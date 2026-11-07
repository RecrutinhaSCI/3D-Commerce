/**
 * Rotas admin das etiquetas (Etapa 1): só admin, travas desligadas por
 * padrão, remetente validado e FORA do DTO público de settings.
 * Prisma mockado; nenhuma chamada ao Melhor Envio.
 */
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CNPJ, validSenderInput } from './labels.testdata';

const settingsRow: Record<string, unknown> = {};
const baseRow = () => ({
  id: 'main', storeName: 'Loja', whatsapp: '5554999990000', email: 'loja@t.test', instagram: null, address: 'texto livre',
  cnpj: TEST_CNPJ, logoUrl: null, heroTitle: null, heroSubtitle: null, aboutTitle: null, aboutText: null, seoTitle: null,
  seoDescription: null, pixDiscountPercent: 5, freeShippingThreshold: 299, shippingNote: null, heroIntervalSeconds: 6,
  shippingSenderJson: null, createdAt: new Date(), updatedAt: new Date(),
});
const prismaMock = {
  user: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id.startsWith('admin') ? { id: where.id, email: 'a@t.test', role: 'ADMIN' } : { id: where.id, email: 'c@t.test', role: 'CUSTOMER' },
    ),
  },
  siteSettings: {
    upsert: vi.fn(async () => ({ ...settingsRow })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(settingsRow, data);
      return { ...settingsRow };
    }),
  },
};
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const realFetch = globalThis.fetch;
const externalFetch = vi.fn();
vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
  String(input).startsWith('http://127.0.0.1') ? realFetch(input, init) : externalFetch(input, init),
);

const { env } = await import('../../../config/env');
const { labelsRouter } = await import('./labels.routes');
const { settingsService } = await import('../../settings/settings.service');
const { errorHandler } = await import('../../../middlewares/errorHandler');
const { signAuthToken } = await import('../../../utils/jwt');

const ORIGINAL = {
  MELHOR_ENVIO_LABELS_ENABLED: env.MELHOR_ENVIO_LABELS_ENABLED,
  MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION: env.MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION,
  MELHOR_ENVIO_BASE_URL: env.MELHOR_ENVIO_BASE_URL,
  SHIPPING_ORIGIN_CEP: env.SHIPPING_ORIGIN_CEP,
};

let server: http.Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', labelsRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  Object.assign(env, ORIGINAL);
  vi.unstubAllGlobals();
});
beforeEach(() => {
  for (const k of Object.keys(settingsRow)) delete settingsRow[k];
  Object.assign(settingsRow, baseRow());
  env.MELHOR_ENVIO_LABELS_ENABLED = undefined;
  env.MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION = undefined;
  env.MELHOR_ENVIO_BASE_URL = 'https://sandbox.melhorenvio.com.br';
  env.SHIPPING_ORIGIN_CEP = '95700000';
  externalFetch.mockClear();
});

const bearer = (id: string) => ({ Authorization: `Bearer ${signAuthToken({ sub: id, email: 'x@t.test', role: id.startsWith('admin') ? 'ADMIN' : 'CUSTOMER' })}` });
const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
  const r = await realFetch(`${base}/api/admin/shipping-labels${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as { ok: boolean; data?: Record<string, any>; error?: { code: string } } };
};

describe('acesso', () => {
  it.each([
    ['GET', '/config'],
    ['GET', '/sender'],
    ['PUT', '/sender'],
  ])('%s %s: sem login 401, cliente 403', async (method, path) => {
    expect((await call(method, path, {}, method === 'PUT' ? validSenderInput() : undefined)).status).toBe(401);
    expect((await call(method, path, bearer('cliente-1'), method === 'PUT' ? validSenderInput() : undefined)).status).toBe(403);
    expect(prismaMock.siteSettings.update).not.toHaveBeenCalled();
  });
});

describe('GET /config', () => {
  it('padrão: desligado, Sandbox = teste, compra bloqueada, remetente pendente', async () => {
    const { status, json } = await call('GET', '/config', bearer('admin-1'));
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ enabled: false, environment: 'sandbox', isTest: true, purchaseAllowed: false });
    expect(json.data!.sender).toMatchObject({ declaration: false, nfe: false });
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it('produção ligada sem a segunda trava continua bloqueada', async () => {
    env.MELHOR_ENVIO_LABELS_ENABLED = 'true';
    env.MELHOR_ENVIO_BASE_URL = 'https://melhorenvio.com.br';
    const { json } = await call('GET', '/config', bearer('admin-1'));
    expect(json.data).toMatchObject({ enabled: true, environment: 'production', isTest: false, purchaseAllowed: false });
    expect(json.data!.blockedReason).toMatch(/PRODUÇÃO/);
  });
});

describe('remetente', () => {
  it('sem cadastro: devolve sugestão das configurações (não grava nada)', async () => {
    const { json } = await call('GET', '/sender', bearer('admin-1'));
    expect(json.data!.sender).toBeNull();
    expect(json.data!.suggestion).toMatchObject({ name: 'Loja', document: TEST_CNPJ, phone: '54999990000', postalCode: '95700000' });
    expect(prismaMock.siteSettings.update).not.toHaveBeenCalled();
  });

  it('PUT inválido: 422 e nada gravado', async () => {
    const { status } = await call('PUT', '/sender', bearer('admin-1'), { ...validSenderInput(), document: '123', stateAbbr: 'ZZ' });
    expect(status).toBe(422);
    expect(prismaMock.siteSettings.update).not.toHaveBeenCalled();
  });

  it('PUT válido grava normalizado; GET e /config refletem; DTO público NÃO expõe o remetente', async () => {
    const put = await call('PUT', '/sender', bearer('admin-1'), validSenderInput());
    expect(put.status).toBe(200);
    expect(put.json.data!.readiness).toEqual({ declaration: true, nfe: true, issues: [] });
    expect(settingsRow.shippingSenderJson).toMatchObject({ document: TEST_CNPJ, postalCode: '95700000', stateAbbr: 'RS' });

    const get = await call('GET', '/sender', bearer('admin-1'));
    expect(get.json.data!.sender).toMatchObject({ name: 'Loja Teste 3D', city: 'Bento Gonçalves' });
    expect(get.json.data!.suggestion).toBeNull();
    expect((await call('GET', '/config', bearer('admin-1'))).json.data!.sender).toMatchObject({ declaration: true, nfe: true });

    const publicDto = await settingsService.getPublic();
    expect(JSON.stringify(publicDto)).not.toMatch(/shippingSender|Rua das Impressoras|95700000/);
    expect(JSON.stringify(await settingsService.getAdmin())).not.toMatch(/shippingSender/);
  });
});
