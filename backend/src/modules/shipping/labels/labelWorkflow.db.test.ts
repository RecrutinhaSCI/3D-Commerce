/**
 * Ciclo da etiqueta contra Postgres REAL + Melhor Envio FALSO (nenhuma
 * chamada real). Concorrência com DOIS PrismaClient (pools separados),
 * simulando duas instâncias/abas disputando a mesma etiqueta.
 *
 * Só roda com TEST_DATABASE_URL LOCAL cujo banco termina em "_test" — o
 * teste APAGA etiquetas, pedidos e itens. Ex.:
 *   TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/labels_test npx vitest run labelWorkflow.db
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type ShipmentLabel } from '@prisma/client';
import { createLabelWorkflow, CONFIRMATION_TTL_MS, type LabelWorkflow } from './labelWorkflow';
import type { MeLabelsRuntimeConfig } from './meLabelsClient';
import { FakeMe, meError } from './labels.fakeMe.testdata';
import { senderSchema } from './sender';
import { validSenderInput } from './labels.testdata';
import { HttpError } from '../../../utils/httpError';

const TEST_URL = process.env.TEST_DATABASE_URL;
function isSafeTestDb(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && /_test$/.test(u.pathname.slice(1));
  } catch {
    return false;
  }
}
const enabled = isSafeTestDb(TEST_URL);

const CFG: MeLabelsRuntimeConfig = {
  enabled: true, allowProduction: false, environment: 'sandbox',
  baseUrl: 'https://sandbox.melhorenvio.com.br', userAgent: 'teste (t@t.test)', timeoutMs: 1000,
};
const PKG = { weightKg: 1.2, heightCm: 10, widthCm: 20, lengthCm: 30 };
const DECL = { mode: 'DECLARATION' };
const ADMIN = 'admin-1';

describe.skipIf(!enabled)('labelWorkflow — Postgres real', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let me: FakeMe;
  let clock: number;
  let A: LabelWorkflow;
  let B: LabelWorkflow;
  let orderId: string;

  const make = (db: PrismaClient, cfg = CFG) => createLabelWorkflow({ db, client: me.client(), config: cfg, now: () => new Date(clock) });

  beforeAll(async () => {
    dbA = new PrismaClient({ datasourceUrl: TEST_URL });
    dbB = new PrismaClient({ datasourceUrl: TEST_URL });
    await Promise.all([dbA.$connect(), dbB.$connect()]);
  });
  afterAll(async () => {
    await Promise.all([dbA?.$disconnect(), dbB?.$disconnect()]);
  });

  async function createOrder(p: Record<string, unknown> = {}) {
    const o = await dbA.order.create({
      data: {
        customerName: 'Cliente Teste', customerEmail: 'cliente@exemplo.test', customerPhone: '11988887777', customerCpf: '52998224725',
        addressSnapshot: { recipientName: 'Cliente Teste', zipCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP', country: 'BR' },
        subtotal: 212.3, shippingValue: 24.9, total: 237.2, paymentMethod: 'PIX', paymentStatus: 'PAID', status: 'CONFIRMED',
        shippingMethod: 'PAC', shippingQuoteSource: 'fixed',
        items: { create: [{ productName: 'Filamento PLA 1kg', quantity: 2, unitPrice: 99.9, total: 199.8 }, { productName: 'Bico 0.4', quantity: 1, unitPrice: 12.5, total: 12.5 }] },
        ...p,
      },
    });
    return o.id;
  }

  beforeEach(async () => {
    await dbA.shipmentLabelEvent.deleteMany();
    await dbA.shipmentLabel.deleteMany();
    await dbA.orderItem.deleteMany();
    await dbA.order.deleteMany();
    await dbA.siteSettings.upsert({
      where: { id: 'main' },
      create: { id: 'main', storeName: 'Loja', whatsapp: '54999990000', email: 'loja@t.test', address: 'x', shippingSenderJson: senderSchema.parse(validSenderInput()) },
      update: { shippingSenderJson: senderSchema.parse(validSenderInput()) },
    });
    me = new FakeMe();
    clock = Date.parse('2026-10-27T12:00:00Z');
    A = make(dbA);
    B = make(dbB);
    orderId = await createOrder();
  });

  const label = () => dbA.shipmentLabel.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  const events = async () => (await dbA.shipmentLabelEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
  async function rejected(p: Promise<unknown>): Promise<HttpError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      return e as HttpError;
    }
    throw new Error('deveria ter sido recusado');
  }
  const prepared = async () => {
    const r = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
    expect(r.label.status).toBe('AWAITING_CONFIRMATION');
    return r.confirmation!.token;
  };

  // ---------------------------------------------------------------------------

  describe('fluxo feliz', () => {
    it('prepara → confirma → compra → gera; eventos em ordem; pedido intocado', async () => {
      const r = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(r.label).toMatchObject({ status: 'AWAITING_CONFIRMATION', isTest: true, quotedPrice: 23.45, customerShippingValue: 24.9, serviceId: 1 });
      expect(r.confirmation).toMatchObject({ price: 23.45, customerShippingValue: 24.9, difference: -1.45 });
      const row = await label();
      expect(row.meOrderId).toMatch(/aaaa/);
      expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.confirmationHash).not.toContain(r.confirmation!.token);

      const done = await A.purchase(orderId, r.confirmation!.token, ADMIN);
      expect(done.label).toMatchObject({ status: 'LABEL_READY', paidPrice: 23.45, locked: false });
      expect(me.calls).toMatchObject({ add: 1, checkout: 1, generate: 1 });
      expect(await events()).toEqual([
        'CART_ADD_STARTED', 'PREPARED', 'CONFIRMATION_CREATED', 'PURCHASE_STARTED', 'PURCHASE_CONFIRMED', 'GENERATION_STARTED', 'LABEL_GENERATED',
      ]);
      const order = await dbA.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.trackingCode).toBeNull();
    });

    it('eventos sem token, payload, endereço ou documento', async () => {
      const token = await prepared();
      await A.purchase(orderId, token, ADMIN);
      const all = JSON.stringify(await dbA.shipmentLabelEvent.findMany());
      for (const secret of [token, 'Paulista', '52998224725', 'cliente@exemplo.test', '01310100']) expect(all).not.toContain(secret);
    });
  });

  describe('preparação', () => {
    it('pedido não pago, retirada, sem remetente, caixa inválida: recusado sem criar etiqueta', async () => {
      const unpaid = await createOrder({ paymentStatus: 'PENDING' });
      expect((await rejected(A.prepare(unpaid, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('ORDER_NOT_PAID');
      const pickup = await createOrder({ shippingMethod: 'PICKUP' });
      expect((await rejected(A.prepare(pickup, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('PICKUP_ORDER');
      await expect(A.prepare(orderId, { package: { ...PKG, weightKg: 0 }, fiscal: DECL }, ADMIN)).rejects.toThrow();
      await expect(A.prepare(orderId, { package: PKG, fiscal: { mode: 'NFE', nfeKey: '123' } }, ADMIN)).rejects.toThrow();
      await dbA.siteSettings.update({ where: { id: 'main' }, data: { shippingSenderJson: null as never } });
      expect((await rejected(A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('SENDER_MISSING');
      expect(await dbA.shipmentLabel.count()).toBe(0);
      expect(me.calls.add).toBe(0);
    });

    it('travas: desligado ou produção sem liberação → 403, nada gravado nem enviado', async () => {
      const off = make(dbA, { ...CFG, enabled: false });
      expect((await rejected(off.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('LABELS_DISABLED');
      const prod = make(dbA, { ...CFG, environment: 'production', baseUrl: 'https://melhorenvio.com.br' });
      expect((await rejected(prod.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('LABELS_PRODUCTION_BLOCKED');
      expect(await dbA.shipmentLabel.count()).toBe(0);
      expect(me.calls.add).toBe(0);
    });

    it('DUAS preparações simultâneas (dois pools): um só carrinho, mesma etiqueta', async () => {
      me.delay.add = 80;
      const [r1, r2] = await Promise.all([
        A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN),
        B.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN),
      ]);
      expect(r1.label.id).toBe(r2.label.id);
      expect(me.calls.add).toBe(1);
      expect(await dbA.shipmentLabel.count()).toBe(1);
      // Só a vencedora recebe token.
      expect([r1.confirmation, r2.confirmation].filter(Boolean)).toHaveLength(1);
    });

    it('etiqueta ativa existente: preparar de novo devolve a mesma, sem novo carrinho', async () => {
      await prepared();
      const again = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(again.confirmation).toBeUndefined();
      expect(me.calls.add).toBe(1);
      expect(await dbA.shipmentLabel.count()).toBe(1);
    });

    it('segunda etiqueta ATIVA no mesmo pedido é impossível no banco', async () => {
      await prepared();
      const l = await label();
      await expect(
        dbB.shipmentLabel.create({
          data: { orderId, activeOrderId: orderId, environment: 'sandbox', serviceId: 1, fiscalMode: 'DECLARATION', packageJson: {}, declaredValue: 1, customerShippingValue: 1 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect((await label()).id).toBe(l.id);
    });

    it('carrinho recusado (422) → ERROR; preparar de novo reaproveita a MESMA etiqueta', async () => {
      me.failNext('add', () => {
        throw meError('cart.add', 'VALIDATION', 'rejected', 422);
      });
      const r = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(r.label.status).toBe('ERROR');
      expect(r.error?.code).toBe('VALIDATION');
      const retry = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(retry.label).toMatchObject({ id: r.label.id, status: 'AWAITING_CONFIRMATION' });
      expect(await dbA.shipmentLabel.count()).toBe(1);
    });
  });

  describe('confirmação', () => {
    it('expirada → 409 CONFIRMATION_EXPIRED, sem checkout', async () => {
      const token = await prepared();
      clock += CONFIRMATION_TTL_MS + 1;
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('CONFIRMATION_EXPIRED');
      expect(me.calls.checkout).toBe(0);
    });

    it('token errado → CONFIRMATION_INVALID', async () => {
      await prepared();
      expect((await rejected(A.purchase(orderId, 'token-falso', ADMIN))).code).toBe('CONFIRMATION_INVALID');
    });

    it('versão antiga: nova confirmação invalida a anterior', async () => {
      const old = await prepared();
      const fresh = (await A.requestConfirmation(orderId, ADMIN)).confirmation!.token;
      expect((await rejected(A.purchase(orderId, old, ADMIN))).code).toBe('CONFIRMATION_INVALID');
      expect((await A.purchase(orderId, fresh, ADMIN)).label.status).toBe('LABEL_READY');
    });

    it('versão alterada por fora (outra escrita) invalida o token', async () => {
      const token = await prepared();
      await dbB.shipmentLabel.updateMany({ where: { orderId }, data: { version: { increment: 1 } } });
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('CONFIRMATION_INVALID');
      expect(me.calls.checkout).toBe(0);
    });

    it('reaproveitada após a compra → ALREADY_PURCHASED, um único checkout', async () => {
      const token = await prepared();
      await A.purchase(orderId, token, ADMIN);
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('ALREADY_PURCHASED');
      expect((await rejected(B.purchase(orderId, token, ADMIN))).code).toBe('ALREADY_PURCHASED');
      expect(me.calls.checkout).toBe(1);
    });
  });

  describe('compra concorrente (CAS)', () => {
    it('DOIS cliques simultâneos (duas abas/pools): um compra, o outro 409; um checkout', async () => {
      const token = await prepared();
      me.delay.checkout = 80;
      const results = await Promise.allSettled([A.purchase(orderId, token, ADMIN), B.purchase(orderId, token, ADMIN)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const ko = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(ko).toHaveLength(1);
      expect(ko[0].reason).toMatchObject({ status: 409 });
      expect(['PURCHASE_CONFLICT', 'PURCHASE_IN_PROGRESS', 'CONFIRMATION_INVALID']).toContain(ko[0].reason.code);
      expect(me.calls.checkout).toBe(1);
    });

    it('rajada de 10 compras concorrentes nos dois pools: exatamente uma vence', async () => {
      const token = await prepared();
      me.delay.get = 30;
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? A : B).purchase(orderId, token, ADMIN)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(me.calls.checkout).toBe(1);
      expect((await dbA.shipmentLabelEvent.findMany({ where: { type: 'PURCHASE_STARTED' } }))).toHaveLength(1);
    });

    it('depois de PURCHASED (geração recusada) e de LABEL_READY: nova compra recusada', async () => {
      const token = await prepared();
      me.failNext('generate', () => {
        throw meError('generate', 'GENERATION_FAILED', 'rejected', 200);
      });
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label.status).toBe('PURCHASED');
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('ALREADY_PURCHASED');
      expect((await rejected(A.requestConfirmation(orderId, ADMIN))).code).toBe('ALREADY_PURCHASED');
      expect((await A.generate(orderId, ADMIN)).label.status).toBe('LABEL_READY');
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('ALREADY_PURCHASED');
      expect(me.calls.checkout).toBe(1);
    });
  });

  describe('releitura antes do checkout', () => {
    it('preço mudou → 409 PRICE_CHANGED com nova confirmação; sem checkout; novo token compra', async () => {
      const token = await prepared();
      const meId = (await label()).meOrderId!;
      me.orders.get(meId)!.price = 27.1;
      const e = await rejected(A.purchase(orderId, token, ADMIN));
      expect(e.code).toBe('PRICE_CHANGED');
      const details = e.details as { price: number; previousPrice: number; confirmation: { token: string; difference: number } };
      expect(details).toMatchObject({ previousPrice: 23.45, price: 27.1, confirmation: { difference: 2.2 } });
      expect(me.calls.checkout).toBe(0);
      expect((await label()).status).toBe('AWAITING_CONFIRMATION');
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('CONFIRMATION_INVALID');
      expect((await A.purchase(orderId, details.confirmation.token, ADMIN)).label).toMatchObject({ status: 'LABEL_READY', paidPrice: 27.1 });
      expect(await events()).toContain('PRICE_CHANGED');
    });

    it('já paga no ME → NÃO chama checkout; reconcilia para PURCHASED', async () => {
      const token = await prepared();
      me.markPaid((await label()).meOrderId!);
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label.status).toBe('PURCHASED');
      expect(me.calls.checkout).toBe(0);
      expect(await events()).toEqual(expect.arrayContaining(['RECONCILIATION_REQUIRED', 'RECONCILED']));
    });

    it('releitura falhou → ERROR recuperável (checkout não chamado); nova confirmação segue', async () => {
      const token = await prepared();
      me.failNext('get', () => {
        throw meError('order.get', 'TIMEOUT', 'unknown');
      });
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label.status).toBe('ERROR');
      expect(me.calls.checkout).toBe(0);
      const again = await A.requestConfirmation(orderId, ADMIN);
      expect((await A.purchase(orderId, again.confirmation!.token, ADMIN)).label.status).toBe('LABEL_READY');
    });
  });

  describe('resultado do checkout', () => {
    it('TIMEOUT depois de possível compra → NEEDS_RECONCILIATION; nunca recompra; conciliação → PURCHASED', async () => {
      const token = await prepared();
      me.failNext('checkout', (id) => {
        me.markPaid(id!); // a compra ACONTECEU lá
        throw meError('checkout', 'TIMEOUT', 'unknown');
      });
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label).toMatchObject({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true });
      expect(r.error).toMatchObject({ code: 'TIMEOUT', requiresReconciliation: true });
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
      expect((await rejected(A.requestConfirmation(orderId, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
      const again = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN); // não cria outra
      expect(again.label).toMatchObject({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true });
      expect(again.confirmation).toBeUndefined();
      const rec = await A.reconcile(orderId, ADMIN);
      expect(rec.label).toMatchObject({ status: 'PURCHASED', paidPrice: 23.45 });
      expect(me.calls.checkout).toBe(1);
      expect(me.calls.add).toBe(1);
    });

    it('timeout SEM compra lá → conciliação volta para confirmação (sem token); só nova confirmação compra', async () => {
      const token = await prepared();
      me.failNext('checkout', () => {
        throw meError('checkout', 'SERVER_ERROR', 'unknown', 502);
      });
      expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('NEEDS_RECONCILIATION');
      const rec = await A.reconcile(orderId, ADMIN);
      expect(rec.label).toMatchObject({ status: 'AWAITING_CONFIRMATION', confirmationExpiresAt: null });
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('CONFIRMATION_REQUIRED');
      const again = await A.requestConfirmation(orderId, ADMIN);
      expect((await A.purchase(orderId, again.confirmation!.token, ADMIN)).label.status).toBe('LABEL_READY');
      expect(me.calls.checkout).toBe(2); // o 1º falhou SEM comprar (provado pela conciliação)
    });

    it('422 no checkout (ex.: saldo) → reconciliação obrigatória, não ERROR', async () => {
      const token = await prepared();
      me.failNext('checkout', () => {
        throw meError('checkout', 'VALIDATION', 'rejected', 422);
      });
      expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('NEEDS_RECONCILIATION');
    });

    it('recusa antes de processar (429/credencial) → ERROR recuperável', async () => {
      const token = await prepared();
      me.failNext('checkout', () => {
        throw meError('checkout', 'RATE_LIMITED', 'rejected', 429);
      });
      expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('ERROR');
      expect((await A.requestConfirmation(orderId, ADMIN)).label.status).toBe('AWAITING_CONFIRMATION');
    });

    it('ALREADY_PAID no checkout → reconcilia (PURCHASED) sem segunda compra', async () => {
      const token = await prepared();
      me.failNext('checkout', (id) => {
        me.markPaid(id!);
        throw meError('checkout', 'ALREADY_PAID', 'rejected', 422);
      });
      expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('PURCHASED');
      expect(me.calls.checkout).toBe(1);
    });
  });

  describe('crash e lease', () => {
    async function crashDuringCheckout(paidThere: boolean) {
      const token = await prepared();
      me.failNext('checkout', (id) => {
        if (paidThere) me.markPaid(id!);
        throw new Error('processo morreu'); // não é LabelApiError: nada é gravado
      });
      await expect(A.purchase(orderId, token, ADMIN)).rejects.toThrow('processo morreu');
      const row = await label();
      expect(row.status).toBe('PURCHASING');
      expect(row.lockUntil!.getTime()).toBeGreaterThan(clock);
      return token;
    }

    it('PURCHASING com lease ATIVO: compra e conciliação recusadas (em andamento)', async () => {
      const token = await crashDuringCheckout(true);
      expect((await rejected(B.purchase(orderId, token, ADMIN))).code).toBe('PURCHASE_IN_PROGRESS');
      expect((await rejected(B.reconcile(orderId, ADMIN))).code).toBe('PURCHASE_IN_PROGRESS');
      expect(me.calls.checkout).toBe(1);
    });

    it('lease EXPIRADO: vira NEEDS_RECONCILIATION (nunca nova compra) e conciliação acha a compra', async () => {
      const token = await crashDuringCheckout(true);
      clock = (await label()).lockUntil!.getTime() + 1;
      expect((await rejected(B.purchase(orderId, token, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
      expect((await label()).status).toBe('NEEDS_RECONCILIATION');
      expect(await events()).toContain('LEASE_EXPIRED');
      expect((await B.reconcile(orderId, ADMIN)).label.status).toBe('PURCHASED');
      expect(me.calls.checkout).toBe(1);
    });

    it('lease expirado SEM compra lá: conciliação volta para confirmação, nunca compra sozinha', async () => {
      await crashDuringCheckout(false);
      clock = (await label()).lockUntil!.getTime() + 1;
      const v = await B.get(orderId);
      expect(v).toMatchObject({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true });
      expect((await B.reconcile(orderId, ADMIN)).label.status).toBe('AWAITING_CONFIRMATION');
      expect(me.calls.checkout).toBe(1);
    });

    it('duas conciliações simultâneas: uma consulta, a outra 409', async () => {
      const token = await prepared();
      me.failNext('checkout', () => {
        throw meError('checkout', 'TIMEOUT', 'unknown');
      });
      await A.purchase(orderId, token, ADMIN);
      me.delay.get = 80;
      const getsBefore = me.calls.get;
      const rs = await Promise.allSettled([A.reconcile(orderId, ADMIN), B.reconcile(orderId, ADMIN)]);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((rs.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toMatch(/RECONCILIATION_IN_PROGRESS|LABEL_CHANGED/);
      expect(me.calls.get - getsBefore).toBe(1);
    });
  });

  describe('conciliação', () => {
    async function toReconcile() {
      const token = await prepared();
      me.failNext('checkout', () => {
        throw meError('checkout', 'NETWORK', 'unknown');
      });
      await A.purchase(orderId, token, ADMIN);
      return (await label()).meOrderId!;
    }

    it('cancelada no ME → CANCELED e inativa; nova preparação cria OUTRA etiqueta', async () => {
      const meId = await toReconcile();
      Object.assign(me.orders.get(meId)!, { status: 'canceled', canceledAt: '2026-10-27T13:00:00.000Z' });
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('CANCELED');
      const old = await label();
      expect(old.activeOrderId).toBeNull();
      const fresh = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(fresh.label.id).not.toBe(old.id);
      expect(await dbA.shipmentLabel.count({ where: { orderId } })).toBe(2);
    });

    it('estado inconclusivo (expirada sem pagamento) → continua NEEDS_RECONCILIATION + evento', async () => {
      const meId = await toReconcile();
      me.orders.get(meId)!.status = 'expired';
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('NEEDS_RECONCILIATION');
      expect(await events()).toContain('RECONCILIATION_INCONCLUSIVE');
    });

    it('ME fora do ar durante a conciliação → continua NEEDS_RECONCILIATION', async () => {
      await toReconcile();
      me.failNext('get', () => {
        throw meError('order.get', 'SERVER_ERROR', 'unknown', 503);
      });
      const r = await A.reconcile(orderId, ADMIN);
      expect(r.label.status).toBe('NEEDS_RECONCILIATION');
      expect(r.error?.code).toBe('SERVER_ERROR');
      expect((await label()).lockUntil).toBeNull();
    });

    it('paga e já gerada no ME → LABEL_READY direto', async () => {
      const meId = await toReconcile();
      me.markPaid(meId);
      me.orders.get(meId)!.status = 'generated';
      me.orders.get(meId)!.generatedAt = '2026-10-27T12:30:00.000Z';
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('LABEL_READY');
    });

    it('todo passo de conciliação gera evento', async () => {
      const meId = await toReconcile();
      me.markPaid(meId);
      await A.reconcile(orderId, ADMIN);
      const ev = await dbA.shipmentLabelEvent.findMany({ where: { orderId, type: 'RECONCILED' } });
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ fromStatus: 'NEEDS_RECONCILIATION', toStatus: 'PURCHASED', userId: ADMIN });
    });
  });

  describe('geração', () => {
    it('falha ambígua → NEEDS_RECONCILIATION; conciliação decide; gerar de novo só se o ME mostra não gerada', async () => {
      const token = await prepared();
      me.failNext('generate', () => {
        throw meError('generate', 'TIMEOUT', 'unknown');
      });
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label.status).toBe('NEEDS_RECONCILIATION');
      expect((await rejected(A.generate(orderId, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('PURCHASED'); // ME: paga, não gerada
      expect((await A.generate(orderId, ADMIN)).label.status).toBe('LABEL_READY');
      expect(me.calls.checkout).toBe(1);
    });

    it('GENERATING com lease vencido → reconciliação (não gera às cegas)', async () => {
      const token = await prepared();
      me.failNext('generate', () => {
        throw new Error('processo morreu');
      });
      await expect(A.purchase(orderId, token, ADMIN)).rejects.toThrow();
      expect((await label()).status).toBe('GENERATING');
      clock = (await label()).lockUntil!.getTime() + 1;
      expect((await rejected(A.generate(orderId, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
    });

    it('DUAS gerações simultâneas (só o CAS por versão protege): uma chamada ao ME', async () => {
      const token = await prepared();
      me.failNext('generate', () => {
        throw meError('generate', 'GENERATION_FAILED', 'rejected', 200);
      });
      expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('PURCHASED');
      me.delay.generate = 80;
      const before = me.calls.generate;
      const rs = await Promise.allSettled([A.generate(orderId, ADMIN), B.generate(orderId, ADMIN)]);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((rs.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('GENERATION_IN_PROGRESS');
      expect(me.calls.generate - before).toBe(1);
    });

    it('escrita com versão VELHA não sobrescreve (CAS)', async () => {
      await prepared();
      const stale = await label();
      await A.requestConfirmation(orderId, ADMIN); // versão avança
      const r = await dbB.shipmentLabel.updateMany({
        where: { id: stale.id, status: stale.status, version: stale.version },
        data: { status: 'PURCHASING', version: { increment: 1 } },
      });
      expect(r.count).toBe(0);
      expect((await label()).status).toBe('AWAITING_CONFIRMATION');
    });

    it('LABEL_READY: gerar de novo é idempotente (sem chamada)', async () => {
      const token = await prepared();
      await A.purchase(orderId, token, ADMIN);
      expect((await A.generate(orderId, ADMIN)).label.status).toBe('LABEL_READY');
      expect(me.calls.generate).toBe(1);
    });
  });

  it('pagamento do pedido estornado antes da compra → ORDER_NOT_PAID, sem checkout', async () => {
    const token = await prepared();
    await dbA.order.update({ where: { id: orderId }, data: { paymentStatus: 'REFUNDED' } });
    expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('ORDER_NOT_PAID');
    expect(me.calls.checkout).toBe(0);
    expect((await label()).status).toBe('AWAITING_CONFIRMATION');
  });

  it('versão só cresce e nenhuma etiqueta fica com lock pendurado no fim do fluxo', async () => {
    const token = await prepared();
    const v1 = (await label()).version;
    await A.purchase(orderId, token, ADMIN);
    const end: ShipmentLabel = await label();
    expect(end.version).toBeGreaterThan(v1);
    expect(end.lockUntil).toBeNull();
    expect(end.confirmationHash).toBeNull();
  });
});
