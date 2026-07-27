import { randomUUID } from 'node:crypto';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PixChargeStatus,
  Prisma,
  UserRole,
  type Payment,
  type PaymentEvent,
  type PaymentProvider,
} from '@prisma/client';
import { env, paymentWebhookSecret } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';
import { HttpError } from '../../utils/httpError';
import { getActiveProvider, getProviderByName, parseProviderSlug } from './providers';
import { MOCK_SIGNATURE_HEADER, signMockWebhook } from './providers/mock.provider';
import type { NormalizedWebhookEvent } from './providers/types';
import type { SimulatePaymentInput } from './payments.schemas';

/**
 * Payments — R19.
 *
 * Regras de idempotência (nenhum efeito acontece duas vezes):
 *  1. Criar pagamento reusa a cobrança PENDING não expirada do pedido.
 *  2. Webhook: PaymentEvent tem unique (provider, externalEventId) — replay
 *     do mesmo evento responde 200 sem reprocessar.
 *  3. Transições usam updateMany com guarda de status (só PENDING transiciona);
 *     aprovar duas vezes não repete os efeitos no pedido.
 */

export interface PaymentDTO {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  status: PixChargeStatus;
  amount: number;
  txid: string;
  pixCopyPaste: string;
  qrCodeText: string;
  expiresAt: string;
  paidAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPaymentDTO(p: Payment): PaymentDTO {
  return {
    id: p.id,
    orderId: p.orderId,
    provider: p.provider,
    status: p.status,
    amount: decimalToNumber(p.amount) ?? 0,
    txid: p.txid,
    pixCopyPaste: p.pixCopyPaste,
    qrCodeText: p.qrCodeText,
    expiresAt: p.expiresAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    canceledAt: p.canceledAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toEventDTO(e: PaymentEvent) {
  return {
    id: e.id,
    provider: e.provider,
    externalEventId: e.externalEventId,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
  };
}

type Requester = { id: string; role: UserRole };

function assertCanAccess(requester: Requester, orderUserId: string | null) {
  if (requester.role !== UserRole.ADMIN && orderUserId !== requester.id) {
    // 404 (e não 403) para não confirmar a existência do recurso de terceiros.
    throw HttpError.notFound('Pagamento não encontrado.');
  }
}

/** É erro de unique constraint do Prisma (registro já existe)? */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Aplica a transição de status da cobrança + efeitos no pedido, tudo
 * atômico. Retorna true se a transição aconteceu (false = já estava
 * em estado final; chamada é um no-op idempotente).
 */
async function applyTransition(
  tx: Prisma.TransactionClient,
  payment: Payment,
  type: NormalizedWebhookEvent['type'],
): Promise<boolean> {
  const now = new Date();

  if (type === 'pix.approved') {
    const upd = await tx.payment.updateMany({
      where: { id: payment.id, status: PixChargeStatus.PENDING },
      data: { status: PixChargeStatus.APPROVED, paidAt: now },
    });
    if (upd.count === 0) return false;

    // Pedido: paymentStatus → PAID sempre; status PENDING → CONFIRMED
    // (não regride pedidos que o admin já avançou manualmente).
    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: PaymentStatus.PAID },
    });
    await tx.order.updateMany({
      where: { id: payment.orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CONFIRMED },
    });
    return true;
  }

  if (type === 'pix.expired') {
    const upd = await tx.payment.updateMany({
      where: { id: payment.id, status: PixChargeStatus.PENDING },
      data: { status: PixChargeStatus.EXPIRED },
    });
    return upd.count > 0;
  }

  // pix.canceled
  const upd = await tx.payment.updateMany({
    where: { id: payment.id, status: PixChargeStatus.PENDING },
    data: { status: PixChargeStatus.CANCELED, canceledAt: now },
  });
  return upd.count > 0;
}

/**
 * Expiração "lazy": cobrança PENDING vencida vira EXPIRED na primeira
 * leitura. Registra o evento interno uma única vez (unique protege replay).
 */
async function expireIfDue(payment: Payment): Promise<Payment> {
  if (payment.status !== PixChargeStatus.PENDING || payment.expiresAt > new Date()) {
    return payment;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const changed = await applyTransition(tx, payment, 'pix.expired');
      if (changed) {
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            provider: payment.provider,
            externalEventId: `internal_expire_${payment.id}`,
            type: 'pix.expired',
            payload: { source: 'lazy-expiration', expiredAt: new Date().toISOString() },
          },
        });
      }
    });
  } catch (err) {
    // Corrida benigna: outra request expirou primeiro.
    if (!isUniqueViolation(err)) throw err;
  }

  const fresh = await prisma.payment.findUnique({ where: { id: payment.id } });
  return fresh ?? payment;
}

export const paymentsService = {
  /**
   * Cria (ou reusa) a cobrança Pix de um pedido.
   * Idempotente: se já existe cobrança PENDING válida, retorna a mesma.
   */
  async createForOrder(requester: Requester, orderId: string): Promise<{ payment: PaymentDTO; reused: boolean }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, total: true, status: true, paymentStatus: true, paymentMethod: true, customerName: true },
    });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    assertCanAccess(requester, order.userId);

    if (order.paymentMethod !== PaymentMethod.PIX) {
      throw HttpError.unprocessable('Este pedido não é Pix — apenas pagamentos Pix são suportados nesta versão.');
    }
    if (order.status === OrderStatus.CANCELED) {
      throw HttpError.unprocessable('Pedido cancelado não pode receber pagamento.');
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw HttpError.conflict('Este pedido já está pago.');
    }

    // Reuso idempotente: cobrança PENDING ainda válida.
    const existing = await prisma.payment.findFirst({
      where: { orderId, status: PixChargeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const checked = await expireIfDue(existing);
      if (checked.status === PixChargeStatus.PENDING) {
        return { payment: toPaymentDTO(checked), reused: true };
      }
    }

    const provider = getActiveProvider();
    const amount = decimalToNumber(order.total) ?? 0;
    if (amount <= 0) {
      throw HttpError.unprocessable('Pedido com total zero não gera cobrança Pix.');
    }

    const charge = await provider.createPixCharge({
      orderId: order.id,
      amount,
      customerName: order.customerName,
      expirationMinutes: env.PAYMENT_PIX_EXPIRATION_MINUTES,
    });

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: provider.name,
          status: PixChargeStatus.PENDING,
          amount: new Prisma.Decimal(amount),
          txid: charge.txid,
          pixCopyPaste: charge.pixCopyPaste,
          qrCodeText: charge.qrCodeText,
          expiresAt: charge.expiresAt,
          providerData: charge.raw as Prisma.InputJsonValue,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: created.id,
          provider: provider.name,
          externalEventId: `internal_create_${charge.txid}`,
          type: 'pix.created',
          payload: charge.raw as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    return { payment: toPaymentDTO(payment), reused: false };
  },

  /** Consulta uma cobrança (dono do pedido ou admin). Expira lazy. */
  async getById(requester: Requester, paymentId: string): Promise<PaymentDTO> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { userId: true } } },
    });
    if (!payment) throw HttpError.notFound('Pagamento não encontrado.');
    assertCanAccess(requester, payment.order.userId);

    const fresh = await expireIfDue(payment);
    return toPaymentDTO(fresh);
  },

  /** Detalhe admin: cobrança + trilha de eventos. */
  async getAdmin(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw HttpError.notFound('Pagamento não encontrado.');
    const fresh = await expireIfDue(payment);
    const events = await prisma.paymentEvent.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
    return { ...toPaymentDTO(fresh), events: events.map(toEventDTO) };
  },

  /** Lista as cobranças de um pedido (dono ou admin). */
  async listForOrder(requester: Requester, orderId: string): Promise<PaymentDTO[]> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    assertCanAccess(requester, order.userId);

    const payments = await prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(payments.map(async (p) => toPaymentDTO(await expireIfDue(p))));
  },

  /**
   * Processa um webhook autenticado do provider da URL.
   * Retorna `duplicate: true` quando o evento já foi processado antes
   * (resposta 200 mesmo assim — PSPs reenviam até receber 2xx).
   */
  async processWebhook(
    providerSlug: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true; duplicate: boolean; applied: boolean }> {
    if (!rawBody || rawBody.length === 0) {
      throw HttpError.badRequest('Webhook sem body.');
    }

    const providerName = parseProviderSlug(providerSlug);
    const provider = getProviderByName(providerName);
    const event = provider.verifyAndParseWebhook(rawBody, headers);

    const payment = await prisma.payment.findUnique({ where: { txid: event.txid } });
    if (!payment || payment.provider !== providerName) {
      throw HttpError.notFound('Cobrança não encontrada para este txid.');
    }

    let applied = false;
    try {
      await prisma.$transaction(async (tx) => {
        // O create do evento é a TRAVA de idempotência: se o mesmo
        // (provider, externalEventId) já existe, o unique dispara P2002
        // e nada da transação é aplicado.
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            provider: providerName,
            externalEventId: event.externalEventId,
            type: event.type,
            payload: event.payload as Prisma.InputJsonValue,
          },
        });
        applied = await applyTransition(tx, payment, event.type);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { received: true, duplicate: true, applied: false };
      }
      throw err;
    }

    return { received: true, duplicate: false, applied };
  },

  /**
   * Simulação local de status (approved/expired/canceled).
   * Só existe com PAYMENT_PROVIDER=mock e fora de produção; passa pelo
   * MESMO pipeline do webhook (assinatura HMAC inclusa) — o que os testes
   * validam aqui é exatamente o que rodará com um PSP real.
   */
  async simulate(
    requester: Requester,
    paymentId: string,
    input: SimulatePaymentInput,
  ): Promise<{ payment: PaymentDTO; duplicate: boolean; applied: boolean }> {
    if (env.PAYMENT_PROVIDER !== 'mock' || env.NODE_ENV === 'production') {
      throw HttpError.forbidden('Simulação disponível apenas com PAYMENT_PROVIDER=mock fora de produção.');
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { userId: true } } },
    });
    if (!payment) throw HttpError.notFound('Pagamento não encontrado.');
    assertCanAccess(requester, payment.order.userId);

    const body = Buffer.from(
      JSON.stringify({
        eventId: `sim_${randomUUID()}`,
        txid: payment.txid,
        type: `pix.${input.status}`,
        simulatedBy: requester.id,
        occurredAt: new Date().toISOString(),
      }),
      'utf8',
    );
    const headers = { [MOCK_SIGNATURE_HEADER]: signMockWebhook(body, paymentWebhookSecret) };

    const result = await this.processWebhook('mock', body, headers);
    const fresh = await prisma.payment.findUnique({ where: { id: paymentId } });
    return {
      payment: toPaymentDTO(fresh ?? payment),
      duplicate: result.duplicate,
      applied: result.applied,
    };
  },
};
