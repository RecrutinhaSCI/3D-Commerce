/**
 * Pagamentos contra Postgres REAL + Mercado Pago FALSO (só o `fetch` é
 * simulado; prisma, orders.service e payments.service são os de verdade).
 *
 * Cobre os bugs da auditoria de lançamento:
 *   - pagamento aprovado DEPOIS do cancelamento (webhook, polling e corrida);
 *   - partially_refunded não cancela nem repõe estoque;
 *   - duplo createPayment (mesma instância e "duas instâncias");
 *   - retry seguro (mesma chave de idempotência);
 *   - nenhuma baixa de estoque duplicada e nenhum e-mail duplicado.
 *
 * Só roda com TEST_DATABASE_URL LOCAL cujo banco termina em "_test" (APAGA
 * pedidos, produtos e usuários de teste).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DB_LOCK_TIMEOUT_MS, dbEnabled, lockTestDb, TEST_URL } from '../shipping/labels/labels.dbHarness.testdata';

const h = vi.hoisted(() => ({ db: null as unknown as PrismaClient, emails: [] as Array<{ to: string; subject: string }> }));

vi.mock('../../lib/prisma', () => ({
  get prisma() {
    return h.db;
  },
}));
vi.mock('../../lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    h.emails.push({ to: m.to, subject: m.subject });
    return { sent: true };
  }),
}));

// Importados DEPOIS dos mocks (vi.mock é içado).
import { paymentsService, paymentAttemptIdempotencyKey } from './payments.service';
import { cancelOrderRecord, PAID_AFTER_CANCEL_MARKER } from '../orders/orders.service';

// ---------------------------------------------------------------------------
// Mercado Pago falso
// ---------------------------------------------------------------------------
type MpCall = { method: string; path: string; idempotencyKey: string | null; body: unknown };
interface FakeMp {
  calls: MpCall[];
  /** Orders "no MP", por id. */
  orders: Map<string, Record<string, unknown>>;
  /** Respostas já dadas por chave de idempotência (como o MP faz). */
  byKey: Map<string, Record<string, unknown>>;
  /** Status com que o próximo POST /v1/orders nasce. */
  createStatus: { order: string; payment: string; detail?: string };
  /** Atraso artificial do POST /v1/orders (para abrir a janela de corrida). */
  createDelayMs: number;
  cancelOk: boolean;
  seq: number;
}
let mp: FakeMp;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function installFakeMp() {
  mp = { calls: [], orders: new Map(), byKey: new Map(), createStatus: { order: 'action_required', payment: 'action_required', detail: 'waiting_transfer' }, createDelayMs: 0, cancelOk: true, seq: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: MpCall = { method: init.method ?? 'GET', path: u.pathname, idempotencyKey: headers['X-Idempotency-Key'] ?? null, body: init.body ? JSON.parse(String(init.body)) : null };
    mp.calls.push(call);
    if (u.hostname !== 'api.mercadopago.com') throw new Error(`host inesperado no teste: ${u.hostname}`);

    if (call.method === 'POST' && u.pathname === '/v1/orders') {
      if (call.idempotencyKey && mp.byKey.has(call.idempotencyKey)) return json(201, mp.byKey.get(call.idempotencyKey));
      if (mp.createDelayMs) await new Promise((r) => setTimeout(r, mp.createDelayMs));
      // Reconfere depois do atraso (duas chamadas iguais "em voo").
      if (call.idempotencyKey && mp.byKey.has(call.idempotencyKey)) return json(201, mp.byKey.get(call.idempotencyKey));
      const id = `ORD${String(++mp.seq).padStart(4, '0')}`;
      const b = call.body as { external_reference: string; total_amount: string };
      const o = {
        id, status: mp.createStatus.order, status_detail: mp.createStatus.detail, external_reference: b.external_reference, total_amount: b.total_amount,
        transactions: { payments: [{ id: `PAY${mp.seq}`, status: mp.createStatus.payment, status_detail: mp.createStatus.detail, payment_method: { qr_code: 'qr', ticket_url: 'https://mp.test/t' } }] },
      };
      mp.orders.set(id, o);
      if (call.idempotencyKey) mp.byKey.set(call.idempotencyKey, o);
      return json(201, o);
    }
    const m = u.pathname.match(/^\/v1\/orders\/([^/]+)(\/(cancel|refund))?$/);
    if (m) {
      const o = mp.orders.get(decodeURIComponent(m[1]));
      if (!o) return json(404, { errors: [{ code: 'not_found' }] });
      if (call.method === 'GET') return json(200, o);
      if (m[3] === 'cancel') {
        if (!mp.cancelOk) return json(409, { errors: [{ code: 'cannot_cancel' }] });
        setMpStatus(o.id as string, 'canceled', 'canceled');
        return json(200, o);
      }
      if (m[3] === 'refund') {
        setMpStatus(o.id as string, 'refunded', 'refunded');
        return json(200, o);
      }
    }
    return json(500, { errors: [{ code: 'rota_nao_simulada' }] });
  }));
}

function setMpStatus(id: string, order: string, payment: string, detail?: string) {
  const o = mp.orders.get(id)!;
  o.status = order;
  o.status_detail = detail ?? payment;
  const p = (o.transactions as { payments: Array<Record<string, unknown>> }).payments[0];
  p.status = payment;
  p.status_detail = detail ?? payment;
}

const createCalls = () => mp.calls.filter((c) => c.method === 'POST' && c.path === '/v1/orders');

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
const PIX = { selectedPaymentMethod: 'bank_transfer', formData: { payment_method_id: 'pix', payer: { email: 'cliente@exemplo.test' } } } as never;
const CARD = (token: string) => ({ selectedPaymentMethod: 'credit_card', formData: { payment_method_id: 'visa', token, installments: 1, payer: { email: 'cliente@exemplo.test' } } }) as never;

let userId: string;
let productId: string;

async function resetData(db: PrismaClient) {
  await db.shipmentLabelEvent.deleteMany();
  await db.shipmentLabel.deleteMany();
  await db.payment.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.product.deleteMany({ where: { slug: { startsWith: 'pay-test-' } } });
  await db.category.deleteMany({ where: { slug: 'pay-test-cat' } });
  await db.user.deleteMany({ where: { email: 'pay-test@exemplo.test' } });
  await db.siteSettings.upsert({
    where: { id: 'main' },
    create: { id: 'main', storeName: 'Loja', whatsapp: '54999990000', email: 'loja@t.test', address: 'x', pixDiscountPercent: 0 },
    update: { pixDiscountPercent: 0 },
  });
  const cat = await db.category.create({ data: { name: 'Pay Test', slug: 'pay-test-cat' } });
  const p = await db.product.create({ data: { categoryId: cat.id, name: 'PLA Teste', slug: 'pay-test-pla', price: 50, stock: 10 } });
  productId = p.id;
  const u = await db.user.create({ data: { name: 'Cliente', email: 'pay-test@exemplo.test', passwordHash: 'x' } });
  userId = u.id;
}

async function newOrder(db: PrismaClient, over: Record<string, unknown> = {}) {
  const o = await db.order.create({
    data: {
      userId, customerName: 'Cliente', customerEmail: 'cliente@exemplo.test', customerPhone: '11988887777', customerCpf: '52998224725',
      addressSnapshot: { zipCode: '01310100' }, subtotal: 100, total: 100, paymentMethod: 'PIX', paymentStatus: 'PENDING', status: 'PENDING',
      items: { create: [{ productId, productName: 'PLA Teste', quantity: 2, unitPrice: 50, total: 100 }] },
      ...over,
    },
  });
  return o.id;
}

const stock = async () => (await h.db.product.findUniqueOrThrow({ where: { id: productId } })).stock;
const order = (id: string) => h.db.order.findUniqueOrThrow({ where: { id } });
const approvedEmails = () => h.emails.filter((e) => /aprovado/i.test(e.subject));

describe.skipIf(!dbEnabled)('pagamentos — Postgres real + MP falso', () => {
  let unlock: () => Promise<void>;
  beforeAll(async () => {
    unlock = await lockTestDb();
    h.db = new PrismaClient({ datasourceUrl: TEST_URL });
    await h.db.$connect();
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await h.db?.$disconnect();
    await unlock?.();
  });
  beforeEach(async () => {
    await resetData(h.db);
    h.emails.length = 0;
    installFakeMp();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // -------------------------------------------------------------------------
  describe('pagamento aprovado depois do cancelamento', () => {
    it('webhook PAID num pedido cancelado: sem baixa de estoque, sem e-mail de aprovação, marcador visível', async () => {
      const id = await newOrder(h.db);
      await paymentsService.createPayment(userId, id, PIX);
      const mpId = (await order(id)).mpPaymentId!;
      // Admin cancela, mas o cancelamento no MP falha (best-effort).
      mp.cancelOk = false;
      await paymentsService.cancelOrRefund(id);
      expect((await order(id)).status).toBe('CANCELED');
      h.emails.length = 0;

      setMpStatus(mpId, 'processed', 'processed', 'accredited');
      expect(await paymentsService.processPaymentWebhook(mpId)).toBe('updated');
      // Webhook duplicado: nada muda de novo.
      expect(await paymentsService.processPaymentWebhook(mpId)).toBe('unchanged');

      const o = await order(id);
      expect(o.status).toBe('CANCELED'); // não reativa sozinho
      expect(o.paymentStatus).toBe('PAID'); // não esconde: o dinheiro entrou
      expect(o.stockApplied).toBe(false);
      expect(o.notes).toContain(PAID_AFTER_CANCEL_MARKER);
      expect(o.notes!.split(PAID_AFTER_CANCEL_MARKER)).toHaveLength(2); // uma vez só
      expect(await stock()).toBe(10);
      expect(approvedEmails()).toHaveLength(0);
    });

    it('polling (getPaymentStatus) e boleto compensado após expirar seguem a mesma regra', async () => {
      const id = await newOrder(h.db, { paymentMethod: 'BOLETO' });
      await paymentsService.createPayment(userId, id, PIX);
      const mpId = (await order(id)).mpPaymentId!;
      mp.cancelOk = false;
      expect(await cancelOrderRecord(id, 'CANCELED', '[EXPIRADO] teste')).toBe(true);

      setMpStatus(mpId, 'processed', 'processed', 'accredited');
      await paymentsService.getPaymentStatus(userId, id);
      const o = await order(id);
      expect(o.status).toBe('CANCELED');
      expect(o.paymentStatus).toBe('PAID');
      expect(o.notes).toContain(PAID_AFTER_CANCEL_MARKER);
      expect(await stock()).toBe(10);
      expect(approvedEmails()).toHaveLength(0);
    });

    it('admin estorna o pagamento recebido após o cancelamento: REFUNDED, estoque intacto, idempotente', async () => {
      const id = await newOrder(h.db);
      await paymentsService.createPayment(userId, id, PIX);
      const mpId = (await order(id)).mpPaymentId!;
      mp.cancelOk = false;
      await paymentsService.cancelOrRefund(id);
      setMpStatus(mpId, 'processed', 'processed', 'accredited');
      await paymentsService.processPaymentWebhook(mpId);

      const r = await paymentsService.cancelOrRefund(id);
      expect(r.result).toBe('refunded');
      const refunds = mp.calls.filter((c) => c.path.endsWith('/refund'));
      expect(refunds).toHaveLength(1);
      expect(refunds[0].idempotencyKey).toBe(`refund-${id}`);
      const o = await order(id);
      expect(o.paymentStatus).toBe('REFUNDED');
      expect(o.status).toBe('CANCELED');
      expect(await stock()).toBe(10);
      // Segunda vez: já REFUNDED → conflito, sem novo estorno.
      await expect(paymentsService.cancelOrRefund(id)).rejects.toMatchObject({ status: 409 });
      expect(mp.calls.filter((c) => c.path.endsWith('/refund'))).toHaveLength(1);
    });

    it('corrida cancelamento × aprovação: o estoque termina igual ao inicial e no máximo um e-mail', async () => {
      for (let i = 0; i < 6; i++) {
        await resetData(h.db);
        h.emails.length = 0;
        const id = await newOrder(h.db);
        await paymentsService.createPayment(userId, id, PIX);
        const mpId = (await order(id)).mpPaymentId!;
        setMpStatus(mpId, 'processed', 'processed', 'accredited');
        await Promise.all([paymentsService.processPaymentWebhook(mpId), cancelOrderRecord(id, 'CANCELED')]);
        const o = await order(id);
        expect(o.status).toBe('CANCELED');
        expect(o.stockApplied).toBe(false);
        expect(await stock()).toBe(10);
        expect(approvedEmails().length).toBeLessThanOrEqual(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('partially_refunded', () => {
    async function paidOrder() {
      mp.createStatus = { order: 'processed', payment: 'processed', detail: 'accredited' };
      const id = await newOrder(h.db, { paymentMethod: 'CREDIT_CARD' });
      await paymentsService.createPayment(userId, id, CARD('tok-1'));
      const o = await order(id);
      expect(o.paymentStatus).toBe('PAID');
      expect(o.status).toBe('CONFIRMED');
      expect(await stock()).toBe(8);
      return { id, mpId: o.mpPaymentId! };
    }

    it('webhook de estorno parcial NÃO cancela, NÃO repõe estoque e marca [ESTORNO PARCIAL]', async () => {
      const { id, mpId } = await paidOrder();
      setMpStatus(mpId, 'processed', 'partially_refunded', 'partially_refunded');
      expect(await paymentsService.processPaymentWebhook(mpId)).toBe('unchanged');
      await paymentsService.processPaymentWebhook(mpId);
      const o = await order(id);
      expect(o.status).toBe('CONFIRMED');
      expect(o.paymentStatus).toBe('PAID');
      expect(o.stockApplied).toBe(true);
      expect(await stock()).toBe(8);
      expect(o.notes).toContain('[ESTORNO PARCIAL]');
      expect(o.notes!.split('[ESTORNO PARCIAL]')).toHaveLength(2);
      expect(h.emails.filter((e) => /cancelad/i.test(e.subject))).toHaveLength(0);
    });

    it('Order "refunded" com status_detail partially_refunded também é tratada como parcial', async () => {
      const { id, mpId } = await paidOrder();
      setMpStatus(mpId, 'refunded', 'refunded', 'partially_refunded');
      await paymentsService.getPaymentStatus(userId, id);
      const o = await order(id);
      expect(o.status).toBe('CONFIRMED');
      expect(await stock()).toBe(8);
      expect(o.notes).toContain('[ESTORNO PARCIAL]');
    });

    it('estorno TOTAL continua cancelando e repondo o estoque uma única vez', async () => {
      const { id, mpId } = await paidOrder();
      setMpStatus(mpId, 'refunded', 'refunded', 'refunded');
      expect(await paymentsService.processPaymentWebhook(mpId)).toBe('updated');
      expect(await paymentsService.processPaymentWebhook(mpId)).toBe('unchanged');
      const o = await order(id);
      expect(o.status).toBe('CANCELED');
      expect(o.paymentStatus).toBe('REFUNDED');
      expect(await stock()).toBe(10);
      expect(h.emails.filter((e) => /cancelad/i.test(e.subject))).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('duplo createPayment', () => {
    it('duas chamadas simultâneas na mesma instância: UMA cobrança, a outra recebe 409', async () => {
      const id = await newOrder(h.db);
      mp.createDelayMs = 150;
      const results = await Promise.allSettled([paymentsService.createPayment(userId, id, PIX), paymentsService.createPayment(userId, id, PIX)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 409 });
      expect(createCalls()).toHaveLength(1);
      expect(mp.orders.size).toBe(1);
    });

    it('"duas instâncias" (sem trava em memória): mesma chave → o MP devolve a MESMA Order', async () => {
      const id = await newOrder(h.db);
      mp.createDelayMs = 150;
      const [a, b] = await Promise.all([
        paymentsService.createPaymentUnlocked(userId, id, PIX),
        paymentsService.createPaymentUnlocked(userId, id, PIX),
      ]);
      expect(a.paymentId).toBe(b.paymentId);
      expect(mp.orders.size).toBe(1);
      const keys = createCalls().map((c) => c.idempotencyKey);
      expect(keys[0]).toBeTruthy();
      expect(new Set(keys).size).toBe(1);
      expect((await order(id)).mpPaymentId).toBe([...mp.orders.keys()][0]);
    });

    it('cartão aprovado em dobro ("duas instâncias", mesmo token): estoque baixa uma vez e um e-mail só', async () => {
      mp.createStatus = { order: 'processed', payment: 'processed', detail: 'accredited' };
      const id = await newOrder(h.db, { paymentMethod: 'CREDIT_CARD' });
      mp.createDelayMs = 100;
      await Promise.all([
        paymentsService.createPaymentUnlocked(userId, id, CARD('tok-A')),
        paymentsService.createPaymentUnlocked(userId, id, CARD('tok-A')),
      ]);
      expect(mp.orders.size).toBe(1);
      expect(await stock()).toBe(8);
      expect(approvedEmails()).toHaveLength(1);
      expect((await order(id)).status).toBe('CONFIRMED');
    });

    it('tentativas concorrentes DIFERENTES: a que perde o compare-and-set é cancelada no MP', async () => {
      const id = await newOrder(h.db, { paymentMethod: 'CREDIT_CARD' });
      mp.createStatus = { order: 'action_required', payment: 'action_required' };
      mp.createDelayMs = 100;
      const results = await Promise.allSettled([
        paymentsService.createPaymentUnlocked(userId, id, CARD('tok-X')),
        paymentsService.createPaymentUnlocked(userId, id, CARD('tok-Y')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(mp.orders.size).toBe(2);
      const saved = (await order(id)).mpPaymentId!;
      const loser = [...mp.orders.keys()].find((k) => k !== saved)!;
      expect(mp.orders.get(loser)!.status).toBe('canceled');
      expect(mp.orders.get(saved)!.status).toBe('action_required');
    });
  });

  // -------------------------------------------------------------------------
  describe('retry seguro', () => {
    it('repetir a MESMA tentativa (retry de rede) reusa a chave e a Order', async () => {
      const id = await newOrder(h.db);
      await paymentsService.createPayment(userId, id, PIX);
      const first = createCalls()[0].idempotencyKey;
      // Simula: a resposta se perdeu, nada foi gravado, o cliente tenta de novo.
      await h.db.order.update({ where: { id }, data: { mpPaymentId: null } });
      await paymentsService.createPayment(userId, id, PIX);
      expect(createCalls()[1].idempotencyKey).toBe(first);
      expect(mp.orders.size).toBe(1);
    });

    it('nova tentativa depois de recusa gera chave nova (o cliente consegue pagar)', async () => {
      mp.createStatus = { order: 'failed', payment: 'failed', detail: 'rejected_by_issuer' };
      const id = await newOrder(h.db, { paymentMethod: 'CREDIT_CARD' });
      const r1 = await paymentsService.createPayment(userId, id, CARD('tok-1'));
      expect(r1.paymentStatus).toBe('FAILED');
      mp.createStatus = { order: 'processed', payment: 'processed', detail: 'accredited' };
      const r2 = await paymentsService.createPayment(userId, id, CARD('tok-2'));
      expect(r2.paymentStatus).toBe('PAID');
      const [k1, k2] = createCalls().map((c) => c.idempotencyKey);
      expect(k1).not.toBe(k2);
      expect(await stock()).toBe(8);
      expect(approvedEmails()).toHaveLength(1);
    });

    it('troca Pix → Pix de novo: cancela a anterior e cria outra (chave nova)', async () => {
      const id = await newOrder(h.db);
      await paymentsService.createPayment(userId, id, PIX);
      await paymentsService.createPayment(userId, id, PIX);
      const [k1, k2] = createCalls().map((c) => c.idempotencyKey);
      expect(k1).not.toBe(k2);
      const [first] = [...mp.orders.keys()];
      expect(mp.orders.get(first)!.status).toBe('canceled');
    });

    it('a chave é estável na janela, muda com tentativa anterior, método, valor, token e janela', () => {
      const base = { orderId: 'o1', previousAttempt: null, kind: 'pix' as const, amount: '100.00', now: 1_700_000_000_000 };
      const k = paymentAttemptIdempotencyKey(base);
      expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(paymentAttemptIdempotencyKey({ ...base, now: base.now + 1000 })).toBe(k);
      for (const variant of [{ previousAttempt: 'ORD1' }, { kind: 'boleto' as const }, { amount: '95.00' }, { cardToken: 't' }, { now: base.now + 3_600_000 }]) {
        expect(paymentAttemptIdempotencyKey({ ...base, ...variant })).not.toBe(k);
      }
    });
  });
});
