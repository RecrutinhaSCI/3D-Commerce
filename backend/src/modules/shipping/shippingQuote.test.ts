/**
 * Cotação do carrinho (unitário): regra única de frete grátis, status
 * público (ok / fixed / unavailable), retirada sempre presente e NENHUM
 * fallback silencioso para a tabela fixa quando o Melhor Envio está ligado.
 * Prisma, cupom e Melhor Envio mockados — nenhum banco nem API é tocado.
 * Ponta a ponta (HTTP + pedido): orders/orderShipping.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';
import { Prisma } from '@prisma/client';

type Product = {
  id: string; name: string; active: boolean; purchaseMode: string; stock: number;
  price: Prisma.Decimal; promotionalPrice: Prisma.Decimal | null;
  weight: Prisma.Decimal | null; width: Prisma.Decimal | null; height: Prisma.Decimal | null; depth: Prisma.Decimal | null;
};
const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
const product = (p: Partial<Record<'price' | 'promotionalPrice' | 'weight' | 'width' | 'height' | 'depth', number | null>> & { id?: string } = {}): Product => ({
  id: p.id ?? 'p1',
  name: 'PLA',
  active: true,
  purchaseMode: 'DIRECT',
  stock: 99,
  price: new Prisma.Decimal(p.price ?? 100),
  promotionalPrice: dec(p.promotionalPrice ?? null),
  weight: dec(p.weight === undefined ? 1.25 : p.weight),
  width: dec(p.width === undefined ? 21 : p.width),
  height: dec(p.height === undefined ? 8 : p.height),
  depth: dec(p.depth === undefined ? 21 : p.depth),
});

const db = {
  cart: null as null | { items: Array<{ quantity: number; product: Product }> },
  threshold: 299 as number | null,
};
const prismaMock = {
  cart: { findUnique: vi.fn(async () => db.cart) },
  siteSettings: {
    findUnique: vi.fn(async () => (db.threshold === null ? null : { freeShippingThreshold: new Prisma.Decimal(db.threshold) })),
  },
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));

const resolveForOrder = vi.fn();
vi.mock('../coupons/coupons.service', () => ({ couponsService: { resolveForOrder } }));

const meState = { configured: true };
const quoteMelhorEnvio = vi.fn();
vi.mock('./melhorEnvio', async (orig) => {
  const real = await orig<typeof import('./melhorEnvio')>();
  return { ...real, isMelhorEnvioConfigured: () => meState.configured, quoteMelhorEnvio };
});

const { shippingService, applyFreeShipping } = await import('./shipping.service');
const { MelhorEnvioError } = await import('./melhorEnvio');

const QUOTED = [
  { method: 'PAC', serviceId: 1, serviceName: 'PAC', carrier: 'Correios', price: 23.5, deadlineDays: 8 },
  { method: 'SEDEX', serviceId: 2, serviceName: 'SEDEX', carrier: 'Correios', price: 41.3, deadlineDays: 3 },
];

beforeEach(() => {
  db.cart = { items: [{ quantity: 1, product: product() }] };
  db.threshold = 299;
  meState.configured = true;
  quoteMelhorEnvio.mockReset().mockResolvedValue(QUOTED);
  resolveForOrder.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const byMethod = (q: { options: Array<{ method: string; price: number }> }) =>
  Object.fromEntries(q.options.map((o) => [o.method, o.price]));

describe('applyFreeShipping — regra única', () => {
  const opts = (pac: number | null, sedex: number | null) =>
    [
      ...(pac === null ? [] : [{ method: 'PAC' as const, price: pac }]),
      ...(sedex === null ? [] : [{ method: 'SEDEX' as const, price: sedex }]),
      { method: 'PICKUP' as const, price: 0 },
    ];
  const prices = (o: Array<{ method: string; price: number }>) => Object.fromEntries(o.map((x) => [x.method, x.price]));

  it('sem benefício: nada muda', () => {
    expect(prices(applyFreeShipping(opts(23.5, 41.3), false))).toEqual({ PAC: 23.5, SEDEX: 41.3, PICKUP: 0 });
  });
  it('PAC grátis e Sedex paga só a diferença', () => {
    expect(prices(applyFreeShipping(opts(23.5, 41.3), true))).toEqual({ PAC: 0, SEDEX: 17.8, PICKUP: 0 });
  });
  it('diferença nunca negativa', () => {
    expect(prices(applyFreeShipping(opts(50, 40), true))).toEqual({ PAC: 0, SEDEX: 0, PICKUP: 0 });
  });
  it('sem PAC na cotação: Sedex cheio (sem valor de referência)', () => {
    expect(prices(applyFreeShipping(opts(null, 41.3), true))).toEqual({ SEDEX: 41.3, PICKUP: 0 });
  });
});

describe('quoteForCart — cotação real (status ok)', () => {
  it('PAC e Sedex do Melhor Envio + retirada, com prazo, transportadora e origem', async () => {
    const q = await shippingService.quoteForCart('u1', { cep: '01310-100' });
    expect(q).toMatchObject({ status: 'ok', message: null, retryable: false, freeShippingThreshold: 299, freeShippingApplied: false });
    expect(q.options).toEqual([
      { method: 'PAC', label: 'PAC', deadline: 'Até 8 dias úteis', deadlineDays: 8, price: 23.5, basePrice: 23.5, carrier: 'Correios', serviceId: 1, serviceName: 'PAC', source: 'melhor_envio' },
      { method: 'SEDEX', label: 'Sedex', deadline: 'Até 3 dias úteis', deadlineDays: 3, price: 41.3, basePrice: 41.3, carrier: 'Correios', serviceId: 2, serviceName: 'SEDEX', source: 'melhor_envio' },
      { method: 'PICKUP', label: 'Retirada na loja', deadline: 'Em até 1 dia útil', price: 0, basePrice: 0, deadlineDays: null, carrier: null, serviceId: null, serviceName: 'Retirada na loja', source: 'store' },
    ]);
  });

  it('manda ao Melhor Envio os itens do carrinho do banco (preço promocional, medidas)', async () => {
    db.cart = { items: [{ quantity: 3, product: product({ id: 'p9', price: 150, promotionalPrice: 120, weight: 0.5 }) }] };
    await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(quoteMelhorEnvio).toHaveBeenCalledWith('01310100', [
      { productId: 'p9', quantity: 3, unitPrice: 120, weight: 0.5, width: 21, height: 8, depth: 21 },
    ]);
  });

  it('acima do limite: PAC grátis e Sedex paga a diferença; basePrice preserva o valor cheio', async () => {
    db.cart = { items: [{ quantity: 3, product: product({ price: 100 }) }] }; // 300 ≥ 299
    const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(byMethod(q)).toEqual({ PAC: 0, SEDEX: 17.8, PICKUP: 0 });
    expect(q.freeShippingApplied).toBe(true);
    expect(q.options.find((o) => o.method === 'SEDEX')?.basePrice).toBe(41.3);
  });

  it('limite 0 desliga o frete grátis por valor', async () => {
    db.threshold = 0;
    db.cart = { items: [{ quantity: 10, product: product() }] };
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100' })).PAC).toBe(23.5);
  });

  it('cupom FREE_SHIPPING válido = mesma regra; cupom inválido não dá benefício', async () => {
    resolveForOrder.mockResolvedValueOnce({ freeShipping: true });
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' }))).toEqual({
      PAC: 0,
      SEDEX: 17.8,
      PICKUP: 0,
    });

    resolveForOrder.mockRejectedValueOnce(new Error('Cupom esgotado.'));
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' })).PAC).toBe(23.5);
  });
});

describe('quoteForCart — Melhor Envio ligado + falha: SÓ retirada (sem tabela fixa)', () => {
  it.each([
    ['TIMEOUT', true],
    ['UNAUTHORIZED', true],
    ['HTTP_ERROR', true],
    ['BAD_RESPONSE', true],
    ['MISSING_PRODUCT_DATA', false],
  ] as const)('erro %s: unavailable, retryable=%s, sem código interno na resposta', async (code, retryable) => {
    quoteMelhorEnvio.mockRejectedValueOnce(new MelhorEnvioError(code, 'falhou', code === 'MISSING_PRODUCT_DATA' ? ['p1'] : []));
    const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(q).toMatchObject({ status: 'unavailable', retryable });
    expect(q.options.map((o) => o.method)).toEqual(['PICKUP']);
    expect(q.message).toBeTruthy();
    expect(JSON.stringify(q)).not.toContain(code);
    // O motivo técnico fica no log do servidor.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(code));
  });

  it('nenhum serviço para o CEP: unavailable (não tenta de novo)', async () => {
    quoteMelhorEnvio.mockResolvedValueOnce([]);
    const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(q).toMatchObject({ status: 'unavailable', retryable: false });
    expect(q.options.map((o) => o.method)).toEqual(['PICKUP']);
  });

  it('erro inesperado (não do Melhor Envio) não é mascarado', async () => {
    quoteMelhorEnvio.mockRejectedValueOnce(new TypeError('bug'));
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toThrow('bug');
  });
});

describe('quoteForCart — Melhor Envio desligado (status fixed, legado)', () => {
  beforeEach(() => {
    meState.configured = false;
  });

  it('tabela fixa, sem chamar o Melhor Envio', async () => {
    const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(q).toMatchObject({ status: 'fixed', message: null });
    expect(byMethod(q)).toEqual({ PAC: 24.9, SEDEX: 42.9, PICKUP: 0 });
    expect(q.options.every((o) => o.serviceId === null && o.deadlineDays === null)).toBe(true);
    expect(quoteMelhorEnvio).not.toHaveBeenCalled();
  });

  it('frete grátis na tabela fixa segue a regra única (PAC 0, Sedex R$ 18)', async () => {
    resolveForOrder.mockResolvedValueOnce({ freeShipping: true });
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' }))).toEqual({
      PAC: 0,
      SEDEX: 18,
      PICKUP: 0,
    });
  });

  it('rota pública legada (getShippingOptions) usa a mesma regra', async () => {
    expect(byMethod({ options: await shippingService.getShippingOptions(300) })).toEqual({ PAC: 0, SEDEX: 18, PICKUP: 0 });
    expect(byMethod({ options: await shippingService.getShippingOptions(100) })).toEqual({ PAC: 24.9, SEDEX: 42.9, PICKUP: 0 });
  });
});

describe('quoteForCart — validação', () => {
  it('CEP inválido = 400', async () => {
    await expect(shippingService.quoteForCart('u1', { cep: '123' })).rejects.toMatchObject({ status: 400 });
  });

  it('carrinho vazio ou inexistente = 400', async () => {
    db.cart = null;
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toMatchObject({ status: 400 });
    db.cart = { items: [] };
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toMatchObject({ status: 400 });
  });

  it('produto só sob orçamento ou sem estoque = 400 (mesma regra do pedido)', async () => {
    db.cart = { items: [{ quantity: 1, product: { ...product(), purchaseMode: 'QUOTE' } }] };
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toMatchObject({ status: 400 });
    db.cart = { items: [{ quantity: 5, product: { ...product(), stock: 2 } }] };
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toMatchObject({ status: 400 });
  });
});

function routeHandlers(router: Router, method: string, path: string) {
  const layer = (router.stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>)
    .find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.map((s) => s.handle) ?? [];
}

describe('rota POST /shipping/quote', () => {
  it('exige login e passa pelo rate limit da cotação, nessa ordem', async () => {
    const [{ shippingRouter }, { authMiddleware }, { shippingQuoteRateLimiter }] = await Promise.all([
      import('./shipping.routes'),
      import('../../middlewares/authMiddleware'),
      import('../../middlewares/rateLimiters'),
    ]);
    const handlers = routeHandlers(shippingRouter, 'post', '/shipping/quote');
    expect(handlers.slice(0, 2)).toEqual([authMiddleware, shippingQuoteRateLimiter]);
  }, 30_000);

  it('a rota antiga de opções continua pública', async () => {
    const { shippingRouter } = await import('./shipping.routes');
    const { authMiddleware } = await import('../../middlewares/authMiddleware');
    const handlers = routeHandlers(shippingRouter, 'get', '/public/shipping/options');
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).not.toContain(authMiddleware);
  });
});
