import type { ShipmentLabelStatus } from '@prisma/client';
import { HttpError } from '../../../utils/httpError';
import type { MelhorEnvioEnvironment, MelhorEnvioLabelsConfig } from '../melhorEnvioConfig';

/**
 * Máquina de estados da etiqueta. Toda mudança de status passa por
 * `canTransition` e é gravada com compare-and-set (status + version) — ver
 * `labelWorkflow.ts`.
 *
 * Regra de ouro: de PURCHASING só se sai para um estado CONFIRMADO pelo
 * Melhor Envio; timeout ou resposta ambígua vai para NEEDS_RECONCILIATION,
 * que nunca compra de novo sem antes consultar a etiqueta lá.
 */
export const LABEL_TRANSITIONS: Record<ShipmentLabelStatus, readonly ShipmentLabelStatus[]> = {
  // → NEEDS_RECONCILIATION: a releitura no ME mostrou algo além de "no carrinho".
  // → DISCARDED: só depois de provar no ME que NÃO foi paga (labelWorkflow.discard).
  PREPARED: ['AWAITING_CONFIRMATION', 'NEEDS_RECONCILIATION', 'ERROR', 'CANCELED', 'DISCARDED'],
  // → AWAITING_CONFIRMATION: novo token (expirou ou preço mudou).
  AWAITING_CONFIRMATION: ['AWAITING_CONFIRMATION', 'PURCHASING', 'PREPARED', 'NEEDS_RECONCILIATION', 'ERROR', 'CANCELED', 'DISCARDED'],
  // → AWAITING_CONFIRMATION: preço mudou na releitura ANTES do checkout.
  // → ERROR: só quando é certo que o checkout não foi aceito (ex.: 4xx de saldo).
  PURCHASING: ['PURCHASED', 'NEEDS_RECONCILIATION', 'AWAITING_CONFIRMATION', 'ERROR'],
  // → POSTED/DELIVERED: só com o estado lido no ME (sync).
  PURCHASED: ['GENERATING', 'LABEL_READY', 'POSTED', 'DELIVERED', 'NEEDS_RECONCILIATION', 'CANCELING', 'CANCELED'],
  // → PURCHASED: geração falhou; pode pedir de novo (gerar não cobra).
  GENERATING: ['LABEL_READY', 'PURCHASED', 'NEEDS_RECONCILIATION'],
  LABEL_READY: ['POSTED', 'DELIVERED', 'NEEDS_RECONCILIATION', 'CANCELING', 'CANCELED'],
  POSTED: ['DELIVERED', 'NEEDS_RECONCILIATION'],
  DELIVERED: [],
  // Saída SÓ depois de consultar o Melhor Envio.
  NEEDS_RECONCILIATION: ['AWAITING_CONFIRMATION', 'PURCHASED', 'LABEL_READY', 'POSTED', 'DELIVERED', 'CANCELED', 'ERROR'],
  ERROR: ['PREPARED', 'AWAITING_CONFIRMATION', 'NEEDS_RECONCILIATION', 'CANCELED', 'DISCARDED'],
  CANCELED: [],
  // Cancelamento enviado: só sai com resposta do ME; ambíguo/lease vencido → reconciliar.
  CANCELING: ['CANCELED', 'PURCHASED', 'LABEL_READY', 'NEEDS_RECONCILIATION'],
  DISCARDED: [],
};

export const canTransition = (from: ShipmentLabelStatus, to: ShipmentLabelStatus) => LABEL_TRANSITIONS[from].includes(to);

/** O checkout (compra) só pode começar a partir daqui — e só uma requisição vence a troca para PURCHASING. */
export const canStartPurchase = (status: ShipmentLabelStatus) => status === 'AWAITING_CONFIRMATION';

/** Já paga (ou pode ter sido): nunca chamar o checkout de novo. */
export const PAID_OR_UNKNOWN: readonly ShipmentLabelStatus[] = [
  'PURCHASING', 'PURCHASED', 'GENERATING', 'LABEL_READY', 'POSTED', 'DELIVERED', 'NEEDS_RECONCILIATION', 'CANCELING',
];

/** Estados com lease cujo vencimento significa "resultado desconhecido" → reconciliar. */
export const LEASED_STATUSES: readonly ShipmentLabelStatus[] = ['PURCHASING', 'GENERATING', 'CANCELING'];

/**
 * Sandbox = etiqueta de TESTE: o rastreio dela NUNCA vai para
 * `orders.tracking_code` e o cliente NUNCA recebe e-mail de envio.
 */
export const syncsTrackingToOrder = (environment: MelhorEnvioEnvironment) => environment === 'production';
export const notifiesCustomer = (environment: MelhorEnvioEnvironment) => environment === 'production';

/** Trava do BACKEND: lança se a compra não está liberada (desligada ou produção bloqueada). */
export function assertLabelPurchaseAllowed(config: MelhorEnvioLabelsConfig): void {
  if (!config.enabled) {
    throw new HttpError(403, 'LABELS_DISABLED', 'Etiquetas do Melhor Envio estão desligadas no servidor.');
  }
  if (!config.isTest && !config.allowProduction) {
    throw new HttpError(403, 'LABELS_PRODUCTION_BLOCKED', 'Compra de etiquetas em produção está bloqueada no servidor.');
  }
}
