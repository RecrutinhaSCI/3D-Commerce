/**
 * R19-D — Auditoria de importação por Excel.
 *
 * Cobre os cenários mandatórios exigidos na revisão de segurança da importação:
 *  §1  Importação inicial cria produtos novos.
 *  §2  Segunda planilha com um único produto não mexe nos demais.
 *  §3  Células vazias preservam campos existentes.
 *  §4  Colunas ausentes preservam campos existentes.
 *  §5  Imagem existente é preservada quando planilha não traz imagem;
 *      atualizada quando planilha traz imagem válida.
 *  §6  Marca e material são independentes.
 *  §7  Estoque 0 explícito atualiza; vazio preserva.
 *  §8  Booleanos: `true`/`false` explícitos aplicam; vazio preserva.
 *  §9  Novos + existentes juntos em um mesmo lote.
 *  §10 SKU duplicado dentro da própria planilha é bloqueado (nenhuma linha
 *      envolvida é aplicada).
 *  §11 Conflito de identidade (ID e SKU apontam para produtos diferentes)
 *      vira conflito explícito.
 *  §12 Linha inválida no meio não derruba as demais (documenta que a
 *      transação vive DENTRO da linha — cada linha é atômica).
 *  §13 Reimportação da mesma planilha não duplica.
 *  §14 Ordem das linhas não altera o resultado final.
 *  §15 Edição manual entre importações é preservada quando a nova planilha
 *      não traz aquelas colunas.
 *
 * O fake in-memory abaixo simula o Prisma o suficiente para exercitar a
 * lógica sem tocar em banco real (nem local, nem produção).
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
interface FakeImage {
  id: string;
  productId: string;
  url: string;
  alt: string;
  position: number;
  mediaType: string;
  mimeType: string | null;
}
interface FakeCategory { id: string; name: string; }

const db = {
  products: [] as FakeProduct[],
  images: [] as FakeImage[],
  categories: [] as FakeCategory[],
  deletionCalls: 0,
};

function reset() {
  db.products = [];
  db.images = [];
  db.categories = [];
  db.deletionCalls = 0;
}
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
      };
      db.products.push(p);
      return { id: p.id, name: p.name };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = db.products.find((x) => x.id === where.id);
      if (!p) throw new Error('not found');
      for (const [k, v] of Object.entries(data)) {
        if (k === 'category') { p.categoryId = (v as any)?.connect?.id ?? p.categoryId; continue; }
        (p as any)[k] = v;
      }
      return { id: p.id, name: p.name };
    }),
    delete: vi.fn(async () => { db.deletionCalls += 1; throw new Error('DELETE inesperado'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls += 1; throw new Error('DELETE_MANY inesperado'); }),
  },
  category: {
    findFirst: vi.fn(async ({ where }: any) => {
      const q = where.name.equals.toLowerCase();
      return db.categories.find((c) => c.name.toLowerCase() === q) ?? null;
    }),
  },
  productImage: {
    findMany: vi.fn(async ({ where }: any) => {
      return db.images
        .filter((i) => i.productId === where.productId)
        .sort((a, b) => a.position - b.position);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const img of db.images) {
        if (img.productId !== where.productId) continue;
        if (data.position?.increment !== undefined) img.position += data.position.increment;
        count++;
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const img = db.images.find((i) => i.id === where.id);
      if (!img) throw new Error('img not found');
      for (const [k, v] of Object.entries(data)) (img as any)[k] = v;
      return img;
    }),
    create: vi.fn(async ({ data }: any) => {
      const img: FakeImage = {
        id: nid('img'),
        productId: data.productId,
        url: data.url,
        alt: data.alt ?? '',
        position: data.position ?? 0,
        mediaType: data.mediaType ?? 'image',
        mimeType: data.mimeType ?? null,
      };
      db.images.push(img);
      return img;
    }),
    delete: vi.fn(async () => { db.deletionCalls += 1; throw new Error('DELETE de imagem inesperado'); }),
  },
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
});

const { productsService } = await import('./products.service');

describe('bulkImport — auditoria R19-D (cenários mandatórios)', () => {
  beforeEach(() => {
    reset();
    db.categories.push({ id: 'cat_fila', name: 'Filamentos' });
    db.categories.push({ id: 'cat_imp', name: 'Impressoras' });
  });

  function seedThree() {
    db.products.push(
      {
        id: 'p-a', name: 'Produto A', slug: 'produto-a', sku: 'SKU-A',
        price: 100, promotionalPrice: null, stock: 5,
        shortDescription: 'curta A', description: 'longa A',
        brand: 'MarcaA', material: 'PLA', active: true, featured: false, categoryId: 'cat_fila',
      },
      {
        id: 'p-b', name: 'Produto B', slug: 'produto-b', sku: 'SKU-B',
        price: 200, promotionalPrice: null, stock: 8,
        shortDescription: 'curta B', description: 'longa B',
        brand: 'MarcaB', material: 'PETG', active: true, featured: false, categoryId: 'cat_fila',
      },
      {
        id: 'p-c', name: 'Produto C', slug: 'produto-c', sku: 'SKU-C',
        price: 300, promotionalPrice: null, stock: 3,
        shortDescription: 'curta C', description: 'longa C',
        brand: 'MarcaC', material: 'ABS', active: true, featured: false, categoryId: 'cat_fila',
      },
    );
  }

  // §1 -----------------------------------------------------------------
  it('§1 importação inicial cria os 3 produtos', async () => {
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, name: 'Produto A', categoryName: 'Filamentos', sku: 'SKU-A', price: 100, stock: 5, brand: 'MarcaA', material: 'PLA' },
        { line: 3, name: 'Produto B', categoryName: 'Filamentos', sku: 'SKU-B', price: 200, stock: 8, brand: 'MarcaB', material: 'PETG' },
        { line: 4, name: 'Produto C', categoryName: 'Filamentos', sku: 'SKU-C', price: 300, stock: 3, brand: 'MarcaC', material: 'ABS' },
      ],
    });
    expect(r.summary).toMatchObject({ total: 3, created: 3, updated: 0, conflicts: 0, skipped: 0 });
    expect(db.products).toHaveLength(3);
  });

  // §2 -----------------------------------------------------------------
  it('§2 segunda planilha só com produto A não mexe em B e C', async () => {
    seedThree();
    const bBefore = { ...db.products.find((p) => p.id === 'p-b')! };
    const cBefore = { ...db.products.find((p) => p.id === 'p-c')! };
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', price: 111 }],
    });
    expect(r.summary).toMatchObject({ updated: 1, created: 0, conflicts: 0 });
    expect(db.products.find((p) => p.id === 'p-a')!.price).toBe(111);
    expect(db.products.find((p) => p.id === 'p-b')!).toEqual(bBefore);
    expect(db.products.find((p) => p.id === 'p-c')!).toEqual(cBefore);
  });

  // §3 -----------------------------------------------------------------
  it('§3 planilha só com SKU + estoque não altera demais campos', async () => {
    seedThree();
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', stock: 42 }],
    });
    expect(r.summary.updated).toBe(1);
    const a = db.products.find((p) => p.id === 'p-a')!;
    expect(a.stock).toBe(42);
    // TODOS os demais preservados
    expect(a).toMatchObject({
      name: 'Produto A', price: 100, brand: 'MarcaA', material: 'PLA',
      shortDescription: 'curta A', description: 'longa A',
      promotionalPrice: null, active: true, featured: false,
    });
  });

  // §4 -----------------------------------------------------------------
  it('§4 colunas ausentes (parser envia só chaves presentes) não zeram campos', async () => {
    seedThree();
    // Simula planilha SEM as colunas de brand/material/descrição: parser só
    // gera as chaves preenchidas.
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', price: 150 } as any],
    });
    expect(r.summary.updated).toBe(1);
    const a = db.products.find((p) => p.id === 'p-a')!;
    expect(a).toMatchObject({ brand: 'MarcaA', material: 'PLA', shortDescription: 'curta A', description: 'longa A' });
  });

  // §5 -----------------------------------------------------------------
  it('§5 imagem: coluna vazia OU ausente preserva; URL nova atualiza principal', async () => {
    seedThree();
    db.images.push(
      { id: 'i1', productId: 'p-a', url: '/uploads/products/a.jpg', alt: '', position: 0, mediaType: 'image', mimeType: null },
      { id: 'i2', productId: 'p-a', url: '/uploads/products/a2.jpg', alt: '', position: 1, mediaType: 'image', mimeType: null },
    );

    // (a) coluna ausente
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', price: 105 }] });
    let imgs = db.images.filter((i) => i.productId === 'p-a').sort((x, y) => x.position - y.position);
    expect(imgs.map((i) => i.url)).toEqual(['/uploads/products/a.jpg', '/uploads/products/a2.jpg']);

    // (b) valor válido atualiza principal, empurra as demais
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', imageUrl: 'https://cdn/nova.jpg' }] });
    imgs = db.images.filter((i) => i.productId === 'p-a').sort((x, y) => x.position - y.position);
    expect(imgs[0].url).toBe('https://cdn/nova.jpg');
    expect(imgs.some((i) => i.url === '/uploads/products/a.jpg')).toBe(true);
    expect(imgs.some((i) => i.url === '/uploads/products/a2.jpg')).toBe(true);
  });

  // §6 -----------------------------------------------------------------
  it('§6 alterar material não altera marca (e vice-versa)', async () => {
    seedThree();
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', material: 'PETG' }] });
    let a = db.products.find((p) => p.id === 'p-a')!;
    expect(a.material).toBe('PETG');
    expect(a.brand).toBe('MarcaA');
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', brand: 'MarcaX' }] });
    a = db.products.find((p) => p.id === 'p-a')!;
    expect(a.brand).toBe('MarcaX');
    expect(a.material).toBe('PETG');
  });

  // §7 -----------------------------------------------------------------
  it('§7 estoque 0 explícito grava zero; estoque ausente preserva', async () => {
    seedThree();
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', stock: 0 }] });
    expect(db.products.find((p) => p.id === 'p-a')!.stock).toBe(0);
    await productsService.bulkImport({ rows: [{ line: 3, sku: 'SKU-B', price: 210 }] });
    expect(db.products.find((p) => p.id === 'p-b')!.stock).toBe(8); // preservado
  });

  // §8 -----------------------------------------------------------------
  it('§8 booleanos: true/false explícitos aplicam; ausente preserva', async () => {
    seedThree();
    // active=false explícito
    await productsService.bulkImport({ rows: [{ line: 2, sku: 'SKU-A', active: false }] });
    expect(db.products.find((p) => p.id === 'p-a')!.active).toBe(false);
    // featured=true explícito não muda o active
    await productsService.bulkImport({ rows: [{ line: 3, sku: 'SKU-B', featured: true }] });
    const b = db.products.find((p) => p.id === 'p-b')!;
    expect(b.featured).toBe(true);
    expect(b.active).toBe(true);
    // planilha sem booleanos preserva
    await productsService.bulkImport({ rows: [{ line: 4, sku: 'SKU-C', price: 305 }] });
    const c = db.products.find((p) => p.id === 'p-c')!;
    expect(c.active).toBe(true);
    expect(c.featured).toBe(false);
  });

  // §9 -----------------------------------------------------------------
  it('§9 mistura de existentes + novos em um mesmo lote', async () => {
    seedThree();
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, sku: 'SKU-A', price: 110 },                                           // update A
        { line: 3, sku: 'SKU-B', stock: 20 },                                            // update B
        { line: 4, name: 'Novo D', categoryName: 'Filamentos', sku: 'SKU-D', price: 88 }, // novo D
        { line: 5, name: 'Novo E', categoryName: 'Filamentos', sku: 'SKU-E', price: 99 }, // novo E
      ],
    });
    expect(r.summary).toMatchObject({ updated: 2, created: 2, conflicts: 0 });
    expect(db.products).toHaveLength(5);
  });

  // §10 ----------------------------------------------------------------
  it('§10 SKU duplicado dentro da planilha bloqueia AMBAS as linhas', async () => {
    seedThree();
    const before = { ...db.products.find((p) => p.id === 'p-a')! };
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, sku: 'SKU-A', price: 999 },
        { line: 3, sku: 'SKU-A', price: 888 },
      ],
    });
    expect(r.summary).toMatchObject({ updated: 0, created: 0, conflicts: 2 });
    // Nada foi alterado
    expect(db.products.find((p) => p.id === 'p-a')!).toEqual(before);
    // Mensagem clara para o admin
    expect(r.conflicts.every((c) => /SKU duplicado/i.test(c.reason ?? ''))).toBe(true);
  });

  // §11 ----------------------------------------------------------------
  it('§11 conflito ID+SKU apontando para produtos diferentes vira conflito', async () => {
    seedThree();
    const aBefore = { ...db.products.find((p) => p.id === 'p-a')! };
    const bBefore = { ...db.products.find((p) => p.id === 'p-b')! };
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'p-a', sku: 'SKU-B', price: 999 }],
    });
    expect(r.summary).toMatchObject({ updated: 0, created: 0, conflicts: 1 });
    expect(r.conflicts[0].reason).toMatch(/Conflito de identidade/i);
    // NENHUM dos dois produtos foi alterado
    expect(db.products.find((p) => p.id === 'p-a')!).toEqual(aBefore);
    expect(db.products.find((p) => p.id === 'p-b')!).toEqual(bBefore);
  });

  // §12 ----------------------------------------------------------------
  it('§12 linha inválida no meio não afeta as linhas válidas (atomicidade por linha)', async () => {
    seedThree();
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, sku: 'SKU-A', price: 105 },
        { line: 3, sku: 'SKU-B', imageUrl: 'javascript:alert(1)' }, // inválida — conflict
        { line: 4, sku: 'SKU-C', price: 305 },
      ],
    });
    expect(r.summary).toMatchObject({ updated: 2, conflicts: 1 });
    expect(db.products.find((p) => p.id === 'p-a')!.price).toBe(105);
    expect(db.products.find((p) => p.id === 'p-c')!.price).toBe(305);
    // B preservado — nem preço nem imagem foram tocados
    expect(db.products.find((p) => p.id === 'p-b')!.price).toBe(200);
  });

  // §13 ----------------------------------------------------------------
  it('§13 reimportar a mesma planilha não duplica nem corrompe', async () => {
    const planilha = [
      { line: 2, name: 'Produto A', categoryName: 'Filamentos', sku: 'SKU-A', price: 100, stock: 5, brand: 'MarcaA', material: 'PLA' },
      { line: 3, name: 'Produto B', categoryName: 'Filamentos', sku: 'SKU-B', price: 200, stock: 8, brand: 'MarcaB', material: 'PETG' },
    ];
    const r1 = await productsService.bulkImport({ rows: planilha });
    expect(r1.summary).toMatchObject({ created: 2, updated: 0 });

    const snap = db.products.map((p) => ({ ...p }));
    const r2 = await productsService.bulkImport({ rows: planilha });
    expect(r2.summary).toMatchObject({ created: 0, updated: 2, conflicts: 0 });
    expect(db.products).toHaveLength(2);
    // Estado final idêntico (nada zerado nem duplicado)
    for (const before of snap) {
      const after = db.products.find((p) => p.id === before.id)!;
      expect(after).toMatchObject({
        name: before.name, sku: before.sku, price: before.price, stock: before.stock,
        brand: before.brand, material: before.material,
      });
    }
    expect(db.deletionCalls).toBe(0);
  });

  // §14 ----------------------------------------------------------------
  it('§14 ordem das linhas não altera o resultado final', async () => {
    const rows1 = [
      { line: 2, name: 'Produto A', categoryName: 'Filamentos', sku: 'SKU-A', price: 100, stock: 5, brand: 'MarcaA' },
      { line: 3, name: 'Produto B', categoryName: 'Filamentos', sku: 'SKU-B', price: 200, stock: 8, brand: 'MarcaB' },
      { line: 4, name: 'Produto C', categoryName: 'Filamentos', sku: 'SKU-C', price: 300, stock: 3, brand: 'MarcaC' },
    ];
    await productsService.bulkImport({ rows: rows1 });
    const snap1 = db.products
      .map((p) => ({ ...p, id: '' })) // ignora ids gerados
      .sort((a, b) => a.sku!.localeCompare(b.sku!));

    reset();
    db.categories.push({ id: 'cat_fila', name: 'Filamentos' });
    const rows2 = [rows1[2], rows1[0], rows1[1]]; // ordem diferente
    await productsService.bulkImport({ rows: rows2 });
    const snap2 = db.products
      .map((p) => ({ ...p, id: '' }))
      .sort((a, b) => a.sku!.localeCompare(b.sku!));

    expect(snap2).toEqual(snap1);
  });

  // §15 ----------------------------------------------------------------
  it('§15 edições manuais entre importações são preservadas', async () => {
    seedThree();
    // Admin editou manualmente descrição/imagem de A depois da importação
    // inicial (simulamos pela mutação direta):
    const a = db.products.find((p) => p.id === 'p-a')!;
    a.description = 'Descrição escrita manualmente pelo admin';
    a.material = 'PETG-CF'; // mudou material via ProductForm
    db.images.push({
      id: 'edit-img', productId: 'p-a', url: '/uploads/products/manual.jpg',
      alt: '', position: 0, mediaType: 'image', mimeType: null,
    });

    // Nova importação: apenas SKU + preço + estoque
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', price: 199, stock: 12 }],
    });
    expect(r.summary.updated).toBe(1);

    const a2 = db.products.find((p) => p.id === 'p-a')!;
    expect(a2.price).toBe(199);
    expect(a2.stock).toBe(12);
    // Edições manuais preservadas
    expect(a2.description).toBe('Descrição escrita manualmente pelo admin');
    expect(a2.material).toBe('PETG-CF');
    // Imagem preservada — nenhuma mexida na galeria
    const imgs = db.images.filter((i) => i.productId === 'p-a');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].url).toBe('/uploads/products/manual.jpg');
  });

  // Fluxo integrado A → B → C ------------------------------------------
  it('fluxo A→B→C completo (catálogo inicial + update parcial + novos)', async () => {
    // A: catálogo inicial (3 produtos)
    await productsService.bulkImport({
      rows: [
        { line: 2, name: 'Produto A', categoryName: 'Filamentos', sku: 'SKU-A', price: 100, stock: 5, brand: 'MarcaA', material: 'PLA', description: 'desc A' },
        { line: 3, name: 'Produto B', categoryName: 'Filamentos', sku: 'SKU-B', price: 200, stock: 8, brand: 'MarcaB', material: 'PETG', description: 'desc B' },
        { line: 4, name: 'Produto C', categoryName: 'Filamentos', sku: 'SKU-C', price: 300, stock: 3, brand: 'MarcaC', material: 'ABS', description: 'desc C' },
      ],
    });
    expect(db.products).toHaveLength(3);

    // B: update parcial de A (só preço)
    await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-A', price: 149 }],
    });
    const aAfterB = db.products.find((p) => p.sku === 'SKU-A')!;
    expect(aAfterB).toMatchObject({ price: 149, stock: 5, brand: 'MarcaA', material: 'PLA', description: 'desc A' });
    expect(db.products.find((p) => p.sku === 'SKU-B')).toMatchObject({ price: 200, stock: 8 });
    expect(db.products.find((p) => p.sku === 'SKU-C')).toMatchObject({ price: 300, stock: 3 });

    // C: novos produtos + update em B
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, sku: 'SKU-B', stock: 30 }, // update B
        { line: 3, name: 'Produto D', categoryName: 'Filamentos', sku: 'SKU-D', price: 400, stock: 2 }, // novo
        { line: 4, name: 'Produto E', categoryName: 'Filamentos', sku: 'SKU-E', price: 500, stock: 1 }, // novo
      ],
    });
    expect(r.summary).toMatchObject({ updated: 1, created: 2, conflicts: 0 });
    expect(db.products).toHaveLength(5);
    expect(db.products.find((p) => p.sku === 'SKU-B')).toMatchObject({ price: 200, stock: 30, description: 'desc B' });
    // A e C absolutamente intactos
    expect(db.products.find((p) => p.sku === 'SKU-A')).toMatchObject(aAfterB);
    expect(db.products.find((p) => p.sku === 'SKU-C')).toMatchObject({ price: 300, stock: 3, description: 'desc C' });

    expect(db.deletionCalls).toBe(0);
  });
});
