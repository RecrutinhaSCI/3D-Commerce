import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductPurchaseMode,
  type ShippingMethod,
  type CouponDiscountType,
  type Order,
  type OrderItem,
  type User,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { decimalToNumber } from '../../utils/decimal';
import { sendEmail } from '../../lib/email';
import { orderCreatedEmail, orderShippedEmail, type EmailContent } from '../../lib/emailTemplates';
import { couponsService } from '../coupons/coupons.service';
import { effectivePrice } from '../cart/cart.service';
import { shippingService } from '../shipping/shipping.service';
import type {
  AdminOrdersQuery,
  CreateOrderInput,
  MeOrdersQuery,
  UpdateOrderStatusInput,
  UpdateOrderTrackingInput,
} from './orders.schemas';

type OrderWithRelations = Order & {
  items: OrderItem[];
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
};

/** DTO — todos os valores monetários como `number`, sem `passwordHash`. */
export interface OrderDTO {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressSnapshot: unknown;
  subtotal: number;
  shippingValue: number;
  /** Modalidade de entrega (null em pedidos antigos). */
  shippingMethod: ShippingMethod | null;
  discountValue: number;
  /** Desconto da forma de pagamento (ex.: Pix), já abatido de `total`. */
  paymentDiscount: number;
  /** subtotal + frete, antes do desconto do cupom. */
  totalBeforeDiscount: number;
  total: number;
  couponId: string | null;
  couponCode: string | null;
  couponDiscountType: CouponDiscountType | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  notes: string | null;
  trackingCode: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    productId: string | null;
    productName: string;
    productSku: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  user?: { id: string; name: string; email: string } | null;
}

function toOrderDTO(order: OrderWithRelations): OrderDTO {
  return {
    id: order.id,
    userId: order.userId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    addressSnapshot: order.addressSnapshot,
    subtotal: decimalToNumber(order.subtotal) ?? 0,
    shippingValue: decimalToNumber(order.shippingValue) ?? 0,
    shippingMethod: order.shippingMethod,
    discountValue: decimalToNumber(order.discountValue) ?? 0,
    paymentDiscount: decimalToNumber(order.paymentDiscount) ?? 0,
    totalBeforeDiscount:
      (decimalToNumber(order.subtotal) ?? 0) + (decimalToNumber(order.shippingValue) ?? 0),
    total: decimalToNumber(order.total) ?? 0,
    couponId: order.couponId,
    couponCode: order.couponCode,
    couponDiscountType: order.couponDiscountType,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    notes: order.notes,
    trackingCode: order.trackingCode,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        quantity: it.quantity,
        unitPrice: decimalToNumber(it.unitPrice) ?? 0,
        total: decimalToNumber(it.total) ?? 0,
      })),
    user: order.user
      ? { id: order.user.id, name: order.user.name, email: order.user.email }
      : undefined,
  };
}

const includeRelations = {
  items: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrderInclude;

/**
 * Dispara um e-mail transacional SEM bloquear nem derrubar o fluxo principal.
 * Qualquer falha (SMTP fora, template, etc.) é engolida com log — o pedido já
 * está persistido e nunca deve falhar por causa do e-mail. Não loga o corpo,
 * só o assunto e o destinatário (mesma política do lib/email).
 */
async function notifyByEmail(to: string, content: EmailContent): Promise<void> {
  try {
    await sendEmail({ to, subject: content.subject, html: content.html, text: content.text });
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[orders:email] Falha ao enviar "${content.subject}" -> ${to}`);
  }
}

export const ordersService = {
  /**
   * Cria um pedido a partir do carrinho do usuário.
   * Tudo dentro de uma transação: validações, criação e limpeza do carrinho.
   * Se qualquer passo falhar, nada é persistido.
   *
   * O estoque NÃO baixa aqui — só quando o pagamento é confirmado (PAID), via
   * `applyStockForOrder` (ver payments.service). A checagem de estoque abaixo é
   * apenas um pré-filtro de UX; a baixa autoritativa e concorrência-segura
   * acontece no pagamento.
   */
  async createFromCart(userId: string, input: CreateOrderInput): Promise<OrderDTO> {
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw HttpError.badRequest('Carrinho vazio.');
    }

    // Revalidação de cada item antes da transação: existência, ativo, modo, estoque.
    for (const item of cart.items) {
      if (!item.product) {
        throw HttpError.badRequest('Um dos produtos do carrinho não existe mais.');
      }
      if (!item.product.active) {
        throw HttpError.badRequest(`Produto "${item.product.name}" não está mais disponível.`);
      }
      if (item.product.purchaseMode === ProductPurchaseMode.QUOTE) {
        throw HttpError.badRequest(
          `Produto "${item.product.name}" é apenas via orçamento.`,
        );
      }
      if (item.quantity > item.product.stock) {
        throw HttpError.badRequest(
          `Estoque insuficiente para "${item.product.name}" (pediu ${item.quantity}, disponível ${item.product.stock}).`,
        );
      }
    }

    // Cálculos monetários usando Prisma.Decimal para não perder precisão.
    // Preço = o ATUAL do produto (promoção vigente), nunca o congelado no carrinho.
    const pricedItems = cart.items.map((i) => ({
      ...i,
      price: new Prisma.Decimal(effectivePrice(i.product)),
    }));
    const subtotal = pricedItems.reduce(
      (acc, i) => acc.add(i.price.mul(i.quantity)),
      new Prisma.Decimal(0),
    );
    const subtotalNum = decimalToNumber(subtotal) ?? 0;

    // Cupom: SEMPRE revalidado no backend. O `input.discountValue` do cliente
    // é ignorado — o desconto vem exclusivamente do cupom resolvido aqui.
    const resolved = input.couponCode
      ? await couponsService.resolveForOrder(input.couponCode, subtotalNum, userId)
      : null;

    // Frete SEMPRE calculado aqui a partir da modalidade (o valor enviado pelo
    // cliente é ignorado). Limite de frete grátis vem do /admin/configuracoes.
    const freeShipping = resolved?.freeShipping ?? false;
    const shipping = new Prisma.Decimal(
      await shippingService.priceFor(input.shippingMethod, subtotalNum, freeShipping),
    );
    const discount = new Prisma.Decimal(resolved ? resolved.discountAmount : 0);
    let total = subtotal.add(shipping).sub(discount);
    if (total.lt(0)) total = new Prisma.Decimal(0); // nunca negativo

    const order = await prisma.$transaction(async (tx) => {
      // Consome o cupom de forma ATÔMICA antes de criar o pedido.
      // updateMany com guarda de limite evita corrida em cupons como VIP5:
      // se dois pedidos simultâneos disputam o último uso, só um passa.
      if (resolved) {
        const c = resolved.coupon;
        if (c.usageLimit != null) {
          const upd = await tx.coupon.updateMany({
            where: { id: c.id, usageCount: { lt: c.usageLimit } },
            data: { usageCount: { increment: 1 } },
          });
          if (upd.count === 0) throw HttpError.conflict('Cupom esgotado.');
        } else {
          await tx.coupon.update({
            where: { id: c.id },
            data: { usageCount: { increment: 1 } },
          });
        }
      }

      const created = await tx.order.create({
        data: {
          userId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          addressSnapshot: input.address as unknown as Prisma.InputJsonValue,
          subtotal,
          shippingValue: shipping,
          shippingMethod: input.shippingMethod,
          discountValue: discount,
          total,
          status: OrderStatus.PENDING,
          paymentMethod: input.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          notes: input.notes ?? null,
          // Snapshot do cupom aplicado (preserva histórico).
          couponId: resolved?.coupon.id ?? null,
          couponCode: resolved?.coupon.code ?? null,
          couponDiscountType: resolved?.coupon.discountType ?? null,
          items: {
            create: pricedItems.map((item) => ({
              productId: item.productId,
              productName: item.product.name,
              productSku: item.product.sku,
              quantity: item.quantity,
              unitPrice: item.price,
              total: item.price.mul(item.quantity),
            })),
          },
        },
        include: includeRelations,
      });

      // Estoque NÃO é decrementado na criação: o pedido nasce sem reservar
      // estoque e a baixa acontece no pagamento (applyStockForOrder).

      // Limpa o carrinho (mantém o Cart em si, só apaga os items).
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return created;
    });

    // Pedido criado com sucesso (fora da transação) → avisa o cliente.
    // Não-bloqueante: uma falha de e-mail nunca desfaz o pedido já persistido.
    await notifyByEmail(
      order.customerEmail,
      orderCreatedEmail({
        orderId: order.id,
        total: decimalToNumber(order.total) ?? 0,
        items: order.items.map((it) => ({ productName: it.productName, quantity: it.quantity })),
      }),
    );

    return toOrderDTO(order);
  },

  async listMine(userId: string, query: MeOrdersQuery) {
    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) where.status = query.status;

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: includeRelations,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
    ]);

    return {
      orders: rows.map(toOrderDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async getMine(userId: string, orderId: string): Promise<OrderDTO> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: includeRelations,
    });
    // Não vaza se o pedido é de outro user — retorna 404 igual.
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    return toOrderDTO(order);
  },

  async listAdmin(query: AdminOrdersQuery) {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.couponCode) where.couponCode = query.couponCode;

    if (query.search) {
      where.OR = [
        { id: { equals: query.search } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerEmail: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.OrderOrderByWithRelationInput =
      query.sort === 'oldest'
        ? { createdAt: 'asc' }
        : query.sort === 'total_asc'
        ? { total: 'asc' }
        : query.sort === 'total_desc'
        ? { total: 'desc' }
        : { createdAt: 'desc' };

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: includeRelations,
        orderBy,
        skip,
        take: query.limit,
      }),
    ]);

    return {
      orders: rows.map(toOrderDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async getAdmin(orderId: string): Promise<OrderDTO> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: includeRelations,
    });
    if (!order) throw HttpError.notFound('Pedido não encontrado.');
    return toOrderDTO(order);
  },

  async updateStatus(orderId: string, input: UpdateOrderStatusInput): Promise<OrderDTO> {
    const prev = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!prev) throw HttpError.notFound('Pedido não encontrado.');

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      },
      include: includeRelations,
    });

    // Pedido despachado: enviamos o e-mail de envio na TRANSIÇÃO para SHIPPED
    // (status antes != SHIPPED), e só se já houver código de rastreio. Se o
    // código ainda não existir, o disparo fica a cargo de `updateTracking`
    // (quando o código chega) — os dois gatilhos são exclusivos, então o
    // cliente recebe o aviso de envio uma única vez. Não-bloqueante.
    if (
      updated.status === OrderStatus.SHIPPED &&
      prev.status !== OrderStatus.SHIPPED &&
      updated.trackingCode
    ) {
      await notifyByEmail(
        updated.customerEmail,
        orderShippedEmail(updated.trackingCode, updated.id),
      );
    }

    // Reposição de estoque: se o admin cancela o pedido ou o pagamento
    // falha/estorna/cancela DEPOIS de a baixa ter ocorrido, devolve as unidades
    // ao estoque. `restoreStockForOrder` é idempotente (só age se stockApplied
    // estava true), então repetir a mesma transição não repõe em dobro.
    const releasesStock =
      input.status === OrderStatus.CANCELED ||
      input.paymentStatus === PaymentStatus.FAILED ||
      input.paymentStatus === PaymentStatus.CANCELED ||
      input.paymentStatus === PaymentStatus.REFUNDED;
    if (releasesStock) {
      await restoreStockForOrder(orderId);
    }

    return toOrderDTO(updated);
  },

  async updateTracking(orderId: string, input: UpdateOrderTrackingInput): Promise<OrderDTO> {
    const prev = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, trackingCode: true },
    });
    if (!prev) throw HttpError.notFound('Pedido não encontrado.');

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { trackingCode: input.trackingCode },
      include: includeRelations,
    });

    // Complemento do gatilho de envio: se o pedido JÁ está SHIPPED e o código de
    // rastreio acabou de ser preenchido (antes era nulo, agora tem valor),
    // enviamos aqui o aviso de envio — o caso em que o status virou SHIPPED sem
    // código e o admin só informou o rastreio depois. `updateStatus` não envia
    // nesse fluxo (não havia código lá), então não há duplicidade. Não-bloqueante.
    if (
      updated.status === OrderStatus.SHIPPED &&
      !prev.trackingCode &&
      updated.trackingCode
    ) {
      await notifyByEmail(
        updated.customerEmail,
        orderShippedEmail(updated.trackingCode, updated.id),
      );
    }

    return toOrderDTO(updated);
  },
};

// ===========================================================================
// Baixa e reposição de estoque — acionadas no PAGAMENTO (payments.service),
// não na criação do pedido. Idempotentes e seguras sob concorrência.
// ===========================================================================

/** Sinaliza estoque insuficiente no momento da baixa, para abortar a transação. */
class StockShortfall extends Error {
  constructor(public readonly productName: string) {
    super('INSUFFICIENT_STOCK');
    this.name = 'StockShortfall';
  }
}

export type ApplyStockResult =
  | { status: 'applied' }
  | { status: 'already_applied' }
  | { status: 'insufficient'; productName: string };

/**
 * Baixa o estoque de um pedido, UMA única vez, dentro de uma transação.
 *
 * Idempotência: reivindica a baixa com um `updateMany` guardado por
 * `stockApplied: false`. Se `count === 0`, outro chamador (ex.: webhook
 * duplicado, ou webhook + polling simultâneos) já baixou → no-op
 * (`already_applied`).
 *
 * Concorrência: cada item é decrementado com `updateMany` guardado por
 * `stock: { gte: quantity }`. O guard é reavaliado sob lock de linha do
 * Postgres, então dois pagamentos disputando a última unidade não conseguem
 * vender o mesmo item duas vezes — o segundo encontra `count === 0` e a
 * transação inteira é revertida (inclusive o claim do `stockApplied`).
 */
export async function applyStockForOrder(orderId: string): Promise<ApplyStockResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id: orderId, stockApplied: false },
        data: { stockApplied: true },
      });
      if (claim.count === 0) return { status: 'already_applied' as const };

      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const item of items) {
        // Produto removido do catálogo (SetNull): nada a baixar.
        if (!item.productId) continue;
        const dec = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (dec.count === 0) {
          // Reverte tudo (o claim e decrementos já feitos) e sinaliza.
          throw new StockShortfall(item.productName);
        }
      }
      return { status: 'applied' as const };
    });
  } catch (e) {
    if (e instanceof StockShortfall) {
      return { status: 'insufficient', productName: e.productName };
    }
    throw e;
  }
}

/**
 * Repõe o estoque baixado de um pedido (cancelamento/estorno). Idempotente:
 * só age se `stockApplied` estava true, e o desmarca no mesmo passo atômico —
 * repetir a reposição não devolve unidades em dobro. Retorna se repôs.
 */
export async function restoreStockForOrder(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: orderId, stockApplied: true },
      data: { stockApplied: false },
    });
    if (claim.count === 0) return false;

    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      if (!item.productId) continue;
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
    return true;
  });
}
