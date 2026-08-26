/**
 * R19-A — Testes unitários do bulkImport.
 * Prisma é mockado — NENHUM banco é tocado (nem local, nem produção).
 *
 * Cenários cobertos (mínimos exigidos + adicionais):
 *  A. Catálogo existente permanece intacto ao importar produtos novos.
 *  B. Update parcial: célula vazia preserva; célula preenchida atualiza.
 *  C. Reimportação da mesma planilha não duplica.
 *  D. Colisão de nome sem id/sku/slug → CONFLITO (nunca sobrescreve).
 *  E. Estoque explícito 0 é aplicado (0 ≠ vazio).
 *  F. Estoque vazio preserva o valor atual.
 *  G. ID válido atualiza exatamente aquele produto.
 *  H. ID inexistente vira CONFLITO (nunca cria com o id informado).
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
}

interface FakeCategory {
  id: string;
  name: string;
}

// -----------------------------------------------------------------------------
// Store em memória — simula o Neon o suficiente para exercitar a lógica.
// -----------------------------------------------------------------------------
const db = {
  products: [] as FakeProduct[],
  categories: [] as FakeCategory[],
  deletionCalls: 0, // guardia: se algum caminho tentar deletar, quebramos o teste.
};

function reset() {
  db.products = [];
  db.categories = [];
  db.deletionCalls = 0;
}

function nextId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// -----------------------------------------------------------------------------
// Mock do prisma antes de importar o service.
// -----------------------------------------------------------------------------
const mockPrisma: any = {};
vi.mock('../../lib/prisma', () => ({ prisma: mockPrisma }));
Object.assign(mockPrisma, {
  product: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return db.products.find((p) => p.id === where.id) ?? null;
        if (where.slug) return db.products.find((p) => p.slug === where.slug) ?? null;
        return null;
      }),
      findFirst: vi.fn(
        async ({ where }: { where: { sku?: string; slug?: string; id?: { not?: string } } }) => {
          return (
            db.products.find((p) => {
              if (where.sku !== undefined && p.sku !== where.sku) return false;
              if (where.slug !== undefined && p.slug !== where.slug) return false;
              return true;
            }) ?? null
          );
        },
      ),
      create: vi.fn(async ({ data }: { data: any }) => {
        // Prisma `category: { connect: { id } }` — extraímos.
        const categoryId: string | undefined = data.category?.connect?.id;
        const p: FakeProduct = {
          id: nextId('prod'),
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
          categoryId: categoryId ?? 'cat_default',
        };
        db.products.push(p);
        return { id: p.id, name: p.name };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const p = db.products.find((x) => x.id === where.id);
        if (!p) throw new Error(`Product ${where.id} not found in mock`);
        for (const [k, v] of Object.entries(data)) {
          if (k === 'category') {
            p.categoryId = (v as any)?.connect?.id ?? p.categoryId;
            continue;
          }
          // Apenas seta chaves que vieram — mesmo comportamento do Prisma real.
          (p as any)[k] = v;
        }
        return { id: p.id, name: p.name };
      }),
      delete: vi.fn(async () => {
        db.deletionCalls += 1;
        throw new Error('DELETE não deve ser chamado pelo bulkImport!');
      }),
      deleteMany: vi.fn(async () => {
        db.deletionCalls += 1;
        throw new Error('DELETE_MANY não deve ser chamado pelo bulkImport!');
      }),
      count: vi.fn(async () => db.products.length),
      findMany: vi.fn(async () => db.products.slice()),
    },
    category: {
      findFirst: vi.fn(async ({ where }: { where: { name: { equals: string; mode: string } } }) => {
        const q = where.name.equals.toLowerCase();
        return db.categories.find((c) => c.name.toLowerCase() === q) ?? null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return db.categories.find((c) => c.id === where.id) ?? null;
      }),
    },
    productImage: {
      delete: vi.fn(async () => {
        db.deletionCalls += 1;
        throw new Error('DELETE de imagem não deve ser chamado pelo bulkImport!');
      }),
      // R19-C — mocks presentes para o service (o create/update usa
      // $transaction agora). Esses testes não passam `imageUrl`, então
      // nunca são chamados; se forem, quebramos.
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => { throw new Error('productImage.create inesperado nos testes R19-A'); }),
      update: vi.fn(async () => { throw new Error('productImage.update inesperado nos testes R19-A'); }),
    },
  // R19-C — bulkImport agora agrupa create/update + imagem numa transação
  // por linha. Sem rollback nos testes R19-A: executa callback com o mock.
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
});

// Só importar DEPOIS de mockar.
const { productsService } = await import('./products.service');

describe('productsService.bulkImport (R19-A)', () => {
  beforeEach(() => {
    reset();
    db.categories.push({ id: 'cat_fila', name: 'Filamentos' });
    db.categories.push({ id: 'cat_imp', name: 'Impressoras' });
    db.categories.push({ id: 'cat_bico', name: 'Bicos' });
  });

  function seedCatalog() {
    // 20 filamentos 3D Prime + 4 impressoras + 3 bicos (equivalente ao cenário do cliente).
    for (let i = 1; i <= 20; i++) {
      db.products.push({
        id: nextId('prod'),
        name: `Filamento 3D Prime Cor ${i}`,
        slug: `filamento-3d-prime-cor-${i}`,
        sku: null,
        price: 100 + i,
        promotionalPrice: null,
        stock: 10,
        shortDescription: `Filamento cor ${i}`,
        description: 'PLA 3D Prime',
        brand: '3D Prime',
        material: 'PLA',
        active: true,
        featured: false,
        categoryId: 'cat_fila',
      });
    }
    for (let i = 1; i <= 4; i++) {
      db.products.push({
        id: nextId('prod'),
        name: `Impressora ${i}`, slug: `impressora-${i}`, sku: null,
        price: 3000, promotionalPrice: null, stock: 2,
        shortDescription: null, description: null, brand: null, material: null,
        active: true, featured: false, categoryId: 'cat_imp',
      });
    }
    for (let i = 1; i <= 3; i++) {
      db.products.push({
        id: nextId('prod'),
        name: `Bico ${i}`, slug: `bico-${i}`, sku: null,
        price: 25, promotionalPrice: null, stock: 50,
        shortDescription: null, description: null, brand: null, material: null,
        active: true, featured: false, categoryId: 'cat_imp',
      });
    }
  }

  it('CENÁRIO A — importar novos produtos preserva os 27 já existentes', async () => {
    seedCatalog();
    const rowsAntes = db.products.length;
    expect(rowsAntes).toBe(27);

    const rows = Array.from({ length: 15 }, (_, i) => ({
      line: i + 2,
      name: `Masterprint PLA Tom ${i + 1}`,
      categoryName: 'Filamentos',
      price: 129.9,
      stock: 5,
    }));
    const report = await productsService.bulkImport({ rows });

    expect(report.summary).toMatchObject({ total: 15, created: 15, updated: 0, conflicts: 0 });
    expect(db.products).toHaveLength(27 + 15);
    // Todos os 27 originais continuam presentes, com dados intactos.
    const originaisIntactos = db.products.filter((p) => p.name.startsWith('Filamento 3D Prime')).length;
    expect(originaisIntactos).toBe(20);
    expect(db.deletionCalls).toBe(0);
  });

  it('CENÁRIO D — nome idêntico sem id/sku/slug NÃO sobrescreve; vira conflito', async () => {
    db.products.push({
      id: 'prod_pla_preto', name: 'PLA Preto', slug: 'pla-preto', sku: null,
      price: 100, promotionalPrice: null, stock: 5,
      shortDescription: 'Bobina PLA preto', description: 'Textão',
      // Fixture reproduz o estado defeituoso HERDADO (bug antigo): material
      // carregando a MARCA. R19-B corrige o futuro; testes R19-A validam que
      // esse dado histórico não é sobrescrito por colisão de slug.
      brand: null, material: '3D Prime', active: true, featured: false, categoryId: 'cat_fila',
    });

    const report = await productsService.bulkImport({
      rows: [{ line: 2, name: 'PLA Preto', categoryName: 'Filamentos', price: 199, stock: 8 }],
    });

    expect(report.summary).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    // Produto original inalterado — nada de sobrescrita silenciosa.
    const original = db.products.find((p) => p.id === 'prod_pla_preto')!;
    expect(original).toMatchObject({ name: 'PLA Preto', price: 100, stock: 5, material: '3D Prime' });
    expect(report.conflicts[0]).toMatchObject({ line: 2, name: 'PLA Preto' });
    expect(report.conflicts[0].reason).toMatch(/slug derivado|pla-preto/i);
    expect(db.deletionCalls).toBe(0);
  });

  it('CENÁRIO B — update parcial preserva imagem/descrição não enviadas', async () => {
    db.products.push({
      id: 'prod_a', name: 'PLA Preto', slug: 'pla-preto', sku: 'SKU-A',
      price: 100, promotionalPrice: null, stock: 5,
      shortDescription: 'Curta', description: 'Longa',
      brand: '3D Prime', material: 'PLA', active: true, featured: false, categoryId: 'cat_fila',
    });

    // Planilha só traz preço e estoque (colunas de descrição/promoção vazias).
    const report = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', price: 110, stock: 8 }],
    });

    expect(report.summary).toMatchObject({ updated: 1, created: 0, conflicts: 0 });
    const p = db.products.find((x) => x.id === 'prod_a')!;
    expect(p.price).toBe(110);
    expect(p.stock).toBe(8);
    // PRESERVADOS — a linha não trouxe esses campos.
    expect(p.shortDescription).toBe('Curta');
    expect(p.description).toBe('Longa');
    expect(p.material).toBe('PLA');
    expect(p.promotionalPrice).toBe(null);
  });

  it('CENÁRIO C — reimportar a mesma planilha não duplica (matching por sku)', async () => {
    const row = {
      line: 2, name: 'Novo Filamento', sku: 'MP-001',
      categoryName: 'Filamentos', price: 99.9, stock: 10,
    };

    const r1 = await productsService.bulkImport({ rows: [row] });
    expect(r1.summary).toMatchObject({ created: 1, updated: 0 });
    expect(db.products).toHaveLength(1);

    const r2 = await productsService.bulkImport({ rows: [row] });
    // 2ª rodada bateu no SKU e apenas atualizou — nada de duplicata.
    expect(r2.summary).toMatchObject({ created: 0, updated: 1 });
    expect(db.products).toHaveLength(1);
  });

  it('ESTOQUE — 0 explícito é aplicado', async () => {
    db.products.push({
      id: 'prod_est', name: 'Item Est', slug: 'item-est', sku: 'EST-1',
      price: 10, promotionalPrice: null, stock: 10,
      shortDescription: null, description: null, brand: null, material: null,
      active: true, featured: false, categoryId: 'cat_fila',
    });

    const report = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'EST-1', stock: 0 }],
    });
    expect(report.summary.updated).toBe(1);
    expect(db.products[0].stock).toBe(0);
  });

  it('ESTOQUE — vazio (undefined) NÃO altera o valor atual', async () => {
    db.products.push({
      id: 'prod_est2', name: 'Item Est 2', slug: 'item-est-2', sku: 'EST-2',
      price: 10, promotionalPrice: null, stock: 10,
      shortDescription: null, description: null, brand: null, material: null,
      active: true, featured: false, categoryId: 'cat_fila',
    });

    const report = await productsService.bulkImport({
      // stock ausente = undefined = preservar.
      rows: [{ line: 2, sku: 'EST-2', price: 15 }],
    });
    expect(report.summary.updated).toBe(1);
    expect(db.products[0].stock).toBe(10); // preservado
    expect(db.products[0].price).toBe(15);
  });

  it('ID válido atualiza exatamente aquele produto', async () => {
    db.products.push({
      id: 'prod_id_ok', name: 'Item ID', slug: 'item-id', sku: null,
      price: 50, promotionalPrice: null, stock: 3,
      shortDescription: null, description: null, brand: null, material: null,
      active: true, featured: false, categoryId: 'cat_fila',
    });
    db.products.push({
      id: 'prod_outro', name: 'Outro', slug: 'outro', sku: null,
      price: 200, promotionalPrice: null, stock: 1,
      shortDescription: null, description: null, brand: null, material: null,
      active: true, featured: false, categoryId: 'cat_fila',
    });

    const report = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod_id_ok', price: 55 }],
    });
    expect(report.summary).toMatchObject({ updated: 1, created: 0, conflicts: 0 });
    expect(db.products.find((p) => p.id === 'prod_id_ok')!.price).toBe(55);
    expect(db.products.find((p) => p.id === 'prod_outro')!.price).toBe(200);
    expect(db.products).toHaveLength(2);
  });

  it('ID inexistente vira CONFLITO — não sobrescreve outro produto', async () => {
    db.products.push({
      id: 'prod_real', name: 'Real', slug: 'real', sku: null,
      price: 30, promotionalPrice: null, stock: 1,
      shortDescription: null, description: null, brand: null, material: null,
      active: true, featured: false, categoryId: 'cat_fila',
    });

    const report = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod_fantasma', name: 'Fantasma', price: 999 }],
    });
    expect(report.summary).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(report.conflicts[0]).toMatchObject({ line: 2, identifier: 'prod_fantasma' });
    // Produto real segue intacto e nada de novo foi criado com id fantasma.
    expect(db.products).toHaveLength(1);
    expect(db.products[0]).toMatchObject({ id: 'prod_real', price: 30 });
  });

  it('SEGURANÇA — nenhum caminho chama delete/deleteMany', async () => {
    seedCatalog();
    await productsService.bulkImport({
      rows: [
        { line: 2, name: 'PLA Preto', categoryName: 'Filamentos', price: 100 }, // conflito
        { line: 3, name: 'Novo Único', categoryName: 'Filamentos', price: 100 }, // created
        { line: 4, id: 'prod_inexistente', price: 999 }, // conflito
      ],
    });
    expect(db.deletionCalls).toBe(0);
  });
});
