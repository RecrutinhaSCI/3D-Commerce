/**
 * Livro-razão de estoque contra Postgres REAL (só com TEST_DATABASE_URL local
 * cujo banco termina em "_test"; apaga produtos e pedidos de teste).
 */
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

import { applyStockMoves, InsufficientStockError, stockService, setStockAbsolute } from './stock.service';
import { applyStockForOrder, cancelOrderRecord, restoreStockForOrder } from '../orders/orders.service';
import { productsService } from '../products/products.service';
import { movementsQuerySchema } from './stock.schemas';

const actor = { id: 'admin-1', name: 'Operador' };
const POS = { type: 'POS_SALE', source: 'POS', actor } as const;

async function product(stock: number, sku = 'SKU-1') {
  return h.db.product.create({
    data: { name: `Filamento ${sku}`, slug: sku.toLowerCase(), sku, price: 100, stock, category: { connect: { id: 'cat-1' } } },
  });
}
async function movements(productId: string) {
  return h.db.stockMovement.findMany({ where: { productId }, orderBy: { seq: 'asc' } });
}
async function order(productId: string, quantity: number) {
  const o = await h.db.order.create({
    data: {
      customerName: 'C', customerEmail: 'c@t.test', customerPhone: '1', addressSnapshot: {}, subtotal: 100, total: 100,
      paymentMethod: 'PIX', items: { create: [{ productId, productName: 'P', quantity, unitPrice: 100, total: 100 }] },
    },
  });
  return o.id;
}
function expectChained(rows: Array<{ quantityBefore: number; quantityDelta: number; quantityAfter: number }>) {
  rows.forEach((m, i) => {
    expect(m.quantityBefore + m.quantityDelta).toBe(m.quantityAfter);
    if (i > 0) expect(m.quantityBefore).toBe(rows[i - 1].quantityAfter);
  });
}

describe.skipIf(!dbEnabled)('estoque — Postgres real', () => {
  let unlock: () => Promise<void>;
  beforeAll(async () => {
    unlock = await lockTestDb();
    h.db = new PrismaClient({ datasourceUrl: TEST_URL });
    await h.db.user.upsert({ where: { id: 'admin-1' }, create: { id: 'admin-1', name: 'Operador', email: 'a1@t.test', passwordHash: 'x', role: 'ADMIN' }, update: {} });
  }, DB_LOCK_TIMEOUT_MS);
  afterAll(async () => {
    await h.db?.$disconnect();
    await unlock?.();
  });
  it('busca/exibe código público na referência online sem regravar histórico nem alterar orderId', async () => {
    const p = await product(10);
    const id = await order(p.id, 2);
    await applyStockForOrder(id);
    const code = (await h.db.order.findUniqueOrThrow({ where: { id } })).publicCode;
    const saved = await h.db.stockMovement.findFirstOrThrow({ where: { orderId: id } });
    const result = await stockService.listMovements(movementsQuerySchema.parse({ search: code }));
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({ orderId: id, referenceLabel: `Pedido ${code}` });
    expect((await h.db.stockMovement.findUniqueOrThrow({ where: { id: saved.id } })).referenceLabel).toBe(saved.referenceLabel);
  });

  beforeEach(async () => {
    await h.db.$executeRawUnsafe('TRUNCATE stock_movements, order_items, orders, cart_items, product_images, products, categories RESTART IDENTITY CASCADE');
    await h.db.category.create({ data: { id: 'cat-1', name: 'Filamentos', slug: 'filamentos' } });
  });

  it('20 vendas simultâneas de 1 unidade com 5 em estoque: exatamente 5 passam', async () => {
    const p = await product(5);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -1 }], POS), { maxWait: 20_000, timeout: 20_000 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(InsufficientStockError);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
    const rows = await movements(p.id);
    expect(rows).toHaveLength(5);
    expectChained(rows);
    expect(rows[4].quantityAfter).toBe(0);
  });

  it('venda online e física disputando a última unidade: só uma baixa', async () => {
    const p = await product(1);
    const orderId = await order(p.id, 1);
    const [online, fisica] = await Promise.allSettled([
      applyStockForOrder(orderId),
      h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -1 }], POS)),
    ]);
    const onlineOk = online.status === 'fulfilled' && online.value.status === 'applied';
    expect(Number(onlineOk) + Number(fisica.status === 'fulfilled')).toBe(1);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
    expect(await movements(p.id)).toHaveLength(1);
  });

  it('item insuficiente reverte a operação inteira (sem movimentação parcial)', async () => {
    const a = await product(5, 'A');
    const b = await product(0, 'B');
    await expect(
      h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: a.id, delta: -1 }, { productId: b.id, delta: -1 }], POS)),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: a.id } })).stock).toBe(5);
    expect(await h.db.stockMovement.count()).toBe(0);
  });

  it('banco recusa estoque negativo mesmo fora do serviço', async () => {
    const p = await product(1);
    await expect(h.db.product.update({ where: { id: p.id }, data: { stock: -1 } })).rejects.toThrow();
  });

  it('pedido: baixa e reposição idempotentes, com origem e referência', async () => {
    const p = await product(10);
    const orderId = await order(p.id, 3);
    await Promise.all([applyStockForOrder(orderId), applyStockForOrder(orderId)]);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
    await Promise.all([restoreStockForOrder(orderId), restoreStockForOrder(orderId)]);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
    const rows = await movements(p.id);
    expect(rows.map((m) => [m.type, m.source, m.quantityDelta])).toEqual([
      ['ECOMMERCE_SALE', 'ECOMMERCE', -3],
      ['CANCELLATION', 'ECOMMERCE', 3],
    ]);
    expect(rows[0].orderId).toBe(orderId);
    expect(rows[0].referenceLabel).toMatch(/^Pedido #/);
    expectChained(rows);
  });

  it('estorno de pedido registra RETURN, e cancelar de novo não repõe', async () => {
    const p = await product(4);
    const orderId = await order(p.id, 2);
    await applyStockForOrder(orderId);
    expect(await cancelOrderRecord(orderId, 'REFUNDED', undefined, actor)).toBe(true);
    expect(await cancelOrderRecord(orderId, 'REFUNDED', undefined, actor)).toBe(false);
    const rows = await movements(p.id);
    expect(rows.map((m) => m.type)).toEqual(['ECOMMERCE_SALE', 'RETURN']);
    expect(rows[1].userName).toBe('Operador');
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
  });

  it('uso interno baixa estoque, não é venda, e retry não baixa duas vezes', async () => {
    const p = await product(12);
    const input = { clientRequestId: 'uso-interno-0001', productId: p.id, quantity: 2, note: 'Teste de impressão' };
    const [a, b] = await Promise.all([stockService.registerInternalUse(input, actor), stockService.registerInternalUse(input, actor)]);
    expect(a.movement.id).toBe(b.movement.id);
    expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
    const rows = await movements(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'INTERNAL_USE', quantityBefore: 12, quantityDelta: -2, quantityAfter: 10, userId: 'admin-1', note: 'Teste de impressão' });
  });

  it('uso interno sem estoque suficiente responde 409', async () => {
    const p = await product(1);
    await expect(stockService.registerInternalUse({ clientRequestId: 'uso-interno-0002', productId: p.id, quantity: 2 }, actor)).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });
    expect(await movements(p.id)).toHaveLength(0);
  });

  describe('edição do produto', () => {
    it('salvar sem mexer no estoque preserva venda feita depois de abrir o formulário', async () => {
      const p = await product(11);
      await h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -3 }], POS));
      const saved = await productsService.update(p.id, { name: 'Novo nome', stock: 11, expectedStock: 11 } as never, actor);
      expect(saved).toMatchObject({ name: 'Novo nome', stock: 8 });
      expect(await movements(p.id)).toHaveLength(1);
    });

    it('alterar o estoque com valor defasado responde 409 e nada muda', async () => {
      const p = await product(11);
      await h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -3 }], POS));
      await expect(productsService.update(p.id, { name: 'X nome', stock: 20, expectedStock: 11 } as never, actor)).rejects.toMatchObject({ status: 409, code: 'STOCK_CHANGED' });
      const fresh = await h.db.product.findUniqueOrThrow({ where: { id: p.id } });
      expect([fresh.stock, fresh.name]).toEqual([8, p.name]);
    });

    it('ajuste manual registra MANUAL_ADJUSTMENT com responsável', async () => {
      const p = await product(5);
      await productsService.update(p.id, { stock: 9, expectedStock: 5 } as never, actor);
      expect((await movements(p.id))[0]).toMatchObject({ type: 'MANUAL_ADJUSTMENT', source: 'ADMIN', quantityBefore: 5, quantityDelta: 4, quantityAfter: 9, userName: 'Operador' });
    });

    it('compare-and-set: ajuste absoluto concorrente com venda mantém a cadeia', async () => {
      const p = await product(50);
      await Promise.all([
        ...Array.from({ length: 10 }, () => h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -1 }], POS), { maxWait: 20_000, timeout: 20_000 })),
        h.db.$transaction((tx) => setStockAbsolute(tx, p.id, 100, { type: 'MANUAL_ADJUSTMENT', source: 'ADMIN', actor }), { maxWait: 20_000, timeout: 20_000 }),
      ]);
      const rows = await movements(p.id);
      expectChained(rows);
      expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(rows[rows.length - 1].quantityAfter);
    });
  });

  describe('importação Excel', () => {
    it('estoque diferente vira IMPORT; mesma planilha não gera movimentação', async () => {
      const p = await product(5, 'XL-1');
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-1', stock: 9 }] } as never, actor);
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-1', stock: 9 }] } as never, actor);
      const rows = await movements(p.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'IMPORT', source: 'IMPORT', quantityBefore: 5, quantityAfter: 9, note: 'Importação Excel — linha 2' });
    });

    it('registra anterior, delta e posterior reais, com responsável', async () => {
      const p = await product(11, 'XL-2');
      await productsService.bulkImport({ rows: [{ line: 5, sku: 'XL-2', stock: 4 }] } as never, actor);
      expect((await movements(p.id))[0]).toMatchObject({ type: 'IMPORT', quantityBefore: 11, quantityDelta: -7, quantityAfter: 4, userName: 'Operador', productSku: 'XL-2' });
      expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
    });

    it('zero explícito é alteração válida e fica registrado', async () => {
      const p = await product(6, 'XL-3');
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-3', stock: 0 }] } as never, actor);
      expect((await movements(p.id))[0]).toMatchObject({ quantityBefore: 6, quantityDelta: -6, quantityAfter: 0 });
    });

    it('estoque igual ou coluna vazia: nenhuma movimentação e carimbo intacto, mesmo mudando outro campo', async () => {
      const p = await product(5, 'XL-4');
      const report = await productsService.bulkImport({
        rows: [{ line: 2, sku: 'XL-4', stock: 5 }],
      } as never, actor);
      expect(report.summary.unchanged).toBe(1);
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-4', stock: 5, price: 77 }] } as never, actor);
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-4', price: 78 }] } as never, actor);
      const fresh = await h.db.product.findUniqueOrThrow({ where: { id: p.id } });
      expect([fresh.stock, Number(fresh.price), fresh.stockUpdatedAt]).toEqual([5, 78, null]);
      expect(await movements(p.id)).toHaveLength(0);
    });

    it('falha em outro campo da linha reverte estoque e movimentação juntos', async () => {
      const p = await product(5, 'XL-5');
      // Estoura numeric(12,2) no UPDATE que roda depois da baixa do estoque.
      const report = await productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-5', stock: 9, price: 99_999_999_999 }] } as never, actor);
      expect(report.summary.skipped).toBe(1);
      expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
      expect(await movements(p.id)).toHaveLength(0);
    });

    it('importação concorrente com vendas mantém a cadeia e o saldo real', async () => {
      const p = await product(50, 'XL-6');
      await Promise.all([
        ...Array.from({ length: 8 }, () => h.db.$transaction((tx) => applyStockMoves(tx, [{ productId: p.id, delta: -1 }], POS), { maxWait: 20_000, timeout: 20_000 })),
        productsService.bulkImport({ rows: [{ line: 2, sku: 'XL-6', stock: 100 }] } as never, actor),
      ]);
      const rows = await movements(p.id);
      expect(rows.filter((m) => m.type === 'IMPORT')).toHaveLength(1);
      expectChained(rows);
      expect((await h.db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(rows[rows.length - 1].quantityAfter);
    });

    it('produto criado pela planilha registra o estoque inicial', async () => {
      await productsService.bulkImport({ rows: [{ line: 2, sku: 'NOVO-1', name: 'Novo produto', categoryName: 'Filamentos', price: 10, stock: 7 }] } as never, actor);
      const fresh = await h.db.product.findFirstOrThrow({ where: { sku: 'NOVO-1' } });
      expect((await movements(fresh.id))[0]).toMatchObject({ type: 'IMPORT', quantityBefore: 0, quantityAfter: 7 });
    });
  });

  it('excluir produto preserva o histórico e registra a baixa', async () => {
    const p = await product(6);
    await productsService.remove(p.id, actor);
    const rows = await movements(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'CORRECTION', quantityDelta: -6, quantityAfter: 0, productName: p.name });
  });
});
