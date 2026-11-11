import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { adminOrdersQuerySchema, createOrderSchema } from './orders.schemas';

const mocks = vi.hoisted(() => ({
  order: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  sendEmail: vi.fn(async (_mail: { html: string; text: string }) => ({ sent: true })),
}));
vi.mock('../../lib/prisma', () => ({ prisma: { order: mocks.order } }));
vi.mock('../../lib/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('../coupons/coupons.service', () => ({ couponsService: {} }));
vi.mock('../shipping/shipping.service', () => ({ shippingService: {}, toQuoteItems: vi.fn() }));
import { ordersService } from './orders.service';
const ID = 'cmwcb0re3000d8o1va7q6zgf2';
const CODE = '3DCOMMERCE00007';
function order() {
  return {
    id: ID, publicCode: CODE, userId: 'customer', customerName: 'Cliente', customerEmail: 'cliente@test.test', customerPhone: '11999999999', customerCpf: null,
    addressSnapshot: { zipCode: '01001000' }, subtotal: new Prisma.Decimal(20), shippingValue: new Prisma.Decimal(5), total: new Prisma.Decimal(25),
    paymentDiscount: new Prisma.Decimal(0), discountValue: new Prisma.Decimal(0), status: 'SHIPPED', paymentStatus: 'PAID', paymentMethod: 'PIX',
    notes: 'Nota preservada', trackingCode: 'BR123456789', mpPaymentId: 'mp-123', externalReference: ID,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), items: [],
  };
}
beforeEach(() => { vi.clearAllMocks(); mocks.order.count.mockResolvedValue(1); mocks.order.findMany.mockResolvedValue([order()]); });

describe('código público — DTO/busca/ownership/rastreio sem alterar id técnico', () => {
  it('busca publicCode sem remover ID, cliente, email e telefone; DTO retorna ambos', async () => {
    const result = await ordersService.listAdmin(adminOrdersQuerySchema.parse({ search: CODE.toLowerCase() }));
    const where = mocks.order.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(expect.arrayContaining([
      { publicCode: { equals: CODE.toLowerCase(), mode: 'insensitive' } }, { id: { equals: CODE.toLowerCase() } },
      { customerName: { contains: CODE.toLowerCase(), mode: 'insensitive' } }, { customerEmail: { contains: CODE.toLowerCase(), mode: 'insensitive' } },
      { customerPhone: { contains: CODE.toLowerCase(), mode: 'insensitive' } },
    ]));
    expect(result.orders[0]).toMatchObject({ id: ID, publicCode: CODE, userId: 'customer', mpPaymentId: 'mp-123', notes: 'Nota preservada' });
  });
  it('consulta do cliente continua limitada por userId + id técnico', async () => {
    mocks.order.findFirst.mockResolvedValue(order());
    expect(await ordersService.getMine('customer', ID)).toMatchObject({ id: ID, publicCode: CODE });
    expect(mocks.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID, userId: 'customer' } }));
    mocks.order.findFirst.mockResolvedValue(null);
    await expect(ordersService.getMine('other-user', ID)).rejects.toMatchObject({ status: 404 });
  });
  it('rastreio atualiza pelo id técnico, preserva código e email usa código público', async () => {
    mocks.order.findUnique.mockResolvedValue({ id: ID, status: 'SHIPPED', trackingCode: null });
    mocks.order.update.mockResolvedValue(order());
    expect(await ordersService.updateTracking(ID, { trackingCode: 'BR123456789' })).toMatchObject({ id: ID, publicCode: CODE, trackingCode: 'BR123456789' });
    expect(mocks.order.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID }, data: { trackingCode: 'BR123456789' } }));
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining(CODE), text: expect.stringContaining(CODE) }));
    expect(mocks.sendEmail.mock.calls[0][0].html).not.toContain(ID);
  });
  it('cliente não define código público ou id no payload de criação', () => {
    const parsed = createOrderSchema.parse({ id: 'forged', publicCode: '3DCOMMERCE00001', customerName: 'Cliente', customerEmail: 'a@b.test', customerPhone: '11999999999', paymentMethod: 'PIX',
      address: { recipientName: 'Cliente', phone: '11999999999', zipCode: '01001000', street: 'Rua A', number: '1', district: 'Centro', city: 'São Paulo', state: 'SP' },
    });
    expect(parsed).not.toHaveProperty('id'); expect(parsed).not.toHaveProperty('publicCode');
  });
});
