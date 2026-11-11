import type { ShipmentLabel, ShipmentLabelEvent, ShipmentLabelStatus } from '@prisma/client';
import { decimalToNumber } from '../../../utils/decimal';
import { LEASED_STATUSES } from './labelStatus';
import type { ShipmentPackage, StoredPackage } from './package';

/**
 * DTO das etiquetas para o PAINEL. O backend decide o que pode ser feito
 * (`availableActions`); o frontend só mostra o que vier aqui.
 *
 * Nunca sai daqui: hash da confirmação, token, lease completo, payload/hash
 * do payload, resposta bruta do ME, segredo OAuth.
 */

export const LABEL_ACTIONS = [
  'PREPARE',
  'REQUEST_CONFIRMATION',
  'PURCHASE',
  'RECONCILE',
  'GENERATE',
  'SYNC_STATUS',
  'DOWNLOAD',
  'CHECK_CANCELLABLE',
  'CANCEL',
  'DISCARD_UNPAID',
  'ADD_NOTE',
] as const;
export type LabelAction = (typeof LABEL_ACTIONS)[number];

/** Ações que alteram algo no ME (exigem travas liberadas). */
const WRITE_ACTIONS: readonly LabelAction[] = ['PREPARE', 'REQUEST_CONFIRMATION', 'PURCHASE', 'GENERATE', 'CANCEL', 'DISCARD_UNPAID'];
/** Ações que só consultam o ME (exigem etiquetas ligadas). */
const READ_ACTIONS: readonly LabelAction[] = ['RECONCILE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'DOWNLOAD'];

export interface LabelsConfigView {
  enabled: boolean;
  environment: string;
  isTest: boolean;
  /** enabled e (sandbox ou produção liberada). */
  purchaseAllowed: boolean;
  /**
   * Permissões da conexão OAuth para etiquetas (Etapa 6):
   *   ok         — scopes confirmados;
   *   unverified — o ME não informou os scopes (deixa tentar; um 403 vira "escopo faltando");
   *   missing    — não conectado / reconexão necessária: nenhuma ação que chame o ME.
   */
  meAccess?: 'ok' | 'unverified' | 'missing';
  missingScopes?: string[];
}

export interface OrderLabelContext {
  id: string;
  publicCode?: string;
  paid: boolean;
  canceled: boolean;
  /** Entrega com serviço de etiqueta suportado (retirada = false). */
  serviceSupported: boolean;
  customerShippingValue: number | null;
  /** Dados de exibição/pré-preenchimento do painel (sem dado pessoal além do CEP de destino). */
  shippingMethod?: string | null;
  shippingServiceName?: string | null;
  shippingCarrier?: string | null;
  deadlineDays?: number | null;
  destinationCep?: string | null;
  /** Rastreio JÁ gravado no pedido (manual ou futuro automático). */
  trackingCode?: string | null;
  /** Pedido sem CPF/CNPJ do destinatário: o modal pede o documento. */
  recipientDocumentMissing?: boolean;
  /** Sugestão de caixa pelos produtos (null quando falta peso/medida em algum item). */
  packageSuggestion?: { package: ShipmentPackage | null; itemsMissingData: number };
  /** Prontidão do remetente por modalidade fiscal + pendências legíveis. */
  sender?: { declaration: boolean; nfe: boolean; issues: string[] };
}

/**
 * O que fazer com o rastreio do PEDIDO quando a etiqueta tem código:
 *   SANDBOX_NEVER        — etiqueta de teste: nunca alimenta o pedido;
 *   NO_LABEL_CODE        — a etiqueta ainda não tem rastreio;
 *   ALREADY_SAME         — o pedido já tem este código;
 *   AVAILABLE            — pedido sem código: pode receber o da etiqueta;
 *   MANUAL_CODE_CONFLICT — o pedido tem OUTRO código (manual): nunca sobrescrever sem confirmação.
 * Só a decisão — aplicar fica para a etapa de produção.
 */
export type OrderTrackingSync = 'SANDBOX_NEVER' | 'NO_LABEL_CODE' | 'ALREADY_SAME' | 'AVAILABLE' | 'MANUAL_CODE_CONFLICT';
export function orderTrackingSync(environment: string, labelCode: string | null, orderCode: string | null | undefined): OrderTrackingSync {
  if (environment !== 'production') return 'SANDBOX_NEVER';
  if (!labelCode) return 'NO_LABEL_CODE';
  const current = orderCode?.trim().toUpperCase() || null;
  if (!current) return 'AVAILABLE';
  return current === labelCode.trim().toUpperCase() ? 'ALREADY_SAME' : 'MANUAL_CODE_CONFLICT';
}


export interface ActionContext {
  order: OrderLabelContext;
  config: LabelsConfigView;
  /** Carrinho ambíguo sem UUID: preparar de novo só depois de descartar. */
  cartAddUncertain: boolean;
  now: Date;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function labelActions(label: ShipmentLabel | null, ctx: ActionContext): LabelAction[] {
  const { order, config, now } = ctx;
  const canPrepare = order.paid && !order.canceled && order.serviceSupported;
  let actions: LabelAction[] = [];

  if (!label) {
    actions = canPrepare ? ['PREPARE'] : [];
  } else {
    const live = Boolean(label.lockUntil && label.lockUntil > now);
    const stale = !live && Boolean(label.lockUntil) && LEASED_STATUSES.includes(label.status);
    const paidRecorded = label.paidPrice !== null || label.purchasedAt !== null || label.mePurchaseId !== null;
    const retryPrepare = !label.meOrderId && !ctx.cartAddUncertain && canPrepare ? (['PREPARE'] as LabelAction[]) : [];

    if (live) {
      actions = []; // operação em andamento: nada além de anotar
    } else if (stale || label.status === 'NEEDS_RECONCILIATION') {
      actions = ['RECONCILE'];
    } else {
      switch (label.status) {
        case 'PREPARED':
          actions = label.meOrderId ? ['REQUEST_CONFIRMATION', 'DISCARD_UNPAID'] : [...retryPrepare, 'DISCARD_UNPAID'];
          break;
        case 'AWAITING_CONFIRMATION': {
          const pending = Boolean(label.confirmationHash && label.confirmationExpiresAt && label.confirmationExpiresAt > now);
          actions = [
            'REQUEST_CONFIRMATION',
            ...(pending && !paidRecorded ? (['PURCHASE'] as LabelAction[]) : []),
            'RECONCILE',
            ...(paidRecorded ? [] : (['DISCARD_UNPAID'] as LabelAction[])),
          ];
          break;
        }
        case 'ERROR':
          actions = label.meOrderId ? ['REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID'] : [...retryPrepare, 'DISCARD_UNPAID'];
          break;
        case 'PURCHASED':
          actions = ['GENERATE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE'];
          break;
        case 'LABEL_READY':
          actions = [
            ...(label.generatedAt ? (['DOWNLOAD'] as LabelAction[]) : []),
            'SYNC_STATUS',
            'CHECK_CANCELLABLE',
            'CANCEL',
            'RECONCILE',
          ];
          break;
        case 'POSTED':
          actions = ['SYNC_STATUS', 'RECONCILE'];
          break;
        default:
          actions = []; // DELIVERED, CANCELED, DISCARDED, PURCHASING/GENERATING/CANCELING sem lease
      }
    }
    if (!order.paid || order.canceled) actions = actions.filter((a) => a !== 'PURCHASE' && a !== 'REQUEST_CONFIRMATION' && a !== 'PREPARE');
    actions.push('ADD_NOTE');
  }

  const meOk = config.meAccess !== 'missing';
  return actions.filter((a) => {
    if (WRITE_ACTIONS.includes(a)) return config.purchaseAllowed && meOk;
    if (READ_ACTIONS.includes(a)) return config.enabled && meOk;
    return true;
  });
}

export interface LabelDto {
  id: string;
  orderId: string;
  status: ShipmentLabelStatus;
  environment: string;
  isTest: boolean;
  service: { id: number; name: string | null };
  carrier: string | null;
  values: {
    customerShippingValue: number | null;
    quotedPrice: number | null;
    paidPrice: number | null;
    /** (pago, ou cotado se ainda não pago) − cobrado do cliente. Positivo = loja paga mais do que cobrou. */
    difference: number | null;
    differenceBasis: 'paid' | 'quoted' | null;
  };
  package: StoredPackage | null;
  declaredValue: number | null;
  fiscal: { mode: string; nfeKeyEnd: string | null };
  tracking: { code: string | null; melhorEnvio: string | null; orderSync: OrderTrackingSync };
  /**
   * Arquivo da etiqueta: `downloadable` só depois que o ME CONFIRMA a geração.
   */
  file: { requestedAt: string | null; verifiedAt: string | null; downloadable: boolean };
  /** Confirmação de preço válida no momento (o token só vem na resposta que a criou). */
  pendingConfirmation: { price: number | null; expiresAt: string } | null;
  dates: {
    createdAt: string;
    preparedAt: string | null;
    purchasedAt: string | null;
    generatedAt: string | null;
    postedAt: string | null;
    deliveredAt: string | null;
    canceledAt: string | null;
    lastSyncedAt: string | null;
  };
  cancelReason: string | null;
  lastError: { code: string; message: string | null } | null;
  requiresReconciliation: boolean;
  inProgress: boolean;
  availableActions: LabelAction[];
  canPurchase: boolean;
  canGenerate: boolean;
  canCancel: boolean;
  canDiscard: boolean;
}

export function toLabelDto(l: ShipmentLabel, ctx: ActionContext): LabelDto {
  const { now } = ctx;
  const live = Boolean(l.lockUntil && l.lockUntil > now);
  const stale = !live && Boolean(l.lockUntil) && LEASED_STATUSES.includes(l.status);
  const customer = decimalToNumber(l.customerShippingValue);
  const quoted = decimalToNumber(l.quotedPrice);
  const paid = decimalToNumber(l.paidPrice);
  const basis = paid !== null ? 'paid' : quoted !== null ? 'quoted' : null;
  const cost = paid ?? quoted;
  const pending = l.status === 'AWAITING_CONFIRMATION' && l.confirmationHash && l.confirmationExpiresAt && l.confirmationExpiresAt > now;
  const actions = labelActions(l, ctx);
  return {
    id: l.id,
    orderId: l.orderId,
    status: l.status,
    environment: l.environment,
    isTest: l.environment !== 'production',
    service: { id: l.serviceId, name: l.serviceName },
    carrier: l.carrier,
    values: {
      customerShippingValue: customer,
      quotedPrice: quoted,
      paidPrice: paid,
      difference: cost !== null && customer !== null ? round2(cost - customer) : null,
      differenceBasis: basis,
    },
    package: (l.packageJson as unknown as StoredPackage) ?? null,
    declaredValue: decimalToNumber(l.declaredValue),
    fiscal: { mode: l.fiscalMode, nfeKeyEnd: l.nfeKey ? l.nfeKey.slice(-4) : null },
    tracking: { code: l.trackingCode, melhorEnvio: l.selfTracking, orderSync: orderTrackingSync(l.environment, l.trackingCode, ctx.order.trackingCode) },
    file: {
      requestedAt: iso(l.generationRequestedAt),
      verifiedAt: iso(l.generatedAt),
      downloadable: actions.includes('DOWNLOAD'),
    },
    pendingConfirmation: pending ? { price: decimalToNumber(l.confirmationPrice), expiresAt: l.confirmationExpiresAt!.toISOString() } : null,
    dates: {
      createdAt: l.createdAt.toISOString(),
      preparedAt: iso(l.preparedAt),
      purchasedAt: iso(l.purchasedAt),
      generatedAt: iso(l.generatedAt),
      postedAt: iso(l.postedAt),
      deliveredAt: iso(l.deliveredAt),
      canceledAt: iso(l.canceledAt),
      lastSyncedAt: iso(l.lastSyncedAt),
    },
    cancelReason: l.cancelReason,
    lastError: l.lastErrorCode ? { code: l.lastErrorCode, message: l.lastErrorMessage } : null,
    requiresReconciliation: l.status === 'NEEDS_RECONCILIATION' || stale,
    inProgress: live,
    availableActions: actions,
    canPurchase: actions.includes('PURCHASE'),
    canGenerate: actions.includes('GENERATE'),
    canCancel: actions.includes('CANCEL'),
    canDiscard: actions.includes('DISCARD_UNPAID'),
  };
}

/** Etiquetas anteriores (inativas) do pedido — só o resumo. */
export function toLabelHistoryItem(l: ShipmentLabel) {
  return {
    id: l.id,
    status: l.status,
    environment: l.environment,
    isTest: l.environment !== 'production',
    paidPrice: decimalToNumber(l.paidPrice),
    trackingCode: l.trackingCode,
    cancelReason: l.cancelReason,
    createdAt: l.createdAt.toISOString(),
    canceledAt: iso(l.canceledAt),
  };
}

/** Evento de auditoria para exibição (os detalhes já são gravados sem dado sensível). */
export function toLabelEventDto(e: ShipmentLabelEvent) {
  return {
    id: e.id,
    labelId: e.labelId,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    userId: e.userId,
    details: e.detailsJson ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export interface LabelOverview {
  order: OrderLabelContext;
  config: LabelsConfigView;
  label: LabelDto | null;
  /** Ações quando NÃO há etiqueta ativa (ex.: PREPARE); com etiqueta, iguais a `label.availableActions`. */
  availableActions: LabelAction[];
  history: ReturnType<typeof toLabelHistoryItem>[];
}

export function buildLabelOverview(label: ShipmentLabel | null, history: ShipmentLabel[], ctx: ActionContext): LabelOverview {
  const dto = label ? toLabelDto(label, ctx) : null;
  return {
    order: ctx.order,
    config: ctx.config,
    label: dto,
    availableActions: dto ? dto.availableActions : labelActions(null, ctx),
    history: history.map(toLabelHistoryItem),
  };
}
