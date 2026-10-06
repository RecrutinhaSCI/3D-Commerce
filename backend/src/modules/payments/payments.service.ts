import crypto from 'node:crypto';
import { OrderStatus, PaymentMethod, PaymentStatus, type Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { decimalToNumber } from '../../utils/decimal';
import { sendEmail } from '../../lib/email';
import { paymentApprovedEmail } from '../../lib/emailTemplates';
import { applyStockForOrder } from '../orders/orders.service';
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

/** Marcador de revisão manual anexado a um pedido pago sem estoque. */
const STOCK_REVIEW_MARKER = '[REVISAR ESTOQUE]';

/**
 * Liquida um pedido recém-confirmado como PAGO: baixa o estoque (idempotente) e
 * decide o status do pedido. Ponto ÚNICO chamado por todas as transições para
 * PAID (cartão, webhook Pix/boleto e reconciliação/polling), então a baixa é
 * sempre a mesma e nunca dupla (o guard `stockApplied` garante).
 *
 * Decisão "pago mas sem estoque": o pagamento é REAL e permanece PAID — nunca
 * descartamos um pagamento aprovado. Se o estoque não cobre no momento da baixa,
 * NÃO confirmamos o pedido: ele fica em PENDING, recebe um marcador de revisão
 * nas `notes` e um log de erro (sem dados sensíveis). O admin trata manualmente
 * (repor estoque e confirmar, ou estornar). Assim o sistema nunca fica
 * inconsistente (vendido sem estoque e já "Confirmado").
 */
/**
 * Envia o e-mail de "pagamento aprovado" ao cliente, SEM bloquear nem derrubar
 * o fluxo de liquidação. Carrega só os campos necessários do pedido; qualquer
 * falha (SMTP fora, etc.) é engolida com log sem dados sensíveis — a liquidação
 * já ocorreu e nunca deve falhar por causa do e-mail.
 */
async function sendPaymentApprovedEmail(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerEmail: true, total: true },
    });
    if (!order) return;
    const content = paymentApprovedEmail({
      orderId,
      total: decimalToNumber(order.total) ?? 0,
    });
    await sendEmail({
      to: order.customerEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[payments:email] Falha ao enviar "pagamento aprovado" do pedido ${orderId}.`);
  }
}

async function settlePaidOrder(orderId: string): Promise<void> {
  const result = await applyStockForOrder(orderId);

  // E-mail de pagamento aprovado — enviado UMA única vez. A garantia vem do
  // claim atômico de `applyStockForOrder`: só o primeiro chamador que liquida o
  // pedido recebe `'applied'`; webhook, polling e reconciliação concorrentes (ou
  // repetidos) recebem `'already_applied'` e NÃO reenviam. Não-bloqueante e sem
  // dados sensíveis no log. `insufficient` não envia: o pedido fica retido para
  // revisão do admin (não "preparando para envio"), então avisar seria enganoso.
  if (result.status === 'applied') {
    await sendPaymentApprovedEmail(orderId);
  }

  if (result.status === 'insufficient') {
    // eslint-disable-next-line no-console
    console.error(
      `[payments] Pedido ${orderId} pago sem estoque suficiente — marcado para revisão do admin.`,
    );
    const current = await prisma.order.findUnique({
      where: { id: orderId },
      select: { notes: true },
    });
    if (!current?.notes?.includes(STOCK_REVIEW_MARKER)) {
      const note = `${STOCK_REVIEW_MARKER} Pagamento aprovado sem estoque suficiente; revisar.`;
      await prisma.order.update({
        where: { id: orderId },
        data: { notes: current?.notes ? `${note}\n${current.notes}` : note },
      });
    }
    return;
  }

  // applied | already_applied → confirma o pedido, mas só se ainda estiver
  // "Novo" (PENDING); nunca regride quem já avançou para produção/envio.
  await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.PENDING },
    data: { status: OrderStatus.CONFIRMED },
  });
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
    if (kind === 'pix') paymentEntry.expiration_time = 'P1D';

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
      if (paymentStatus === PaymentStatus.PAID) {
        await settlePaidOrder(order.id);
      }
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

    const mpPayment = mpOrder.transactions?.payments?.[0] ?? {};
    const nextStatus = mapMpStatus(mpPayment.status ?? mpOrder.status);
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
    if (nextStatus === PaymentStatus.PAID) {
      await settlePaidOrder(order.id);
    }
    return 'updated';
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
    const orders = await prisma.order.findMany({
      where: { paymentStatus: PaymentStatus.PENDING, mpPaymentId: { not: null } },
      select: { id: true, mpPaymentId: true, paymentStatus: true },
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
        if (next === PaymentStatus.PAID) {
          await settlePaidOrder(o.id);
        }
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
