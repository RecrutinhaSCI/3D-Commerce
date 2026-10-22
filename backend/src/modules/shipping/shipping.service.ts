import { env } from '../../config/env';
import { Prisma, ShippingMethod, type Product } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';
import { HttpError } from '../../utils/httpError';
import { assertCartPurchasable, effectivePrice } from '../cart/cart.service';
import { couponsService } from '../coupons/coupons.service';
import {
  isMelhorEnvioConfigured,
  melhorEnvioConfig,
  MelhorEnvioError,
  normalizeCep,
  quoteMelhorEnvio,
  type QuoteItem,
} from './melhorEnvio';

/**
 * Frete — FONTE ÚNICA da regra. O checkout (`POST /api/shipping/quote`) e a
 * criação do pedido (`ordersService.createFromCart`) chamam a MESMA função,
 * `quoteForItems`, com o carrinho do banco: o valor exibido é o valor cobrado.
 *
 * Origem dos preços:
 *   - Melhor Envio LIGADO: PAC e Sedex reais (Correios) por CEP + medidas.
 *     Se a cotação falhar (timeout, token, produto sem medidas, CEP sem
 *     atendimento...), NÃO cai na tabela fixa: só a retirada fica disponível
 *     (status `unavailable`) e o motivo técnico vai só para o log.
 *   - Melhor Envio DESLIGADO de propósito: tabela fixa (PAC R$ 24,90; Sedex =
 *     PAC + R$ 18,00) — comportamento legado (status `fixed`).
 *   - Retirada na loja: sempre disponível e grátis.
 *
 * Frete grátis (limite do /admin/configuracoes OU cupom FREE_SHIPPING) —
 * `applyFreeShipping`: o PAC fica grátis e o Sedex recebe desconto do valor
 * do PAC da MESMA cotação (o cliente paga só a diferença do upgrade, nunca
 * negativo).
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

/** De onde veio o preço da opção (gravado no pedido em `shippingQuoteSource`). */
export type ShippingQuoteSource = 'melhor_envio' | 'fixed' | 'store';

export interface CartQuoteOption extends ShippingOption {
  /** Preço antes do frete grátis (igual a `price` quando não há benefício). */
  basePrice: number;
  /** Prazo em dias úteis informado pelo serviço de entrega (só na cotação real). */
  deadlineDays: number | null;
  carrier: string | null;
  /** ID do serviço no Melhor Envio (1 = PAC, 2 = Sedex); null na tabela fixa/retirada. */
  serviceId: number | null;
  serviceName: string;
  source: ShippingQuoteSource;
}

/**
 * Resposta PÚBLICA da cotação. Sem códigos internos (token, timeout etc.):
 *   - `ok`          cotação real do Melhor Envio;
 *   - `fixed`       Melhor Envio desligado → tabela fixa;
 *   - `unavailable` Melhor Envio ligado mas sem cotação agora → só retirada.
 */
export interface CartQuote {
  status: 'ok' | 'fixed' | 'unavailable';
  /** Texto amigável para o cliente quando `unavailable`. */
  message: string | null;
  /** Vale a pena "Tentar de novo" (falha temporária do provedor)? */
  retryable: boolean;
  freeShippingThreshold: number;
  /** Limite ou cupom deu frete grátis no PAC. */
  freeShippingApplied: boolean;
  options: CartQuoteOption[];
}

const LABELS: Record<ShippingMethod, { label: string; deadline: string }> = {
  [ShippingMethod.PAC]: { label: 'PAC', deadline: '5 a 8 dias úteis' },
  [ShippingMethod.SEDEX]: { label: 'Sedex', deadline: '2 a 4 dias úteis' },
  [ShippingMethod.PICKUP]: { label: 'Retirada na loja', deadline: 'Em até 1 dia útil' },
};

const MESSAGES = {
  temporary: 'Não conseguimos calcular o frete agora. Tente novamente em instantes ou escolha retirar na loja.',
  missingData: 'Não conseguimos calcular a entrega para um dos produtos do carrinho. Escolha retirar na loja ou fale com a gente no WhatsApp.',
  noService: 'Os Correios (PAC/Sedex) não atendem este CEP no momento. Escolha retirar na loja ou fale com a gente no WhatsApp.',
};

async function freeShippingThreshold(): Promise<number> {
  const s = await prisma.siteSettings.findUnique({
    where: { id: 'main' },
    select: { freeShippingThreshold: true },
  });
  return decimalToNumber(s?.freeShippingThreshold) ?? DEFAULT_FREE_THRESHOLD;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Regra ÚNICA de frete grátis: PAC grátis; Sedex com desconto do valor do PAC
 * da mesma cotação (paga só a diferença, nunca negativo). Sem PAC na cotação
 * não há valor de referência → Sedex cheio. Retirada não muda.
 */
export function applyFreeShipping<T extends { method: ShippingMethod; price: number }>(options: T[], eligible: boolean): T[] {
  if (!eligible) return options;
  const pac = options.find((o) => o.method === ShippingMethod.PAC);
  if (!pac) return options;
  const pacPrice = pac.price;
  return options.map((o) => {
    if (o.method === ShippingMethod.PAC) return { ...o, price: 0 };
    if (o.method === ShippingMethod.SEDEX) return { ...o, price: Math.max(0, round2(o.price - pacPrice)) };
    return o;
  });
}

function isFreeEligible(subtotal: number, threshold: number, couponFreeShipping: boolean): boolean {
  return couponFreeShipping || (threshold > 0 && subtotal >= threshold);
}

function deadlineText(days: number): string {
  return days <= 1 ? 'Até 1 dia útil' : `Até ${days} dias úteis`;
}

function pickupOption(): CartQuoteOption {
  return {
    method: ShippingMethod.PICKUP,
    ...LABELS[ShippingMethod.PICKUP],
    price: 0,
    basePrice: 0,
    deadlineDays: null,
    carrier: null,
    serviceId: null,
    serviceName: LABELS[ShippingMethod.PICKUP].label,
    source: 'store',
  };
}

/** Tabela fixa (Melhor Envio desligado) — PAC, Sedex e retirada. */
function fixedOptions(): CartQuoteOption[] {
  const fixed = (method: ShippingMethod, price: number): CartQuoteOption => ({
    method,
    ...LABELS[method],
    price,
    basePrice: price,
    deadlineDays: null,
    carrier: null,
    serviceId: null,
    serviceName: LABELS[method].label,
    source: 'fixed',
  });
  return [
    fixed(ShippingMethod.PAC, PAC_BASE),
    fixed(ShippingMethod.SEDEX, round2(PAC_BASE + SEDEX_EXTRA)),
    pickupOption(),
  ];
}

type CartLine = { quantity: number; product: Product };

/** Itens do carrinho (do BANCO) no formato da cotação + subtotal autoritativo. */
export function toQuoteItems(lines: CartLine[]): { items: QuoteItem[]; subtotal: number } {
  const items: QuoteItem[] = lines.map((l) => ({
    productId: l.product.id,
    quantity: l.quantity,
    unitPrice: decimalToNumber(effectivePrice(l.product)) ?? 0,
    weight: decimalToNumber(l.product.weight),
    width: decimalToNumber(l.product.width),
    height: decimalToNumber(l.product.height),
    depth: decimalToNumber(l.product.depth),
  }));
  // Mesma conta do pedido (Decimal), para o limite de frete grátis bater.
  const subtotal = lines.reduce(
    (acc, l) => acc.add(new Prisma.Decimal(effectivePrice(l.product)).mul(l.quantity)),
    new Prisma.Decimal(0),
  );
  return { items, subtotal: decimalToNumber(subtotal) ?? 0 };
}


type QuoteParams = { cep: string; items: QuoteItem[]; subtotal: number; couponFreeShipping: boolean };

// Contrato exato da main enquanto a homologação estiver isolada.
function legacyOptions(subtotal: number, threshold: number, coupon: boolean): CartQuoteOption[] {
  const pac = coupon || (threshold > 0 && subtotal >= threshold) ? 0 : PAC_BASE;
  const prices = { PAC: pac, SEDEX: coupon ? 0 : round2(pac + SEDEX_EXTRA), PICKUP: 0 };
  return fixedOptions().map(o => ({ ...o, price: prices[o.method], basePrice: prices[o.method] }));
}

async function calculateQuote(params: QuoteParams, sandbox: boolean): Promise<CartQuote> {
  const threshold = await freeShippingThreshold();
  const eligible = isFreeEligible(params.subtotal, threshold, params.couponFreeShipping);
  const base = { freeShippingThreshold: threshold, freeShippingApplied: eligible };

  if (!sandbox && env.MELHOR_ENVIO_HOMOLOGATION_ONLY !== 'false') {
    return { status: 'fixed', message: null, retryable: false, ...base, options: legacyOptions(params.subtotal, threshold, params.couponFreeShipping) };
  }
  // Desligado de propósito → tabela fixa (comportamento legado).
  if (sandbox && !isMelhorEnvioConfigured()) throw new HttpError(503, 'INTEGRATION_NOT_CONFIGURED', 'Sandbox não configurado.');
  if (!isMelhorEnvioConfigured()) {
    return { status: 'fixed', message: null, retryable: false, ...base, options: applyFreeShipping(fixedOptions(), eligible) };
  }

  const cep = normalizeCep(params.cep);
  if (!cep) throw HttpError.badRequest('CEP inválido.');

  const unavailable = (message: string, retryable: boolean): CartQuote => ({
    status: 'unavailable',
    message,
    retryable,
    ...base,
    options: [pickupOption()],
  });

  try {
    const quoted = await quoteMelhorEnvio(cep, params.items);
    if (quoted.length === 0) {
      console.warn(`[shipping] Melhor Envio sem PAC/Sedex para o CEP ${cep.slice(0, 5)}*** — só retirada.`);
      return unavailable(MESSAGES.noService, false);
    }
    const options: CartQuoteOption[] = quoted.map((q) => ({
      method: q.method,
      label: LABELS[q.method].label,
      deadline: deadlineText(q.deadlineDays),
      deadlineDays: q.deadlineDays,
      price: q.price,
      basePrice: q.price,
      carrier: q.carrier,
      serviceId: q.serviceId,
      serviceName: q.serviceName,
      source: 'melhor_envio',
    }));
    options.push(pickupOption());
    return { status: 'ok', message: null, retryable: false, ...base, options: applyFreeShipping(options, eligible) };
  } catch (err) {
    if (!(err instanceof MelhorEnvioError)) throw err;
    if (err.code === 'INVALID_CEP') throw HttpError.badRequest('CEP inválido.');
    // OAuth configurado mas ainda NÃO conectado e sem token manual: é o
    // mesmo que "desligado de propósito" → tabela fixa (legado).
    if (sandbox && err.code === 'NOT_CONFIGURED') throw new HttpError(503, 'INTEGRATION_NOT_CONFIGURED', 'Conecte o Sandbox primeiro.');
    if (err.code === 'NOT_CONFIGURED') {
      return { status: 'fixed', message: null, retryable: false, ...base, options: applyFreeShipping(fixedOptions(), eligible) };
    }
    // Motivo técnico SÓ no log (sem token/dados): o cliente recebe `unavailable`.
    const extra = err.code === 'MISSING_PRODUCT_DATA' ? ` (${err.productIds.length} produto(s) sem peso/medidas: ${err.productIds.join(', ')})` : '';
    console.warn(`[shipping] cotação Melhor Envio indisponível: ${err.code}${extra} — só retirada.`);
    if (err.code === 'MISSING_PRODUCT_DATA') return unavailable(MESSAGES.missingData, false);
    return unavailable(MESSAGES.temporary, true);
  }
}

export const shippingService = {
  /**
   * Tabela fixa para um subtotal (rota pública legada `GET /public/shipping/options`).
   * Mesma regra de frete grátis da cotação.
   */
  async getShippingOptions(subtotal: number, couponFreeShipping = false): Promise<ShippingOption[]> {
    const threshold = await freeShippingThreshold();
    const options = env.MELHOR_ENVIO_HOMOLOGATION_ONLY !== 'false'
      ? legacyOptions(subtotal, threshold, couponFreeShipping)
      : applyFreeShipping(fixedOptions(), isFreeEligible(subtotal, threshold, couponFreeShipping));
    return options.map(
      ({ method, label, deadline, price }) => ({ method, label, deadline, price }),
    );
  },

  async getThreshold(): Promise<number> {
    return freeShippingThreshold();
  },

  /**
   * Cotação AUTORITATIVA para itens já carregados do banco. Usada pela rota de
   * cotação e pela criação do pedido — por isso não lê nada do cliente além do
   * CEP de destino e do benefício de cupom já resolvido no servidor.
   */
  async quoteForItems(params: QuoteParams): Promise<CartQuote> {
    return calculateQuote(params, false);
  },

  // Somente a rota admin usa esta entrada; nunca aceita seleção via checkout.
  async quoteSandboxForItems(params: QuoteParams): Promise<CartQuote> {
    if (env.MELHOR_ENVIO_HOMOLOGATION_ONLY !== 'true' || melhorEnvioConfig().environment !== 'sandbox') {
      throw new HttpError(404, 'NOT_FOUND', 'Recurso indisponível.');
    }
    return calculateQuote(params, true);
  },

  /**
   * Cotação para o CARRINHO do usuário (checkout). Itens, preços e medidas vêm
   * do banco; o cupom só é usado para saber se dá frete grátis (inválido =
   * sem benefício; a criação do pedido revalida e devolve o erro real).
   */
  async quoteForCart(userId: string, input: { cep: string; couponCode?: string | null }): Promise<CartQuote> {
    if (!normalizeCep(input.cep)) throw HttpError.badRequest('CEP inválido.');

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    const lines = cart?.items ?? [];
    if (lines.length === 0) throw HttpError.badRequest('Carrinho vazio.');
    assertCartPurchasable(lines);

    const { items, subtotal } = toQuoteItems(lines);

    let couponFreeShipping = false;
    if (input.couponCode) {
      try {
        couponFreeShipping = (await couponsService.resolveForOrder(input.couponCode, subtotal, userId)).freeShipping;
      } catch {
        couponFreeShipping = false;
      }
    }

    return this.quoteForItems({ cep: input.cep, items, subtotal, couponFreeShipping });
  },
};
