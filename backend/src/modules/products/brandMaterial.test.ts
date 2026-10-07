/**
 * R19-B — Testes de separação Marca × Material.
 * Prisma mockado: nenhum banco é tocado.
 *
 * Cobertura (todos os cenários do escopo):
 *   1. Create: brand e material persistem independentes.
 *   2. Update só de material não altera brand.
 *   3. Update só de brand não altera material.
 *   4. Bulk import: brand e material vão para campos distintos.
 *   5. Export → import mantém separação (matching por id).
 *   6. Bulk patch parcial: só brand ou só material.
 *   7. Célula vazia em ambos preserva os dois.
 *   8. Adapter/serviço nunca faz brand = material.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  promotionalPrice: number | null;
  brand: string | null;
  material: string | null;
  stock: number;
  active: boolean;
  featured: boolean;
  shortDescription: string | null;
  description: string | null;
  color: string | null;
  printTime: string | null;
  weight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  purchaseMode: 'DIRECT' | 'QUOTE' | 'BOTH';
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
  images: any[];
  category: { id: string; name: string; slug: string } | null;
}

// Fábrica de fakes preenchendo os campos que o DTO precisa serializar.
function makeFake(partial: Partial<FakeProduct>): FakeProduct {
  return {
    id: partial.id ?? nextId('prod'),
    name: partial.name ?? 'X',
    slug: partial.slug ?? 'x',
    sku: partial.sku ?? null,
    price: partial.price ?? 100,
    promotionalPrice: partial.promotionalPrice ?? null,
    brand: partial.brand ?? null,
    material: partial.material ?? null,
    stock: partial.stock ?? 0,
    active: partial.active ?? true,
    featured: partial.featured ?? false,
    shortDescription: partial.shortDescription ?? null,
    description: partial.description ?? null,
    color: partial.color ?? null,
    printTime: partial.printTime ?? null,
    weight: partial.weight ?? null,
    width: partial.width ?? null,
    height: partial.height ?? null,
    depth: partial.depth ?? null,
    purchaseMode: partial.purchaseMode ?? 'DIRECT',
    categoryId: partial.categoryId ?? 'cat_fila',
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
    images: partial.images ?? [],
    category: partial.category ?? { id: 'cat_fila', name: 'Filamentos', slug: 'filamentos' },
  };
}

const db = {
  products: [] as FakeProduct[],
  categories: [] as { id: string; name: string }[],
};

function nextId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

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
        return (
          db.products.find((p) => {
            if (where.sku !== undefined && p.sku !== where.sku) return false;
            if (where.slug !== undefined && p.slug !== where.slug) return false;
            return true;
          }) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const p = makeFake({
          name: data.name, slug: data.slug, sku: data.sku ?? null,
          price: Number(data.price), promotionalPrice: data.promotionalPrice ?? null,
          brand: data.brand ?? null, material: data.material ?? null,
          stock: data.stock ?? 0, active: data.active ?? true, featured: data.featured ?? false,
          shortDescription: data.shortDescription ?? null, description: data.description ?? null,
          categoryId: data.category?.connect?.id ?? 'cat_fila',
        });
        db.products.push(p);
        return p;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = db.products.find((x) => x.id === where.id);
        if (!p) throw new Error(`Product ${where.id} not found`);
        for (const [k, v] of Object.entries(data)) {
          if (k === 'category') { p.categoryId = (v as any)?.connect?.id ?? p.categoryId; continue; }
          (p as any)[k] = v;
        }
        p.updatedAt = new Date();
        return p;
      }),
      delete: vi.fn(async () => { throw new Error('delete não deve ser chamado'); }),
      deleteMany: vi.fn(async () => { throw new Error('deleteMany não deve ser chamado'); }),
    },
    category: {
      findFirst: vi.fn(async ({ where }: any) => {
        const q = where.name.equals.toLowerCase();
        return db.categories.find((c) => c.name.toLowerCase() === q) ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => db.categories.find((c) => c.id === where.id) ?? null),
    },
  productImage: {
    delete: vi.fn(),
    // R19-C — nunca chamados nestes testes (nenhuma linha passa imageUrl).
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => { throw new Error('productImage.create inesperado nos testes R19-B'); }),
    update: vi.fn(async () => { throw new Error('productImage.update inesperado nos testes R19-B'); }),
  },
  // R19-C — bulkImport agora envolve create/update em $transaction.
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
});

const { productsService } = await import('./products.service');

describe('brand × material — separação absoluta (R19-B)', () => {
  beforeEach(() => {
    db.products = [];
    db.categories = [{ id: 'cat_fila', name: 'Filamentos' }];
  });

  // -------------------------------------------------------------------------
  // Backend "normal" (create/update)
  // -------------------------------------------------------------------------
  it('CASO 1 — create persiste brand e material INDEPENDENTES', async () => {
    const dto = await productsService.create({
      categoryId: 'cat_fila',
      name: 'PLA Premium HT Verde 1KG',
      price: 129.9,
      brand: '3D Prime',
      material: 'PLA',
    });
    expect(dto.brand).toBe('3D Prime');
    expect(dto.material).toBe('PLA');
    const persisted = db.products[0];
    expect(persisted.brand).toBe('3D Prime');
    expect(persisted.material).toBe('PLA');
  });

  it('CASO 2 — update SÓ de material NÃO altera brand', async () => {
    db.products.push(makeFake({
      id: 'p1', name: 'X', slug: 'x',
      price: 100, brand: '3D Prime', material: 'PLA', stock: 5,
    }));
    const dto = await productsService.update('p1', { material: 'PETG' });
    expect(dto.brand).toBe('3D Prime');
    expect(dto.material).toBe('PETG');
    expect(db.products[0]).toMatchObject({ brand: '3D Prime', material: 'PETG' });
  });

  it('CASO 3 — update SÓ de brand NÃO altera material', async () => {
    db.products.push(makeFake({
      id: 'p1', price: 100, brand: '3D Prime', material: 'PETG', stock: 5,
    }));
    const dto = await productsService.update('p1', { brand: 'Masterprint' });
    expect(dto.brand).toBe('Masterprint');
    expect(dto.material).toBe('PETG');
    expect(db.products[0]).toMatchObject({ brand: 'Masterprint', material: 'PETG' });
  });

  // -------------------------------------------------------------------------
  // Bulk import
  // -------------------------------------------------------------------------
  it('CASO 4 — import Excel: brand e material em campos distintos', async () => {
    const report = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'PLA Masterprint Preto 1KG',
        categoryName: 'Filamentos', price: 89.9,
        brand: 'Masterprint', material: 'PLA',
      }],
    });
    expect(report.summary.created).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: 'Masterprint', material: 'PLA' });
  });

  it('CASO 5 — export → alterar → reimport pelo mesmo ID mantém separação', async () => {
    // "Export": snapshot inicial no banco.
    db.products.push(makeFake({
      id: 'produto-123', name: 'PLA X', slug: 'pla-x',
      price: 100, brand: '3D Prime', material: 'PLA', stock: 5,
    }));

    // "Reimport" via bulk com o id do export.
    const report = await productsService.bulkImport({
      rows: [{
        line: 2, id: 'produto-123',
        brand: 'Masterprint', material: 'PETG', price: 110,
      }],
    });
    expect(report.summary).toMatchObject({ updated: 1, created: 0, conflicts: 0 });
    expect(db.products).toHaveLength(1); // sem duplicação
    expect(db.products[0]).toMatchObject({
      id: 'produto-123', brand: 'Masterprint', material: 'PETG', price: 110,
    });
  });

  it('CASO 6 — bulk patch parcial: só material (brand preservado)', async () => {
    db.products.push(makeFake({
      id: 'p1', sku: 'SKU-X', price: 100, brand: '3D Prime', material: 'PLA', stock: 5,
    }));
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-X', material: 'ABS' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: '3D Prime', material: 'ABS' });
  });

  it('CASO 6b — bulk patch parcial: só brand (material preservado)', async () => {
    db.products.push(makeFake({
      id: 'p1', sku: 'SKU-X', price: 100, brand: '3D Prime', material: 'PLA', stock: 5,
    }));
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-X', brand: 'Voolt3D' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: 'Voolt3D', material: 'PLA' });
  });

  it('CASO 7 — planilha com Marca e Material vazios preserva os dois', async () => {
    db.products.push(makeFake({
      id: 'p1', sku: 'SKU-X', price: 100, brand: '3D Prime', material: 'PLA', stock: 5,
    }));
    // Ambas as chaves ausentes = undefined = preservar.
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-X', price: 120 }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: '3D Prime', material: 'PLA', price: 120 });
  });

  it('COMPAT — planilha antiga só com Marca (sem coluna Material) NÃO toca material', async () => {
    db.products.push(makeFake({
      id: 'p1', sku: 'SKU-X', price: 100, brand: null, material: 'PLA', stock: 5,
    }));
    // Só brand veio; material ausente = preservado.
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-X', brand: '3D Prime' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: '3D Prime', material: 'PLA' });
  });

  it('SEG — DTO exposto pelo service NUNCA usa material como fallback de brand', async () => {
    // Produto com brand vazio e material preenchido — bug antigo tentaria
    // promover material a brand no adapter. O DTO do backend agora NUNCA faz isso.
    db.products.push(makeFake({
      id: 'p1', price: 100, brand: null, material: 'PLA', stock: 5,
    }));
    // Via update (que passa por toDTO)
    const dto = await productsService.update('p1', { price: 100 });
    expect(dto.brand).toBe(null);
    expect(dto.material).toBe('PLA');
  });
});
