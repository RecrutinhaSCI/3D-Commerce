/**
 * Complementa os fakes in-memory do Prisma (só testes; fora do build) com o que
 * o stock.service usa: o compare-and-set de estoque e o histórico.
 */
import { vi } from 'vitest';

type FakeRow = { id: string; stock: number; updatedAt?: Date };

export function installStockFake(mock: any, products: () => FakeRow[]) {
  mock.stockMovement = {
    create: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({ count: 0 })),
  };
  const original = mock.product.updateMany;
  mock.product.updateMany = vi.fn(async (args: any) => {
    if (typeof args.where.id !== 'string') return original ? original(args) : { count: 0 };
    const row = products().find((p) => p.id === args.where.id && p.stock === args.where.stock);
    if (!row) return { count: 0 };
    Object.assign(row, args.data, { updatedAt: new Date() });
    return { count: 1 };
  });
}
