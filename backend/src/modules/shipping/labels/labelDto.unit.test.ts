/**
 * DTO do painel e `availableActions` (puro, sem banco): a matriz estado →
 * ações que o backend autoriza, travas, lease e o que NUNCA sai no DTO.
 */
import { describe, expect, it } from 'vitest';
import { Prisma, type ShipmentLabel } from '@prisma/client';
import { buildLabelOverview, labelActions, orderTrackingSync, toLabelDto, type ActionContext } from './labelDto';

const now = new Date('2026-10-28T12:00:00Z');
const later = new Date('2026-10-28T12:05:00Z');
const earlier = new Date('2026-10-28T11:55:00Z');

const row = (p: Partial<ShipmentLabel> = {}): ShipmentLabel =>
  ({
    id: 'l', orderId: 'o', activeOrderId: 'o', environment: 'sandbox', status: 'AWAITING_CONFIRMATION', version: 3, lockUntil: null,
    meOrderId: 'me-1', meProtocol: null, mePurchaseId: null, serviceId: 1, serviceName: 'PAC', carrier: 'Correios', fiscalMode: 'NFE',
    nfeKey: '4'.repeat(40) + '1234', packageJson: { weightKg: 1, heightCm: 1, widthCm: 1, lengthCm: 1, source: 'admin' }, declaredValue: new Prisma.Decimal(10),
    customerShippingValue: new Prisma.Decimal(24.9), quotedPrice: new Prisma.Decimal(23.45), paidPrice: null, payloadHash: 'PAYLOADHASH',
    confirmationHash: 'CONFIRMHASH', confirmationExpiresAt: later, confirmationPrice: new Prisma.Decimal(23.45),
    trackingCode: null, selfTracking: null, preparedAt: null, purchasedAt: null, generatedAt: null, postedAt: null, deliveredAt: null,
    canceledAt: null, lastSyncedAt: null, lastErrorCode: null, lastErrorMessage: null, createdByUserId: null, purchasedByUserId: null,
    canceledByUserId: null, generationRequestedAt: null, cancelReason: null, createdAt: now, updatedAt: now, ...p,
  }) as ShipmentLabel;

const ctx = (p: Partial<ActionContext> = {}): ActionContext => ({
  order: { id: 'o', paid: true, canceled: false, serviceSupported: true, customerShippingValue: 24.9 },
  config: { enabled: true, environment: 'sandbox', isTest: true, purchaseAllowed: true },
  cartAddUncertain: false,
  now,
  ...p,
});
const paid = { paidPrice: new Prisma.Decimal(23.45), purchasedAt: earlier, mePurchaseId: 'p1', confirmationHash: null };

describe('availableActions por estado', () => {
  it.each([
    ['PREPARED com UUID', row({ status: 'PREPARED', confirmationHash: null }), ['REQUEST_CONFIRMATION', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['confirmação válida', row(), ['REQUEST_CONFIRMATION', 'PURCHASE', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['confirmação vencida', row({ confirmationExpiresAt: earlier }), ['REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['confirmação sem token (pós-reconciliação)', row({ confirmationHash: null }), ['REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['ERROR com UUID', row({ status: 'ERROR', confirmationHash: null }), ['REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['ERROR sem UUID (recusa certa)', row({ status: 'ERROR', meOrderId: null }), ['PREPARE', 'DISCARD_UNPAID', 'ADD_NOTE']],
    ['PURCHASED', row({ status: 'PURCHASED', ...paid }), ['GENERATE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE']],
    ['LABEL_READY sem arquivo confirmado', row({ status: 'LABEL_READY', ...paid }), ['SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE']],
    ['LABEL_READY confirmada', row({ status: 'LABEL_READY', ...paid, generatedAt: earlier }), ['DOWNLOAD', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE']],
    ['POSTED', row({ status: 'POSTED', ...paid }), ['SYNC_STATUS', 'RECONCILE', 'ADD_NOTE']],
    ['DELIVERED', row({ status: 'DELIVERED', ...paid }), ['ADD_NOTE']],
    ['NEEDS_RECONCILIATION', row({ status: 'NEEDS_RECONCILIATION' }), ['RECONCILE', 'ADD_NOTE']],
    ['CANCELED', row({ status: 'CANCELED', activeOrderId: null }), ['ADD_NOTE']],
    ['DISCARDED', row({ status: 'DISCARDED', activeOrderId: null }), ['ADD_NOTE']],
  ])('%s', (_n, l, expected) => expect(labelActions(l, ctx())).toEqual(expected));

  it('carrinho ambíguo sem UUID: sem PREPARE (só descarte explícito)', () => {
    expect(labelActions(row({ status: 'ERROR', meOrderId: null }), ctx({ cartAddUncertain: true }))).toEqual(['DISCARD_UNPAID', 'ADD_NOTE']);
  });

  it.each(['PURCHASING', 'GENERATING', 'CANCELING', 'AWAITING_CONFIRMATION'] as const)('%s com lease ativo: nada além de anotar', (status) => {
    expect(labelActions(row({ status, lockUntil: later }), ctx())).toEqual(['ADD_NOTE']);
  });

  it.each(['PURCHASING', 'GENERATING', 'CANCELING'] as const)('%s com lease vencido: só reconciliar', (status) => {
    expect(labelActions(row({ status, lockUntil: earlier }), ctx())).toEqual(['RECONCILE', 'ADD_NOTE']);
  });

  it('pedido não pago (ex.: estornado) tira compra/confirmação', () => {
    const c = ctx({ order: { id: 'o', paid: false, canceled: false, serviceSupported: true, customerShippingValue: 24.9 } });
    expect(labelActions(row(), c)).toEqual(['RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']);
    expect(labelActions(null, c)).toEqual([]);
  });

  it('travas: desligado → só nota; produção bloqueada → só consultas', () => {
    const l = row({ status: 'LABEL_READY', ...paid, generatedAt: earlier });
    expect(labelActions(l, ctx({ config: { enabled: false, environment: 'sandbox', isTest: true, purchaseAllowed: false } }))).toEqual(['ADD_NOTE']);
    expect(labelActions(l, ctx({ config: { enabled: true, environment: 'production', isTest: false, purchaseAllowed: false } }))).toEqual([
      'DOWNLOAD', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'RECONCILE', 'ADD_NOTE',
    ]);
    expect(labelActions(null, ctx({ config: { enabled: true, environment: 'production', isTest: false, purchaseAllowed: false } }))).toEqual([]);
  });

  it('OAuth sem scopes de etiqueta (meAccess=missing): nada que chame o ME; "unverified" não bloqueia', () => {
    const l = row({ status: 'LABEL_READY', ...paid, generatedAt: earlier });
    const cfg = (meAccess: 'ok' | 'unverified' | 'missing') => ctx({ config: { enabled: true, environment: 'sandbox', isTest: true, purchaseAllowed: true, meAccess } });
    expect(labelActions(l, cfg('missing'))).toEqual(['ADD_NOTE']);
    expect(labelActions(null, cfg('missing'))).toEqual([]);
    expect(labelActions(l, cfg('unverified'))).toEqual(labelActions(l, cfg('ok')));
  });

  it('registro de compra numa etiqueta "aguardando" (contradição): nunca oferece compra nem descarte', () => {
    expect(labelActions(row({ ...paid, confirmationHash: 'h' }), ctx())).toEqual(['REQUEST_CONFIRMATION', 'RECONCILE', 'ADD_NOTE']);
  });
});

describe('DTO', () => {
  it('nunca expõe hash, lease, payload nem a chave NF-e inteira', () => {
    const dto = toLabelDto(row({ lockUntil: later }), ctx());
    const json = JSON.stringify(dto);
    for (const s of ['CONFIRMHASH', 'PAYLOADHASH', 'confirmationHash', 'payloadHash', 'lockUntil', 'version', '4'.repeat(40)]) expect(json).not.toContain(s);
    expect(dto.fiscal).toEqual({ mode: 'NFE', nfeKeyEnd: '1234' });
    expect(dto.inProgress).toBe(true);
  });

  it('diferença: cotado antes de pagar, pago depois; flags seguem as ações', () => {
    expect(toLabelDto(row(), ctx()).values).toMatchObject({ difference: -1.45, differenceBasis: 'quoted' });
    const p = toLabelDto(row({ status: 'PURCHASED', ...paid, paidPrice: new Prisma.Decimal(26) }), ctx());
    expect(p.values).toMatchObject({ paidPrice: 26, difference: 1.1, differenceBasis: 'paid' });
    expect(p).toMatchObject({ canGenerate: true, canCancel: true, canPurchase: false, canDiscard: false, pendingConfirmation: null });
  });

  it('visão sem etiqueta ativa: ações do pedido + histórico resumido', () => {
    const ov = buildLabelOverview(null, [row({ status: 'DISCARDED', activeOrderId: null, cancelReason: 'Caixa errada' })], ctx());
    expect(ov).toMatchObject({ label: null, availableActions: ['PREPARE'], history: [{ status: 'DISCARDED', cancelReason: 'Caixa errada', isTest: true }] });
    expect(JSON.stringify(ov)).not.toContain('CONFIRMHASH');
  });
});

describe('rastreio do pedido e impressão no Sandbox', () => {
  it('Sandbox nunca alimenta o rastreio do pedido', () => {
    expect(orderTrackingSync('sandbox', 'AB123456789BR', null)).toBe('SANDBOX_NEVER');
  });
  it('produção: disponível, igual ou conflito com código manual (nunca sobrescreve)', () => {
    expect(orderTrackingSync('production', null, null)).toBe('NO_LABEL_CODE');
    expect(orderTrackingSync('production', 'AB123456789BR', null)).toBe('AVAILABLE');
    expect(orderTrackingSync('production', 'AB123456789BR', ' ab123456789br ')).toBe('ALREADY_SAME');
    expect(orderTrackingSync('production', 'AB123456789BR', 'XY999999999BR')).toBe('MANUAL_CODE_CONFLICT');
  });
});
