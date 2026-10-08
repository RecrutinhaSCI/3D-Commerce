import crypto from 'node:crypto';
import { OrderStatus, PaymentMethod, PaymentStatus, type Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { decimalToNumber } from '../../utils/decimal';
import { sendEmail } from '../../lib/email';
import { orderCanceledEmail } from '../../lib/emailTemplates';
import { cancelOrderRecord, settlePaidOrder } from '../orders/orders.service';
import {
  resolvePaymentKind,
  type CreatePaymentInput,
  type PaymentKind,
} from './payments.schemas';

/**
 * Mercado Pago — Orders API (`/v1/orders`), Checkout Transparente.
 *
 * Migrado da Payments API (`/v1/payments`, descontinuada) na T10. A criação
 * usa `fetch` direto ao endpoint (não o SDK `Order`) porque uma recusa de
 * cartão volta como **HTTP 402** com o pedido em `body.data` — o SDK lançaria
 * e perderíamos esse corpo; com `fetch` tratamos a recusa como resultado
 * normal (`{ status: 'rejected' }`) que o front já entende. Verificado em
 * sandbox (T10): valores são STRING, `X-Idempotency-Key` obrigatório, e o
 * status do pagamento vem no vocabulário `processed`/`action_required`/`failed`.
 *
 * Persistência: guardamos o **id da Order do MP** (ULID) em `order.mpPaymentId`
 * — é ele o `{id}` do `GET /v1/orders/{id}` e o `data.id` do webhook (T11).
 */

const MP_API = 'https://api.mercadopago.com';
const MP_TIMEOUT_MS = 8000;

/** Pedidos por execução do cron/reconcile (1 chamada ao MP cada). */
const RECONCILE_BATCH = 50;
/**
 * Prazo para expirar pedido não pago, contado da criação. Pix vence em 1 dia e
 * boleto em 3 (expiration_time no createPayment) — damos folga de compensação.
 */
const EXPIRE_AFTER_HOURS = { default: 48, boleto: 96 } as const;

// ---------------------------------------------------------------------------
// Tipos mínimos da resposta da Orders API (só os campos que consumimos).
// ---------------------------------------------------------------------------

interface MpPaymentMethod {
  id?: string;
  type?: string;
  ticket_url?: string;
  qr_code?: string;
  qr_code_base64?: string;
  digitable_line?: string;
  barcode_content?: string;
}

interface MpPayment {
  id?: string;
  status?: string;
  status_detail?: string;
  payment_method?: MpPaymentMethod;
}

interface MpOrder {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transactions?: { payments?: MpPayment[] };
}

/** Corpo de erro de negócio do `/v1/orders` (ex.: cartão recusado → HTTP 402). */
interface MpErrorBody {
  errors?: Array<{ code?: string; message?: string; details?: unknown }>;
  data?: MpOrder;
}

// ---------------------------------------------------------------------------
// Mapeamento de status — ponto ÚNICO, reusado por getPaymentStatus e webhook.
// ---------------------------------------------------------------------------

/**
 * Traduz o status da Orders API (Order ou payment) para o enum `PaymentStatus`
 * do Prisma. Valores observados em sandbox (T10):
 *   - cartão aprovado → `processed` (detail `accredited`)
 *   - cartão recusado → `failed`    (detail `rejected_by_issuer` / `insufficient_amount`)
 *   - cartão pendente → `processing` (detail `in_process`)
 *   - Pix sem pagar   → `action_required` (detail `waiting_transfer`)
 *   - boleto sem pagar→ `action_required` (detail `waiting_payment`)
 * Estados intermediários ficam `PENDING` até o webhook (T11) confirmar.
 */
export function mapMpStatus(mpStatus: string | undefined): PaymentStatus {
  switch (mpStatus) {
    case 'processed':
    case 'approved':
      return PaymentStatus.PAID;
    case 'rejected':
    case 'failed':
      return PaymentStatus.FAILED;
    case 'cancelled':
    case 'canceled':
      return PaymentStatus.CANCELED;
    case 'refunded':
    case 'partially_refunded':
    case 'charged_back':
      return PaymentStatus.REFUNDED;
    case 'action_required':
    case 'processing':
    case 'pending':
    case 'in_process':
    case 'in_mediation':
    case 'authorized':
    case 'created':
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * Traduz o status da Orders API para o vocabulário CLÁSSICO da Payments API
 * (`approved`/`rejected`/`in_process`/`pending`/...) que o frontend (T6) já
 * consome — o Checkout ramifica em `status === 'approved'` e `=== 'rejected'`.
 * Mantém o contrato de resposta estável apesar da troca de API.
 */
export function mpStatusToLegacy(mpStatus: string | undefined): string {
  switch (mpStatus) {
    case 'processed':
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'failed':
      return 'rejected';
    case 'processing':
    case 'in_process':
      return 'in_process';
    case 'action_required':
    case 'pending':
    case 'created':
      return 'pending';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'authorized':
      return 'authorized';
    default:
      return mpStatus ?? 'unknown';
  }
}

/**
 * Ordem de avanço dos estados de pagamento. Só se avança nesta escala; nunca
 * se regride. Usada pela reconciliação (getPaymentStatus) e pelo webhook (T11)
 * para garantir monotonicidade: uma notificação PENDING atrasada não rebaixa um
 * pedido já PAID, e reprocessar a MESMA notificação não tem efeito (idempotência
 * — `next` nunca supera o `current` igual).
 *
 * PENDING(0) → FAILED/CANCELED(1) → PAID(2) → REFUNDED(3). REFUNDED é terminal.
 */
/**
 * Método REAL escolhido no Payment Brick (fonte única). O pedido é criado antes
 * do Brick com um placeholder; ao iniciar o pagamento gravamos aqui o método
 * efetivo para o admin exibir o correto (Pix/cartão/boleto).
 */
const KIND_TO_PAYMENT_METHOD: Record<PaymentKind, PaymentMethod> = {
  credit_card: PaymentMethod.CREDIT_CARD,
  pix: PaymentMethod.PIX,
  boleto: PaymentMethod.BOLETO,
};

const PAYMENT_STATUS_RANK: Record<PaymentStatus, number> = {
  [PaymentStatus.PENDING]: 0,
  [PaymentStatus.FAILED]: 1,
  [PaymentStatus.CANCELED]: 1,
  [PaymentStatus.PAID]: 2,
  [PaymentStatus.REFUNDED]: 3,
};

/**
 * Só permite aplicar `next` se ele estiver estritamente à frente de `current`.
 * Estritamente (`>`, não `>=`) garante que repetir o mesmo status seja no-op.
 */
export function canAdvancePaymentStatus(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  return PAYMENT_STATUS_RANK[next] > PAYMENT_STATUS_RANK[current];
}

// ---------------------------------------------------------------------------
// Cliente HTTP mínimo do Mercado Pago (fetch direto).
// ---------------------------------------------------------------------------

interface MpResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Faz uma requisição à Orders API. NUNCA loga o access token, o cartão nem o
 * corpo cru. Timeout curto (8s) — bem dentro da janela de ~22s do webhook.
 * Falha de rede/timeout vira 502 (o cliente pode tentar de novo).
 */
async function mpRequest(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<MpResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${MP_API}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // eslint-disable-next-line no-console
    console.error('[payments] Falha de rede/timeout ao falar com o Mercado Pago.');
    throw new HttpError(
      502,
      'PAYMENT_PROVIDER_ERROR',
      'O provedor de pagamento está indisponível. Tente novamente.',
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

/**
 * Converte uma resposta não-ok (que NÃO é recusa de negócio) em `HttpError`
 * seguro. Repassa só a mensagem enxuta do MP; nunca dados sensíveis (CWE-209).
 */
function providerError(status: number, body: unknown): HttpError {
  const first = (body as MpErrorBody | null)?.errors?.[0];
  const upstreamIs5xx = status >= 500;
  const outStatus = status >= 400 && status < 500 ? status : 502;
  const message = upstreamIs5xx
    ? 'O provedor de pagamento está indisponível. Tente novamente.'
    : first?.message || 'Não foi possível processar o pagamento.';
  // eslint-disable-next-line no-console
  console.error(`[payments] Mercado Pago respondeu ${status}: ${first?.code ?? 'erro'}`);
  return new HttpError(
    upstreamIs5xx ? 502 : outStatus,
    'PAYMENT_PROVIDER_ERROR',
    message,
  );
}

// ---------------------------------------------------------------------------
// Contrato de resposta ao frontend (T6). Campos por método são planos, como o
// front consome: cartão → { status, statusDetail }; Pix → { qr_code,
// qr_code_base64, ticket_url }; boleto → { external_resource_url }.
// ---------------------------------------------------------------------------

interface CreatePaymentResult {
  orderId: string;
  method: PaymentKind;
  /** Valor cobrado nesta tentativa (já com o desconto do Pix, se houver). */
  amount: number;
  /** Desconto da forma de pagamento aplicado (0 fora do Pix). */
  paymentDiscount: number;
  /** Id do PAGAMENTO no MP (`transactions.payments[0].id`), para exibição. */
  paymentId?: string;
  /** Status no vocabulário clássico (approved/rejected/in_process/pending/...). */
  status: string;
  statusDetail?: string;
  paymentStatus: PaymentStatus;
  // Pix
  qr_code?: string;
  qr_code_base64?: string;
  ticket_url?: string;
  // Boleto
  external_resource_url?: string;
  digitable_line?: string;
  barcode_content?: string;
}

/** Status do PAGAMENTO de uma Order do MP (prefere o payment, cai na Order). */
function mpOrderPaymentStatus(mpOrder: MpOrder): PaymentStatus {
  const p = mpOrder.transactions?.payments?.[0];
  return mapMpStatus(p?.status ?? mpOrder.status);
}

/** Order do MP ainda cancelável (aguardando Pix/boleto ou criada). */
function isMpOrderOpen(mpOrder: MpOrder): boolean {
  return ['action_required', 'created', 'pending'].includes(mpOrder.status ?? '');
}

/**
 * Cancela uma Order do MP (best-effort). Usado ao trocar de método e no
 * cancelamento pelo admin/expiração. Nunca lança por falha do MP.
 */
async function cancelMpOrder(mpOrderId: string): Promise<boolean> {
  try {
    const res = await mpRequest(`/v1/orders/${encodeURIComponent(mpOrderId)}/cancel`, {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[payments] Não foi possível cancelar a Order ${mpOrderId} no MP (HTTP ${res.status}).`);
    }
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Encerra a tentativa anterior antes de uma nova: se já foi paga → 'paid';
 * se ainda está aberta → cancela no MP; se já falhou/cancelou → nada.
 */
async function closePreviousAttempt(mpOrderId: string): Promise<'paid' | 'closed'> {
  const res = await mpRequest(`/v1/orders/${encodeURIComponent(mpOrderId)}`, { method: 'GET' });
  if (!res.ok) return 'closed'; // inexistente/erro: segue com a nova tentativa
  const mpOrder = res.body as MpOrder;
  if (mpOrderPaymentStatus(mpOrder) === PaymentStatus.PAID) return 'paid';
  if (isMpOrderOpen(mpOrder)) await cancelMpOrder(mpOrderId);
  return 'closed';
}

/** Avisa o cliente do cancelamento (não-bloqueante, nunca lança). */
async function notifyCanceled(orderId: string, reason: 'refunded' | 'canceled' | 'expired'): Promise<void> {
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerEmail: true, total: true } });
    if (!o) return;
    const content = orderCanceledEmail(orderId, reason, decimalToNumber(o.total) ?? undefined);
    await sendEmail({ to: o.customerEmail, subject: content.subject, html: content.html, text: content.text });
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[payments:email] Falha ao enviar "pedido cancelado" do pedido ${orderId}.`);
  }
}

/**
 * Efeitos de uma mudança de status vinda do MP (webhook, polling, reconcile):
 *  - PAID     → liquida (estoque + confirma + e-mail), idempotente;
 *  - REFUNDED → estorno/chargeback feito no MP: cancela o pedido, repõe o
 *               estoque e devolve o cupom (uma única vez) e avisa o cliente.
 */
async function afterPaymentTransition(orderId: string, next: PaymentStatus): Promise<void> {
  if (next === PaymentStatus.PAID) {
    await settlePaidOrder(orderId);
  } else if (next === PaymentStatus.REFUNDED) {
    const canceledNow = await cancelOrderRecord(orderId, PaymentStatus.REFUNDED);
    if (canceledNow) await notifyCanceled(orderId, 'refunded');
  }
}

/** Anexa um marcador às notas do pedido (idempotente). */
async function appendOrderNote(orderId: string, marker: string, text: string): Promise<void> {
  const current = await prisma.order.findUnique({ where: { id: orderId }, select: { notes: true } });
  if (current?.notes?.includes(marker)) return;
  const note = `${marker} ${text}`;
  await prisma.order.update({
    where: { id: orderId },
    data: { notes: current?.notes ? `${note}\n${current.notes}` : note },
  });
}

/**
 * Desconto do Pix em R$ para o pedido: `pixDiscountPercent` (SiteSettings,
 * editável no admin) sobre os produtos já com cupom — frete não entra.
 */
async function pixDiscountFor(order: { subtotal: Prisma.Decimal; discountValue: Prisma.Decimal }): Promise<number> {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: 'main' },
    select: { pixDiscountPercent: true },
  });
  const pct = decimalToNumber(settings?.pixDiscountPercent) ?? 0;
  if (pct <= 0) return 0;
  const base = Math.max(0, (decimalToNumber(order.subtotal) ?? 0) - (decimalToNumber(order.discountValue) ?? 0));
  return Number(((base * Math.min(pct, 100)) / 100).toFixed(2));
}

export const paymentsService = {
  /**
   * Cria uma Order no Mercado Pago para um pedido PENDENTE do próprio usuário.
   * Monta o body conforme o método (valores como STRING), aplica idempotência,
   * persiste o id da Order do MP em `mpPaymentId` + `externalReference`, reflete
   * o `paymentStatus` inicial e devolve ao front só o necessário por método.
   *
   * Anti-IDOR: `findFirst({ id, userId })` — pedido de outro usuário responde
   * 404, igual a um inexistente. Exige `status === PENDING`.
   */
  async createPayment(
    userId: string,
    orderId: string,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    if (order.status !== OrderStatus.PENDING) {
      throw HttpError.conflict('Este pedido não está mais pendente de pagamento.');
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw HttpError.conflict('Este pedido já foi pago.');
    }

    const kind = resolvePaymentKind(
      input.selectedPaymentMethod,
      input.formData.payment_method_id,
    );
    if (!kind) throw HttpError.badRequest('Método de pagamento inválido.');

    // Nova tentativa (troca de método ou retry): encerra a anterior no MP para
    // o cliente não conseguir pagar duas vezes (ex.: Pix antigo + cartão).
    if (order.mpPaymentId) {
      const previous = await closePreviousAttempt(order.mpPaymentId);
      if (previous === 'paid') {
        // A tentativa anterior foi paga nesse meio-tempo → liquida e recusa.
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: PaymentStatus.PAID } });
        await settlePaidOrder(order.id);
        throw HttpError.conflict('Este pedido já foi pago.');
      }
    }

    // Valor SEMPRE do pedido (nunca do cliente) e como string ("50.00").
    // Desconto da forma de pagamento: no Pix, `pixDiscountPercent` (admin) sobre
    // os PRODUTOS já com cupom (frete fora) — o mesmo que a vitrine anuncia.
    // `total + paymentDiscount` = total bruto, então trocar de método recalcula.
    const grossTotal = (decimalToNumber(order.total) ?? 0) + (decimalToNumber(order.paymentDiscount) ?? 0);
    const paymentDiscount = kind === 'pix' ? await pixDiscountFor(order) : 0;
    const chargedTotal = Number((grossTotal - paymentDiscount).toFixed(2));
    const amount = chargedTotal.toFixed(2);
    const { formData } = input;
    const email = formData.payer.email || order.customerEmail;

    const payer: Record<string, unknown> = { email };
    if (formData.payer.first_name) payer.first_name = formData.payer.first_name;
    if (formData.payer.last_name) payer.last_name = formData.payer.last_name;
    if (formData.payer.identification) payer.identification = formData.payer.identification;
    else if (order.customerCpf) payer.identification = { type: 'CPF', number: order.customerCpf };

    // Endereço para a Orders API. A UF DEVE ir como `state`; o campo
    // `federal_unit` (nome da Payments API antiga / Brick) é REJEITADO pelo MP
    // (HTTP 400 "Properties not supported"). Remapeamos `state ?? federal_unit`
    // e nunca repassamos `federal_unit`. Cartão/Pix não exigem address.
    const rawAddress = formData.payer.address;
    if (rawAddress) {
      const { federal_unit, state, ...restAddress } = rawAddress;
      const address: Record<string, unknown> = { ...restAddress };
      const uf = state ?? federal_unit;
      if (uf) address.state = uf;
      payer.address = address;
    }

    // Boleto exige payer.address (T7: sem ele o MP responde 400
    // "missing properties: 'address'"). Falhamos cedo com 400 claro, não 500.
    if (kind === 'boleto' && !payer.address) {
      throw HttpError.badRequest('Boleto exige o endereço do pagador (payer.address).');
    }

    let paymentMethod: Record<string, unknown>;
    if (kind === 'credit_card') {
      paymentMethod = {
        id: formData.payment_method_id,
        type: 'credit_card',
        token: formData.token,
        installments: formData.installments ?? 1,
      };
      // issuer_id NÃO entra aqui: a Orders API rejeita
      // ("additionalProperties 'issuer_id' not allowed", HTTP 400 —
      // confirmado em sandbox T10). O MP infere o emissor pelo token.
    } else if (kind === 'pix') {
      paymentMethod = { id: 'pix', type: 'bank_transfer' };
    } else {
      // boleto — em sandbox tanto "boleto" quanto "bolbradesco" são aceitos.
      paymentMethod = { id: formData.payment_method_id ?? 'bolbradesco', type: 'ticket' };
    }

    const paymentEntry: Record<string, unknown> = { amount, payment_method: paymentMethod };
    // Vencimentos explícitos — a expiração automática (cron) usa os mesmos prazos.
    if (kind === 'pix') paymentEntry.expiration_time = 'P1D';
    if (kind === 'boleto') paymentEntry.expiration_time = 'P3D';

    const body = {
      type: 'online',
      processing_mode: 'automatic',
      external_reference: order.id,
      total_amount: amount,
      description: `Pedido ${order.id}`,
      payer,
      transactions: { payments: [paymentEntry] },
    };

    const res = await mpRequest('/v1/orders', {
      method: 'POST',
      body,
      // UUID por tentativa: torna um retry de rede DESTA tentativa seguro (sem
      // cobrança dupla) sem bloquear uma nova tentativa do usuário após recusa.
      idempotencyKey: crypto.randomUUID(),
    });

    let mpOrder: MpOrder;
    if (res.ok) {
      mpOrder = res.body as MpOrder;
    } else {
      // Recusa de negócio (ex.: cartão recusado → HTTP 402) traz o pedido em
      // `data`: tratamos como resultado normal (front lê status='rejected').
      const errBody = res.body as MpErrorBody | null;
      if (errBody?.data?.transactions?.payments?.length) {
        mpOrder = errBody.data;
      } else {
        throw providerError(res.status, res.body);
      }
    }

    const mpPayment = mpOrder.transactions?.payments?.[0] ?? {};
    // Preferimos o status do pagamento; caímos no da Order.
    const rawStatus = mpPayment.status ?? mpOrder.status;
    const paymentStatus = mapMpStatus(rawStatus);
    const mpOrderId = mpOrder.id ?? null;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(mpOrderId ? { mpPaymentId: mpOrderId } : {}),
        externalReference: order.id,
        // Método real do Brick (o pedido foi criado com placeholder).
        paymentMethod: KIND_TO_PAYMENT_METHOD[kind],
        paymentStatus,
        // `total` passa a ser o valor efetivamente cobrado nesta tentativa.
        total: chargedTotal,
        paymentDiscount,
      },
    });

    // Pagamento aprovado → baixa o estoque (idempotente) e confirma o pedido.
    // A baixa acontece AQUI, no pagamento — não na criação do pedido.
    if (paymentStatus === PaymentStatus.PAID) {
      await settlePaidOrder(order.id);
    }

    const out: CreatePaymentResult = {
      orderId: order.id,
      method: kind,
      amount: chargedTotal,
      paymentDiscount,
      paymentId: mpPayment.id,
      status: mpStatusToLegacy(rawStatus),
      statusDetail: mpPayment.status_detail ?? mpOrder.status_detail,
      paymentStatus,
    };

    const pm = mpPayment.payment_method;
    if (kind === 'pix') {
      out.qr_code = pm?.qr_code;
      out.qr_code_base64 = pm?.qr_code_base64;
      out.ticket_url = pm?.ticket_url;
    } else if (kind === 'boleto') {
      out.external_resource_url = pm?.ticket_url;
      out.digitable_line = pm?.digitable_line;
      out.barcode_content = pm?.barcode_content;
    }

    return out;
  },

  /**
   * Consulta a Order no Mercado Pago (fonte de verdade) e reconcilia o status
   * do pedido — reconciliação ativa para polling de Pix/boleto. Só avança o
   * status (monotônico); não substitui o webhook (T11), complementa.
   */
  async getPaymentStatus(userId: string, orderId: string) {
    const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    if (!order.mpPaymentId) {
      throw HttpError.notFound('Nenhum pagamento foi iniciado para este pedido.');
    }

    const res = await mpRequest(
      `/v1/orders/${encodeURIComponent(order.mpPaymentId)}`,
      { method: 'GET' },
    );
    if (!res.ok) throw providerError(res.status, res.body);

    const mpOrder = res.body as MpOrder;
    const mpPayment = mpOrder.transactions?.payments?.[0] ?? {};
    const rawStatus = mpPayment.status ?? mpOrder.status;
    const paymentStatus = mapMpStatus(rawStatus);

    if (canAdvancePaymentStatus(order.paymentStatus, paymentStatus)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus },
      });
      // Pix/boleto compensado detectado por polling → baixa o estoque e
      // confirma. Idempotente com o webhook: quem chegar primeiro baixa uma vez.
      await afterPaymentTransition(order.id, paymentStatus);
    }

    return {
      orderId: order.id,
      mpOrderId: order.mpPaymentId,
      paymentId: mpPayment.id ?? null,
      status: mpStatusToLegacy(rawStatus),
      statusDetail: mpPayment.status_detail ?? mpOrder.status_detail,
      paymentStatus,
    };
  },

  /**
   * Reconciliação a partir de uma notificação do webhook (T11 fará o roteamento
   * `type=order` + validação de assinatura no controller). O corpo do webhook
   * não é fonte de verdade: recebemos só o **id da Order** (`data.id`),
   * reconsultamos `GET /v1/orders/{id}`, achamos o pedido por `mpPaymentId` OU
   * `externalReference` (= id do pedido) e aplicamos a transição — sem regredir
   * e de forma idempotente (ver `canAdvancePaymentStatus`).
   *
   * Retorno para o controller decidir o HTTP:
   *  - 'updated'   status avançou e foi persistido;
   *  - 'unchanged' nada a fazer (repetição / status atrasado / já terminal);
   *  - 'ignored'   Order não existe no MP ou nenhum pedido casa (ack, sem reenvio).
   * Erros de infra/MP são lançados (→ 5xx no controller → MP reenvia).
   */
  async processPaymentWebhook(
    mpOrderId: string,
  ): Promise<'updated' | 'unchanged' | 'ignored'> {
    const res = await mpRequest(
      `/v1/orders/${encodeURIComponent(mpOrderId)}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      if (res.status === 404) {
        // eslint-disable-next-line no-console
        console.warn(`[payments:webhook] Order ${mpOrderId} não encontrada no MP.`);
        return 'ignored';
      }
      throw providerError(res.status, res.body);
    }

    const mpOrder = res.body as MpOrder;
    const id = mpOrder.id ?? mpOrderId;
    const externalReference = mpOrder.external_reference ?? undefined;

    const or: Array<{ mpPaymentId: string } | { externalReference: string }> = [];
    if (id) or.push({ mpPaymentId: id });
    if (externalReference) or.push({ externalReference });
    if (or.length === 0) return 'ignored';

    const order = await prisma.order.findFirst({ where: { OR: or } });
    if (!order) {
      // eslint-disable-next-line no-console
      console.warn(`[payments:webhook] Nenhum pedido para a Order ${id}.`);
      return 'ignored';
    }

    const nextStatus = mpOrderPaymentStatus(mpOrder);

    // Notificação de uma tentativa ANTIGA (o cliente trocou de método depois).
    // Só o id atual (`mpPaymentId`) move o status — senão um "failed" atrasado
    // do cartão rebaixaria o Pix pendente. Exceção: a antiga foi PAGA.
    if (order.mpPaymentId && id !== order.mpPaymentId) {
      if (nextStatus !== PaymentStatus.PAID) return 'ignored';
      if (order.paymentStatus === PaymentStatus.PAID) {
        // eslint-disable-next-line no-console
        console.error(`[payments:webhook] Pagamento DUPLICADO no pedido ${order.id} (Order ${id}).`);
        await appendOrderNote(
          order.id,
          '[PAGAMENTO DUPLICADO]',
          `A Order ${id} do Mercado Pago também foi paga — estornar pelo painel do MP.`,
        );
        return 'unchanged';
      }
      // Única tentativa paga: vale como pagamento do pedido (cai no fluxo abaixo).
      // eslint-disable-next-line no-console
      console.warn(`[payments:webhook] Pedido ${order.id} pago por uma tentativa anterior (Order ${id}).`);
      await appendOrderNote(
        order.id,
        '[CONFERIR VALOR]',
        `Pago pela tentativa anterior ${id} (valor pode diferir do total atual).`,
      );
      await prisma.order.update({ where: { id: order.id }, data: { mpPaymentId: id } });
    }

    if (!canAdvancePaymentStatus(order.paymentStatus, nextStatus)) {
      return 'unchanged';
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: nextStatus,
        // Preenche o id do MP se o pedido foi achado pela externalReference.
        ...(id && !order.mpPaymentId ? { mpPaymentId: id } : {}),
        ...(order.externalReference ? {} : { externalReference: order.id }),
      },
    });

    // Pagamento aprovado (Pix/boleto compensado) → baixa o estoque (idempotente)
    // e confirma o pedido. O webhook pode chegar 2x: `settlePaidOrder` garante a
    // baixa uma única vez. Não regride quem já está em produção/enviado.
    await afterPaymentTransition(order.id, nextStatus);
    return 'updated';
  },

  /**
   * Cancelar / estornar pelo admin (`POST /api/admin/orders/:orderId/cancel`).
   *  - Pago via MP  → estorno TOTAL no Mercado Pago (`/v1/orders/{id}/refund`),
   *                   pagamento REFUNDED;
   *  - Pago fora do MP (marcado à mão) → REFUNDED + nota [ESTORNO MANUAL];
   *  - Não pago     → cancela a cobrança aberta no MP (Pix/boleto), CANCELED.
   * Em todos: pedido CANCELED, estoque reposto e cupom devolvido (uma vez),
   * e-mail ao cliente. Se o MP recusar o estorno, nada muda e o erro sobe.
   */
  async cancelOrRefund(orderId: string): Promise<{ orderId: string; result: 'refunded' | 'canceled' }> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    if (order.status === OrderStatus.CANCELED) throw HttpError.conflict('Este pedido já está cancelado.');

    if (order.paymentStatus === PaymentStatus.PAID) {
      if (order.mpPaymentId) {
        const res = await mpRequest(`/v1/orders/${encodeURIComponent(order.mpPaymentId)}/refund`, {
          method: 'POST',
          // Estável por pedido: um duplo clique não gera dois estornos.
          idempotencyKey: `refund-${order.id}`,
        });
        if (!res.ok) throw providerError(res.status, res.body);
        await cancelOrderRecord(order.id, PaymentStatus.REFUNDED);
      } else {
        await cancelOrderRecord(
          order.id,
          PaymentStatus.REFUNDED,
          '[ESTORNO MANUAL] Pago fora do Mercado Pago — devolver o valor ao cliente manualmente.',
        );
      }
      await notifyCanceled(order.id, 'refunded');
      return { orderId: order.id, result: 'refunded' };
    }

    if (order.mpPaymentId) {
      // Confere antes: se pagou nesse meio-tempo, não cancela "às cegas".
      const previous = await closePreviousAttempt(order.mpPaymentId);
      if (previous === 'paid') {
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: PaymentStatus.PAID } });
        await settlePaidOrder(order.id);
        throw HttpError.conflict('O pagamento acabou de ser aprovado. Atualize a lista e use "estornar" se precisar.');
      }
    }
    await cancelOrderRecord(order.id, PaymentStatus.CANCELED);
    await notifyCanceled(order.id, 'canceled');
    return { orderId: order.id, result: 'canceled' };
  },

  /**
   * Expiração automática (cron diário — GET /api/cron/expire-orders):
   *  1. reconcilia pagamentos pendentes no MP (pega o que foi pago sem webhook);
   *  2. cancela pedidos ainda não pagos após o prazo (48h; boleto 96h):
   *     encerra a cobrança aberta no MP, repõe estoque, devolve o cupom e avisa
   *     o cliente. Se o MP disser que foi pago, liquida em vez de cancelar.
   * Lote limitado por execução; idempotente (cancelOrderRecord é guardado).
   */
  async expireUnpaidOrders(): Promise<{ reconciled: number; expired: number; paidLate: number; failed: number }> {
    const rec = await this.reconcilePendingPayments();

    const cutoff = new Date(Date.now() - EXPIRE_AFTER_HOURS.default * 3600_000);
    const candidates = await prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.CANCELED] },
        createdAt: { lt: cutoff },
      },
      select: { id: true, mpPaymentId: true, paymentMethod: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: RECONCILE_BATCH,
    });

    let expired = 0;
    let paidLate = 0;
    let failed = 0;
    for (const o of candidates) {
      const hours = o.paymentMethod === PaymentMethod.BOLETO ? EXPIRE_AFTER_HOURS.boleto : EXPIRE_AFTER_HOURS.default;
      if (o.createdAt.getTime() > Date.now() - hours * 3600_000) continue; // boleto ainda no prazo
      try {
        if (o.mpPaymentId && (await closePreviousAttempt(o.mpPaymentId)) === 'paid') {
          await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: PaymentStatus.PAID } });
          await settlePaidOrder(o.id);
          paidLate++;
          continue;
        }
        const canceledNow = await cancelOrderRecord(
          o.id,
          PaymentStatus.CANCELED,
          `[EXPIRADO] Cancelado automaticamente: sem pagamento em ${hours}h.`,
        );
        if (canceledNow) {
          expired++;
          await notifyCanceled(o.id, 'expired');
        }
      } catch {
        // eslint-disable-next-line no-console
        console.error(`[payments:expire] Falha ao expirar o pedido ${o.id}.`);
        failed++;
      }
    }
    return { reconciled: rec.updated, expired, paidLate, failed };
  },

  /**
   * Reconciliação em lote: varre pedidos ainda `PENDING` com `mpPaymentId`
   * preenchido, consulta cada Order no MP (fonte de verdade) e aplica a
   * transição de forma idempotente e monotônica (`canAdvancePaymentStatus`),
   * baixando o estoque via `settlePaidOrder` quando vira PAID. É a rede de
   * segurança para webhooks perdidos; NÃO agenda nada (o líder decide o cron).
   *
   * Exposta em `POST /api/admin/payments/reconcile` (admin) — ver o controller.
   * Rodar manualmente: `curl -X POST .../api/admin/payments/reconcile` com um
   * Bearer de admin. Erros por pedido são isolados (um MP fora do ar não
   * derruba o lote); nunca loga dados sensíveis.
   */
  async reconcilePendingPayments(): Promise<{
    scanned: number;
    updated: number;
    unchanged: number;
    failed: number;
    details: Array<{ orderId: string; result: string; paymentStatus?: PaymentStatus }>;
  }> {
    // Lote limitado (mais antigos primeiro): cada pedido é 1 chamada ao MP e a
    // função da Vercel tem tempo máximo — o próximo run continua de onde parou.
    const orders = await prisma.order.findMany({
      where: { paymentStatus: PaymentStatus.PENDING, mpPaymentId: { not: null }, status: { not: OrderStatus.CANCELED } },
      select: { id: true, mpPaymentId: true, paymentStatus: true },
      orderBy: { createdAt: 'asc' },
      take: RECONCILE_BATCH,
    });

    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const details: Array<{ orderId: string; result: string; paymentStatus?: PaymentStatus }> = [];

    for (const o of orders) {
      if (!o.mpPaymentId) continue;
      try {
        const res = await mpRequest(`/v1/orders/${encodeURIComponent(o.mpPaymentId)}`, {
          method: 'GET',
        });
        if (!res.ok) {
          failed++;
          details.push({ orderId: o.id, result: 'error' });
          continue;
        }

        const mpOrder = res.body as MpOrder;
        const mpPayment = mpOrder.transactions?.payments?.[0] ?? {};
        const next = mapMpStatus(mpPayment.status ?? mpOrder.status);

        if (!canAdvancePaymentStatus(o.paymentStatus, next)) {
          unchanged++;
          details.push({ orderId: o.id, result: 'unchanged' });
          continue;
        }

        await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: next } });
        await afterPaymentTransition(o.id, next);
        updated++;
        details.push({ orderId: o.id, result: 'updated', paymentStatus: next });
      } catch {
        // eslint-disable-next-line no-console
        console.error(`[payments:reconcile] Falha ao reconciliar o pedido ${o.id}.`);
        failed++;
        details.push({ orderId: o.id, result: 'error' });
      }
    }

    return { scanned: orders.length, updated, unchanged, failed, details };
  },
};
