/**
 * Frete ponta a ponta: rota POST /api/shipping/quote (HTTP de verdade) +
 * shipping.service + cliente Melhor Envio REAL (só o `fetch` externo é
 * simulado) + ordersService.createFromCart.
 *
 * Prisma, cupom e e-mail mockados — nenhum banco, nenhuma API real é tocada.
 *
 * Garantias cobertas:
 *   - valor cotado = valor salvo/cobrado no pedido (mesma cotação, via cache);
 *   - frete grátis: PAC grátis e Sedex pagando só a diferença (nunca negativo);
 *   - expectedShippingValue/shippingValue do front nunca viram valor cobrado;
 *   - troca de CEP entre cotação e pedido; serviço que deixou de existir;
 *   - produto sem medidas; Melhor Envio desligado = legado; ligado + erro =
 *     NÃO usa a tabela fixa; resposta pública sem códigos internos;
 *   - pedidos antigos com os campos novos nulos.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Banco em memória (mock do Prisma)
// ---------------------------------------------------------------------------
type FakeProduct = {
  id: string; name: string; sku: string | null; active: boolean; purchaseMode: 'DIRECT' | 'QUOTE' | 'BOTH'; stock: number;
  price: Prisma.Decimal; promotionalPrice: Prisma.Decimal | null;
  weight: Prisma.Decimal | null; width: Prisma.Decimal | null; height: Prisma.Decimal | null; depth: Prisma.Decimal | null;
};
const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
function product(over: Partial<Record<'price' | 'weight' | 'width' | 'height' | 'depth', number | null>> & { id?: string } = {}): FakeProduct {
  return {
    id: over.id ?? 'p1', name: 'PLA Preto 1kg', sku: 'PLA-1', active: true, purchaseMode: 'DIRECT', stock: 50,
    price: new Prisma.Decimal(over.price ?? 100), promotionalPrice: null,
    weight: dec(over.weight === undefined ? 1.25 : over.weight),
    width: dec(over.width === undefined ? 21 : over.width),
    height: dec(over.height === undefined ? 8 : over.height),
    depth: dec(over.depth === undefined ? 21 : over.depth),
  };
}

const db = {
  cart: null as null | { id: string; items: Array<{ productId: string; quantity: number; product: FakeProduct }> },
  threshold: 299,
  storedOrder: null as unknown,
};
const orderCreate = vi.fn(async ({ data }: { data: Record<string, any> }) => ({
  id: 'ord_1', userId: data.userId, ...data,
  paymentDiscount: new Prisma.Decimal(0), mpPaymentId: null, trackingCode: null,
  createdAt: new Date(), updatedAt: new Date(),
  items: data.items.create.map((i: Record<string, unknown>, n: number) => ({ id: `it${n}`, ...i, createdAt: new Date() })),
  user: null,
}));
const tx = {
  coupon: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
  order: { create: orderCreate },
  cartItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
};
const prismaMock = {
  cart: { findUnique: vi.fn(async () => db.cart) },
  siteSettings: { findUnique: vi.fn(async () => ({ freeShippingThreshold: new Prisma.Decimal(db.threshold) })) },
  user: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, email: `${where.id}@t.test`, role: where.id === 'admin-isolation' ? 'ADMIN' : 'CUSTOMER' })) },
  order: { findFirst: vi.fn(async () => db.storedOrder) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

const resolveForOrder = vi.fn();
vi.mock('../coupons/coupons.service', () => ({ couponsService: { resolveForOrder } }));

// ---------------------------------------------------------------------------
// Melhor Envio: só o fetch externo é simulado (cliente, cache e regra reais)
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
type MePrices = { pac?: number | null; sedex?: number | null; status?: number };
let mePricesByCep: Record<string, MePrices> = {};
const meFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  const p = mePricesByCep[body.to.postal_code] ?? {};
  if (p.status && p.status !== 200) return new Response('{}', { status: p.status });
  const services = [];
  if (p.pac != null) services.push({ id: 1, name: 'PAC', custom_price: String(p.pac), custom_delivery_time: 7, company: { name: 'Correios' } });
  if (p.sedex != null) services.push({ id: 2, name: 'SEDEX', custom_price: String(p.sedex), custom_delivery_time: 2, company: { name: 'Correios' } });
  return new Response(JSON.stringify(services), { status: 200 });
});
vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  return url.includes('melhorenvio') ? meFetch(url, init) : realFetch(input, init);
});

const { env } = await import('../../config/env');
const { clearQuoteCache } = await import('../shipping/melhorEnvio');
const { ordersService } = await import('./orders.service');
const { createOrderSchema } = await import('./orders.schemas');
const { shippingRouter } = await import('../shipping/shipping.routes');
const { errorHandler } = await import('../../middlewares/errorHandler');
const { signAuthToken } = await import('../../utils/jwt');

const ORIGINAL_ME = {
  MELHOR_ENVIO_TOKEN: env.MELHOR_ENVIO_TOKEN,
  SHIPPING_ORIGIN_CEP: env.SHIPPING_ORIGIN_CEP,
  MELHOR_ENVIO_BASE_URL: env.MELHOR_ENVIO_BASE_URL,
};
function setMelhorEnvio(enabled: boolean) {
  env.MELHOR_ENVIO_TOKEN = enabled ? 'token-de-teste' : undefined;
  env.SHIPPING_ORIGIN_CEP = enabled ? '95700000' : undefined;
  env.MELHOR_ENVIO_BASE_URL = 'https://sandbox.melhorenvio.com.br';
}

const CEP_A = '01310100';
const CEP_B = '69005000';

function orderInput(over: Record<string, unknown> = {}, cep = CEP_A) {
  return createOrderSchema.parse({
    customerName: 'Cliente Teste', customerEmail: 'cliente@t.test', customerPhone: '54999999999',
    address: {
      recipientName: 'Cliente Teste', phone: '54999999999', zipCode: cep, street: 'Rua A', number: '1',
      district: 'Centro', city: 'São Paulo', state: 'SP',
    },
    shippingMethod: 'PAC', paymentMethod: 'PIX',
    ...over,
  });
}
const savedData = () => orderCreate.mock.calls.at(-1)![0].data as Record<string, any>;
const num = (v: unknown) => Number(String(v));

// ---------------------------------------------------------------------------
// HTTP: app mínimo com a rota real + errorHandler real
// ---------------------------------------------------------------------------
let server: http.Server;
let baseUrl = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', shippingRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  Object.assign(env, ORIGINAL_ME);
  vi.unstubAllGlobals();
});

async function postQuote(body: unknown, user: string | null = 'u1') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${signAuthToken({ sub: user, email: `${user}@t.test`, role: 'CUSTOMER' })}`;
  const res = await realFetch(`${baseUrl}/api/shipping/quote`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.clone().text(), json: (await res.json()) as any };
}

beforeEach(() => {
  env.MELHOR_ENVIO_HOMOLOGATION_ONLY = 'false';
  setMelhorEnvio(true);
  clearQuoteCache();
  mePricesByCep = { [CEP_A]: { pac: 23.5, sedex: 41.3 }, [CEP_B]: { pac: 58.2, sedex: 97.4 } };
  db.cart = { id: 'cart1', items: [{ productId: 'p1', quantity: 1, product: product() }] };
  db.threshold = 299;
  db.storedOrder = null;
  meFetch.mockClear();
  orderCreate.mockClear();
  resolveForOrder.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ===========================================================================
describe('rota POST /api/shipping/quote (HTTP)', () => {
  it('sem login = 401; CEP inválido = 400', async () => {
    expect((await postQuote({ cep: CEP_A }, null)).status).toBe(401);
    const bad = await postQuote({ cep: '123' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toBe('CEP inválido.');
  });

  it('cotação real: status ok, PAC/Sedex com prazo + retirada', async () => {
    const r = await postQuote({ cep: '01310-100' });
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe('ok');
    expect(r.json.data.options.map((o: any) => [o.method, o.price, o.deadlineDays])).toEqual([
      ['PAC', 23.5, 7],
      ['SEDEX', 41.3, 2],
      ['PICKUP', 0, null],
    ]);
  });

  it.each([
    ['token inválido', { status: 401 }],
    ['provedor fora do ar', { status: 500 }],
  ])('Melhor Envio ligado + erro (%s): unavailable, só retirada, SEM tabela fixa e sem código interno', async (_l, p) => {
    mePricesByCep[CEP_A] = p;
    const r = await postQuote({ cep: CEP_A });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ status: 'unavailable', retryable: true });
    expect(r.json.data.options.map((o: any) => o.method)).toEqual(['PICKUP']);
    expect(r.json.data.message).toMatch(/Tente novamente/);
    expect(r.text).not.toMatch(/UNAUTHORIZED|HTTP_ERROR|TIMEOUT|BAD_RESPONSE|fallbackReason|token/i);
  });

  it('rate limit: 30 cotações/min por usuário, depois 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await postQuote({ cep: CEP_A }, 'u-rate')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Tudo veio do cache: uma única ida ao Melhor Envio.
    expect(meFetch).toHaveBeenCalledTimes(1);
  }, 30_000);
});

// ===========================================================================
describe('cotação → criação do pedido', () => {
  it('valor cotado = valor salvo/cobrado (mesma cotação, sem nova chamada)', async () => {
    const q = await postQuote({ cep: CEP_A });
    const sedex = q.json.data.options.find((o: any) => o.method === 'SEDEX');

    const order = await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', expectedShippingValue: sedex.price }));
    expect(order.shippingValue).toBe(sedex.price);
    expect(num(savedData().shippingValue)).toBe(41.3);
    expect(num(savedData().total)).toBe(141.3);
    expect(savedData()).toMatchObject({
      shippingMethod: 'SEDEX', shippingServiceId: 2, shippingServiceName: 'SEDEX', shippingCarrier: 'Correios',
      shippingDeadlineDays: 2, shippingQuoteSource: 'melhor_envio',
    });
    expect(order).toMatchObject({ shippingServiceId: 2, shippingDeadlineDays: 2, shippingQuoteSource: 'melhor_envio' });
    expect(meFetch).toHaveBeenCalledTimes(1); // cache de 10 min reaproveitado
  });

  it('cache expirado/limpo: recota e cobra o valor novo (sem expected = aceita o valor do servidor)', async () => {
    await postQuote({ cep: CEP_A });
    clearQuoteCache();
    mePricesByCep[CEP_A] = { pac: 25, sedex: 44 };
    await ordersService.createFromCart('u1', orderInput());
    expect(meFetch).toHaveBeenCalledTimes(2);
    expect(num(savedData().shippingValue)).toBe(25);
  });

  it('frete grátis pelo limite: PAC 0 e Sedex paga só a diferença', async () => {
    db.cart!.items[0].quantity = 3; // 300 ≥ 299
    const q = await postQuote({ cep: CEP_A });
    const prices = Object.fromEntries(q.json.data.options.map((o: any) => [o.method, o.price]));
    expect(prices).toEqual({ PAC: 0, SEDEX: 17.8, PICKUP: 0 });
    expect(q.json.data.freeShippingApplied).toBe(true);

    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', expectedShippingValue: 17.8 }));
    expect(num(savedData().shippingValue)).toBe(17.8);
  });

  it('cupom FREE_SHIPPING: mesma regra no checkout e no pedido', async () => {
    resolveForOrder.mockResolvedValue({
      coupon: { id: 'c1', code: 'FRETE3D', usageLimit: null, discountType: 'FREE_SHIPPING' }, discountAmount: 0, freeShipping: true,
    });
    const q = await postQuote({ cep: CEP_A, couponCode: 'FRETE3D' });
    expect(Object.fromEntries(q.json.data.options.map((o: any) => [o.method, o.price]))).toEqual({ PAC: 0, SEDEX: 17.8, PICKUP: 0 });

    await ordersService.createFromCart('u1', orderInput({ couponCode: 'FRETE3D', shippingMethod: 'PAC', expectedShippingValue: 0 }));
    expect(num(savedData().shippingValue)).toBe(0);
  });

  it('diferença do Sedex nunca fica negativa (PAC mais caro que Sedex)', async () => {
    mePricesByCep[CEP_A] = { pac: 50, sedex: 40 };
    db.cart!.items[0].quantity = 3;
    const q = await postQuote({ cep: CEP_A });
    expect(q.json.data.options.find((o: any) => o.method === 'SEDEX').price).toBe(0);
    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', expectedShippingValue: 0 }));
    expect(num(savedData().shippingValue)).toBe(0);
  });

  it('expectedShippingValue manipulado: 409 SHIPPING_CHANGED, nada criado; shippingValue do front é ignorado', async () => {
    const err = await ordersService
      .createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', expectedShippingValue: 0.01 }))
      .catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'SHIPPING_CHANGED' });
    expect(err.details.quote.options.find((o: any) => o.method === 'SEDEX').price).toBe(41.3);
    expect(orderCreate).not.toHaveBeenCalled();

    // Valor "barato" no campo legado shippingValue: ignorado, cobra o real.
    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', shippingValue: 0 }));
    expect(num(savedData().shippingValue)).toBe(41.3);
  });

  it('diferença de até R$ 0,01 é aceita (arredondamento) e cobra o valor do servidor', async () => {
    await ordersService.createFromCart('u1', orderInput({ expectedShippingValue: 23.49 }));
    expect(num(savedData().shippingValue)).toBe(23.5);
  });

  it('troca de CEP entre cotação e pedido: cobra pelo CEP do ENDEREÇO do pedido', async () => {
    const q = await postQuote({ cep: CEP_A }); // viu PAC 23,50 (SP)
    const pacA = q.json.data.options[0].price;

    const err = await ordersService.createFromCart('u1', orderInput({ expectedShippingValue: pacA }, CEP_B)).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'SHIPPING_CHANGED' });
    expect(err.details.quote.options[0].price).toBe(58.2);

    await ordersService.createFromCart('u1', orderInput({}, CEP_B));
    expect(num(savedData().shippingValue)).toBe(58.2);
  });

  it('serviço escolhido deixou de existir: 409 com as opções atuais', async () => {
    await postQuote({ cep: CEP_A });
    clearQuoteCache();
    mePricesByCep[CEP_A] = { pac: 23.5, sedex: null }; // Sedex sumiu
    const err = await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX', expectedShippingValue: 41.3 })).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'SHIPPING_CHANGED' });
    expect(err.details.quote.options.map((o: any) => o.method)).toEqual(['PAC', 'PICKUP']);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('Melhor Envio ligado + erro: PAC recusado (409), NUNCA cobrado pela tabela fixa; retirada funciona', async () => {
    mePricesByCep[CEP_A] = { status: 500 };
    const err = await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'PAC' })).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'SHIPPING_CHANGED' });
    expect(err.details.quote.status).toBe('unavailable');
    expect(orderCreate).not.toHaveBeenCalled();

    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'PICKUP', expectedShippingValue: 0 }));
    expect(savedData()).toMatchObject({ shippingMethod: 'PICKUP', shippingQuoteSource: 'store', shippingServiceId: null });
    expect(num(savedData().shippingValue)).toBe(0);
  });

  it('produto sem medidas: sem chamar o Melhor Envio, só retirada (sem tabela fixa)', async () => {
    db.cart!.items.push({ productId: 'p2', quantity: 1, product: product({ id: 'p2', weight: null }) });
    const q = await postQuote({ cep: CEP_A });
    expect(q.json.data).toMatchObject({ status: 'unavailable', retryable: false });
    expect(q.json.data.options.map((o: any) => o.method)).toEqual(['PICKUP']);
    expect(meFetch).not.toHaveBeenCalled();

    const err = await ordersService.createFromCart('u1', orderInput()).catch((e) => e);
    expect(err).toMatchObject({ status: 409 });
  });

  it('carrinho com produto inativo: cotação recusa como o pedido recusaria', async () => {
    db.cart!.items[0].product.active = false;
    const r = await postQuote({ cep: CEP_A });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/não está mais disponível/);
  });
});

// ===========================================================================
describe('Melhor Envio DESLIGADO — comportamento legado (tabela fixa)', () => {
  beforeEach(() => setMelhorEnvio(false));

  it('cotação fixed: PAC 24,90 / Sedex 42,90 / retirada, sem chamar a API', async () => {
    const q = await postQuote({ cep: CEP_A });
    expect(q.json.data.status).toBe('fixed');
    expect(Object.fromEntries(q.json.data.options.map((o: any) => [o.method, o.price]))).toEqual({ PAC: 24.9, SEDEX: 42.9, PICKUP: 0 });
    expect(meFetch).not.toHaveBeenCalled();
  });

  it('pedido cobra a tabela fixa e grava a origem; acima do limite PAC 0 e Sedex R$ 18', async () => {
    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'PAC', expectedShippingValue: 24.9 }));
    expect(num(savedData().shippingValue)).toBe(24.9);
    expect(savedData()).toMatchObject({ shippingQuoteSource: 'fixed', shippingServiceId: null, shippingDeadlineDays: null });

    db.cart!.items[0].quantity = 3;
    await ordersService.createFromCart('u1', orderInput({ shippingMethod: 'SEDEX' }));
    expect(num(savedData().shippingValue)).toBe(18);
  });

  it('não exige CEP válido no pedido (como antes)', async () => {
    await ordersService.createFromCart('u1', orderInput({}, '9570'));
    expect(num(savedData().shippingValue)).toBe(24.9);
  });
});

// ===========================================================================
describe('pedidos antigos', () => {
  it('campos novos nulos no banco viram null no DTO', async () => {
    db.storedOrder = {
      id: 'ord_old', userId: 'u1', customerName: 'A', customerEmail: 'a@t.test', customerPhone: '1', customerCpf: null,
      addressSnapshot: {}, subtotal: new Prisma.Decimal(100), shippingValue: new Prisma.Decimal(24.9), shippingMethod: 'PAC',
      shippingServiceId: null, shippingServiceName: null, shippingCarrier: null, shippingDeadlineDays: null, shippingQuoteSource: null,
      discountValue: new Prisma.Decimal(0), paymentDiscount: new Prisma.Decimal(0), total: new Prisma.Decimal(124.9),
      couponId: null, couponCode: null, couponDiscountType: null, status: 'PAID', paymentMethod: 'PIX', paymentStatus: 'APPROVED',
      mpPaymentId: null, notes: null, trackingCode: null, createdAt: new Date(), updatedAt: new Date(), items: [], user: null,
    };
    const dto = await ordersService.getMine('u1', 'ord_old');
    expect(dto).toMatchObject({
      shippingValue: 24.9, shippingMethod: 'PAC', shippingServiceId: null, shippingServiceName: null,
      shippingCarrier: null, shippingDeadlineDays: null, shippingQuoteSource: null,
    });
  });
});


describe('homologação isolada — HTTP e pedido, sem Sandbox para clientes', () => {
  beforeEach(() => { env.MELHOR_ENVIO_HOMOLOGATION_ONLY = 'true'; });
  const sample = { productId: 'simulation-only', quantity: 1, unitPrice: 100, weight: 1, width: 20, height: 10, depth: 20 };
  async function sandboxQuote(user: string | null, body: unknown = { cep: CEP_A, items: [sample] }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = 'Bearer ' + signAuthToken({ sub: user, email: user+'@t.test', role: user === 'admin-isolation' ? 'ADMIN' : 'CUSTOMER' });
    return realFetch(baseUrl+'/api/admin/integrations/melhor-envio/sandbox/quote', { method: 'POST', headers, body: JSON.stringify(body) });
  }
  it('cliente com produto sem medidas recebe tabela fixa, mesmo tentando forjar o contexto', async () => {
    db.cart!.items[0].product = product({ weight: null, width: null, height: null, depth: null });
    const r = await postQuote({ cep: CEP_A, sandbox: true, sandboxAdmin: true, items: [sample] }, 'public-isolation');
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe('fixed');
    expect(r.json.data.options.map((o: any) => [o.method, o.price])).toEqual([['PAC',24.9],['SEDEX',42.9],['PICKUP',0]]);
    expect(meFetch).not.toHaveBeenCalled();
  });
  it.each([[100,false,24.9,42.9],[400,false,0,18],[100,true,0,0]])('GET público preserva preços da main: subtotal %s cupom %s', async (subtotal,coupon,pac,sedex) => {
    const r = await realFetch(baseUrl+'/api/public/shipping/options?subtotal='+subtotal+'&freeShipping='+coupon);
    const q = (await r.json()).data;
    expect(q.options.map((o: any) => o.price)).toEqual([pac,sedex,0]);
    expect(meFetch).not.toHaveBeenCalled();
  });
  it('pedido público sem medidas continua com Sedex legado e cupom grátis', async () => {
    db.cart!.items[0].product = product({ weight: null });
    resolveForOrder.mockResolvedValue({ coupon:{id:'coupon1',code:'FREE',usageLimit:null,discountType:'FREE_SHIPPING'},discountAmount:0,freeShipping:true });
    await ordersService.createFromCart('u1',orderInput({shippingMethod:'SEDEX',couponCode:'FREE'}));
    expect(num(savedData().shippingValue)).toBe(0);
    expect(savedData().shippingQuoteSource).toBe('fixed');
    expect(meFetch).not.toHaveBeenCalled();
  });
  it('simulação requer login e ADMIN; cliente não dispara chamada externa', async () => {
    expect((await sandboxQuote(null)).status).toBe(401);
    expect((await sandboxQuote('customer-isolation')).status).toBe(403);
    expect(meFetch).not.toHaveBeenCalled();
  });
  it('admin cota Sandbox e aplica PAC grátis/Sedex diferença sem gravar pedido ou tocar no carrinho', async () => {
    const cartReads = prismaMock.cart.findUnique.mock.calls.length;
    const r = await sandboxQuote('admin-isolation',{cep:CEP_A,items:[sample],couponFreeShipping:true});
    expect(r.status).toBe(200);
    const q = (await r.json()).data;
    expect(q.status).toBe('ok');
    expect(q.options.map((o:any)=>[o.method,o.price])).toEqual([['PAC',0],['SEDEX',17.8],['PICKUP',0]]);
    expect(meFetch).toHaveBeenCalledTimes(1);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(prismaMock.cart.findUnique.mock.calls.length).toBe(cartReads);
  });
  it('rota de simulação fecha fora de Sandbox e fora do modo isolado', async () => {
    env.MELHOR_ENVIO_BASE_URL='https://melhorenvio.com.br';
    expect((await sandboxQuote('admin-isolation')).status).toBe(404);
    env.MELHOR_ENVIO_BASE_URL='https://sandbox.melhorenvio.com.br';
    env.MELHOR_ENVIO_HOMOLOGATION_ONLY='false';
    expect((await sandboxQuote('admin-isolation')).status).toBe(404);
    expect(meFetch).not.toHaveBeenCalled();
  });
});
