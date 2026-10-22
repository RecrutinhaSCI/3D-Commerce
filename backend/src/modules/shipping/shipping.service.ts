import { ShippingMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';
import { HttpError } from '../../utils/httpError';
import { effectivePrice } from '../cart/cart.service';
import { couponsService } from '../coupons/coupons.service';
import {
  isMelhorEnvioConfigured,
  MelhorEnvioError,
  type MelhorEnvioErrorCode,
  normalizeCep,
  quoteMelhorEnvio,
  type QuoteItem,
} from './melhorEnvio';

/**
 * Frete — FONTE ÚNICA da regra (o checkout só escolhe a modalidade).
 *
 * Regra atual (tabela fixa, sem cotação por CEP):
 *   - PAC:    R$ 24,90; grátis quando o subtotal atinge o "frete grátis acima de"
 *             configurado em /admin/configuracoes (SiteSettings.freeShippingThreshold).
 *   - Sedex:  PAC + R$ 18,00 (acima do limite, paga só os R$ 18,00).
 *   - Retirada na loja: grátis.
 *   - Cupom FREE_SHIPPING zera PAC e Sedex.
 *
 * Cotação real (Melhor Envio, Correios PAC/Sedex): `quoteForCart`, com esta
 * tabela como fallback. A criação do pedido ainda cobra pela tabela fixa —
 * ver docs/integracoes/frete-melhor-envio.md.
 */
const PAC_BASE = 24.9;
const SEDEX_EXTRA = 18;
const DEFAULT_FREE_THRESHOLD = 299;

export interface ShippingOption {
  method: ShippingMethod;
  label: string;
  deadline: string;
  price: number;
}

const LABELS: Record<ShippingMethod, { label: string; deadline: string }> = {
  [ShippingMethod.PAC]: { label: 'PAC', deadline: '5 a 8 dias úteis' },
  [ShippingMethod.SEDEX]: { label: 'Sedex', deadline: '2 a 4 dias úteis' },
  [ShippingMethod.PICKUP]: { label: 'Retirada na loja', deadline: 'Em até 1 dia útil' },
};

async function freeShippingThreshold(): Promise<number> {
  const s = await prisma.siteSettings.findUnique({
    where: { id: 'main' },
    select: { freeShippingThreshold: true },
  });
  return decimalToNumber(s?.freeShippingThreshold) ?? DEFAULT_FREE_THRESHOLD;
}

const round2 = (n: number) => Number(n.toFixed(2));

export const shippingService = {
  /** Opções de entrega para um subtotal (produtos, antes do cupom). */
  async getShippingOptions(subtotal: number, couponFreeShipping = false): Promise<ShippingOption[]> {
    const threshold = await freeShippingThreshold();
    const reachesFree = threshold > 0 && subtotal >= threshold;
    const pac = couponFreeShipping || reachesFree ? 0 : PAC_BASE;
    const sedex = couponFreeShipping ? 0 : pac + SEDEX_EXTRA;
    const prices: Record<ShippingMethod, number> = {
      [ShippingMethod.PAC]: round2(pac),
      [ShippingMethod.SEDEX]: round2(sedex),
      [ShippingMethod.PICKUP]: 0,
    };
    return (Object.keys(prices) as ShippingMethod[]).map((method) => ({
      method,
      ...LABELS[method],
      price: prices[method],
    }));
  },

  /** Preço autoritativo de uma modalidade (usado na criação do pedido). */
  async priceFor(method: ShippingMethod, subtotal: number, couponFreeShipping: boolean): Promise<number> {
    const options = await this.getShippingOptions(subtotal, couponFreeShipping);
    return options.find((o) => o.method === method)?.price ?? PAC_BASE;
  },

  async getThreshold(): Promise<number> {
    return freeShippingThreshold();
  },

  /**
   * Cotação para o CARRINHO do usuário e o CEP de destino (checkout).
   *
   *   - Com Melhor Envio configurado: PAC e Sedex com preço/prazo reais.
   *     Frete grátis (limite do admin ou cupom FREE_SHIPPING) zera só o PAC.
   *   - Sem configuração, produto sem peso/medidas, erro ou timeout do
   *     provedor: cai na tabela fixa (`getShippingOptions`), a mesma que a
   *     criação do pedido cobra hoje — o checkout nunca fica sem frete.
   *   - Retirada na loja sempre presente.
   *
   * Só EXIBIÇÃO: o valor cobrado continua sendo recalculado na criação do pedido.
   */
  async quoteForCart(userId: string, input: { cep: string; couponCode?: string | null }): Promise<CartQuote> {
    const cep = normalizeCep(input.cep);
    if (!cep) throw HttpError.badRequest('CEP inválido.');

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    const lines = (cart?.items ?? []).filter((i) => i.product);
    if (lines.length === 0) throw HttpError.badRequest('Carrinho vazio.');

    const items: QuoteItem[] = lines.map((i) => ({
      productId: i.product.id,
      quantity: i.quantity,
      unitPrice: decimalToNumber(effectivePrice(i.product)) ?? 0,
      weight: decimalToNumber(i.product.weight),
      width: decimalToNumber(i.product.width),
      height: decimalToNumber(i.product.height),
      depth: decimalToNumber(i.product.depth),
    }));
    const subtotal = round2(items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0));
    const threshold = await freeShippingThreshold();

    // Cupom só para saber se dá frete grátis; inválido/esgotado = sem benefício
    // (a criação do pedido revalida e devolve o erro real).
    let couponFreeShipping = false;
    if (input.couponCode) {
      try {
        couponFreeShipping = (await couponsService.resolveForOrder(input.couponCode, subtotal, userId)).freeShipping;
      } catch {
        couponFreeShipping = false;
      }
    }

    const fallback = async (reason: MelhorEnvioErrorCode | 'NO_SERVICES'): Promise<CartQuote> => {
      const fixed = await this.getShippingOptions(subtotal, couponFreeShipping);
      return {
        source: 'fixed',
        fallbackReason: reason,
        freeShippingThreshold: threshold,
        options: fixed.map((o) => ({ ...o, deadlineDays: null, carrier: null, serviceId: null, serviceName: o.label })),
      };
    };

    if (!isMelhorEnvioConfigured()) return fallback('NOT_CONFIGURED');

    try {
      const quoted = await quoteMelhorEnvio(cep, items);
      if (quoted.length === 0) {
        console.warn(`[shipping] Melhor Envio sem PAC/Sedex para o CEP ${cep.slice(0, 5)}*** — usando tabela fixa.`);
        return fallback('NO_SERVICES');
      }
      const freePac = couponFreeShipping || (threshold > 0 && subtotal >= threshold);
      const options: CartQuoteOption[] = quoted.map((q) => ({
        method: q.method,
        label: LABELS[q.method].label,
        deadline: deadlineText(q.deadlineDays),
        deadlineDays: q.deadlineDays,
        price: q.method === ShippingMethod.PAC && freePac ? 0 : q.price,
        carrier: q.carrier,
        serviceId: q.serviceId,
        serviceName: q.serviceName,
      }));
      options.push(pickupOption());
      return { source: 'melhor_envio', fallbackReason: null, freeShippingThreshold: threshold, options };
    } catch (err) {
      if (!(err instanceof MelhorEnvioError)) throw err;
      // Sem token/dados no log: só o motivo (e quantos produtos estão incompletos).
      const extra = err.code === 'MISSING_PRODUCT_DATA' ? ` (${err.productIds.length} produto(s) sem peso/medidas)` : '';
      console.warn(`[shipping] cotação Melhor Envio indisponível: ${err.code}${extra} — usando tabela fixa.`);
      return fallback(err.code);
    }
  },
};

export interface CartQuoteOption extends ShippingOption {
  /** Prazo em dias úteis (só na cotação real). */
  deadlineDays: number | null;
  carrier: string | null;
  /** ID do serviço no Melhor Envio (1 = PAC, 2 = Sedex); null na tabela fixa/retirada. */
  serviceId: number | null;
  serviceName: string;
}

export interface CartQuote {
  source: 'melhor_envio' | 'fixed';
  /** Motivo de ter caído na tabela fixa (null quando a cotação é real). */
  fallbackReason: MelhorEnvioErrorCode | 'NO_SERVICES' | null;
  freeShippingThreshold: number;
  options: CartQuoteOption[];
}

function deadlineText(days: number): string {
  return days <= 1 ? 'Até 1 dia útil' : `Até ${days} dias úteis`;
}

function pickupOption(): CartQuoteOption {
  return {
    method: ShippingMethod.PICKUP,
    ...LABELS[ShippingMethod.PICKUP],
    price: 0,
    deadlineDays: null,
    carrier: null,
    serviceId: null,
    serviceName: LABELS[ShippingMethod.PICKUP].label,
  };
}
