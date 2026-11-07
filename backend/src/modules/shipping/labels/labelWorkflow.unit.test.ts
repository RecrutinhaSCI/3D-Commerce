/**
 * Partes puras do ciclo da etiqueta (sem banco): hash da confirmação,
 * leitura do estado do Melhor Envio e visão da etiqueta (lease vencido).
 * O ciclo completo com Postgres real está em labelWorkflow.db.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ShipmentLabel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { confirmationHash, leaseMs, meCanceled, meInCart, mePaid, toLabelView } from './labelWorkflow';

const dates = { createdAt: null, paidAt: null, generatedAt: null, postedAt: null, deliveredAt: null, canceledAt: null, expiredAt: null };

describe('hash da confirmação', () => {
  const base = confirmationHash('tok', 'label-1', 3, 23.45);
  it('determinístico e sem o token em claro', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).toBe(confirmationHash('tok', 'label-1', 3, 23.45));
    expect(base).not.toContain('tok');
  });
  it.each([
    ['outro token', confirmationHash('tok2', 'label-1', 3, 23.45)],
    ['outra etiqueta', confirmationHash('tok', 'label-2', 3, 23.45)],
    ['outra versão', confirmationHash('tok', 'label-1', 4, 23.45)],
    ['outro preço', confirmationHash('tok', 'label-1', 3, 23.46)],
  ])('muda com %s', (_n, h) => expect(h).not.toBe(base));
});

describe('estado no Melhor Envio', () => {
  it.each(['released', 'paid', 'generated', 'posted', 'delivered'])('"%s" prova pagamento', (status) => {
    expect(mePaid({ status, dates })).toBe(true);
    expect(meInCart({ status, dates })).toBe(false);
  });
  it('data de pagamento prova pagamento mesmo com status estranho', () => {
    expect(mePaid({ status: 'pending', dates: { ...dates, paidAt: '2026-10-27T00:00:00Z' } })).toBe(true);
    expect(meInCart({ status: 'pending', dates: { ...dates, paidAt: '2026-10-27T00:00:00Z' } })).toBe(false);
  });
  it('só "pending" sem pagamento/cancelamento é "no carrinho"', () => {
    expect(meInCart({ status: 'pending', dates })).toBe(true);
    for (const s of ['expired', 'unknown', null]) expect(meInCart({ status: s, dates })).toBe(false);
  });
  it('cancelada por status ou data', () => {
    expect(meCanceled({ status: 'canceled', dates })).toBe(true);
    expect(meCanceled({ status: 'cancelled', dates })).toBe(true);
    expect(meCanceled({ status: 'released', dates: { ...dates, canceledAt: '2026-10-27T00:00:00Z' } })).toBe(true);
    expect(mePaid({ status: 'expired', dates })).toBe(false);
  });
});

describe('visão da etiqueta', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const row = (p: Partial<ShipmentLabel>): ShipmentLabel =>
    ({
      id: 'l', orderId: 'o', activeOrderId: 'o', environment: 'sandbox', status: 'AWAITING_CONFIRMATION', version: 2, lockUntil: null,
      meOrderId: 'x', meProtocol: null, mePurchaseId: null, serviceId: 1, serviceName: 'PAC', carrier: 'Correios', fiscalMode: 'DECLARATION',
      nfeKey: null, packageJson: { weightKg: 1, heightCm: 1, widthCm: 1, lengthCm: 1, source: 'admin' }, declaredValue: new Prisma.Decimal(10),
      customerShippingValue: new Prisma.Decimal(24.9), quotedPrice: new Prisma.Decimal(23.45), paidPrice: null, payloadHash: 'h',
      confirmationHash: 'abc', confirmationExpiresAt: new Date('2026-10-27T12:10:00Z'), confirmationPrice: new Prisma.Decimal(23.45),
      trackingCode: null, selfTracking: null, preparedAt: null, purchasedAt: null, generatedAt: null, postedAt: null, deliveredAt: null,
      canceledAt: null, lastSyncedAt: null, lastErrorCode: null, lastErrorMessage: null, createdByUserId: null, purchasedByUserId: null,
      canceledByUserId: null, createdAt: now, updatedAt: now, ...p,
    }) as ShipmentLabel;

  it('nunca expõe o hash; valores em número; Sandbox = teste', () => {
    const v = toLabelView(row({}), now);
    expect(JSON.stringify(v)).not.toContain('abc');
    expect(v).toMatchObject({ isTest: true, quotedPrice: 23.45, customerShippingValue: 24.9, confirmationExpiresAt: '2026-10-27T12:10:00.000Z' });
  });

  it('PURCHASING com lease vencido já aparece como "precisa conciliar"', () => {
    expect(toLabelView(row({ status: 'PURCHASING', lockUntil: new Date('2026-10-27T11:59:00Z') }), now)).toMatchObject({ requiresReconciliation: true, locked: false });
    expect(toLabelView(row({ status: 'PURCHASING', lockUntil: new Date('2026-10-27T12:01:00Z') }), now)).toMatchObject({ requiresReconciliation: false, locked: true });
  });

  it('lease cobre releitura + checkout com folga', () => {
    expect(leaseMs({ timeoutMs: 20000 })).toBe(70000);
  });
});
