import { CustomerOrigin, OrderStatus, PaymentStatus, PosSaleStatus, Prisma, type Customer } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';
import { HttpError } from '../../utils/httpError';
import type { CreateCustomerInput, CustomersQuery, UpdateCustomerInput } from './customers.schemas';

const onlyDigits = (v: string) => v.replace(/\D/g, '');
const num = (v: Prisma.Decimal | null | undefined) => decimalToNumber(v ?? null) ?? 0;

/**
 * Traz para `customers` quem se cadastrou na loja, sem tocar em auth/checkout:
 * vincula por e-mail quem já era cliente do PDV e cria o restante. Idempotente,
 * roda antes das buscas. Só role CUSTOMER: administradores não são clientes.
 */
export async function syncCustomersFromUsers(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE customers c SET user_id = u.id, updated_at = now()
    FROM users u
    WHERE c.user_id IS NULL AND c.email = lower(u.email) AND u.role = 'CUSTOMER'
      AND NOT EXISTS (SELECT 1 FROM customers x WHERE x.user_id = u.id)`;
  await prisma.$executeRaw`
    INSERT INTO customers (id, user_id, name, email, phone, phone_digits, origin, created_at, updated_at)
    SELECT 'cus_' || u.id, u.id, u.name, lower(u.email), u.phone,
           NULLIF(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), ''),
           'ECOMMERCE'::"CustomerOrigin", u.created_at, now()
    FROM users u
    WHERE u.role = 'CUSTOMER' AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id)
    ON CONFLICT DO NOTHING`;
}

function searchWhere(search: string): Prisma.CustomerWhereInput {
  const terms: Prisma.CustomerWhereInput[] = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
    { phone: { contains: search } },
    { user: { orders: { some: { customerPhone: { contains: search } } } } },
  ];
  const digits = onlyDigits(search);
  if (digits.length >= 3) {
    terms.push(
      { phoneDigits: { contains: digits } },
      { document: { contains: digits } },
      // CPF informado no checkout mora no snapshot do pedido.
      { user: { orders: { some: { customerCpf: { contains: digits } } } } },
    );
  }
  return { OR: terms };
}

function toCustomerDTO(c: Customer) {
  return {
    id: c.id,
    userId: c.userId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    document: c.document,
    notes: c.notes,
    origin: c.origin,
    hasLogin: c.userId !== null,
    createdAt: c.createdAt.toISOString(),
  };
}

const PAID_ORDER = {
  paymentStatus: PaymentStatus.PAID,
  status: { not: OrderStatus.CANCELED },
} satisfies Prisma.OrderWhereInput;

/** Transforma erro de unicidade (e-mail/documento) em mensagem clara. */
function uniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
    throw HttpError.conflict(
      target.includes('document') ? 'Já existe cliente com este CPF/CNPJ.' : 'Já existe cliente com este e-mail.',
    );
  }
  throw e;
}

export const customersService = {
  async list(query: CustomersQuery) {
    await syncCustomersFromUsers();
    const where = query.search ? searchWhere(query.search) : {};
    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip, take: query.limit }),
    ]);

    // Agregados da página numa ida só por origem (sem N+1).
    const userIds = rows.flatMap((c) => (c.userId ? [c.userId] : []));
    const [online, pos] = await Promise.all([
      userIds.length
        ? prisma.order.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds }, ...PAID_ORDER },
            _sum: { total: true },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      prisma.posSale.groupBy({
        by: ['customerId'],
        where: { customerId: { in: rows.map((c) => c.id) }, status: PosSaleStatus.COMPLETED },
        _sum: { total: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const onlineBy = new Map(online.map((o) => [o.userId, o]));
    const posBy = new Map(pos.map((p) => [p.customerId, p]));

    return {
      customers: rows.map((c) => {
        const o = c.userId ? onlineBy.get(c.userId) : undefined;
        const p = posBy.get(c.id);
        const dates = [o?._max.createdAt, p?._max.createdAt].filter((d): d is Date => !!d);
        return {
          ...toCustomerDTO(c),
          purchaseCount: (o?._count._all ?? 0) + (p?._count._all ?? 0),
          totalSpent: Number((num(o?._sum.total) + num(p?._sum.total)).toFixed(2)),
          lastPurchaseAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null,
        };
      }),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
    };
  },

  async get(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        user: { select: { phone: true, addresses: { orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], take: 1 } } },
      },
    });
    if (!customer) throw HttpError.notFound('Cliente não encontrado.');

    const [orders, sales] = await Promise.all([
      customer.userId
        ? prisma.order.findMany({
            where: { userId: customer.userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { items: { select: { productName: true, quantity: true } } },
          })
        : Promise.resolve([]),
      prisma.posSale.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { items: { select: { description: true, quantity: true } }, returns: { select: { refundAmount: true } } },
      }),
    ]);

    const paidOrders = orders.filter((o) => o.paymentStatus === PaymentStatus.PAID && o.status !== OrderStatus.CANCELED);
    const completed = sales.filter((s) => s.status === PosSaleStatus.COMPLETED);
    const refunds = completed.reduce((acc, s) => acc + s.returns.reduce((r, x) => r + num(x.refundAmount), 0), 0);
    const spentOnline = paidOrders.reduce((acc, o) => acc + num(o.total), 0);
    const spentPos = completed.reduce((acc, s) => acc + num(s.total), 0) - refunds;
    const dates = [...paidOrders.map((o) => o.createdAt), ...completed.map((s) => s.createdAt)];

    const latestOrder = orders[0];
    const address = customer.user?.addresses[0];
    return {
      customer: {
        ...toCustomerDTO(customer),
        // Quem só comprou online tem telefone/CPF no snapshot do pedido.
        phone: customer.phone ?? customer.user?.phone ?? latestOrder?.customerPhone ?? null,
        document: customer.document ?? orders.find((o) => o.customerCpf)?.customerCpf ?? null,
        address: address
          ? { zipCode: address.zipCode, street: address.street, number: address.number, complement: address.complement, district: address.district, city: address.city, state: address.state }
          : (latestOrder?.addressSnapshot ?? null),
      },
      stats: {
        purchaseCount: paidOrders.length + completed.length,
        totalSpent: Number((spentOnline + spentPos).toFixed(2)),
        totalOnline: Number(spentOnline.toFixed(2)),
        totalPos: Number(spentPos.toFixed(2)),
        lastPurchaseAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null,
      },
      orders: orders.map((o) => ({
        id: o.id,
        createdAt: o.createdAt.toISOString(),
        total: num(o.total),
        status: o.status,
        paymentStatus: o.paymentStatus,
        items: o.items,
      })),
      posSales: sales.map((s) => ({
        id: s.id,
        number: s.number,
        createdAt: s.createdAt.toISOString(),
        total: num(s.total),
        status: s.status,
        paymentMethod: s.paymentMethod,
        items: s.items.map((i) => ({ productName: i.description, quantity: i.quantity })),
      })),
    };
  },

  async create(input: CreateCustomerInput) {
    try {
      const customer = await prisma.customer.create({
        data: {
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          phoneDigits: input.phone ? onlyDigits(input.phone) || null : null,
          document: input.document ?? null,
          notes: input.notes ?? null,
          origin: CustomerOrigin.POS,
        },
      });
      return toCustomerDTO(customer);
    } catch (e) {
      return uniqueConflict(e);
    }
  },

  async update(id: string, input: UpdateCustomerInput) {
    const current = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw HttpError.notFound('Cliente não encontrado.');
    try {
      const customer = await prisma.customer.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone, phoneDigits: input.phone ? onlyDigits(input.phone) || null : null } : {}),
          ...(input.document !== undefined ? { document: input.document } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      return toCustomerDTO(customer);
    } catch (e) {
      return uniqueConflict(e);
    }
  },
};
