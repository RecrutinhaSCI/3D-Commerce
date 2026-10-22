/**
 * Cotação do carrinho (POST /api/shipping/quote): cotação real do Melhor Envio,
 * frete grátis só no PAC, retirada sempre presente e fallback para a tabela
 * fixa. Prisma, cupom e Melhor Envio mockados — nenhum banco nem API é tocado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';
import { Prisma } from '@prisma/client';

type Product = {
  id: string; price: Prisma.Decimal; promotionalPrice: Prisma.Decimal | null;
  weight: Prisma.Decimal | null; width: Prisma.Decimal | null; height: Prisma.Decimal | null; depth: Prisma.Decimal | null;
};
const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
const product = (p: Partial<Record<keyof Product, number | null>> & { id?: string } = {}): Product => ({
  id: p.id ?? 'p1',
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

const { shippingService } = await import('./shipping.service');
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

describe('quoteForCart — cotação real', () => {
  it('devolve PAC e Sedex do Melhor Envio + retirada, com prazo e transportadora', async () => {
    const q = await shippingService.quoteForCart('u1', { cep: '01310-100' });
    expect(q.source).toBe('melhor_envio');
    expect(q.fallbackReason).toBeNull();
    expect(q.freeShippingThreshold).toBe(299);
    expect(q.options).toEqual([
      { method: 'PAC', label: 'PAC', deadline: 'Até 8 dias úteis', deadlineDays: 8, price: 23.5, carrier: 'Correios', serviceId: 1, serviceName: 'PAC' },
      { method: 'SEDEX', label: 'Sedex', deadline: 'Até 3 dias úteis', deadlineDays: 3, price: 41.3, carrier: 'Correios', serviceId: 2, serviceName: 'SEDEX' },
      { method: 'PICKUP', label: 'Retirada na loja', deadline: 'Em até 1 dia útil', price: 0, deadlineDays: null, carrier: null, serviceId: null, serviceName: 'Retirada na loja' },
    ]);
  });

  it('manda ao Melhor Envio os itens do carrinho do banco (preço promocional, medidas)', async () => {
    db.cart = { items: [{ quantity: 3, product: product({ id: 'p9', price: 150, promotionalPrice: 120, weight: 0.5 }) }] };
    await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(quoteMelhorEnvio).toHaveBeenCalledWith('01310100', [
      { productId: 'p9', quantity: 3, unitPrice: 120, weight: 0.5, width: 21, height: 8, depth: 21 },
    ]);
  });

  it('acima do limite do admin, só o PAC fica grátis', async () => {
    db.cart = { items: [{ quantity: 3, product: product({ price: 100 }) }] }; // 300 ≥ 299
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100' }))).toEqual({ PAC: 0, SEDEX: 41.3, PICKUP: 0 });
  });

  it('limite 0 desliga o frete grátis por valor', async () => {
    db.threshold = 0;
    db.cart = { items: [{ quantity: 10, product: product() }] };
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100' })).PAC).toBe(23.5);
  });

  it('cupom FREE_SHIPPING válido zera só o PAC; cupom inválido não dá benefício', async () => {
    resolveForOrder.mockResolvedValueOnce({ freeShipping: true });
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' }))).toEqual({
      PAC: 0,
      SEDEX: 41.3,
      PICKUP: 0,
    });

    resolveForOrder.mockRejectedValueOnce(new Error('Cupom esgotado.'));
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' })).PAC).toBe(23.5);
  });
});

describe('quoteForCart — fallback para a tabela fixa', () => {
  const FIXED = { PAC: 24.9, SEDEX: 42.9, PICKUP: 0 };

  it('sem configuração: tabela fixa, sem chamar o Melhor Envio', async () => {
    meState.configured = false;
    const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
    expect(q.source).toBe('fixed');
    expect(q.fallbackReason).toBe('NOT_CONFIGURED');
    expect(byMethod(q)).toEqual(FIXED);
    expect(q.options.every((o) => o.serviceId === null && o.deadlineDays === null)).toBe(true);
    expect(quoteMelhorEnvio).not.toHaveBeenCalled();
  });

  it.each(['MISSING_PRODUCT_DATA', 'TIMEOUT', 'UNAUTHORIZED', 'HTTP_ERROR', 'BAD_RESPONSE'] as const)(
    'erro %s do Melhor Envio: tabela fixa com o motivo',
    async (code) => {
      quoteMelhorEnvio.mockRejectedValueOnce(new MelhorEnvioError(code, 'falhou', code === 'MISSING_PRODUCT_DATA' ? ['p1'] : []));
      const q = await shippingService.quoteForCart('u1', { cep: '01310100' });
      expect(q).toMatchObject({ source: 'fixed', fallbackReason: code });
      expect(byMethod(q)).toEqual(FIXED);
    },
  );

  it('nenhum serviço para o CEP: tabela fixa (NO_SERVICES)', async () => {
    quoteMelhorEnvio.mockResolvedValueOnce([]);
    expect(await shippingService.quoteForCart('u1', { cep: '01310100' })).toMatchObject({ source: 'fixed', fallbackReason: 'NO_SERVICES' });
  });

  it('a tabela fixa mantém a regra atual do cupom (zera PAC e Sedex) — é a que o pedido cobra hoje', async () => {
    meState.configured = false;
    resolveForOrder.mockResolvedValueOnce({ freeShipping: true });
    expect(byMethod(await shippingService.quoteForCart('u1', { cep: '01310100', couponCode: 'FRETE3D' }))).toEqual({
      PAC: 0,
      SEDEX: 0,
      PICKUP: 0,
    });
  });

  it('erro inesperado (não do Melhor Envio) não é mascarado', async () => {
    quoteMelhorEnvio.mockRejectedValueOnce(new TypeError('bug'));
    await expect(shippingService.quoteForCart('u1', { cep: '01310100' })).rejects.toThrow('bug');
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
