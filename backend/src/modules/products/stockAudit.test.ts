/**
 * R19-E — Exclusão em massa + histórico de estoque (`stockUpdatedAt`).
 *
 * Fake in-memory do Prisma — nenhum banco é tocado. Cobre:
 *  §1 seleção múltipla + exclusão em massa (soft delete via updateMany).
 *  §2 produto não selecionado permanece intocado.
 *  §3 IDs inexistentes ou já-inativos são reportados sem falha do lote.
 *  §4 `createdAt` nunca é sobrescrito.
 *  §5 edição de estoque muda `stockUpdatedAt`.
 *  §6 edição só de preço NÃO muda `stockUpdatedAt`.
 *  §7 import com estoque vazio NÃO muda a data.
 *  §8 import com estoque igual ao atual NÃO muda a data.
 *  §9 import com estoque diferente muda a data.
 *  §10 import mudando estoque para 0 muda a data.
 *  §11 import parcial preserva os demais campos.
 *  §12 produtos legados (stockUpdatedAt=null) continuam válidos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  promotionalPrice: number | null;
  stock: number;
  shortDescription: string | null;
  description: string | null;
  brand: string | null;
  material: string | null;
  active: boolean;
  featured: boolean;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
  stockUpdatedAt: Date | null;
  // Campos que o toDTO lê mas cujo valor exato não interessa aos testes.
  weight: null;
  width: null;
  height: null;
  depth: null;
  color: null;
  printTime: null;
  purchaseMode: 'DIRECT';
}

const db = {
  products: [] as FakeProduct[],
  categories: [] as { id: string; name: string }[],
  deletionCalls: 0,
};

function reset() { db.products = []; db.categories = []; db.deletionCalls = 0; }
function nid(prefix: string) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

const mockPrisma: any = {};
vi.mock('../../lib/prisma', () => ({ prisma: mockPrisma }));
Object.assign(mockPrisma, {
  product: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return db.products.find((p) => p.id === where.id) ?? null;
      if (where.slug) return db.products.find((p) => p.slug === where.slug) ?? null;
      return null;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const notId = where.NOT?.id;
      return (
        db.products.find((p) => {
          if (notId && p.id === notId) return false;
          if (where.sku !== undefined && p.sku !== where.sku) return false;
          if (where.slug !== undefined && p.slug !== where.slug) return false;
          return true;
        }) ?? null
      );
    }),
    findMany: vi.fn(async ({ where, select: _select }: any) => {
      let rows = db.products.slice();
      if (where?.id?.in) rows = rows.filter((p) => where.id.in.includes(p.id));
      return rows.map((p) => ({ id: p.id, active: p.active }));
    }),
    create: vi.fn(async ({ data }: any) => {
      const p: FakeProduct = {
        id: nid('prod'),
        name: data.name,
        slug: data.slug,
        sku: data.sku ?? null,
        price: Number(data.price),
        promotionalPrice: data.promotionalPrice ?? null,
        stock: data.stock ?? 0,
        shortDescription: data.shortDescription ?? null,
        description: data.description ?? null,
        brand: data.brand ?? null,
        material: data.material ?? null,
        active: data.active ?? true,
        featured: data.featured ?? false,
        categoryId: data.category?.connect?.id ?? 'cat_default',
        createdAt: new Date('2026-01-01'),
        stockUpdatedAt: data.stockUpdatedAt ?? null,
      };
      db.products.push(p);
      return { id: p.id, name: p.name };
    }),
    update: vi.fn(async ({ where, data, include }: any) => {
      const p = db.products.find((x) => x.id === where.id);
      if (!p) throw new Error('not found');
      for (const [k, v] of Object.entries(data)) {
        if (k === 'category') { p.categoryId = (v as any)?.connect?.id ?? p.categoryId; continue; }
        (p as any)[k] = v;
      }
      // Prisma real preenche `updatedAt` automaticamente.
      (p as any).updatedAt = new Date();
      // Se o service pediu include, devolvemos o "produto rico"; caso
      // contrário o select cru já é suficiente (bulkImport usa select).
      if (include) {
        return {
          ...p,
          category: { id: p.categoryId, name: 'Filamentos', slug: 'filamentos' },
          images: [],
        };
      }
      return { id: p.id, name: p.name };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const ids: string[] = where.id.in;
      let count = 0;
      for (const p of db.products) {
        if (!ids.includes(p.id)) continue;
        for (const [k, v] of Object.entries(data)) (p as any)[k] = v;
        count++;
      }
      return { count };
    }),
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('DELETE inesperado'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls++; throw new Error('DELETE_MANY inesperado'); }),
  },
  category: {
    findFirst: vi.fn(async ({ where }: any) => {
      const q = where.name.equals.toLowerCase();
      return db.categories.find((c) => c.name.toLowerCase() === q) ?? null;
    }),
  },
  productImage: {
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => { throw new Error('img update inesperado'); }),
    create: vi.fn(async () => { throw new Error('img create inesperado'); }),
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('img delete inesperado'); }),
  },
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
});

const { productsService } = await import('./products.service');

const RICH: Pick<FakeProduct, 'weight' | 'width' | 'height' | 'depth' | 'color' | 'printTime' | 'purchaseMode'> = {
  weight: null, width: null, height: null, depth: null, color: null, printTime: null, purchaseMode: 'DIRECT',
};

function seedThree() {
  db.products.push(
    {
      id: 'p-a', name: 'Prod A', slug: 'prod-a', sku: 'SKU-A',
      price: 100, promotionalPrice: null, stock: 10,
      shortDescription: null, description: null, brand: 'MarcaA', material: 'PLA',
      active: true, featured: false, categoryId: 'cat_fila',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      updatedAt: new Date('2026-01-15T10:00:00Z'),
      stockUpdatedAt: null, ...RICH,
    },
    {
      id: 'p-b', name: 'Prod B', slug: 'prod-b', sku: 'SKU-B',
      price: 200, promotionalPrice: null, stock: 20,
      shortDescription: null, description: null, brand: 'MarcaB', material: 'PETG',
      active: true, featured: false, categoryId: 'cat_fila',
      createdAt: new Date('2026-02-10T15:30:00Z'),
      updatedAt: new Date('2026-02-10T15:30:00Z'),
      stockUpdatedAt: new Date('2026-03-01T09:00:00Z'), ...RICH,
    },
    {
      id: 'p-c', name: 'Prod C', slug: 'prod-c', sku: 'SKU-C',
      price: 300, promotionalPrice: null, stock: 30,
      shortDescription: null, description: null, brand: 'MarcaC', material: 'ABS',
      active: false, featured: false, categoryId: 'cat_fila',
      createdAt: new Date('2026-02-20T12:00:00Z'),
      updatedAt: new Date('2026-02-20T12:00:00Z'),
      stockUpdatedAt: null, ...RICH,
    },
  );
}

describe('bulkDelete + stockUpdatedAt (R19-E)', () => {
  beforeEach(() => {
    reset();
    db.categories.push({ id: 'cat_fila', name: 'Filamentos' });
  });

  // §1 -----------------------------------------------------------------
  it('§1 exclui múltiplos produtos (soft delete: active=false)', async () => {
    seedThree();
    const r = await productsService.bulkDelete(['p-a', 'p-b']);
    expect(r).toMatchObject({ requested: 2, deactivated: 2, notFound: [], alreadyInactive: [] });
    expect(db.products.find((p) => p.id === 'p-a')!.active).toBe(false);
    expect(db.products.find((p) => p.id === 'p-b')!.active).toBe(false);
    // Registro físico permanece — nada de DELETE.
    expect(db.products).toHaveLength(3);
    expect(db.deletionCalls).toBe(0);
  });

  // §2 -----------------------------------------------------------------
  it('§2 produto não selecionado permanece intocado', async () => {
    seedThree();
    const cBefore = { ...db.products.find((p) => p.id === 'p-c')! };
    await productsService.bulkDelete(['p-a']);
    expect(db.products.find((p) => p.id === 'p-c')!).toEqual(cBefore);
    // B também
    expect(db.products.find((p) => p.id === 'p-b')!.active).toBe(true);
  });

  // §3 -----------------------------------------------------------------
  it('§3 IDs inexistentes e já-inativos são reportados sem quebrar o lote', async () => {
    seedThree();
    const r = await productsService.bulkDelete(['p-a', 'p-c', 'p-fantasma', 'p-fantasma-2']);
    expect(r.requested).toBe(4);
    expect(r.deactivated).toBe(1); // apenas p-a era ativo
    expect(r.alreadyInactive).toContain('p-c');
    expect(r.notFound).toEqual(expect.arrayContaining(['p-fantasma', 'p-fantasma-2']));
    // p-a foi desativado; p-c segue como estava (já inativo); p-b intocado
    expect(db.products.find((p) => p.id === 'p-a')!.active).toBe(false);
    expect(db.products.find((p) => p.id === 'p-b')!.active).toBe(true);
    expect(db.products.find((p) => p.id === 'p-c')!.active).toBe(false);
  });

  it('§3b IDs duplicados no payload contam UMA vez só', async () => {
    seedThree();
    const r = await productsService.bulkDelete(['p-a', 'p-a', 'p-a']);
    expect(r.requested).toBe(1);
    expect(r.deactivated).toBe(1);
  });

  // §4 -----------------------------------------------------------------
  it('§4 createdAt nunca é sobrescrito por edições', async () => {
    seedThree();
    const before = new Date(db.products.find((p) => p.id === 'p-a')!.createdAt);
    await productsService.update('p-a', { stock: 999, price: 555, name: 'novo nome' });
    expect(db.products.find((p) => p.id === 'p-a')!.createdAt).toEqual(before);
  });

  // §5 -----------------------------------------------------------------
  it('§5 edição manual de estoque atualiza stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt;
    expect(before).toBeNull();
    await productsService.update('p-a', { stock: 42 });
    const after = db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt;
    expect(after).toBeInstanceOf(Date);
    expect(after).not.toBeNull();
  });

  // §6 -----------------------------------------------------------------
  it('§6 edição só de preço NÃO altera stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    await productsService.update('p-b', { price: 250 });
    const after = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    expect(after.getTime()).toBe(before.getTime());
    expect(db.products.find((p) => p.id === 'p-b')!.price).toBe(250);
  });

  it('§6b edição de nome/descrição/marca/material NÃO altera stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    await productsService.update('p-b', {
      name: 'Novo nome',
      description: 'Nova descrição',
      brand: 'OutraMarca',
      material: 'PETG-CF',
    });
    const after = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    expect(after.getTime()).toBe(before.getTime());
  });

  // §7 -----------------------------------------------------------------
  it('§7 import com estoque vazio (undefined) NÃO altera stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-B', price: 250 }] });
    const after = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    expect(after.getTime()).toBe(before.getTime());
  });

  // §8 -----------------------------------------------------------------
  it('§8 import com estoque IGUAL ao atual NÃO altera stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-B', stock: 20 }], // igual ao atual
    });
    const after = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    expect(after.getTime()).toBe(before.getTime());
  });

  // §9 -----------------------------------------------------------------
  it('§9 import com estoque DIFERENTE atualiza stockUpdatedAt', async () => {
    seedThree();
    const before = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    await new Promise((r) => setTimeout(r, 5)); // garante diferença de timestamp
    await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-B', stock: 999 }],
    });
    const after = db.products.find((p) => p.id === 'p-b')!.stockUpdatedAt!;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  // §10 ----------------------------------------------------------------
  it('§10 estoque mudando para 0 explícito atualiza stockUpdatedAt', async () => {
    seedThree();
    await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-B', stock: 0 }],
    });
    const p = db.products.find((x) => x.id === 'p-b')!;
    expect(p.stock).toBe(0);
    expect(p.stockUpdatedAt).toBeInstanceOf(Date);
  });

  // §11 ----------------------------------------------------------------
  it('§11 import parcial preserva TODOS os demais campos', async () => {
    seedThree();
    const before = { ...db.products.find((p) => p.id === 'p-b')! };
    await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-B', stock: 25 }],
    });
    const after = db.products.find((p) => p.id === 'p-b')!;
    expect(after).toMatchObject({
      name: before.name, price: before.price, promotionalPrice: before.promotionalPrice,
      shortDescription: before.shortDescription, description: before.description,
      brand: before.brand, material: before.material,
      active: before.active, featured: before.featured,
      createdAt: before.createdAt,
    });
    expect(after.stock).toBe(25);
    expect(after.stockUpdatedAt).not.toBeNull();
  });

  // §12 ----------------------------------------------------------------
  it('§12 produto legado (stockUpdatedAt=null) permanece null até estoque mudar', async () => {
    seedThree();
    // p-a começa com stockUpdatedAt=null (legado)
    expect(db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt).toBeNull();
    // Import só com preço: permanece null
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', price: 150 }] });
    expect(db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt).toBeNull();
    // Estoque igual ao atual: continua null
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', stock: 10 }] });
    expect(db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt).toBeNull();
    // Só quando muda de verdade
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', stock: 11 }] });
    expect(db.products.find((p) => p.id === 'p-a')!.stockUpdatedAt).toBeInstanceOf(Date);
  });
});
