/**
 * PDV, caixa, relatório e clientes contra Postgres REAL, incluindo o fluxo
 * completo pela HTTP (só com TEST_DATABASE_URL local "_test"; apaga dados).
 */
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DB_LOCK_TIMEOUT_MS, dbEnabled, lockTestDb, TEST_URL } from '../shipping/labels/labels.dbHarness.testdata';

const h = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock('../../lib/prisma', () => ({
  get prisma() {
    return h.db;
  },
}));
vi.mock('../../lib/email', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));

import { posService } from './pos.service';
import { stockService } from '../stock/stock.service';
import { customersService } from '../customers/customers.service';
import { applyStockForOrder, cancelOrderRecord } from '../orders/orders.service';
import { productsService } from '../products/products.service';
import { createApp } from '../../app';
import { signAuthToken } from '../../utils/jwt';
import type { SessionReport } from './pos.report';

const op = { id: 'op-1', name: 'Ana Caixa' };
const op2 = { id: 'op-2', name: 'Bruno Caixa' };
let seq = 0;
const key = (p = 'req') => `${p}-${String(++seq).padStart(8, '0')}`;

async function product(sku: string, stock: number, price = 100, extra: Record<string, unknown> = {}) {
  return h.db.product.create({
    data: { name: `Produto ${sku}`, slug: sku.toLowerCase(), sku, price, stock, category: { connect: { id: 'cat-1' } }, ...extra },
  });
}
const stockOf = async (id: string) => (await h.db.product.findUniqueOrThrow({ where: { id } })).stock;
const movs = (productId: string) => h.db.stockMovement.findMany({ where: { productId }, orderBy: { seq: 'asc' } });

function sale(items: unknown[], extra: Record<string, unknown> = {}) {
  return { clientRequestId: key('sale'), items, discount: 0, paymentMethod: 'PIX', ...extra } as never;
}
const line = (productId: string, quantity = 1) => ({ type: 'product', productId, quantity });
const free = (description: string, unitPrice: number, quantity = 1) => ({ type: 'free', description, unitPrice, quantity });

async function paidOrder(productId: string, quantity: number, userId?: string) {
  const o = await h.db.order.create({
    data: {
      userId, customerName: 'Online', customerEmail: 'o@t.test', customerPhone: '54999990000', customerCpf: '52998224725', addressSnapshot: { city: 'Passo Fundo' },
      subtotal: 100, total: 100, paymentMethod: 'PIX', paymentStatus: 'PAID', status: 'CONFIRMED',
      items: { create: [{ productId, productName: 'P', quantity, unitPrice: 100, total: 100 }] },
    },
  });
  return o.id;
}

describe.skipIf(!dbEnabled)('PDV — Postgres real', () => {
  let unlock: () => Promise<void>;

  beforeAll(async () => {
    unlock = await lockTestDb();
    h.db = new PrismaClient({ datasourceUrl: TEST_URL });
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    await h.db?.$disconnect();
    await unlock?.();
  });

  beforeEach(async () => {
    await h.db.$executeRawUnsafe(
      'TRUNCATE pos_return_items, pos_returns, pos_sale_items, pos_sales, cash_sessions, customers, stock_movements, order_items, orders, cart_items, product_images, products, categories, users RESTART IDENTITY CASCADE',
    );
    await h.db.category.create({ data: { id: 'cat-1', name: 'Filamentos', slug: 'filamentos' } });
    for (const u of [op, op2]) {
      await h.db.user.create({ data: { id: u.id, name: u.name, email: `${u.id}@t.test`, passwordHash: 'x', role: 'ADMIN' } });
    }
  });

  describe('venda', () => {
    beforeEach(async () => {
      await posService.openSession({ openingCash: 100 }, op);
    });

    it('baixa o estoque imediatamente e registra POS_SALE com referência', async () => {
      const p = await product('MARROM', 11);
      const { sale: s } = await posService.createSale(sale([line(p.id, 3)]), op);
      expect(await stockOf(p.id)).toBe(8);
      const [m] = await movs(p.id);
      expect(m).toMatchObject({ type: 'POS_SALE', source: 'POS', quantityBefore: 11, quantityDelta: -3, quantityAfter: 8, userName: 'Ana Caixa', referenceLabel: `Venda #PDV-${s.number}` });
    });

    it('item livre entra no total, fica na venda e não toca estoque', async () => {
      const p = await product('A', 5, 50);
      const { sale: s } = await posService.createSale(sale([line(p.id, 2), free('Peça personalizada', 35.5, 2)]), op);
      expect(s.total).toBe(171);
      expect(s.items.find((i) => i.isFreeItem)).toMatchObject({ description: 'Peça personalizada', productId: null, total: 71 });
      expect(await h.db.stockMovement.count()).toBe(1);
      expect(await stockOf(p.id)).toBe(3);
    });

    it('venda só com item livre não gera movimentação', async () => {
      await posService.createSale(sale([free('Serviço', 20)]), op);
      expect(await h.db.stockMovement.count()).toBe(0);
    });

    it('preço vem do banco (promoção vigente) e desconto é rateado sem perder centavo', async () => {
      const a = await product('A', 5, 100, { promotionalPrice: 33.33 });
      const b = await product('B', 5, 33.34);
      const { sale: s } = await posService.createSale(sale([line(a.id), line(b.id)], { discount: 10 }), op);
      expect(s).toMatchObject({ subtotal: 66.67, discount: 10, total: 56.67 });
      expect(Number((s.items[0].netTotal + s.items[1].netTotal).toFixed(2))).toBe(56.67);
    });

    it('total divergente do que o operador viu responde 409 e nada acontece', async () => {
      const p = await product('A', 5, 50);
      await expect(posService.createSale(sale([line(p.id)], { expectedTotal: 40 }), op)).rejects.toMatchObject({ status: 409, code: 'TOTAL_CHANGED' });
      expect(await stockOf(p.id)).toBe(5);
      expect(await h.db.posSale.count()).toBe(0);
    });

    it('desconto maior que o subtotal é recusado', async () => {
      const p = await product('A', 5, 50);
      await expect(posService.createSale(sale([line(p.id)], { discount: 51 }), op)).rejects.toMatchObject({ status: 400 });
    });

    it('dinheiro: troco calculado no backend; valor insuficiente recusado', async () => {
      const p = await product('A', 5, 50);
      const { sale: s } = await posService.createSale(sale([line(p.id)], { paymentMethod: 'CASH', amountReceived: 70 }), op);
      expect(s).toMatchObject({ amountReceived: 70, changeAmount: 20 });
      await expect(posService.createSale(sale([line(p.id)], { paymentMethod: 'CASH', amountReceived: 10 }), op)).rejects.toMatchObject({ status: 400 });
    });

    it('estoque insuficiente: 409 com detalhes e venda inteira revertida', async () => {
      const a = await product('A', 5);
      const b = await product('B', 1);
      await expect(posService.createSale(sale([line(a.id, 2), line(b.id, 2)]), op)).rejects.toMatchObject({
        status: 409, code: 'INSUFFICIENT_STOCK', details: { available: 1, requested: 2 },
      });
      expect(await stockOf(a.id)).toBe(5);
      expect(await h.db.posSale.count()).toBe(0);
      expect(await h.db.stockMovement.count()).toBe(0);
    });

    it('mesmo produto em duas linhas soma a quantidade para validar estoque', async () => {
      const p = await product('A', 3);
      await expect(posService.createSale(sale([line(p.id, 2), line(p.id, 2)]), op)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      const { sale: s } = await posService.createSale(sale([line(p.id, 1), line(p.id, 2)]), op);
      expect(s.items).toHaveLength(1);
      expect(s.items[0].quantity).toBe(3);
    });

    it('retry da mesma venda não baixa duas vezes (sequencial e simultâneo)', async () => {
      const p = await product('A', 10);
      const input = sale([line(p.id, 2)]);
      const [a, b, c] = await Promise.all([posService.createSale(input, op), posService.createSale(input, op), posService.createSale(input, op)]);
      expect(new Set([a.sale.id, b.sale.id, c.sale.id]).size).toBe(1);
      const again = await posService.createSale(input, op);
      expect(again).toMatchObject({ idempotent: true });
      expect(await stockOf(p.id)).toBe(8);
      expect(await h.db.posSale.count()).toBe(1);
    });

    it('duas vendas em caixas diferentes disputando a última unidade: só uma passa', async () => {
      await posService.openSession({ openingCash: 0 }, op2);
      const p = await product('A', 1);
      const results = await Promise.allSettled([posService.createSale(sale([line(p.id)]), op), posService.createSale(sale([line(p.id)]), op2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await stockOf(p.id)).toBe(0);
    });

    it('produto inativo: sem confirmação é recusado e nada acontece', async () => {
      const p = await product('INATIVO', 5, 10, { active: false });
      await expect(posService.createSale(sale([line(p.id)]), op)).rejects.toMatchObject({
        status: 409, code: 'INACTIVE_PRODUCT_NOT_CONFIRMED', details: { products: [{ id: p.id, name: p.name }] },
      });
      expect(await stockOf(p.id)).toBe(5);
      expect(await h.db.posSale.count()).toBe(0);
    });

    it('produto inativo: com confirmação explícita vende e baixa o estoque', async () => {
      const p = await product('INATIVO', 5, 10, { active: false });
      const { sale: s } = await posService.createSale(sale([{ ...line(p.id, 2), confirmInactive: true }]), op);
      expect(s.total).toBe(20);
      expect(await stockOf(p.id)).toBe(3);
    });

    it('vincula cliente e guarda snapshot do nome', async () => {
      const p = await product('A', 5);
      const c = await customersService.create({ name: 'Maria Silva', phone: '(54) 99999-1234' });
      const { sale: s } = await posService.createSale(sale([line(p.id)], { customerId: c.id }), op);
      expect(s).toMatchObject({ customerId: c.id, customerName: 'Maria Silva' });
      await expect(posService.createSale(sale([line(p.id)], { customerId: 'nao-existe' }), op)).rejects.toMatchObject({ status: 400 });
    });
  });

  it('sem caixa aberto não vende nem devolve', async () => {
    const p = await product('A', 5);
    await expect(posService.createSale(sale([line(p.id)]), op)).rejects.toMatchObject({ status: 409, code: 'NO_OPEN_SESSION' });
    expect(await stockOf(p.id)).toBe(5);
  });

  describe('cancelamento', () => {
    it('devolve o estoque uma vez só, mesmo com pedidos simultâneos, e mantém a venda', async () => {
      await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 10);
      const { sale: s } = await posService.createSale(sale([line(p.id, 4), free('Serviço', 10)]), op);
      const results = await Promise.allSettled([posService.cancelSale(s.id, 'Erro no item', op), posService.cancelSale(s.id, 'Erro no item', op), posService.cancelSale(s.id, 'Erro no item', op)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await stockOf(p.id)).toBe(10);
      const rows = await movs(p.id);
      expect(rows.map((m) => m.type)).toEqual(['POS_SALE', 'CANCELLATION']);
      expect(rows[1]).toMatchObject({ quantityDelta: 4, userName: 'Ana Caixa', note: 'Erro no item' });
      const stored = await h.db.posSale.findUniqueOrThrow({ where: { id: s.id } });
      expect(stored).toMatchObject({ status: 'CANCELED', canceledByName: 'Ana Caixa', cancelReason: 'Erro no item' });
      expect(stored.canceledAt).toBeInstanceOf(Date);
    });

    it('caixa fechado não aceita cancelamento: orienta devolução', async () => {
      const session = await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 10);
      const { sale: s } = await posService.createSale(sale([line(p.id)]), op);
      await posService.closeSession(session.id, {}, op);
      await expect(posService.cancelSale(s.id, 'Tarde demais', op)).rejects.toMatchObject({ status: 409, code: 'SESSION_CLOSED' });
      expect(await stockOf(p.id)).toBe(9);
    });

    it('venda com devolução não pode ser cancelada (reverte tudo)', async () => {
      await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 10);
      const { sale: s } = await posService.createSale(sale([line(p.id, 2)]), op);
      await posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Defeito', items: [{ saleItemId: s.items[0].id, quantity: 1 }] }, op);
      await expect(posService.cancelSale(s.id, 'Cancelar', op)).rejects.toMatchObject({ code: 'HAS_RETURNS' });
      expect((await h.db.posSale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('COMPLETED');
      expect(await stockOf(p.id)).toBe(9);
    });
  });

  describe('devolução', () => {
    it('devolve parcial, soma o valor líquido exato e impede devolver além do vendido', async () => {
      await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 10, 10);
      const { sale: s } = await posService.createSale(sale([line(p.id, 3)], { discount: 0.01 }), op);
      const item = s.items[0];
      const r1 = await posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Defeito', items: [{ saleItemId: item.id, quantity: 1 }] }, op);
      const r2 = await posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Defeito', items: [{ saleItemId: item.id, quantity: 2 }] }, op);
      expect(Number((r1.return.refundAmount + r2.return.refundAmount).toFixed(2))).toBe(29.99);
      expect(await stockOf(p.id)).toBe(10);
      await expect(posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Defeito', items: [{ saleItemId: item.id, quantity: 1 }] }, op)).rejects.toMatchObject({ code: 'RETURN_EXCEEDS_SOLD' });
      expect((await movs(p.id)).filter((m) => m.type === 'RETURN')).toHaveLength(2);
    });

    it('devoluções simultâneas da última unidade: só uma passa', async () => {
      await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 10);
      const { sale: s } = await posService.createSale(sale([line(p.id, 1)]), op);
      const make = () => posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Defeito', items: [{ saleItemId: s.items[0].id, quantity: 1 }] }, op);
      const results = await Promise.allSettled([make(), make(), make()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await stockOf(p.id)).toBe(10);
    });

    it('item livre devolvido não mexe em estoque, mas entra no valor', async () => {
      await posService.openSession({ openingCash: 0 }, op);
      const { sale: s } = await posService.createSale(sale([free('Serviço', 40)]), op);
      const r = await posService.createReturn(s.id, { clientRequestId: key('ret'), reason: 'Desistiu', items: [{ saleItemId: s.items[0].id, quantity: 1 }] }, op);
      expect(r.return.refundAmount).toBe(40);
      expect(await h.db.stockMovement.count()).toBe(0);
    });
  });

  describe('sessão de caixa', () => {
    it('impede dois caixas abertos pelo mesmo operador, mesmo em paralelo', async () => {
      const results = await Promise.allSettled([posService.openSession({ openingCash: 0 }, op), posService.openSession({ openingCash: 0 }, op)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await h.db.cashSession.count()).toBe(1);
      await expect(posService.openSession({ openingCash: 0 }, op)).rejects.toMatchObject({ code: 'SESSION_ALREADY_OPEN' });
    });

    it('fechar duas vezes responde 409; depois pode abrir outro', async () => {
      const s = await posService.openSession({ openingCash: 0 }, op);
      await posService.closeSession(s.id, {}, op);
      await expect(posService.closeSession(s.id, {}, op)).rejects.toMatchObject({ code: 'SESSION_ALREADY_CLOSED' });
      expect(await posService.currentSession(op.id)).toBeNull();
      const next = await posService.openSession({ openingCash: 0 }, op);
      expect(next.number).toBeGreaterThan(s.number);
    });

    it('venda depois do fechamento é recusada', async () => {
      const s = await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 5);
      await posService.closeSession(s.id, {}, op);
      await expect(posService.createSale(sale([line(p.id)]), op)).rejects.toMatchObject({ code: 'NO_OPEN_SESSION' });
    });

    it('vendas em voo durante o fechamento: relatório fecha com o estoque real', async () => {
      const s = await posService.openSession({ openingCash: 0 }, op);
      const p = await product('A', 100);
      const sales = Array.from({ length: 12 }, () => posService.createSale(sale([line(p.id)]), op).then(() => 1, () => 0));
      const closed = posService.closeSession(s.id, {}, op);
      const [counts, { report }] = await Promise.all([Promise.all(sales), closed]);
      const row = report.stock.products.find((x) => x.productId === p.id);
      const committed = (counts as number[]).reduce((a, b) => a + b, 0);
      expect(report.summary.salesCount).toBe(row ? -row.pos : 0);
      expect(report.stock.discrepancies).toBe(0);
      expect(await h.db.posSale.count()).toBe(committed);
      expect(await stockOf(p.id)).toBe(100 - committed);
    });
  });

  describe('relatório de fechamento', () => {
    it('responde "por que o estoque mudou": todas as origens, com detalhe e origem', async () => {
      const preto = await product('PRETO', 20, 100);
      const verde = await product('VERDE', 5, 50);
      await h.db.product.create({ data: { name: 'Sem movimento', slug: 'parado', sku: 'PARADO', price: 1, stock: 3, category: { connect: { id: 'cat-1' } } } });

      const session = await posService.openSession({ openingCash: 200, note: 'Abertura' }, op);

      const orderId = await paidOrder(preto.id, 2);
      await applyStockForOrder(orderId);
      const { sale: v1 } = await posService.createSale(sale([line(preto.id, 5)], { paymentMethod: 'CASH', amountReceived: 500 }), op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: preto.id, quantity: 1, note: 'Produção interna' }, op);
      await posService.createReturn(v1.id, { clientRequestId: key('ret'), reason: 'Troca', items: [{ saleItemId: v1.items[0].id, quantity: 1 }] }, op);
      await productsService.update(verde.id, { stock: 8, expectedStock: 5 } as never, op);
      const { sale: v2 } = await posService.createSale(sale([line(verde.id, 1), free('Serviço', 30)], { paymentMethod: 'PIX', discount: 10 }), op);
      const { sale: v3 } = await posService.createSale(sale([line(verde.id, 1)], { paymentMethod: 'DEBIT_CARD' }), op);
      await posService.cancelSale(v3.id, 'Desistiu', op);

      const { report, session: closed } = await posService.closeSession(session.id, { countedCash: 600, note: 'Tudo certo' }, op);

      const p = report.stock.products.find((x) => x.productId === preto.id)!;
      expect(p).toMatchObject({ initial: 20, ecommerce: -2, pos: -5, internalUse: -1, adjustments: 0, returns: 1, final: 13, expectedFinal: 13, discrepancy: 0 });
      expect(p.movements.map((m) => [m.type, m.delta])).toEqual([['ECOMMERCE_SALE', -2], ['POS_SALE', -5], ['INTERNAL_USE', -1], ['RETURN', 1]]);
      expect(p.movements[0].orderId).toBe(orderId);
      expect(p.movements[1].reference).toBe(`Venda #PDV-${v1.number}`);
      expect(p.movements[2].note).toBe('Produção interna');

      const v = report.stock.products.find((x) => x.productId === verde.id)!;
      expect(v).toMatchObject({ initial: 5, adjustments: 3, pos: -2, cancellations: 1, returns: 0, final: 7, discrepancy: 0 });

      expect(report.stock.products).toHaveLength(2);
      expect(report.stock.discrepancies).toBe(0);

      // Financeiro: só vendas físicas (pedido online fora), cancelada fora do total.
      expect(report.summary).toMatchObject({
        salesCount: 2, totalSold: 570, discounts: 10, canceledCount: 1, canceledTotal: 50,
        averageTicket: 285, itemsSold: 7, freeItemsCount: 1, freeItemsTotal: 30, refundsCount: 1, refundsTotal: 100, netAfterRefunds: 470,
      });
      expect(report.payments.find((x) => x.method === 'CASH')).toMatchObject({ count: 1, total: 500, refunds: 100, net: 400 });
      expect(report.payments.find((x) => x.method === 'PIX')).toMatchObject({ count: 1, total: 70 });
      expect(report.payments.find((x) => x.method === 'DEBIT_CARD')).toMatchObject({ count: 0, total: 0 });
      expect(report.cash).toEqual({ opening: 200, expected: 600, counted: 600, difference: 0 });
      expect(closed).toMatchObject({ status: 'CLOSED', salesCount: 2, totalSold: 570 });
    });

    it('janela lógica: toda origem entra, inicial + colunas = final, e online fica fora do caixa', async () => {
      const p = await product('TODAS', 30, 10);
      const session = await posService.openSession({ openingCash: 0 }, op);

      await applyStockForOrder(await paidOrder(p.id, 2));
      const canceled = await paidOrder(p.id, 1);
      await applyStockForOrder(canceled);
      await cancelOrderRecord(canceled, 'CANCELED');
      const refunded = await paidOrder(p.id, 1);
      await applyStockForOrder(refunded);
      await cancelOrderRecord(refunded, 'REFUNDED');
      await posService.createSale(sale([line(p.id, 3)]), op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 1 }, op);
      await productsService.update(p.id, { stock: 26, expectedStock: 24 } as never, op);
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'TODAS', stock: 20 }] } as never, op);

      const { report } = await posService.closeSession(session.id, {}, op);
      const row = report.stock.products[0];
      expect(row).toMatchObject({ initial: 30, ecommerce: -4, cancellations: 1, returns: 1, pos: -3, internalUse: -1, adjustments: 2, imports: -6, final: 20, discrepancy: 0 });
      expect(row.initial + row.ecommerce + row.pos + row.internalUse + row.adjustments + row.imports + row.cancellations + row.returns).toBe(row.final);
      expect(report.stock.totals).toMatchObject({ ecommerce: -4, imports: -6, cancellations: 1, returns: 1 });
      expect(report.summary).toMatchObject({ salesCount: 1, totalSold: 30 });
      expect(await stockOf(p.id)).toBe(20);
    });

    it('a janela segue a sequência, não o horário gravado', async () => {
      const p = await product('SEQ', 10);
      const s1 = await posService.openSession({ openingCash: 0 }, op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 1 }, op);
      // Relógio "antes da abertura", mas gravado depois do snapshot: entra.
      await h.db.$executeRawUnsafe(`UPDATE stock_movements SET created_at = now() - interval '2 days'`);
      const closed = await posService.closeSession(s1.id, {}, op);
      expect(closed.report.stock.products[0]).toMatchObject({ initial: 10, internalUse: -1, final: 9, discrepancy: 0 });

      // Depois do fechamento, com horário de dentro da sessão: não entra na próxima.
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 2 }, op);
      await h.db.$executeRawUnsafe(`UPDATE stock_movements SET created_at = '${s1.openedAt}' WHERE quantity_delta = -2`);
      const s2 = await posService.openSession({ openingCash: 0 }, op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 3 }, op);
      const next = await posService.closeSession(s2.id, {}, op);
      expect(next.report.stock.products[0]).toMatchObject({ initial: 7, internalUse: -3, final: 4, discrepancy: 0 });
    });

    it('cancelamento de pedido online aparece no estoque e não no caixa', async () => {
      const p = await product('A', 10);
      const orderId = await paidOrder(p.id, 2);
      await applyStockForOrder(orderId);
      const session = await posService.openSession({ openingCash: 0 }, op);
      await cancelOrderRecord(orderId, 'CANCELED');
      const { report } = await posService.closeSession(session.id, {}, op);
      expect(report.stock.products[0]).toMatchObject({ initial: 8, cancellations: 2, final: 10 });
      expect(report.summary.salesCount).toBe(0);
    });

    it('movimento anterior à abertura não entra; o da sessão seguinte também não', async () => {
      const p = await product('A', 10);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 1 }, op);
      const s = await posService.openSession({ openingCash: 0 }, op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 2 }, op);
      const { report } = await posService.closeSession(s.id, {}, op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: p.id, quantity: 3 }, op);
      expect(report.stock.products[0]).toMatchObject({ initial: 9, internalUse: -2, final: 7 });
      const stored = await posService.getSession(s.id);
      expect(stored.live).toBe(false);
      expect((stored.report as SessionReport).stock.products[0].final).toBe(7);
    });

    it('alteração por fora do sistema vira divergência, nunca some em silêncio', async () => {
      const a = await product('A', 10);
      const b = await product('B', 10);
      const s = await posService.openSession({ openingCash: 0 }, op);
      await stockService.registerInternalUse({ clientRequestId: key('uso'), productId: a.id, quantity: 1 }, op);
      await h.db.$executeRawUnsafe(`UPDATE products SET stock = stock - 2 WHERE id = '${a.id}'`);
      await h.db.$executeRawUnsafe(`UPDATE products SET stock = 4 WHERE id = '${b.id}'`);
      const { report } = await posService.closeSession(s.id, {}, op);
      expect(report.stock.products[0]).toMatchObject({ expectedFinal: 9, final: 7, discrepancy: -2 });
      expect(report.stock.untracked).toEqual([expect.objectContaining({ productId: b.id, initial: 10, final: 4 })]);
      expect(report.stock.discrepancies).toBe(2);
    });

    it('produto excluído na sessão fica no relatório com a baixa', async () => {
      const p = await product('A', 6);
      const s = await posService.openSession({ openingCash: 0 }, op);
      await productsService.remove(p.id, op);
      const { report } = await posService.closeSession(s.id, {}, op);
      expect(report.stock.products[0]).toMatchObject({ name: 'Produto A', initial: 6, adjustments: -6, final: 0, discrepancy: 0 });
    });

    it('prévia do caixa aberto usa a mesma regra', async () => {
      const p = await product('A', 10);
      const s = await posService.openSession({ openingCash: 0 }, op);
      await posService.createSale(sale([line(p.id, 2)]), op);
      const preview = await posService.getSession(s.id);
      expect(preview.live).toBe(true);
      expect((preview.report as SessionReport).stock.products[0]).toMatchObject({ initial: 10, pos: -2, final: 8 });
    });

    it('histórico lista do mais recente ao mais antigo, sem carregar o relatório', async () => {
      const s1 = await posService.openSession({ openingCash: 0 }, op);
      await posService.closeSession(s1.id, {}, op);
      const s2 = await posService.openSession({ openingCash: 0 }, op);
      const { sessions } = await posService.listSessions({ page: 1, limit: 10 });
      expect(sessions.map((s) => s.id)).toEqual([s2.id, s1.id]);
      expect(sessions[0]).not.toHaveProperty('reportJson');
    });
  });

  describe('busca de produto', () => {
    it('leitor: código exato por barcode ou SKU, sem casar parcial', async () => {
      const p = await product('PLA-PRETO', 5, 100, { barcode: '7891234567895' });
      expect((await posService.lookupProduct('7891234567895')).product?.id).toBe(p.id);
      expect((await posService.lookupProduct('pla-preto')).product?.id).toBe(p.id);
      expect((await posService.lookupProduct('789123')).product).toBeNull();
    });

    it('pesquisa por termos combinados e por filtros', async () => {
      const p = await product('PLA-PT', 5, 100, { name: 'Filamento PLA Preto', brand: 'Voolt', material: 'PLA' });
      await product('PETG-BR', 5, 100, { name: 'Filamento PETG Branco', brand: 'Outra', material: 'PETG' });
      expect((await posService.searchProducts({ q: 'pla preto', limit: 20 })).products.map((x) => x.id)).toEqual([p.id]);
      expect((await posService.searchProducts({ brand: 'voolt', limit: 20 })).products.map((x) => x.id)).toEqual([p.id]);
      expect((await posService.searchProducts({ material: 'petg', limit: 20 })).products).toHaveLength(1);
      expect((await posService.searchProducts({ category: 'filamentos', limit: 20 })).products).toHaveLength(2);
    });

    it('preço exibido é o efetivo', async () => {
      await product('A', 5, 100, { promotionalPrice: 80 });
      expect((await posService.searchProducts({ q: 'A', limit: 20 })).products[0].price).toBe(80);
    });
  });

  describe('clientes', () => {
    async function customerUser(id: string, email: string, name = 'Carla Web', phone: string | null = '(54) 98888-7777') {
      return h.db.user.create({ data: { id, name, email, phone, passwordHash: 'x', role: 'CUSTOMER' } });
    }

    it('usuários da loja aparecem sem quebrar o login; admin não é cliente', async () => {
      await customerUser('u1', 'Carla@T.test');
      const { customers } = await customersService.list({ page: 1, limit: 20 });
      expect(customers).toHaveLength(1);
      expect(customers[0]).toMatchObject({ userId: 'u1', email: 'carla@t.test', origin: 'ECOMMERCE', hasLogin: true });
      await customersService.list({ page: 1, limit: 20 });
      expect(await h.db.customer.count()).toBe(1);
      expect((await h.db.user.findUniqueOrThrow({ where: { id: 'u1' } })).email).toBe('Carla@T.test');
    });

    it('cliente do PDV sem login, sem criar User', async () => {
      const before = await h.db.user.count();
      const c = await customersService.create({ name: 'João Balcão', phone: '54 91234-5678' });
      expect(c).toMatchObject({ hasLogin: false, origin: 'POS' });
      expect(await h.db.user.count()).toBe(before);
    });

    it('quem era do PDV e cria conta depois é vinculado pelo e-mail', async () => {
      const c = await customersService.create({ name: 'Bia', email: 'bia@t.test' });
      await customerUser('u2', 'bia@t.test', 'Bia Web');
      await customersService.list({ page: 1, limit: 20 });
      expect(await h.db.customer.count()).toBe(1);
      expect((await h.db.customer.findUniqueOrThrow({ where: { id: c.id } })).userId).toBe('u2');
    });

    it('e-mail e documento duplicados respondem 409 claro', async () => {
      await customersService.create({ name: 'Um', email: 'x@t.test', document: '52998224725' });
      await expect(customersService.create({ name: 'Dois', email: 'x@t.test' })).rejects.toMatchObject({ status: 409 });
      await expect(customersService.create({ name: 'Três', document: '52998224725' })).rejects.toMatchObject({ status: 409 });
    });

    it('busca por nome, e-mail, telefone com qualquer máscara e documento', async () => {
      const c = await customersService.create({ name: 'Marina Souza', email: 'marina@t.test', phone: '(54) 99123-4567', document: '52998224725' });
      for (const search of ['marina', 'MARINA@T', '991234567', '99123-4567', '529.982']) {
        const { customers } = await customersService.list({ search, page: 1, limit: 20 });
        expect(customers.map((x) => x.id), search).toEqual([c.id]);
      }
    });

    it('acha pelo CPF digitado no checkout', async () => {
      await customerUser('u3', 'c3@t.test', 'Com CPF', null);
      const p = await product('A', 5);
      await paidOrder(p.id, 1, 'u3');
      const { customers } = await customersService.list({ search: '52998224725', page: 1, limit: 20 });
      expect(customers.map((x) => x.userId)).toEqual(['u3']);
    });

    it('detalhe soma compras online e do PDV; cancelada e devolução não contam', async () => {
      await customerUser('u4', 'c4@t.test');
      await customersService.list({ page: 1, limit: 20 });
      const c = await h.db.customer.findFirstOrThrow({ where: { userId: 'u4' } });
      const p = await product('A', 20, 50);
      await paidOrder(p.id, 1, 'u4');
      await posService.openSession({ openingCash: 0 }, op);
      const { sale: s1 } = await posService.createSale(sale([line(p.id, 2)], { customerId: c.id }), op);
      const { sale: s2 } = await posService.createSale(sale([line(p.id, 1)], { customerId: c.id }), op);
      await posService.cancelSale(s2.id, 'Erro', op);
      await posService.createReturn(s1.id, { clientRequestId: key('ret'), reason: 'Troca', items: [{ saleItemId: s1.items[0].id, quantity: 1 }] }, op);

      const detail = await customersService.get(c.id);
      expect(detail.stats).toMatchObject({ purchaseCount: 2, totalOnline: 100, totalPos: 50, totalSpent: 150 });
      expect(detail.stats.lastPurchaseAt).toBeTruthy();
      expect(detail.orders).toHaveLength(1);
      expect(detail.posSales.map((x) => x.status).sort()).toEqual(['CANCELED', 'COMPLETED']);
      expect(detail.customer.document).toBe('52998224725');
      expect(detail.customer.address).toMatchObject({ city: 'Passo Fundo' });
    });

    it('excluir o login mantém o cliente e o histórico do PDV', async () => {
      await customerUser('u5', 'c5@t.test');
      await customersService.list({ page: 1, limit: 20 });
      await h.db.user.delete({ where: { id: 'u5' } });
      expect((await h.db.customer.findFirstOrThrow({ where: { email: 'c5@t.test' } })).userId).toBeNull();
    });
  });

  describe('HTTP', () => {
    let server: http.Server;
    let base = '';
    const auth = (sub: string, role: 'ADMIN' | 'CUSTOMER', email: string) => ({
      Authorization: `Bearer ${signAuthToken({ sub, email, role })}`, 'Content-Type': 'application/json',
    });
    const admin = auth('op-1', 'ADMIN', 'op-1@t.test');
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = admin) => {
      const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };

    beforeAll(async () => {
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    it('todas as rotas exigem autenticação e papel de admin', async () => {
      await h.db.user.create({ data: { id: 'cust-1', name: 'C', email: 'cust-1@t.test', passwordHash: 'x', role: 'CUSTOMER' } });
      const customer = auth('cust-1', 'CUSTOMER', 'cust-1@t.test');
      const routes: Array<[string, string]> = [
        ['GET', '/api/admin/pos/session/current'], ['GET', '/api/admin/pos/sessions'], ['POST', '/api/admin/pos/sessions'],
        ['GET', '/api/admin/pos/sessions/x'], ['POST', '/api/admin/pos/sessions/x/close'],
        ['GET', '/api/admin/pos/products/search'], ['GET', '/api/admin/pos/products/lookup?code=1'],
        ['POST', '/api/admin/pos/sales'], ['GET', '/api/admin/pos/sales/x'], ['POST', '/api/admin/pos/sales/x/cancel'], ['POST', '/api/admin/pos/sales/x/returns'],
        ['POST', '/api/admin/customers/search'], ['POST', '/api/admin/customers'], ['GET', '/api/admin/customers/x'], ['PUT', '/api/admin/customers/x'],
        ['GET', '/api/admin/stock/movements'], ['POST', '/api/admin/stock/internal-use'],
      ];
      for (const [method, path] of routes) {
        expect((await call(method, path, method === 'GET' ? undefined : {}, { 'Content-Type': 'application/json' })).status, path).toBe(401);
        expect((await call(method, path, method === 'GET' ? undefined : {}, customer)).status, path).toBe(403);
      }
    });

    it('busca de cliente: CPF vai no corpo e a URL não aceita busca', async () => {
      await customersService.create({ name: 'Com CPF', document: '52998224725', phone: '54999991234' });
      const found = await call('POST', '/api/admin/customers/search', { search: '52998224725' });
      expect(found.status).toBe(200);
      expect(found.json.data.customers.map((c: { name: string }) => c.name)).toEqual(['Com CPF']);
      const byPhone = await call('POST', '/api/admin/customers/search', { search: '(54) 99999-1234' });
      expect(byPhone.json.data.customers).toHaveLength(1);
      const viaUrl = await call('GET', '/api/admin/customers?search=52998224725');
      expect(viaUrl.status).toBe(404);
      expect(JSON.stringify(viaUrl.json)).not.toContain('Com CPF');
    });

    it('fluxo completo: abrir caixa → venda → uso interno → fechar → relatório → histórico', async () => {
      const p = await product('E2E', 11, 25);

      expect((await call('GET', '/api/admin/pos/session/current')).json.data.session).toBeNull();
      const opened = await call('POST', '/api/admin/pos/sessions', { openingCash: 50 });
      expect(opened.status).toBe(201);
      expect(opened.json.data.session.openedByName).toBe('Ana Caixa');
      const id = opened.json.data.session.id;

      const looked = await call('GET', '/api/admin/pos/products/lookup?code=E2E');
      expect(looked.json.data.product).toMatchObject({ id: p.id, stock: 11, price: 25 });

      const sold = await call('POST', '/api/admin/pos/sales', {
        clientRequestId: key('http'), paymentMethod: 'CASH', amountReceived: 100, discount: 5, expectedTotal: 90,
        items: [{ type: 'product', productId: p.id, quantity: 3 }, { type: 'free', description: 'Ajuste de peça', quantity: 1, unitPrice: 20 }],
      });
      expect(sold.status).toBe(201);
      expect(sold.json.data.sale).toMatchObject({ total: 90, changeAmount: 10, operatorName: 'Ana Caixa' });

      // O site lê o MESMO estoque.
      expect((await call('GET', '/api/public/products/e2e', undefined, {})).json.data.product.stock).toBe(8);

      const used = await call('POST', '/api/admin/stock/internal-use', { clientRequestId: key('http'), productId: p.id, quantity: 2, note: 'Uso em impressora X' });
      expect(used.status).toBe(201);

      const invalid = await call('POST', '/api/admin/pos/sales', { clientRequestId: key('http'), paymentMethod: 'PIX', items: [] });
      expect(invalid.status).toBe(422);

      const closed = await call('POST', `/api/admin/pos/sessions/${id}/close`, { countedCash: 140 });
      expect(closed.status).toBe(200);
      const report: SessionReport = closed.json.data.report;
      expect(report.stock.products[0]).toMatchObject({ initial: 11, pos: -3, internalUse: -2, final: 6, discrepancy: 0 });
      expect(report.cash).toEqual({ opening: 50, expected: 140, counted: 140, difference: 0 });

      const list = await call('GET', '/api/admin/pos/sessions');
      expect(list.json.data.sessions[0]).toMatchObject({ id, status: 'CLOSED', totalSold: 90 });
      const stored = await call('GET', `/api/admin/pos/sessions/${id}`);
      expect(stored.json.data.report.summary.totalSold).toBe(90);

      const ledger = await call('GET', `/api/admin/stock/movements?productId=${p.id}`);
      expect(ledger.json.data.movements.map((m: { type: string }) => m.type)).toEqual(['INTERNAL_USE', 'POS_SALE']);
    });
  });
});
