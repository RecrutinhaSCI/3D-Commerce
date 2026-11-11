/**
 * Ações operacionais da Etapa 4 contra Postgres REAL + Melhor Envio FALSO:
 * cancelamento, descarte de não paga, consulta de status, nota manual,
 * visão do painel e o risco do carrinho ambíguo sem UUID.
 * Só roda com TEST_DATABASE_URL local terminando em "_test" (ver harness).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createLabelWorkflow, leaseMs, type LabelWorkflow } from './labelWorkflow';
import { FakeMe, meError } from './labels.fakeMe.testdata';
import { CFG, createOrder, DB_LOCK_TIMEOUT_MS, dbEnabled, DECL, lockTestDb, newClient, ORDER_PII, PKG, resetDb, seedCredential } from './labels.dbHarness.testdata';
import { HttpError } from '../../../utils/httpError';
import { LabelApiError } from './labelErrors';

const ADMIN = 'admin-1';
const REASON = 'Cliente pediu troca da caixa';

describe.skipIf(!dbEnabled)('ações da etiqueta — Postgres real', () => {
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let me: FakeMe;
  let clock: number;
  let A: LabelWorkflow;
  let B: LabelWorkflow;
  let orderId: string;

  const make = (db: PrismaClient, cfg = CFG) => createLabelWorkflow({ db, client: me.client(), config: cfg, now: () => new Date(clock), oauthConfigured: true });

  let unlock: () => Promise<void>;
  beforeAll(async () => {
    unlock = await lockTestDb();
    dbA = newClient();
    dbB = newClient();
    await Promise.all([dbA.$connect(), dbB.$connect()]);
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    await Promise.all([dbA?.$disconnect(), dbB?.$disconnect()]);
    await unlock?.();
  });
  beforeEach(async () => {
    await resetDb(dbA);
    me = new FakeMe();
    clock = Date.parse('2026-10-28T12:00:00Z');
    A = make(dbA);
    B = make(dbB);
    orderId = await createOrder(dbA);
  });

  const active = () => dbA.shipmentLabel.findUnique({ where: { activeOrderId: orderId } });
  const latest = () => dbA.shipmentLabel.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  const types = async () => (await dbA.shipmentLabelEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
  async function rejected(p: Promise<unknown>): Promise<HttpError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      return e as HttpError;
    }
    throw new Error('deveria ter sido recusado');
  }
  const awaiting = async () => {
    const r = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
    expect(r.label.status).toBe('AWAITING_CONFIRMATION');
    return { token: r.confirmation!.token, labelId: r.label.id };
  };
  const ready = async () => {
    const { token, labelId } = await awaiting();
    expect((await A.purchase(orderId, token, ADMIN)).label.status).toBe('LABEL_READY');
    return { labelId, meId: (await latest()).meOrderId! };
  };

  // ---------------------------------------------------------------------------

  describe('cancelamento', () => {
    it('permitido: cancellable → CANCELING → CANCELED; inativa; nova etiqueta possível; pedido intocado', async () => {
      const { labelId } = await ready();
      const r = await A.cancel(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.label.status).toBe('CANCELED');
      const row = await latest();
      expect(row).toMatchObject({ activeOrderId: null, cancelReason: REASON, canceledByUserId: ADMIN, lockUntil: null });
      expect(me.calls).toMatchObject({ cancellable: 1, cancel: 1 });
      expect((await types()).slice(-2)).toEqual(['CANCEL_STARTED', 'CANCELED']);
      expect(await active()).toBeNull();
      expect((await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN)).label.id).not.toBe(labelId);
      expect((await dbA.order.findUniqueOrThrow({ where: { id: orderId } })).trackingCode).toBeNull();
    });

    it('não permitido pelo ME: 409, nada enviado, estado intacto, evento registrado', async () => {
      const { labelId } = await ready();
      me.canCancel = false;
      expect((await rejected(A.cancel(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('NOT_CANCELLABLE');
      expect(me.calls.cancel).toBe(0);
      expect((await latest()).status).toBe('LABEL_READY');
      expect(await types()).toContain('CANCEL_REFUSED');
    });

    it('"pode cancelar?" com ME fora do ar: erro devolvido, cancel NUNCA chamado', async () => {
      const { labelId } = await ready();
      me.failNext('cancellable', () => {
        throw meError('cancellable', 'TIMEOUT', 'unknown');
      });
      const r = await A.cancel(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.error?.code).toBe('TIMEOUT');
      expect(me.calls.cancel).toBe(0);
      expect((await latest()).status).toBe('LABEL_READY');
    });

    it('timeout no cancel (não cancelou): NEEDS_RECONCILIATION, ativa; reconciliar volta para LABEL_READY', async () => {
      const { labelId } = await ready();
      me.failNext('cancel', () => {
        throw meError('cancel', 'TIMEOUT', 'unknown');
      });
      const r = await A.cancel(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.label.status).toBe('NEEDS_RECONCILIATION');
      expect((await active())?.id).toBe(labelId);
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('LABEL_READY');
    });

    it('timeout no cancel (CANCELOU no ME): nunca assume; reconciliar confirma CANCELED', async () => {
      const { labelId, meId } = await ready();
      me.failNext('cancel', () => {
        Object.assign(me.orders.get(meId)!, { status: 'canceled', canceledAt: '2026-10-28T12:01:00.000Z' });
        throw meError('cancel', 'SERVER_ERROR', 'unknown', 502);
      });
      expect((await A.cancel(orderId, { labelId, reason: REASON }, ADMIN)).label.status).toBe('NEEDS_RECONCILIATION');
      expect((await A.reconcile(orderId, ADMIN)).label.status).toBe('CANCELED');
      expect(await active()).toBeNull();
    });

    it('recusa explícita no cancel: volta para LABEL_READY sem motivo gravado', async () => {
      const { labelId } = await ready();
      me.failNext('cancel', () => {
        throw meError('cancel', 'NOT_CANCELLABLE', 'rejected', 200);
      });
      const r = await A.cancel(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.label.status).toBe('LABEL_READY');
      expect(await latest()).toMatchObject({ cancelReason: null, canceledByUserId: null, lockUntil: null });
    });

    it('dois cancelamentos simultâneos (dois pools): UMA chamada de cancel', async () => {
      const { labelId } = await ready();
      me.delay.cancel = 80;
      const rs = await Promise.allSettled([
        A.cancel(orderId, { labelId, reason: REASON }, ADMIN),
        B.cancel(orderId, { labelId, reason: REASON }, ADMIN),
      ]);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((rs.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('OPERATION_IN_PROGRESS');
      expect(me.calls.cancel).toBe(1);
    });

    it('CANCELING com lease vencido → NEEDS_RECONCILIATION (nunca CANCELED por suposição)', async () => {
      const { labelId } = await ready();
      me.failNext('cancel', () => {
        throw new Error('processo caiu');
      });
      await expect(A.cancel(orderId, { labelId, reason: REASON }, ADMIN)).rejects.toThrow('processo caiu');
      expect((await latest()).status).toBe('CANCELING');
      expect((await rejected(A.reconcile(orderId, ADMIN))).code).toBe('OPERATION_IN_PROGRESS');
      clock += leaseMs(CFG) + 1;
      expect((await A.overview(orderId, ADMIN)).label).toMatchObject({ status: 'NEEDS_RECONCILIATION', availableActions: ['RECONCILE', 'ADD_NOTE'] });
      expect(await types()).toContain('LEASE_EXPIRED');
    });

    it('estado errado, motivo curto e etiqueta trocada são recusados', async () => {
      const { labelId } = await awaiting();
      expect((await rejected(A.cancel(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('NOT_PURCHASED');
      expect((await rejected(A.cancel(orderId, { labelId, reason: 'x' }, ADMIN))).status).toBe(422);
      expect((await rejected(A.cancel(orderId, { labelId: 'outra', reason: REASON }, ADMIN))).code).toBe('LABEL_CHANGED');
      expect(me.calls.cancellable).toBe(0);
    });

    it('postada não cancela', async () => {
      const { labelId, meId } = await ready();
      Object.assign(me.orders.get(meId)!, { status: 'posted' });
      expect((await A.sync(orderId, ADMIN)).label.status).toBe('POSTED');
      expect((await rejected(A.cancel(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('NOT_CANCELLABLE');
    });
  });

  // ---------------------------------------------------------------------------

  describe('descarte de preparação não paga', () => {
    it('no carrinho e não paga: remove do ME, DISCARDED, histórico mantido, token morto, nova preparação', async () => {
      const { token, labelId } = await awaiting();
      const r = await A.discard(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.label.status).toBe('DISCARDED');
      expect(me.calls.remove).toBe(1);
      const row = await dbA.shipmentLabel.findUniqueOrThrow({ where: { id: labelId } });
      expect(row).toMatchObject({ activeOrderId: null, cancelReason: REASON, confirmationHash: null, lockUntil: null });
      expect((await types()).slice(-3)).toEqual(['DISCARD_STARTED', 'CART_REMOVE_STARTED', 'DISCARDED']);
      expect((await rejected(A.purchase(orderId, token, ADMIN))).code).toBe('LABEL_NOT_FOUND');
      expect(me.calls.checkout).toBe(0);
      const again = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(again.label.id).not.toBe(labelId);
      expect(await dbA.shipmentLabel.count({ where: { orderId } })).toBe(2);
      expect((await A.overview(orderId, ADMIN)).history).toEqual([expect.objectContaining({ id: labelId, status: 'DISCARDED', cancelReason: REASON })]);
    });

    it('paga no ME (por fora): NÃO descarta; vai para reconciliação → PURCHASED', async () => {
      const { labelId } = await awaiting();
      me.markPaid((await latest()).meOrderId!);
      const e = await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN));
      expect(e).toMatchObject({ code: 'DISCARD_NOT_ALLOWED', details: { reason: 'PAID_AT_ME' } });
      expect(me.calls.remove).toBe(0);
      expect(await active()).toMatchObject({ id: labelId, status: 'PURCHASED' });
    });

    it.each(['expired', 'algo-novo', null])('status desconhecido no ME (%s): NÃO descarta, lock liberado', async (status) => {
      const { labelId } = await awaiting();
      Object.assign(me.orders.get((await latest()).meOrderId!)!, { status });
      const e = await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN));
      expect(e).toMatchObject({ code: 'DISCARD_NOT_ALLOWED', details: { reason: 'ME_STATUS_UNKNOWN' } });
      expect(me.calls.remove).toBe(0);
      expect(await active()).toMatchObject({ id: labelId, status: 'AWAITING_CONFIRMATION', lockUntil: null });
      expect(await types()).toContain('DISCARD_REFUSED');
    });

    it('ME fora do ar na verificação: DISCARD_UNVERIFIED, nada descartado', async () => {
      const { labelId } = await awaiting();
      me.failNext('get', () => {
        throw meError('order.get', 'TIMEOUT', 'unknown');
      });
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('DISCARD_UNVERIFIED');
      expect((await active())?.status).toBe('AWAITING_CONFIRMATION');
    });

    it('404 no ME SEM remoção nossa antes: não prova nada → recusa', async () => {
      const { labelId } = await awaiting();
      me.orders.delete((await latest()).meOrderId!);
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('DISCARD_UNVERIFIED');
    });

    it('remoção ambígua: recusa; nova tentativa conclui (item ainda lá ou já removido)', async () => {
      const { labelId } = await awaiting();
      const meId = (await latest()).meOrderId!;
      me.failNext('remove', () => {
        me.orders.delete(meId); // removeu do lado do ME…
        throw meError('cart.remove', 'TIMEOUT', 'unknown'); // …mas a resposta não chegou
      });
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('DISCARD_FAILED');
      expect((await active())?.id).toBe(labelId);
      const r = await A.discard(orderId, { labelId, reason: REASON }, ADMIN);
      expect(r.label.status).toBe('DISCARDED');
      const evt = await dbA.shipmentLabelEvent.findFirstOrThrow({ where: { labelId, type: 'DISCARDED' } });
      expect(evt.detailsJson).toMatchObject({ meStatus: 'not_found_after_removal', cartRemoved: true });
    });

    it('NEEDS_RECONCILIATION, compra em andamento ou etiqueta comprada: NÃO descarta', async () => {
      const { token, labelId } = await awaiting();
      me.failNext('checkout', () => {
        throw meError('checkout', 'TIMEOUT', 'unknown');
      });
      await A.purchase(orderId, token, ADMIN);
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('NEEDS_RECONCILIATION');
      await A.reconcile(orderId, ADMIN); // checkout não ocorreu → volta para confirmação
      const c = await A.requestConfirmation(orderId, ADMIN);
      me.failNext('checkout', () => {
        throw new Error('processo caiu');
      });
      await expect(A.purchase(orderId, c.confirmation!.token, ADMIN)).rejects.toThrow();
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('PURCHASE_IN_PROGRESS');
      clock += leaseMs(CFG) + 1;
      await A.reconcile(orderId, ADMIN);
      const t = (await A.requestConfirmation(orderId, ADMIN)).confirmation!.token;
      await A.purchase(orderId, t, ADMIN);
      expect((await rejected(A.discard(orderId, { labelId, reason: REASON }, ADMIN))).code).toBe('DISCARD_NOT_ALLOWED');
      expect(me.calls.remove).toBe(0);
    });

    it('corrida descarte × compra (dois pools, 5 rodadas): nunca ambos; descartada nunca chama checkout', async () => {
      for (let i = 0; i < 5; i++) {
        await resetDb(dbA);
        me = new FakeMe();
        A = make(dbA);
        B = make(dbB);
        orderId = await createOrder(dbA);
        const { token, labelId } = await awaiting();
        me.delay.get = 30;
        const [d, p] = await Promise.allSettled([
          A.discard(orderId, { labelId, reason: REASON }, ADMIN),
          B.purchase(orderId, token, ADMIN, labelId),
        ]);
        const row = await dbA.shipmentLabel.findUniqueOrThrow({ where: { id: labelId } });
        const discarded = d.status === 'fulfilled';
        const bought = p.status === 'fulfilled' && p.value.label.status !== 'ERROR';
        expect(discarded && bought).toBe(false);
        if (row.status === 'DISCARDED') expect(me.calls.checkout).toBe(0);
        else expect(me.calls.remove).toBe(0);
      }
    });

    it('cart.add ambíguo (sem UUID): mantém ERROR, NÃO prepara de novo sozinho; descarte explícito libera', async () => {
      me.failNext('add', () => {
        throw meError('cart.add', 'TIMEOUT', 'unknown');
      });
      const first = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect(first.label.status).toBe('ERROR');
      expect((await rejected(A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN))).code).toBe('CART_ADD_UNCERTAIN');
      expect(me.calls.add).toBe(1);
      const ov = await A.overview(orderId, ADMIN);
      expect(ov.label!.availableActions).toEqual(['DISCARD_UNPAID', 'ADD_NOTE']);

      const d = await A.discard(orderId, { labelId: first.label.id, reason: REASON }, ADMIN);
      expect(d.label.status).toBe('DISCARDED');
      const evt = await dbA.shipmentLabelEvent.findFirstOrThrow({ where: { labelId: first.label.id, type: 'DISCARDED' } });
      expect(evt.detailsJson).toMatchObject({ meOrderId: false, orphanCartPossible: true });
      expect(me.calls.get).toBe(0); // sem UUID não há o que consultar — e nada é pago
      expect((await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN)).label.status).toBe('AWAITING_CONFIRMATION');
      expect(me.calls.checkout).toBe(0);
    });

    it('cart.add recusado (422): preparar de novo continua liberado; descarte registra "sem órfão"', async () => {
      me.failNext('add', () => {
        throw meError('cart.add', 'VALIDATION', 'rejected', 422);
      });
      const first = await A.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
      expect((await A.overview(orderId, ADMIN)).label!.availableActions).toEqual(['PREPARE', 'DISCARD_UNPAID', 'ADD_NOTE']);
      await A.discard(orderId, { labelId: first.label.id, reason: REASON }, ADMIN);
      const evt = await dbA.shipmentLabelEvent.findFirstOrThrow({ where: { labelId: first.label.id, type: 'DISCARDED' } });
      expect(evt.detailsJson).toMatchObject({ orphanCartPossible: false });
    });

    it('CHECK do banco: descartada nunca fica ativa', async () => {
      const { labelId } = await awaiting();
      await expect(dbA.shipmentLabel.update({ where: { id: labelId }, data: { status: 'DISCARDED' } })).rejects.toThrow(/canceled_inactive_check/);
    });
  });

  // ---------------------------------------------------------------------------

  describe('geração assíncrona e consulta de status', () => {
    it('geração aceita mas sem confirmação do ME: LABEL_READY sem download; sync confirma e libera', async () => {
      const { token } = await awaiting();
      me.failNext('get', () => undefined); // releitura antes do checkout passa
      me.failNext('get', () => {
        throw meError('order.get', 'TIMEOUT', 'unknown'); // releitura pós-geração falha
      });
      const r = await A.purchase(orderId, token, ADMIN);
      expect(r.label.status).toBe('LABEL_READY');
      let ov = await A.overview(orderId, ADMIN);
      expect(ov.label!.file).toMatchObject({ downloadable: false, verifiedAt: null });
      expect(ov.label!.file.requestedAt).not.toBeNull();
      expect(ov.label!.availableActions).not.toContain('DOWNLOAD');
      expect(ov.label!.availableActions).toContain('SYNC_STATUS');

      await A.sync(orderId, ADMIN);
      ov = await A.overview(orderId, ADMIN);
      expect(ov.label!.file.downloadable).toBe(true);
      expect(ov.label!.tracking.code).toBe('AB123456789BR');
      expect(await types()).toContain('STATUS_SYNCED');
      expect((await dbA.order.findUniqueOrThrow({ where: { id: orderId } })).trackingCode).toBeNull();
    });

    it('postada/entregue no ME: avança; nunca regride', async () => {
      const { meId } = await ready();
      Object.assign(me.orders.get(meId)!, { status: 'posted' });
      expect((await A.sync(orderId, ADMIN)).label.status).toBe('POSTED');
      Object.assign(me.orders.get(meId)!, { status: 'generated' });
      expect((await A.sync(orderId, ADMIN)).label.status).toBe('POSTED');
      Object.assign(me.orders.get(meId)!, { status: 'delivered' });
      expect((await A.sync(orderId, ADMIN)).label.status).toBe('DELIVERED');
    });

    it('cancelada no ME → reconcilia para CANCELED; "não paga" para algo comprado → NEEDS_RECONCILIATION', async () => {
      const { meId } = await ready();
      Object.assign(me.orders.get(meId)!, { status: 'pending', paidAt: null });
      const r = await A.sync(orderId, ADMIN);
      expect(r.label).toMatchObject({ status: 'NEEDS_RECONCILIATION', lastError: { code: 'STATUS_CONTRADICTION' } });

      await resetDb(dbA);
      orderId = await createOrder(dbA);
      const second = await ready();
      Object.assign(me.orders.get(second.meId)!, { status: 'canceled', canceledAt: '2026-10-28T13:00:00.000Z' });
      expect((await A.sync(orderId, ADMIN)).label.status).toBe('CANCELED');
    });

    it('ME fora do ar: erro devolvido, nada muda', async () => {
      await ready();
      const before = await latest();
      me.failNext('get', () => {
        throw meError('order.get', 'SERVER_ERROR', 'unknown', 503);
      });
      expect((await A.sync(orderId, ADMIN)).error?.code).toBe('SERVER_ERROR');
      expect((await latest()).version).toBe(before.version);
    });

    it('reconciliar uma etiqueta pronta funciona (LABEL_READY → conferida → LABEL_READY)', async () => {
      await ready();
      expect((await A.reconcile(orderId, ADMIN, 'Conferência de rotina')).label.status).toBe('LABEL_READY');
    });
  });

  // ---------------------------------------------------------------------------

  describe('intervenção manual e visão do painel', () => {
    it('nota: só auditoria (status/versão iguais), motivo e evidência sem dados pessoais', async () => {
      const { labelId } = await ready();
      const before = await latest();
      await A.addNote(orderId, { labelId, reason: 'Conferido no painel do ME', evidence: 'cliente 52998224725 cliente@exemplo.test status pago' }, ADMIN);
      const after = await latest();
      expect(after).toMatchObject({ status: before.status, version: before.version });
      const evt = await dbA.shipmentLabelEvent.findFirstOrThrow({ where: { labelId, type: 'MANUAL_NOTE' } });
      expect(evt).toMatchObject({ userId: ADMIN, fromStatus: 'LABEL_READY', toStatus: 'LABEL_READY' });
      expect(JSON.stringify(evt.detailsJson)).not.toMatch(/52998224725|cliente@exemplo/);
      expect((await rejected(A.addNote(orderId, { labelId: 'nao-existe', reason: 'Conferido' }, ADMIN))).status).toBe(404);
    });

    it('sem etiqueta: PREPARE só para pedido pago de entrega; pedido inexistente 404', async () => {
      expect((await A.overview(orderId, ADMIN)).availableActions).toEqual(['PREPARE']);
      const unpaid = await createOrder(dbA, { paymentStatus: 'PENDING' });
      expect((await A.overview(unpaid, ADMIN)).availableActions).toEqual([]);
      const pickup = await createOrder(dbA, { shippingMethod: 'PICKUP' });
      expect(await A.overview(pickup, ADMIN)).toMatchObject({ availableActions: [], order: { serviceSupported: false } });
      expect((await rejected(A.overview('nao-existe', ADMIN))).code).toBe('ORDER_NOT_FOUND');
    });

    it('travas desligadas: nenhuma ação que altere o ME aparece', async () => {
      await ready();
      const off = make(dbA, { ...CFG, enabled: false });
      expect((await off.overview(orderId, ADMIN)).label!.availableActions).toEqual(['ADD_NOTE']);
      const prod = make(dbA, { ...CFG, environment: 'production', allowProduction: false });
      expect((await prod.overview(orderId, ADMIN)).label!.availableActions).toEqual(['DOWNLOAD', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'RECONCILE', 'ADD_NOTE']);
    });

    it('OAuth sem os scopes de etiqueta (conexão antiga): nenhuma ação que chame o ME, lista do que falta', async () => {
      await ready();
      await seedCredential(dbA, 'shipping-calculate', null);
      const ov = await A.overview(orderId, ADMIN);
      expect(ov.config).toMatchObject({ meAccess: 'missing', missingScopes: expect.arrayContaining(['shipping-checkout', 'cart-write']) });
      expect(ov.label!.availableActions).toEqual(['ADD_NOTE']);
      const other = await createOrder(dbA);
      expect((await A.overview(other, ADMIN)).availableActions).toEqual([]); // nem PREPARE
      await dbA.integrationCredential.deleteMany();
      expect((await A.overview(orderId, ADMIN)).config.meAccess).toBe('missing'); // não conectado
      await seedCredential(dbA, 'shipping-calculate cart-write orders-read shipping-cancel shipping-checkout shipping-generate shipping-print shipping-tracking', 'requested');
      const unverified = await A.overview(orderId, ADMIN);
      expect(unverified.config.meAccess).toBe('unverified');
      expect(unverified.label!.availableActions).toContain('DOWNLOAD'); // deixa tentar; 403 vira "escopo faltando"
    });

    it('DTO não vaza hash, lease, payload, token nem dado pessoal', async () => {
      const { token } = await awaiting();
      const row = await latest();
      const ov = await A.overview(orderId, ADMIN);
      expect(ov.label!.pendingConfirmation).toMatchObject({ price: 23.45 });
      expect(ov.label!.availableActions).toEqual(['REQUEST_CONFIRMATION', 'PURCHASE', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']);
      const json = JSON.stringify([ov, await A.events(orderId)]);
      for (const s of [token, row.confirmationHash!, row.payloadHash!, 'confirmationHash', 'lockUntil', 'payloadHash', ...ORDER_PII]) {
        expect(json).not.toContain(s);
      }
      expect(ov.label!.values).toEqual({ customerShippingValue: 24.9, quotedPrice: 23.45, paidPrice: null, difference: -1.45, differenceBasis: 'quoted' });
    });
  });
});

describe.skipIf(!dbEnabled)('arquivo da etiqueta (download/impressão) — Postgres real', () => {
  let db: PrismaClient;
  let me: FakeMe;
  let orderId: string;
  let unlock: () => Promise<void>;
  const now = () => new Date('2026-10-28T12:00:00Z');
  const make = (cfg = CFG) => createLabelWorkflow({ db, client: me.client(), config: cfg, now, oauthConfigured: true });

  beforeAll(async () => {
    unlock = await lockTestDb();
    db = newClient();
    await db.$connect();
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$disconnect();
    await unlock?.();
  });
  beforeEach(async () => {
    await resetDb(db);
    me = new FakeMe();
    orderId = await createOrder(db);
  });
  async function rejected(p: Promise<unknown>): Promise<HttpError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      return e as HttpError;
    }
    throw new Error('deveria ter sido recusado');
  }
  async function buy(w = make()) {
    const r = await w.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
    return w.purchase(orderId, r.confirmation!.token, ADMIN);
  }

  it('pronta e confirmada: revalida no ME, entrega o PDF e audita; URL temporária nunca é gravada', async () => {
    const w = make();
    await buy(w);
    const gets = me.calls.get;
    const { pdf, filename } = await w.labelFile(orderId, ADMIN);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toBe(`etiqueta-TESTE-${(await db.order.findUniqueOrThrow({ where: { id: orderId } })).publicCode}.pdf`);
    expect(me.calls.get - gets).toBe(1); // revalidou antes de liberar
    expect(me.calls.file).toBe(1);
    const dump = JSON.stringify([await db.shipmentLabel.findMany(), await db.shipmentLabelEvent.findMany()]);
    expect(dump).not.toMatch(/URL-TEMPORARIA|arquivos\.melhorenvio/);
    expect(dump).toContain('LABEL_FILE_DOWNLOADED');
  });

  it('geração ainda processando no ME: NÃO libera, atualiza o status e avisa', async () => {
    const w = make();
    const r = await w.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
    me.failNext('get', () => undefined);
    me.failNext('get', () => {
      throw meError('order.get', 'TIMEOUT', 'unknown');
    });
    await w.purchase(orderId, r.confirmation!.token, ADMIN);
    const meId = (await db.shipmentLabel.findFirstOrThrow({ where: { orderId } })).meOrderId!;
    Object.assign(me.orders.get(meId)!, { status: 'released', generatedAt: null }); // ME ainda não gerou
    expect((await rejected(w.labelFile(orderId, ADMIN))).code).toBe('LABEL_NOT_GENERATED');
    expect(me.calls.file).toBe(0);
    expect((await db.shipmentLabel.findFirstOrThrow({ where: { orderId } })).lastSyncedAt).not.toBeNull();
  });

  it('ME fora do ar na revalidação: 502, sem arquivo', async () => {
    const w = make();
    await buy(w);
    me.failNext('get', () => {
      throw meError('order.get', 'SERVER_ERROR', 'unknown', 503);
    });
    expect(await rejected(w.labelFile(orderId, ADMIN))).toMatchObject({ status: 502, code: 'LABEL_FILE_UNVERIFIED' });
    expect(me.calls.file).toBe(0);
  });

  // Visto no Sandbox real (PAC e SEDEX): 404 "E-PRT-0007 … Aguarde 3 minutos"
  // logo após gerar, ou URL entregue com o arquivo ainda ausente no storage.
  it.each(['sandbox', 'production'] as const)('%s: PDF ainda não processado (404) → 409 LABEL_FILE_NOT_READY, sem registrar download', async (environment) => {
    const w = make(environment === 'production' ? { ...CFG, environment, allowProduction: true } : CFG);
    await buy(w);
    me.failNext('file', () => {
      throw meError('print.file', 'NOT_FOUND', 'rejected', 404);
    });
    const e = await rejected(w.labelFile(orderId, ADMIN));
    expect(e).toMatchObject({ status: 409, code: 'LABEL_FILE_NOT_READY' });
    expect(await db.shipmentLabelEvent.count({ where: { orderId, type: 'LABEL_FILE_DOWNLOADED' } })).toBe(0);
  });

  it('produção: PDF de host ainda não autorizado → 502 LABEL_FILE_HOST_BLOCKED (sem download registrado)', async () => {
    const w = make({ ...CFG, environment: 'production', allowProduction: true });
    await buy(w);
    me.failNext('file', () => {
      throw new LabelApiError({ operation: 'print.file', code: 'BAD_RESPONSE', outcome: 'not_sent', message: 'x', fields: ['host_not_allowed'] });
    });
    expect(await rejected(w.labelFile(orderId, ADMIN))).toMatchObject({ status: 502, code: 'LABEL_FILE_HOST_BLOCKED' });
    expect(await db.shipmentLabelEvent.count({ where: { orderId, type: 'LABEL_FILE_DOWNLOADED' } })).toBe(0);
  });

  it('produção (liberada) com falha no arquivo: 502 LABEL_FILE_UNAVAILABLE', async () => {
    const w = make({ ...CFG, environment: 'production', allowProduction: true });
    await buy(w);
    me.failNext('file', () => {
      throw meError('print.file', 'SERVER_ERROR', 'unknown', 503);
    });
    expect(await rejected(w.labelFile(orderId, ADMIN))).toMatchObject({ status: 502, code: 'LABEL_FILE_UNAVAILABLE' });
  });

  it('sem etiqueta, não comprada, cancelada no ME: download recusado', async () => {
    const w = make();
    expect((await rejected(w.labelFile(orderId, ADMIN))).code).toBe('LABEL_NOT_FOUND');
    await w.prepare(orderId, { package: PKG, fiscal: DECL }, ADMIN);
    expect((await rejected(w.labelFile(orderId, ADMIN))).code).toBe('NOT_PURCHASED');
    await resetDb(db);
    orderId = await createOrder(db);
    await buy(w);
    const meId = (await db.shipmentLabel.findFirstOrThrow({ where: { orderId } })).meOrderId!;
    Object.assign(me.orders.get(meId)!, { status: 'canceled', canceledAt: '2026-10-28T13:00:00.000Z' });
    await expect(w.labelFile(orderId, ADMIN)).rejects.toBeInstanceOf(HttpError);
    expect(me.calls.file).toBe(0);
  });

  it('visão do pedido: CEP de destino, prazo, sugestão de caixa, remetente e plano do rastreio', async () => {
    const ov = await make().overview(orderId, ADMIN);
    expect(ov.order).toMatchObject({ destinationCep: '01310100', recipientDocumentMissing: false, sender: { declaration: expect.any(Boolean) } });
    expect(ov.order.packageSuggestion).toEqual({ package: null, itemsMissingData: 2 }); // itens de teste sem produto
    await buy();
    const after = await make().overview(orderId, ADMIN);
    expect(after.label!.tracking.orderSync).toBe('SANDBOX_NEVER');
    expect(after.label!.file).toMatchObject({ downloadable: true });
  });
});
