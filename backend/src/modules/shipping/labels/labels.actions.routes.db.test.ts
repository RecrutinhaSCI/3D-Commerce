/**
 * Rotas de ação das etiquetas pela HTTP, com workflow REAL em Postgres REAL
 * e Melhor Envio FALSO. Duas instâncias da API (pools separados) para
 * duplo clique/concorrência. Só roda com TEST_DATABASE_URL local "_test".
 */
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CFG, createOrder, DB_LOCK_TIMEOUT_MS, dbEnabled, DECL, lockTestDb, newClient, ORDER_PII, PKG, resetDb } from './labels.dbHarness.testdata';
import { FakeMe, meError } from './labels.fakeMe.testdata';

// Só o login (authMiddleware) usa o prisma global; o workflow recebe o banco de teste.
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id.startsWith('admin') ? { id: where.id, email: 'a@t.test', role: 'ADMIN' } : { id: where.id, email: 'c@t.test', role: 'CUSTOMER' },
    },
  },
}));

const { createLabelsRouter } = await import('./labels.routes');
const { createLabelWorkflow, CONFIRMATION_TTL_MS } = await import('./labelWorkflow');
const { errorHandler } = await import('../../../middlewares/errorHandler');
const { signAuthToken } = await import('../../../utils/jwt');

const admin = { Authorization: `Bearer ${signAuthToken({ sub: 'admin-1', email: 'a@t.test', role: 'ADMIN' })}` };
const NO_LIMIT = { windowMs: 60_000, limit: 10_000 };

describe.skipIf(!dbEnabled)('rotas de etiqueta — HTTP + Postgres real', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let me: FakeMe;
  let clock: number;
  let orderId: string;
  const servers: http.Server[] = [];
  let baseA = '';
  let baseB = '';

  async function start(db: PrismaClient) {
    const workflow = createLabelWorkflow({ db, client: new Proxy({}, { get: (_t, k) => (me.client() as never)[k] }) as never, config: CFG, now: () => new Date(clock), oauthConfigured: true });
    const app = express();
    app.use(express.json());
    app.use('/api', createLabelsRouter({ workflow, limits: { read: NO_LIMIT, query: NO_LIMIT, write: NO_LIMIT, financial: { ...NO_LIMIT, perOrder: true }, financialTotal: NO_LIMIT } }));
    app.use(errorHandler);
    const s = app.listen(0);
    servers.push(s);
    await new Promise((r) => s.once('listening', r));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }

  let unlock: () => Promise<void>;
  beforeAll(async () => {
    unlock = await lockTestDb();
    dbA = newClient();
    dbB = newClient();
    await Promise.all([dbA.$connect(), dbB.$connect()]);
    baseA = await start(dbA);
    baseB = await start(dbB);
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    servers.forEach((s) => s.close());
    await Promise.all([dbA?.$disconnect(), dbB?.$disconnect()]);
    await unlock?.();
  });
  beforeEach(async () => {
    await resetDb(dbA);
    me = new FakeMe();
    clock = Date.parse('2026-10-28T12:00:00Z');
    orderId = await createOrder(dbA);
  });

  /** Tudo que sai pela HTTP fica aqui, para a checagem final de vazamento. */
  const bodies: string[] = [];
  async function call(method: string, path: string, body?: unknown, base = baseA, headers: Record<string, string> = admin) {
    const r = await fetch(`${base}/api/admin/shipping-labels/orders/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    bodies.push(text);
    return { status: r.status, json: JSON.parse(text) as { ok: boolean; data?: any; error?: { code: string; details?: any } } };
  }
  const prepare = async (o = orderId) => {
    const r = await call('POST', `${o}/label/prepare`, { package: PKG, fiscal: DECL });
    expect(r.status).toBe(200);
    return r.json.data;
  };

  it('fluxo completo pela HTTP: PREPARE → confirmação → compra → pronta para download', async () => {
    let r = await call('GET', `${orderId}/label`);
    expect(r.json.data).toMatchObject({ label: null, availableActions: ['PREPARE'], order: { paid: true, serviceSupported: true } });

    const p = await prepare();
    expect(p.confirmation).toMatchObject({ price: 23.45, customerShippingValue: 24.9, difference: -1.45 });
    expect(p.label).toMatchObject({ status: 'AWAITING_CONFIRMATION', isTest: true, canPurchase: true, pendingConfirmation: { price: 23.45 } });

    r = await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token });
    expect(r.status).toBe(200);
    expect(r.json.data.label).toMatchObject({ status: 'LABEL_READY', values: { paidPrice: 23.45, difference: -1.45, differenceBasis: 'paid' }, file: { downloadable: true } });
    expect(r.json.data.label.availableActions).toEqual(['DOWNLOAD', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE']);
    expect(r.json.data.confirmation).toBeUndefined();

    const ev = await call('GET', `${orderId}/label/events`);
    expect(ev.json.data.map((e: { type: string }) => e.type)).toContain('PURCHASE_CONFIRMED');
    expect((await dbA.order.findUniqueOrThrow({ where: { id: orderId } })).trackingCode).toBeNull();
  });

  it('pedido inexistente 404; não pago 409; retirada 422; sem etiqueta 404', async () => {
    expect((await call('GET', 'nao-existe/label')).status).toBe(404);
    expect((await call('POST', 'nao-existe/label/prepare', { package: PKG, fiscal: DECL })).json.error!.code).toBe('ORDER_NOT_FOUND');
    const unpaid = await createOrder(dbA, { paymentStatus: 'PENDING' });
    expect((await call('POST', `${unpaid}/label/prepare`, { package: PKG, fiscal: DECL })).json.error!.code).toBe('ORDER_NOT_PAID');
    const pickup = await createOrder(dbA, { shippingMethod: 'PICKUP' });
    const pk = await call('POST', `${pickup}/label/prepare`, { package: PKG, fiscal: DECL });
    expect(pk).toMatchObject({ status: 422, json: { error: { code: 'PICKUP_ORDER' } } });
    const none = await call('POST', `${orderId}/label/purchase`, { labelId: 'lab1', token: 'A'.repeat(43) });
    expect(none).toMatchObject({ status: 404, json: { error: { code: 'LABEL_NOT_FOUND' } } });
    expect(me.calls.add).toBe(0);
  });

  it('confirmação inválida, expirada, de outra etiqueta', async () => {
    const p = await prepare();
    expect((await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: 'B'.repeat(43) })).json.error!.code).toBe('CONFIRMATION_INVALID');
    expect((await call('POST', `${orderId}/label/purchase`, { labelId: 'outra-etiqueta', token: p.confirmation.token })).json.error!.code).toBe('LABEL_CHANGED');
    clock += CONFIRMATION_TTL_MS + 1;
    const exp = await call('GET', `${orderId}/label`);
    expect(exp.json.data.label.availableActions).not.toContain('PURCHASE');
    expect((await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token })).json.error!.code).toBe('CONFIRMATION_EXPIRED');
    expect(me.calls.checkout).toBe(0);
  });

  it('duplo clique em DUAS instâncias da API: uma compra, um 409', async () => {
    const p = await prepare();
    me.delay.get = 60;
    const body = { labelId: p.label.id, token: p.confirmation.token };
    const rs = await Promise.all([call('POST', `${orderId}/label/purchase`, body, baseA), call('POST', `${orderId}/label/purchase`, body, baseB)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(me.calls.checkout).toBe(1);
  });

  it('preço mudou: 409 PRICE_CHANGED com nova confirmação; a antiga morre, a nova compra', async () => {
    const p = await prepare();
    me.orders.get((await dbA.shipmentLabel.findFirstOrThrow({ where: { orderId } })).meOrderId!)!.price = 25.1;
    const r = await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token });
    expect(r).toMatchObject({ status: 409, json: { error: { code: 'PRICE_CHANGED', details: { previousPrice: 23.45, price: 25.1 } } } });
    const fresh = r.json.error!.details.confirmation;
    expect(fresh).toMatchObject({ price: 25.1, difference: 0.2 });
    expect((await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token })).json.error!.code).toBe('CONFIRMATION_INVALID');
    expect((await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: fresh.token })).json.data.label.status).toBe('LABEL_READY');
    expect(me.calls.checkout).toBe(1);
  });

  it('timeout no checkout: 200 com erro sanitizado e SÓ "reconciliar"; reconciliação resolve', async () => {
    const p = await prepare();
    me.failNext('checkout', (id) => {
      me.markPaid(id!);
      throw meError('checkout', 'TIMEOUT', 'unknown');
    });
    const r = await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token });
    expect(r.status).toBe(200);
    expect(r.json.data.error).toMatchObject({ code: 'TIMEOUT', outcome: 'unknown' });
    expect(r.json.data.label).toMatchObject({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true, availableActions: ['RECONCILE', 'ADD_NOTE'] });
    const rec = await call('POST', `${orderId}/label/reconcile`, { reason: 'Conferir após timeout' });
    expect(rec.json.data.label.status).toBe('PURCHASED');
    expect(me.calls.checkout).toBe(1);
  });

  it('cancelamento: "pode cancelar?", permitido, não permitido e ambíguo', async () => {
    const p = await prepare();
    await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token });
    expect((await call('GET', `${orderId}/label/cancellable`)).json.data.cancellable).toBe(true);

    me.canCancel = false;
    expect((await call('POST', `${orderId}/label/cancel`, { labelId: p.label.id, reason: 'Cliente desistiu' })).json.error!.code).toBe('NOT_CANCELLABLE');

    me.canCancel = true;
    me.failNext('cancel', () => {
      throw meError('cancel', 'TIMEOUT', 'unknown');
    });
    const amb = await call('POST', `${orderId}/label/cancel`, { labelId: p.label.id, reason: 'Cliente desistiu' });
    expect(amb.json.data.label.status).toBe('NEEDS_RECONCILIATION');
    expect((await call('POST', `${orderId}/label/reconcile`, {})).json.data.label.status).toBe('LABEL_READY');

    const ok = await call('POST', `${orderId}/label/cancel`, { labelId: p.label.id, reason: 'Cliente desistiu' });
    expect(ok.json.data).toMatchObject({ label: null, availableActions: ['PREPARE'], history: [{ id: p.label.id, status: 'CANCELED', cancelReason: 'Cliente desistiu' }] });
  });

  it('descarte: não paga OK; paga e desconhecida recusadas', async () => {
    let p = await prepare();
    const ok = await call('POST', `${orderId}/label/discard`, { labelId: p.label.id, reason: 'Caixa errada' });
    expect(ok.json.data).toMatchObject({ label: null, availableActions: ['PREPARE'], history: [{ status: 'DISCARDED' }] });

    p = await prepare();
    const meId = (await dbA.shipmentLabel.findUniqueOrThrow({ where: { id: p.label.id } })).meOrderId!;
    Object.assign(me.orders.get(meId)!, { status: 'expired' });
    expect((await call('POST', `${orderId}/label/discard`, { labelId: p.label.id, reason: 'Caixa errada' })).json.error).toMatchObject({ code: 'DISCARD_NOT_ALLOWED', details: { reason: 'ME_STATUS_UNKNOWN' } });

    Object.assign(me.orders.get(meId)!, { status: 'pending' });
    me.markPaid(meId);
    expect((await call('POST', `${orderId}/label/discard`, { labelId: p.label.id, reason: 'Caixa errada' })).json.error).toMatchObject({ code: 'DISCARD_NOT_ALLOWED', details: { reason: 'PAID_AT_ME' } });
    expect((await call('GET', `${orderId}/label`)).json.data.label.status).toBe('PURCHASED');
    expect(me.calls.remove).toBe(1);
  });

  it('frontend mandando preço/ids/status: 422 e NADA muda', async () => {
    const p = await prepare();
    const before = await dbA.shipmentLabel.findUniqueOrThrow({ where: { id: p.label.id } });
    const r = await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token, price: 0.01, meOrderId: 'x', status: 'PURCHASED' });
    expect(r.status).toBe(422);
    expect(await dbA.shipmentLabel.findUniqueOrThrow({ where: { id: p.label.id } })).toEqual(before);
    expect(me.calls.checkout).toBe(0);
  });

  it('download pela HTTP: PDF real do fluxo; antes da compra, 409 em JSON', async () => {
    const p = await prepare();
    const early = await fetch(`${baseA}/api/admin/shipping-labels/orders/${orderId}/label/file`, { headers: admin });
    expect(early.status).toBe(409);
    bodies.push(await early.text());
    await call('POST', `${orderId}/label/purchase`, { labelId: p.label.id, token: p.confirmation.token });
    const r = await fetch(`${baseA}/api/admin/shipping-labels/orders/${orderId}/label/file?disposition=inline`, { headers: admin });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    const text = Buffer.from(await r.arrayBuffer()).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).not.toMatch(/URL-TEMPORARIA|melhorenvio/);
  });

  it('NENHUMA resposta vaza hash, payload, lease ou dado pessoal; token só nas respostas que o criaram', async () => {
    const all = bodies.join('\n');
    const rows = await dbA.shipmentLabel.findMany();
    for (const s of ['confirmationHash', 'payloadHash', 'lockUntil', 'access_token', 'refresh_token', 'URL-TEMPORARIA', ...ORDER_PII]) expect(all).not.toContain(s);
    for (const r of rows) {
      if (r.confirmationHash) expect(all).not.toContain(r.confirmationHash);
      if (r.payloadHash) expect(all).not.toContain(r.payloadHash);
    }
    const tokenBearing = bodies.filter((b) => b.includes('"token"'));
    for (const b of tokenBearing) expect(b).toMatch(/"confirmation":\{"token"/);
    expect(bodies.length).toBeGreaterThan(30);
  });
});
