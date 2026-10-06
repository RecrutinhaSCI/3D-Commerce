import { ShippingMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';

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
 * Para cotação real (Melhor Envio), troque `getShippingOptions` mantendo o
 * contrato — ver docs/integracoes/frete-melhor-envio.md.
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
};
