import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient, type ShipmentLabel, type ShipmentLabelStatus } from '@prisma/client';
import { HttpError } from '../../../utils/httpError';
import { decimalToNumber } from '../../../utils/decimal';
import { assertLabelPurchaseAllowed, canTransition } from './labelStatus';
import { buildFiscalPayloadParts, FiscalError, fiscalSelectionSchema } from './fiscal';
import { LabelApiError } from './labelErrors';
import { createMeLabelsClient, labelsRuntimeConfig, type MeLabelsClient, type MeLabelsRuntimeConfig, type MeOrderInfo } from './meLabelsClient';
import { packageSchema, type StoredPackage } from './package';
import { buildCartPayload, PayloadError, resolveLabelServiceId, type OrderAddressSnapshot } from './payload';
import { parseStoredSender } from './sender';

/**
 * Ciclo de vida da etiqueta PERSISTIDA (shipment_labels).
 *
 *   preparar → carrinho do ME → me_order_id gravado → preço lido →
 *   confirmação temporária (AWAITING_CONFIRMATION) → admin confirma →
 *   PURCHASING (CAS) → releitura no ME → checkout → PURCHASED →
 *   geração → LABEL_READY
 *
 * Garantias:
 *   - Toda mudança de status é compare-and-set (id + status + version) numa
 *     transação junto com o evento de auditoria: só UMA requisição vence.
 *   - Checkout nunca é repetido aqui. Qualquer resultado que não PROVE que a
 *     compra não aconteceu → NEEDS_RECONCILIATION.
 *   - Lease de PURCHASING/GENERATING expirado = "não sabemos o que
 *     aconteceu" → NEEDS_RECONCILIATION (nunca "pode comprar de novo").
 *   - Reconciliação só decide olhando o estado da etiqueta NO Melhor Envio.
 *   - Nesta etapa nada mexe em orders.tracking_code nem envia e-mail.
 */

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
/** Lease: cobre releitura + checkout (dois timeouts) com folga. */
export const leaseMs = (cfg: Pick<MeLabelsRuntimeConfig, 'timeoutMs'>) => cfg.timeoutMs * 2 + 30_000;

/** Status do ME que provam pagamento. */
const ME_PAID = new Set(['released', 'paid', 'generated', 'posted', 'delivered']);
const ME_CANCELED = new Set(['canceled', 'cancelled']);

/** Erros de checkout recusados ANTES de qualquer processamento (seguro voltar a um estado recuperável). */
const CHECKOUT_SAFE_ERRORS = new Set(['OPERATION_BLOCKED', 'NOT_CONFIGURED', 'NEEDS_RECONNECT', 'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED']);

export type LabelEventType =
  | 'PREPARED'
  | 'CART_ADD_STARTED'
  | 'CONFIRMATION_CREATED'
  | 'PURCHASE_STARTED'
  | 'PRICE_CHANGED'
  | 'PURCHASE_CONFIRMED'
  | 'RECONCILIATION_REQUIRED'
  | 'LEASE_EXPIRED'
  | 'RECONCILED'
  | 'RECONCILIATION_INCONCLUSIVE'
  | 'GENERATION_STARTED'
  | 'LABEL_GENERATED'
  | 'ERROR';

export interface LabelView {
  id: string;
  orderId: string;
  status: ShipmentLabelStatus;
  environment: string;
  isTest: boolean;
  version: number;
  serviceId: number;
  serviceName: string | null;
  carrier: string | null;
  fiscalMode: string;
  package: StoredPackage | null;
  declaredValue: number | null;
  customerShippingValue: number | null;
  quotedPrice: number | null;
  paidPrice: number | null;
  confirmationExpiresAt: string | null;
  trackingCode: string | null;
  selfTracking: string | null;
  preparedAt: string | null;
  purchasedAt: string | null;
  generatedAt: string | null;
  canceledAt: string | null;
  lastError: { code: string; message: string | null } | null;
  /** Precisa consultar o Melhor Envio antes de qualquer nova ação. */
  requiresReconciliation: boolean;
  /** Compra/geração em andamento (lease ativo). */
  locked: boolean;
}

export interface ConfirmationView {
  /** Token descartável — só o HASH fica no banco. */
  token: string;
  price: number;
  customerShippingValue: number;
  /** price − customerShippingValue (positivo = loja paga mais do que cobrou). */
  difference: number;
  expiresAt: string;
}

export interface WorkflowResult {
  label: LabelView;
  confirmation?: ConfirmationView;
  /** Erro do ME (já seguro) quando a ação terminou num estado de erro/reconciliação. */
  error?: ReturnType<LabelApiError['toSafeJSON']>;
}

export interface PrepareInput {
  package: unknown;
  fiscal: unknown;
  /** CPF/CNPJ do destinatário quando o pedido não tem (opcional). */
  recipientDocument?: string | null;
}

export interface LabelWorkflowDeps {
  db?: PrismaClient;
  client?: MeLabelsClient;
  config?: MeLabelsRuntimeConfig;
  now?: () => Date;
  randomToken?: () => string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const samePrice = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 0.005;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Hash da confirmação: preso ao token, à etiqueta, à versão e ao preço exibido. */
export function confirmationHash(token: string, labelId: string, version: number, price: number): string {
  return createHash('sha256').update(`${token}:${labelId}:${version}:${price.toFixed(2)}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** O estado do ME prova pagamento? */
export function mePaid(o: Pick<MeOrderInfo, 'status' | 'dates'>): boolean {
  return (o.status !== null && ME_PAID.has(o.status)) || o.dates.paidAt !== null;
}
export const meCanceled = (o: Pick<MeOrderInfo, 'status' | 'dates'>) =>
  (o.status !== null && ME_CANCELED.has(o.status)) || o.dates.canceledAt !== null;
/** "No carrinho, não paga" — o ÚNICO estado em que comprar é permitido. */
export const meInCart = (o: Pick<MeOrderInfo, 'status' | 'dates'>) => o.status === 'pending' && !mePaid(o) && !meCanceled(o);

export function toLabelView(l: ShipmentLabel, now: Date): LabelView {
  const locked = Boolean(l.lockUntil && l.lockUntil > now);
  const stale = Boolean(l.lockUntil && l.lockUntil <= now) && (l.status === 'PURCHASING' || l.status === 'GENERATING');
  return {
    id: l.id,
    orderId: l.orderId,
    status: l.status,
    environment: l.environment,
    isTest: l.environment !== 'production',
    version: l.version,
    serviceId: l.serviceId,
    serviceName: l.serviceName,
    carrier: l.carrier,
    fiscalMode: l.fiscalMode,
    package: (l.packageJson as unknown as StoredPackage) ?? null,
    declaredValue: decimalToNumber(l.declaredValue),
    customerShippingValue: decimalToNumber(l.customerShippingValue),
    quotedPrice: decimalToNumber(l.quotedPrice),
    paidPrice: decimalToNumber(l.paidPrice),
    confirmationExpiresAt: l.confirmationHash ? iso(l.confirmationExpiresAt) : null,
    trackingCode: l.trackingCode,
    selfTracking: l.selfTracking,
    preparedAt: iso(l.preparedAt),
    purchasedAt: iso(l.purchasedAt),
    generatedAt: iso(l.generatedAt),
    canceledAt: iso(l.canceledAt),
    lastError: l.lastErrorCode ? { code: l.lastErrorCode, message: l.lastErrorMessage } : null,
    requiresReconciliation: l.status === 'NEEDS_RECONCILIATION' || stale,
    locked,
  };
}

const conflict = (code: string, message: string, details?: Record<string, unknown>) => new HttpError(409, code, message, details);

export function createLabelWorkflow(deps: LabelWorkflowDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const cfg = () => deps.config ?? labelsRuntimeConfig();
  const client = () => deps.client ?? createMeLabelsClient();
  const newToken = deps.randomToken ?? (() => randomBytes(32).toString('base64url'));
  let dbRef: PrismaClient | undefined = deps.db;
  const db = async (): Promise<PrismaClient> => (dbRef ??= (await import('../../../lib/prisma')).prisma);

  /** Trava do backend (desligado / produção sem liberação) — antes de qualquer escrita. */
  function guard() {
    const c = cfg();
    assertLabelPurchaseAllowed({ enabled: c.enabled, allowProduction: c.allowProduction, isTest: c.environment !== 'production' } as Parameters<typeof assertLabelPurchaseAllowed>[0]);
    return c;
  }

  /**
   * Compare-and-set + evento na MESMA transação. `null` = outra requisição
   * mudou a etiqueta antes (versão/status diferentes).
   */
  async function cas(
    label: ShipmentLabel,
    to: ShipmentLabelStatus,
    data: Prisma.ShipmentLabelUpdateManyMutationInput,
    event: { type: LabelEventType; userId?: string | null; details?: Record<string, unknown> } | null,
    extraWhere: Prisma.ShipmentLabelWhereInput = {},
  ): Promise<ShipmentLabel | null> {
    if (to !== label.status && !canTransition(label.status, to)) {
      throw new Error(`Transição de etiqueta inválida: ${label.status} → ${to}`);
    }
    const client = await db();
    return client.$transaction(async (tx) => {
      const r = await tx.shipmentLabel.updateMany({
        where: { id: label.id, status: label.status, version: label.version, ...extraWhere },
        data: { ...data, status: to, version: { increment: 1 } },
      });
      if (r.count !== 1) return null;
      if (event) {
        await tx.shipmentLabelEvent.create({
          data: {
            labelId: label.id,
            orderId: label.orderId,
            type: event.type,
            fromStatus: label.status,
            toStatus: to,
            userId: event.userId ?? null,
            detailsJson: (event.details ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
      }
      return tx.shipmentLabel.findUniqueOrThrow({ where: { id: label.id } });
    });
  }

  const errorData = (e: LabelApiError | { code: string; message: string }) => ({
    lastErrorCode: e.code,
    lastErrorMessage: e instanceof LabelApiError ? (e.externalMessage ?? e.message) : e.message,
  });
  const errorDetails = (e: LabelApiError) => ({ code: e.code, outcome: e.outcome, httpStatus: e.httpStatus, operation: e.operation });

  async function findActive(orderId: string): Promise<ShipmentLabel | null> {
    return (await db()).shipmentLabel.findUnique({ where: { activeOrderId: orderId } });
  }

  /**
   * Lease vencido em PURCHASING/GENERATING = resultado desconhecido.
   * Encaminha para NEEDS_RECONCILIATION (nunca libera nova compra).
   */
  async function normalize(label: ShipmentLabel, userId?: string | null): Promise<ShipmentLabel> {
    const t = now();
    if ((label.status === 'PURCHASING' || label.status === 'GENERATING') && label.lockUntil && label.lockUntil <= t) {
      const moved = await cas(
        label,
        'NEEDS_RECONCILIATION',
        { lockUntil: null, lastErrorCode: 'LEASE_EXPIRED', lastErrorMessage: 'Operação interrompida: consulte o Melhor Envio.' },
        { type: 'LEASE_EXPIRED', userId, details: { from: label.status } },
      );
      return moved ?? (await (await db()).shipmentLabel.findUniqueOrThrow({ where: { id: label.id } }));
    }
    return label;
  }

  async function loadActive(orderId: string, userId?: string | null): Promise<ShipmentLabel> {
    const label = await findActive(orderId);
    if (!label) throw new HttpError(404, 'LABEL_NOT_FOUND', 'Nenhuma etiqueta ativa para este pedido.');
    return normalize(label, userId);
  }

  const view = (l: ShipmentLabel): LabelView => toLabelView(l, now());

  // ---------------------------------------------------------------------------
  // Preparação
  // ---------------------------------------------------------------------------

  async function prepare(orderId: string, input: PrepareInput, userId: string): Promise<WorkflowResult> {
    const c = guard();
    const client_ = await db();

    const order = await client_.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');

    // Já existe etiqueta ativa: nunca cria outra.
    const existing = await findActive(orderId);
    if (existing) {
      const current = await normalize(existing, userId);
      const retryCart = !current.meOrderId && (current.status === 'ERROR' || (current.status === 'PREPARED' && (!current.lockUntil || current.lockUntil <= now())));
      if (!retryCart) return { label: view(current) };
    }

    if (order.paymentStatus !== 'PAID') throw conflict('ORDER_NOT_PAID', 'O pedido ainda não está pago.');
    if (order.status === 'CANCELED') throw conflict('ORDER_CANCELED', 'Pedido cancelado.');

    // Validações locais (nenhuma escrita até aqui).
    let serviceId: number;
    let built: ReturnType<typeof buildCartPayload>;
    let pkg: StoredPackage;
    let fiscal: ReturnType<typeof buildFiscalPayloadParts>;
    try {
      serviceId = resolveLabelServiceId(order);
      const settings = await client_.siteSettings.findUnique({ where: { id: 'main' } });
      const sender = parseStoredSender(settings?.shippingSenderJson);
      fiscal = buildFiscalPayloadParts(fiscalSelectionSchema.parse(input.fiscal), sender);
      pkg = { ...packageSchema.parse(input.package), source: 'admin' };
      built = buildCartPayload({
        serviceId,
        sender: sender!,
        recipient: {
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          document: order.customerCpf ?? input.recipientDocument ?? null,
          address: (order.addressSnapshot ?? {}) as OrderAddressSnapshot,
        },
        package: pkg,
        products: order.items.map((i) => ({ name: i.productName, quantity: i.quantity, unitPrice: decimalToNumber(i.unitPrice) ?? 0 })),
        fiscal,
        orderReference: `pedido-${order.id}`,
      });
    } catch (err) {
      if (err instanceof PayloadError || err instanceof FiscalError) throw new HttpError(422, err.code, err.message);
      throw err; // ZodError → 422 pelo errorHandler
    }

    const lockUntil = new Date(now().getTime() + leaseMs(c));
    const fields = {
      serviceId,
      serviceName: order.shippingServiceName ?? (serviceId === 2 ? 'SEDEX' : 'PAC'),
      carrier: order.shippingCarrier ?? 'Correios',
      fiscalMode: fiscal.fiscalMode,
      nfeKey: fiscal.nfeKey,
      packageJson: pkg as unknown as Prisma.InputJsonValue,
      declaredValue: built.declaredValue,
      customerShippingValue: decimalToNumber(order.shippingValue) ?? 0,
      payloadHash: built.payloadHash,
    };

    // Reserva a etiqueta ANTES de falar com o ME: o índice único de
    // active_order_id garante que só uma preparação segue.
    let label: ShipmentLabel | null;
    if (existing) {
      const current = await normalize(existing, userId);
      label = await cas(current, 'PREPARED', { ...fields, lockUntil, lastErrorCode: null, lastErrorMessage: null }, { type: 'CART_ADD_STARTED', userId, details: { retry: true } });
      if (!label) throw conflict('PREPARE_IN_PROGRESS', 'Outra preparação desta etiqueta está em andamento.');
    } else {
      try {
        label = await client_.$transaction(async (tx) => {
          const created = await tx.shipmentLabel.create({
            data: {
              orderId,
              activeOrderId: orderId,
              environment: c.environment,
              status: 'PREPARED',
              ...fields,
              lockUntil,
              createdByUserId: userId,
            },
          });
          await tx.shipmentLabelEvent.create({
            data: { labelId: created.id, orderId, type: 'CART_ADD_STARTED', toStatus: 'PREPARED', userId },
          });
          return created;
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await findActive(orderId);
          if (winner) return { label: view(winner) };
        }
        throw err;
      }
    }

    // Carrinho do Melhor Envio. O UUID é gravado IMEDIATAMENTE.
    try {
      const item = await client().addToCart(built.payload);
      const saved = await cas(
        label,
        'PREPARED',
        { meOrderId: item.id, meProtocol: item.protocol, quotedPrice: item.price, preparedAt: now(), lockUntil: null },
        { type: 'PREPARED', userId, details: { price: item.price, serviceId, fiscalMode: fiscal.fiscalMode, warnings: built.warnings.length } },
      );
      if (!saved) throw new Error('Etiqueta alterada durante a preparação.');
      label = saved;
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      // Sem UUID não há o que comprar: ERROR é seguro (no máximo sobra um item
      // de carrinho não pago no ME, que nunca é comprado por nós).
      const failed = await cas(label, 'ERROR', { ...errorData(err), lockUntil: null }, { type: 'ERROR', userId, details: errorDetails(err) });
      return { label: view(failed ?? label), error: err.toSafeJSON() };
    }

    return requestConfirmationFor(label, userId);
  }

  // ---------------------------------------------------------------------------
  // Confirmação
  // ---------------------------------------------------------------------------

  async function requestConfirmation(orderId: string, userId: string): Promise<WorkflowResult> {
    guard();
    return requestConfirmationFor(await loadActive(orderId, userId), userId);
  }

  async function requestConfirmationFor(label: ShipmentLabel, userId: string): Promise<WorkflowResult> {
    if (!['PREPARED', 'AWAITING_CONFIRMATION', 'ERROR'].includes(label.status) || !label.meOrderId) {
      throw blockedBy(label);
    }
    if (label.lockUntil && label.lockUntil > now()) throw conflict('PREPARE_IN_PROGRESS', 'Preparação em andamento.');

    let me: MeOrderInfo;
    try {
      me = await client().getOrder(label.meOrderId);
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      return { label: view(label), error: err.toSafeJSON() };
    }

    // Qualquer coisa além de "no carrinho" (paga, cancelada, desconhecida): reconciliar.
    if (!meInCart(me)) {
      const moved = await cas(
        label,
        'NEEDS_RECONCILIATION',
        { confirmationHash: null, confirmationExpiresAt: null, lastErrorCode: 'NOT_IN_CART', lastErrorMessage: 'A etiqueta não está mais no carrinho do Melhor Envio.' },
        { type: 'RECONCILIATION_REQUIRED', userId, details: { reason: 'not_in_cart', meStatus: me.status } },
      );
      if (!moved) throw conflict('LABEL_CHANGED', 'A etiqueta mudou. Atualize a página.');
      return reconcileFor(moved, userId);
    }
    if (me.price === null || me.price <= 0) {
      return { label: view(label), error: { operation: 'order.get', code: 'BAD_RESPONSE', outcome: 'unknown', requiresReconciliation: false, httpStatus: null, message: 'O Melhor Envio não informou o preço da etiqueta.', externalMessage: null, fields: [] } };
    }

    const price = round2(me.price);
    const token = newToken();
    const nextVersion = label.version + 1;
    const expiresAt = new Date(now().getTime() + CONFIRMATION_TTL_MS);
    const previous = decimalToNumber(label.quotedPrice);
    const saved = await cas(
      label,
      'AWAITING_CONFIRMATION',
      {
        quotedPrice: price,
        confirmationPrice: price,
        confirmationHash: confirmationHash(token, label.id, nextVersion, price),
        confirmationExpiresAt: expiresAt,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
      { type: 'CONFIRMATION_CREATED', userId, details: { price, previousPrice: previous, expiresAt: expiresAt.toISOString() } },
    );
    if (!saved) throw conflict('LABEL_CHANGED', 'A etiqueta mudou. Atualize a página.');
    if (previous !== null && !samePrice(previous, price)) {
      await logEvent(saved, 'PRICE_CHANGED', userId, { previousPrice: previous, price });
    }
    const customer = decimalToNumber(saved.customerShippingValue) ?? 0;
    return {
      label: view(saved),
      confirmation: { token, price, customerShippingValue: customer, difference: round2(price - customer), expiresAt: expiresAt.toISOString() },
    };
  }

  async function logEvent(label: ShipmentLabel, type: LabelEventType, userId: string | null, details?: Record<string, unknown>) {
    await (await db()).shipmentLabelEvent.create({
      data: { labelId: label.id, orderId: label.orderId, type, fromStatus: label.status, toStatus: label.status, userId, detailsJson: details as Prisma.InputJsonValue },
    });
  }

  /** 409 explicando por que a ação não cabe no estado atual. */
  function blockedBy(label: ShipmentLabel): HttpError {
    switch (label.status) {
      case 'PURCHASING':
        return conflict('PURCHASE_IN_PROGRESS', 'Compra desta etiqueta em andamento.');
      case 'NEEDS_RECONCILIATION':
        return conflict('NEEDS_RECONCILIATION', 'Consulte o Melhor Envio (Verificar) antes de qualquer nova ação.');
      case 'PURCHASED':
      case 'GENERATING':
      case 'LABEL_READY':
      case 'POSTED':
      case 'DELIVERED':
        return conflict('ALREADY_PURCHASED', 'Esta etiqueta já foi comprada.');
      case 'CANCELED':
        return conflict('LABEL_CANCELED', 'Etiqueta cancelada.');
      default:
        return conflict('INVALID_STATE', 'A etiqueta não está pronta para esta ação.');
    }
  }

  // ---------------------------------------------------------------------------
  // Compra
  // ---------------------------------------------------------------------------

  async function purchase(orderId: string, token: string, userId: string): Promise<WorkflowResult> {
    const c = guard();
    const client_ = await db();
    const label = await loadActive(orderId, userId);

    if (label.status !== 'AWAITING_CONFIRMATION') throw blockedBy(label);
    if (label.paidPrice !== null || label.purchasedAt !== null || label.mePurchaseId !== null) {
      throw conflict('ALREADY_PURCHASED', 'Esta etiqueta já foi comprada.');
    }
    if (!label.meOrderId || !label.confirmationHash || !label.confirmationExpiresAt || label.confirmationPrice === null) {
      throw conflict('CONFIRMATION_REQUIRED', 'Gere uma nova confirmação de preço.');
    }
    if (label.confirmationExpiresAt <= now()) throw conflict('CONFIRMATION_EXPIRED', 'A confirmação expirou. Confira o preço de novo.');
    const confirmedPrice = decimalToNumber(label.confirmationPrice)!;
    const expected = confirmationHash(String(token ?? ''), label.id, label.version, confirmedPrice);
    if (!safeEqualHex(expected, label.confirmationHash)) throw conflict('CONFIRMATION_INVALID', 'Confirmação inválida ou já usada.');

    const order = await client_.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true, status: true } });
    if (!order || order.paymentStatus !== 'PAID' || order.status === 'CANCELED') throw conflict('ORDER_NOT_PAID', 'O pedido não está pago.');

    // CAS: só UMA requisição passa de AWAITING_CONFIRMATION para PURCHASING.
    // O hash some na mesma escrita: a confirmação vale uma única vez.
    const purchasing = await cas(
      label,
      'PURCHASING',
      { lockUntil: new Date(now().getTime() + leaseMs(c)), confirmationHash: null, confirmationExpiresAt: null, purchasedByUserId: userId },
      { type: 'PURCHASE_STARTED', userId, details: { confirmedPrice } },
      { confirmationHash: label.confirmationHash, confirmationExpiresAt: { gt: now() }, purchasedAt: null, paidPrice: null, mePurchaseId: null },
    );
    if (!purchasing) throw conflict('PURCHASE_CONFLICT', 'Esta compra já foi iniciada em outra requisição.');

    // 1) Releitura no ME antes de qualquer checkout.
    let me: MeOrderInfo;
    try {
      me = await client().getOrder(purchasing.meOrderId!);
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      // Checkout NÃO foi chamado: voltar a um estado recuperável é seguro.
      const back = await cas(purchasing, 'ERROR', { ...errorData(err), lockUntil: null }, { type: 'ERROR', userId, details: { ...errorDetails(err), stage: 'reread' } });
      return { label: view(back ?? purchasing), error: err.toSafeJSON() };
    }

    if (mePaid(me) || meCanceled(me) || !meInCart(me)) {
      // Já paga (ou mudou de estado no ME): NÃO chamar checkout; reconciliar.
      const moved = await cas(purchasing, 'NEEDS_RECONCILIATION', { lockUntil: null }, { type: 'RECONCILIATION_REQUIRED', userId, details: { reason: 'reread_not_in_cart', meStatus: me.status } });
      return reconcileFor(moved ?? purchasing, userId);
    }

    if (!samePrice(me.price, confirmedPrice)) {
      // Preço mudou: não compra; nova confirmação com o novo preço (a antiga já foi invalidada).
      const price = me.price !== null ? round2(me.price) : null;
      if (price === null || price <= 0) {
        const moved = await cas(purchasing, 'ERROR', { lockUntil: null, lastErrorCode: 'PRICE_UNAVAILABLE', lastErrorMessage: 'O Melhor Envio não informou o preço.' }, { type: 'ERROR', userId, details: { code: 'PRICE_UNAVAILABLE' } });
        return { label: view(moved ?? purchasing) };
      }
      const newTok = newToken();
      const expiresAt = new Date(now().getTime() + CONFIRMATION_TTL_MS);
      const back = await cas(
        purchasing,
        'AWAITING_CONFIRMATION',
        {
          lockUntil: null,
          quotedPrice: price,
          confirmationPrice: price,
          confirmationHash: confirmationHash(newTok, purchasing.id, purchasing.version + 1, price),
          confirmationExpiresAt: expiresAt,
        },
        { type: 'PRICE_CHANGED', userId, details: { previousPrice: confirmedPrice, price } },
      );
      if (back) await logEvent(back, 'CONFIRMATION_CREATED', userId, { price, expiresAt: expiresAt.toISOString(), reason: 'price_changed' });
      const customer = decimalToNumber(purchasing.customerShippingValue) ?? 0;
      throw conflict('PRICE_CHANGED', 'O preço da etiqueta mudou. Confirme o novo valor.', {
        previousPrice: confirmedPrice,
        price,
        confirmation: back
          ? { token: newTok, price, customerShippingValue: customer, difference: round2(price - customer), expiresAt: expiresAt.toISOString() }
          : null,
      });
    }

    // 2) Checkout — UMA chamada.
    try {
      const result = await client().checkout(purchasing.meOrderId!);
      const paid = round2(result.order.price ?? result.total ?? confirmedPrice);
      const done = await cas(
        purchasing,
        'PURCHASED',
        { lockUntil: null, paidPrice: paid, mePurchaseId: result.purchaseId, purchasedAt: result.paidAt ? new Date(result.paidAt) : now(), lastErrorCode: null, lastErrorMessage: null },
        { type: 'PURCHASE_CONFIRMED', userId, details: { paidPrice: paid, meStatus: result.order.status } },
      );
      if (!done) {
        // Outra coisa mexeu na etiqueta durante o checkout: não sabemos o estado final.
        const fresh = await client_.shipmentLabel.findUniqueOrThrow({ where: { id: purchasing.id } });
        return { label: view(fresh) };
      }
      return generateFor(done, userId);
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      if (err.code === 'ALREADY_PAID') {
        const moved = await cas(purchasing, 'NEEDS_RECONCILIATION', { lockUntil: null, ...errorData(err) }, { type: 'RECONCILIATION_REQUIRED', userId, details: errorDetails(err) });
        return reconcileFor(moved ?? purchasing, userId);
      }
      if (err.outcome === 'not_sent' || (err.outcome === 'rejected' && CHECKOUT_SAFE_ERRORS.has(err.code))) {
        // Recusado antes de processar: seguro voltar a um estado recuperável (nova confirmação exigida).
        const back = await cas(purchasing, 'ERROR', { lockUntil: null, ...errorData(err) }, { type: 'ERROR', userId, details: { ...errorDetails(err), stage: 'checkout' } });
        return { label: view(back ?? purchasing), error: err.toSafeJSON() };
      }
      // Timeout, 5xx, rede, corpo inválido, 422 de compra…: não dá para provar que NÃO comprou.
      const moved = await cas(purchasing, 'NEEDS_RECONCILIATION', { lockUntil: null, ...errorData(err) }, { type: 'RECONCILIATION_REQUIRED', userId, details: { ...errorDetails(err), stage: 'checkout' } });
      return { label: view(moved ?? purchasing), error: err.toSafeJSON() };
    }
  }

  // ---------------------------------------------------------------------------
  // Reconciliação
  // ---------------------------------------------------------------------------

  /** Ação explícita "Verificar no Melhor Envio". */
  async function reconcile(orderId: string, userId: string): Promise<WorkflowResult> {
    const label = await loadActive(orderId, userId);
    if (label.status === 'PURCHASING' || label.status === 'GENERATING') {
      throw conflict(label.status === 'PURCHASING' ? 'PURCHASE_IN_PROGRESS' : 'GENERATION_IN_PROGRESS', 'Operação em andamento. Aguarde.');
    }
    if (!label.meOrderId) throw conflict('NOTHING_TO_RECONCILE', 'A etiqueta ainda não foi criada no Melhor Envio.');
    if (['CANCELED', 'DELIVERED'].includes(label.status)) return { label: view(label) };
    if (label.status !== 'NEEDS_RECONCILIATION') {
      const moved = await cas(label, 'NEEDS_RECONCILIATION', {}, { type: 'RECONCILIATION_REQUIRED', userId, details: { reason: 'manual', from: label.status } });
      if (!moved) throw conflict('LABEL_CHANGED', 'A etiqueta mudou. Atualize a página.');
      return reconcileFor(moved, userId);
    }
    return reconcileFor(label, userId);
  }

  async function reconcileFor(label: ShipmentLabel, userId: string | null): Promise<WorkflowResult> {
    if (label.status !== 'NEEDS_RECONCILIATION' || !label.meOrderId) return { label: view(label) };
    const c = cfg();
    // Lease da reconciliação: uma consulta por vez (status não muda).
    const locked = await cas(label, 'NEEDS_RECONCILIATION', { lockUntil: new Date(now().getTime() + leaseMs(c)) }, null, {
      OR: [{ lockUntil: null }, { lockUntil: { lte: now() } }],
    });
    if (!locked) throw conflict('RECONCILIATION_IN_PROGRESS', 'Verificação já em andamento.');

    let me: MeOrderInfo;
    try {
      me = await client().getOrder(locked.meOrderId!);
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      const kept = await cas(locked, 'NEEDS_RECONCILIATION', { lockUntil: null, ...errorData(err) }, { type: 'RECONCILIATION_INCONCLUSIVE', userId, details: errorDetails(err) });
      return { label: view(kept ?? locked), error: err.toSafeJSON() };
    }

    const base = { lockUntil: null, lastSyncedAt: now(), lastErrorCode: null, lastErrorMessage: null };
    const evt = (to: ShipmentLabelStatus) => ({ type: 'RECONCILED' as const, userId, details: { meStatus: me.status, to } });
    let next: ShipmentLabel | null = null;

    if (meCanceled(me)) {
      next = await cas(locked, 'CANCELED', { ...base, activeOrderId: null, canceledAt: me.dates.canceledAt ? new Date(me.dates.canceledAt) : now() }, evt('CANCELED'));
    } else if (mePaid(me)) {
      const paid = {
        ...base,
        paidPrice: locked.paidPrice ?? (me.price !== null ? round2(me.price) : null),
        purchasedAt: locked.purchasedAt ?? (me.dates.paidAt ? new Date(me.dates.paidAt) : now()),
        trackingCode: me.tracking ?? locked.trackingCode,
        selfTracking: me.selfTracking ?? locked.selfTracking,
      };
      const to: ShipmentLabelStatus =
        me.status === 'delivered' || me.dates.deliveredAt ? 'DELIVERED'
        : me.status === 'posted' || me.dates.postedAt ? 'POSTED'
        : me.status === 'generated' || me.dates.generatedAt ? 'LABEL_READY'
        : 'PURCHASED';
      next = await cas(
        locked,
        to,
        {
          ...paid,
          ...(me.dates.generatedAt ? { generatedAt: new Date(me.dates.generatedAt) } : {}),
          ...(me.dates.postedAt ? { postedAt: new Date(me.dates.postedAt) } : {}),
          ...(me.dates.deliveredAt ? { deliveredAt: new Date(me.dates.deliveredAt) } : {}),
        },
        evt(to),
      );
    } else if (meInCart(me)) {
      // Não paga e ainda no carrinho: volta para confirmação, SEM token válido
      // (o admin precisa pedir uma nova confirmação e conferir o preço).
      next = await cas(
        locked,
        'AWAITING_CONFIRMATION',
        { ...base, confirmationHash: null, confirmationExpiresAt: null, quotedPrice: me.price !== null ? round2(me.price) : locked.quotedPrice },
        evt('AWAITING_CONFIRMATION'),
      );
    } else {
      // Status desconhecido/expirado sem prova de pagamento: inconclusivo.
      next = await cas(
        locked,
        'NEEDS_RECONCILIATION',
        { lockUntil: null, lastSyncedAt: now(), lastErrorCode: 'INCONCLUSIVE', lastErrorMessage: 'Estado no Melhor Envio inconclusivo. Verifique no painel do Melhor Envio.' },
        { type: 'RECONCILIATION_INCONCLUSIVE', userId, details: { meStatus: me.status } },
      );
    }
    if (!next) throw conflict('LABEL_CHANGED', 'A etiqueta mudou durante a verificação. Atualize a página.');
    return { label: view(next) };
  }

  // ---------------------------------------------------------------------------
  // Geração
  // ---------------------------------------------------------------------------

  async function generate(orderId: string, userId: string): Promise<WorkflowResult> {
    guard();
    const label = await loadActive(orderId, userId);
    if (label.status === 'LABEL_READY' || label.status === 'POSTED' || label.status === 'DELIVERED') return { label: view(label) };
    if (label.status === 'GENERATING') throw conflict('GENERATION_IN_PROGRESS', 'Geração em andamento.');
    if (label.status !== 'PURCHASED') throw blockedBy(label);
    return generateFor(label, userId);
  }

  async function generateFor(label: ShipmentLabel, userId: string): Promise<WorkflowResult> {
    const c = cfg();
    const generating = await cas(label, 'GENERATING', { lockUntil: new Date(now().getTime() + leaseMs(c)) }, { type: 'GENERATION_STARTED', userId });
    if (!generating) throw conflict('GENERATION_IN_PROGRESS', 'Geração já iniciada em outra requisição.');
    try {
      const r = await client().generate(generating.meOrderId!);
      const ready = await cas(generating, 'LABEL_READY', { lockUntil: null, generatedAt: now(), lastErrorCode: null, lastErrorMessage: null }, { type: 'LABEL_GENERATED', userId, details: { accepted: r.accepted } });
      return { label: view(ready ?? generating) };
    } catch (err) {
      if (!(err instanceof LabelApiError)) throw err;
      if (err.outcome === 'unknown') {
        // Pode ter gerado: consultar o ME antes de repetir.
        const moved = await cas(generating, 'NEEDS_RECONCILIATION', { lockUntil: null, ...errorData(err) }, { type: 'RECONCILIATION_REQUIRED', userId, details: { ...errorDetails(err), stage: 'generate' } });
        return { label: view(moved ?? generating), error: err.toSafeJSON() };
      }
      // Recusa explícita: não gerou; pode tentar de novo (gerar não cobra).
      const back = await cas(generating, 'PURCHASED', { lockUntil: null, ...errorData(err) }, { type: 'ERROR', userId, details: { ...errorDetails(err), stage: 'generate' } });
      return { label: view(back ?? generating), error: err.toSafeJSON() };
    }
  }

  async function get(orderId: string, userId?: string | null): Promise<LabelView | null> {
    const label = await findActive(orderId);
    return label ? view(await normalize(label, userId)) : null;
  }

  return { prepare, requestConfirmation, purchase, reconcile, generate, get };
}

export type LabelWorkflow = ReturnType<typeof createLabelWorkflow>;
