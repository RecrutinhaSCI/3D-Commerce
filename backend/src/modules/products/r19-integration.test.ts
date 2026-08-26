/**
 * R19-D — Teste de INTEGRAÇÃO das três rodadas juntas.
 *
 * Não substitui os testes unitários; complementa-os simulando o fluxo real
 * "importar → reimportar → export/import → editar" sobre o mesmo banco fake.
 *
 * Cenários cobertos (equivalentes ao roteiro R19-D):
 *   §2/§3   catálogo inicial (A, B, C) + import só de D
 *   §4      reimport da mesma planilha → sem duplicação
 *   §5      export de A, edita só preço/estoque, reimport
 *   §6      A com todas as células vazias exceto preço
 *   §7      estoque explícito 0
 *   §8/§9   update só de material / só de brand (via service.update)
 *   §10     nova imagem principal preserva galeria
 *   §11     promoção de imagem secundária
 *   §12     URL inválida no meio do lote não derruba o resto
 *   §13     colisão de nome sem id/sku/slug → conflito seguro
 *   §14     ID válido atualiza exatamente aquele produto
 *   §15     ID inválido vira conflito
 *   §17     export → import completo (roundtrip)
 *   §18     planilha antiga com só "Marca"
 *   §32     nenhum produto/imagem some por ausência no Excel
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Media = { id: string; productId: string; url: string; alt: string | null; position: number; mediaType: string; mimeType: string | null };
type Prod = {
  id: string; name: string; slug: string; sku: string | null;
  price: number; promotionalPrice: number | null;
  brand: string | null; material: string | null;
  stock: number; active: boolean; featured: boolean;
  shortDescription: string | null; description: string | null;
  color: string | null; printTime: string | null;
  weight: number | null; width: number | null; height: number | null; depth: number | null;
  purchaseMode: 'DIRECT' | 'QUOTE' | 'BOTH';
  categoryId: string;
  createdAt: Date; updatedAt: Date;
  images: Media[];
  category: { id: string; name: string; slug: string } | null;
};

const db = {
  products: [] as Prod[],
  images: [] as Media[],
  categories: [] as { id: string; name: string }[],
  deletionCalls: 0,
};

function nid(p: string) { return `${p}_${Math.random().toString(36).slice(2, 10)}`; }

function makeProd(x: Partial<Prod>): Prod {
  return {
    id: x.id ?? nid('prod'),
    name: x.name ?? 'X', slug: x.slug ?? 'x', sku: x.sku ?? null,
    price: x.price ?? 100, promotionalPrice: x.promotionalPrice ?? null,
    brand: x.brand ?? null, material: x.material ?? null,
    stock: x.stock ?? 0, active: x.active ?? true, featured: x.featured ?? false,
    shortDescription: x.shortDescription ?? null, description: x.description ?? null,
    color: null, printTime: null, weight: null, width: null, height: null, depth: null,
    purchaseMode: 'DIRECT', categoryId: x.categoryId ?? 'cat_fila',
    createdAt: new Date(), updatedAt: new Date(),
    images: [], category: { id: 'cat_fila', name: 'Filamentos', slug: 'filamentos' },
  };
}

function snapshot() { return { p: db.products.map((x) => ({ ...x })), i: db.images.map((x) => ({ ...x })) }; }
function restore(s: ReturnType<typeof snapshot>) { db.products = s.p; db.images = s.i; }

const mock: any = {};
vi.mock('../../lib/prisma', () => ({ prisma: mock }));
Object.assign(mock, {
  product: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return db.products.find((p) => p.id === where.id) ?? null;
      if (where.slug) return db.products.find((p) => p.slug === where.slug) ?? null;
      return null;
    }),
    findFirst: vi.fn(async ({ where }: any) => db.products.find((p) => {
      if (where.sku !== undefined && p.sku !== where.sku) return false;
      if (where.slug !== undefined && p.slug !== where.slug) return false;
      if (where.id?.not && p.id === where.id.not) return false;
      return true;
    }) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const p = makeProd({
        name: data.name, slug: data.slug, sku: data.sku ?? null,
        price: Number(data.price), brand: data.brand ?? null, material: data.material ?? null,
        stock: data.stock ?? 0,
        shortDescription: data.shortDescription ?? null, description: data.description ?? null,
        categoryId: data.category?.connect?.id ?? 'cat_fila',
      });
      db.products.push(p);
      return p;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = db.products.find((x) => x.id === where.id);
      if (!p) throw new Error(`no product ${where.id}`);
      for (const [k, v] of Object.entries(data)) {
        if (k === 'category') { p.categoryId = (v as any)?.connect?.id ?? p.categoryId; continue; }
        (p as any)[k] = v;
      }
      p.updatedAt = new Date();
      return p;
    }),
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('delete produto proibido'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls++; throw new Error('deleteMany proibido'); }),
  },
  productImage: {
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      const list = db.images.filter((i) => i.productId === where.productId);
      if (orderBy?.position === 'asc') list.sort((a, b) => a.position - b.position);
      return list;
    }),
    create: vi.fn(async ({ data }: any) => {
      const img: Media = {
        id: nid('img'), productId: data.productId, url: data.url,
        alt: data.alt ?? null, position: data.position ?? 0,
        mediaType: data.mediaType ?? 'image', mimeType: data.mimeType ?? null,
      };
      db.images.push(img);
      return img;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const img = db.images.find((i) => i.id === where.id);
      if (!img) throw new Error('no image');
      for (const [k, v] of Object.entries(data)) (img as any)[k] = v;
      return img;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const img of db.images) {
        if (img.productId !== where.productId) continue;
        if (data.position?.increment != null) img.position += data.position.increment;
        else if (data.position != null) img.position = data.position;
        count++;
      }
      return { count };
    }),
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('delete de imagem proibido'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls++; throw new Error('deleteMany imagem proibido'); }),
  },
  category: {
    findFirst: vi.fn(async ({ where }: any) => db.categories.find((c) => c.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null),
    findUnique: vi.fn(async ({ where }: any) => db.categories.find((c) => c.id === where.id) ?? null),
  },
  $transaction: vi.fn(async (fn: any) => {
    const s = snapshot();
    try { return await fn(mock); } catch (e) { restore(s); throw e; }
  }),
});

const { productsService } = await import('./products.service');

function bootstrapCatalog() {
  db.categories.push({ id: 'cat_fila', name: 'Filamentos' });
  db.categories.push({ id: 'cat_imp', name: 'Impressoras' });
  db.categories.push({ id: 'cat_bico', name: 'Bicos' });

  db.products.push(makeProd({
    id: 'prod-a', name: 'PLA Premium HT Verde', slug: 'pla-premium-ht-verde',
    sku: '3DP-PLA-VERDE', brand: '3D Prime', material: 'PLA',
    price: 100, stock: 5, description: 'Descrição original', shortDescription: 'HT Verde',
    categoryId: 'cat_fila',
  }));
  db.images.push(
    { id: nid('img'), productId: 'prod-a', url: 'https://cdn/principal-a.jpg', alt: 'A', position: 0, mediaType: 'image', mimeType: null },
    { id: nid('img'), productId: 'prod-a', url: 'https://cdn/lateral-a.jpg', alt: 'A', position: 1, mediaType: 'image', mimeType: null },
    { id: nid('img'), productId: 'prod-a', url: 'https://cdn/detalhe-a.jpg', alt: 'A', position: 2, mediaType: 'image', mimeType: null },
  );
  db.products.push(makeProd({
    id: 'prod-b', name: 'Impressora Creality X', slug: 'impressora-creality-x',
    brand: 'Creality', price: 3200, stock: 2, categoryId: 'cat_imp',
  }));
  db.products.push(makeProd({
    id: 'prod-c', name: 'Bico 0.4mm Creality', slug: 'bico-04mm-creality',
    brand: 'Creality', price: 35, stock: 50, categoryId: 'cat_bico',
  }));
}

function bcSnapshot() {
  const b = db.products.find((p) => p.id === 'prod-b')!;
  const c = db.products.find((p) => p.id === 'prod-c')!;
  return { b: { ...b }, c: { ...c } };
}

describe('R19-D — integração das três rodadas', () => {
  beforeEach(() => {
    db.products = []; db.images = []; db.categories = []; db.deletionCalls = 0;
    bootstrapCatalog();
  });

  it('§3 importar Produto D não toca em A/B/C e cria D com imagem', async () => {
    const before = bcSnapshot();
    const aBefore = { ...db.products.find((p) => p.id === 'prod-a')! };
    const aImages = db.images.filter((i) => i.productId === 'prod-a').length;

    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'PLA Masterprint Preto',
        sku: 'MP-PLA-PRETO', categoryName: 'Filamentos',
        brand: 'Masterprint', material: 'PLA',
        price: 99.9, stock: 10,
        imageUrl: 'https://example.com/masterprint-preto.jpg',
      }],
    });

    expect(r.summary).toMatchObject({ created: 1, updated: 0, conflicts: 0 });
    expect(r.created[0].imageUpdated).toBe(true);
    expect(db.products).toHaveLength(4);

    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toEqual(aBefore);
    expect(db.images.filter((i) => i.productId === 'prod-a')).toHaveLength(aImages);
    expect(db.products.find((p) => p.id === 'prod-b')!).toEqual(before.b);
    expect(db.products.find((p) => p.id === 'prod-c')!).toEqual(before.c);

    const d = db.products.find((p) => p.sku === 'MP-PLA-PRETO')!;
    expect(d).toMatchObject({ brand: 'Masterprint', material: 'PLA', price: 99.9, stock: 10 });
    const dImgs = db.images.filter((i) => i.productId === d.id);
    expect(dImgs).toHaveLength(1);
    expect(dImgs[0]).toMatchObject({ url: 'https://example.com/masterprint-preto.jpg', position: 0, mediaType: 'image' });

    expect(db.deletionCalls).toBe(0);
  });

  it('§4 reimportar a mesma planilha NÃO duplica', async () => {
    const row = {
      line: 2, name: 'PLA Masterprint Preto',
      sku: 'MP-PLA-PRETO', categoryName: 'Filamentos',
      brand: 'Masterprint', material: 'PLA',
      price: 99.9, stock: 10,
      imageUrl: 'https://example.com/masterprint-preto.jpg',
    };
    await productsService.bulkImport({ rows: [row] });
    const totalP = db.products.length;
    const totalI = db.images.length;

    const r = await productsService.bulkImport({ rows: [row] });
    expect(r.summary).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    expect(r.updated[0].imageUpdated).toBeUndefined();
    expect(db.products).toHaveLength(totalP);
    expect(db.images).toHaveLength(totalI);
  });

  it('§5 export A → editar só preço/estoque → reimport preserva demais campos e galeria', async () => {
    const before = bcSnapshot();
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', price: 110, stock: 8 }],
    });
    expect(r.summary.updated).toBe(1);
    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toMatchObject({
      price: 110, stock: 8,
      brand: '3D Prime', material: 'PLA',
      description: 'Descrição original',
    });
    const imgs = db.images.filter((i) => i.productId === 'prod-a').sort((x, y) => x.position - y.position);
    expect(imgs.map((i) => i.url)).toEqual([
      'https://cdn/principal-a.jpg',
      'https://cdn/lateral-a.jpg',
      'https://cdn/detalhe-a.jpg',
    ]);
    expect(db.products.find((p) => p.id === 'prod-b')!).toEqual(before.b);
    expect(db.products.find((p) => p.id === 'prod-c')!).toEqual(before.c);
  });

  it('§6 células vazias com só preço definido — só preço muda', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', price: 120 }],
    });
    expect(r.summary.updated).toBe(1);
    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toMatchObject({
      price: 120, stock: 5,
      brand: '3D Prime', material: 'PLA', description: 'Descrição original',
    });
    expect(db.images.filter((i) => i.productId === 'prod-a')).toHaveLength(3);
  });

  it('§7 estoque explícito 0 é aplicado (0 ≠ vazio)', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', stock: 0 }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products.find((p) => p.id === 'prod-a')!.stock).toBe(0);
  });

  it('§8 update só de material via service.update NÃO altera brand', async () => {
    await productsService.update('prod-a', { material: 'PETG' });
    expect(db.products.find((p) => p.id === 'prod-a')!).toMatchObject({ brand: '3D Prime', material: 'PETG' });
  });

  it('§9 update só de brand via service.update NÃO altera material', async () => {
    await productsService.update('prod-a', { brand: 'Masterprint' });
    expect(db.products.find((p) => p.id === 'prod-a')!).toMatchObject({ brand: 'Masterprint', material: 'PLA' });
  });

  it('§10 nova imagem principal via Excel preserva a galeria antiga', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', imageUrl: 'https://cdn/nova-principal.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(r.updated[0].imageUpdated).toBe(true);
    const imgs = db.images.filter((i) => i.productId === 'prod-a').sort((x, y) => x.position - y.position);
    expect(imgs.map((i) => i.url)).toEqual([
      'https://cdn/nova-principal.jpg',
      'https://cdn/principal-a.jpg',
      'https://cdn/lateral-a.jpg',
      'https://cdn/detalhe-a.jpg',
    ]);
    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toMatchObject({ brand: '3D Prime', material: 'PLA', price: 100, stock: 5 });
  });

  it('§11 promove imagem secundária existente para principal sem duplicar', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', imageUrl: 'https://cdn/lateral-a.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    const imgs = db.images.filter((i) => i.productId === 'prod-a').sort((x, y) => x.position - y.position);
    expect(imgs).toHaveLength(3);
    expect(imgs[0].url).toBe('https://cdn/lateral-a.jpg');
  });

  it('§12 URL inválida no meio do lote não derruba as demais linhas', async () => {
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, id: 'prod-a', imageUrl: 'https://example.com/ok.jpg' },
        { line: 3, id: 'prod-a', imageUrl: 'javascript:alert(1)' },
        { line: 4, id: 'prod-b', imageUrl: '/uploads/products/ok.jpg' },
      ],
    });
    expect(r.summary).toMatchObject({ updated: 2, conflicts: 1 });
    expect(r.conflicts[0].reason).toMatch(/imagem inválida/i);
    expect(db.images.find((i) => i.productId === 'prod-a' && i.position === 0)!.url).toBe('https://example.com/ok.jpg');
    expect(db.images.find((i) => i.productId === 'prod-b')!.url).toBe('/uploads/products/ok.jpg');
  });

  it('§13 colisão de nome sem id/sku/slug vira conflito seguro', async () => {
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'PLA Premium HT Verde', categoryName: 'Filamentos',
        brand: 'Masterprint', price: 90,
      }],
    });
    expect(r.summary).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(r.conflicts[0].reason).toMatch(/slug derivado|pla-premium-ht-verde/i);
    expect(db.products.find((p) => p.id === 'prod-a')!.brand).toBe('3D Prime');
  });

  it('§14 ID válido atualiza EXATAMENTE aquele produto (com imagem)', async () => {
    await productsService.bulkImport({
      rows: [{
        line: 2, name: 'PLA Masterprint Preto', sku: 'MP-PLA-PRETO',
        categoryName: 'Filamentos', brand: 'Masterprint', material: 'PLA', price: 99.9, stock: 10,
        imageUrl: 'https://example.com/masterprint-preto.jpg',
      }],
    });
    const d = db.products.find((p) => p.sku === 'MP-PLA-PRETO')!;
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, id: d.id,
        brand: 'Masterprint Premium', material: 'PETG', price: 115,
        imageUrl: 'https://example.com/masterprint-new.jpg',
      }],
    });
    expect(r.summary.updated).toBe(1);
    const updated = db.products.find((p) => p.id === d.id)!;
    expect(updated).toMatchObject({ brand: 'Masterprint Premium', material: 'PETG', price: 115 });
    const imgs = db.images.filter((i) => i.productId === d.id).sort((a, b) => a.position - b.position);
    expect(imgs[0].url).toBe('https://example.com/masterprint-new.jpg');
    expect(db.products.filter((p) => p.sku === 'MP-PLA-PRETO')).toHaveLength(1);
  });

  it('§15 ID inválido vira conflito sem tocar em nenhum outro produto', async () => {
    const before = db.products.length;
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-nao-existe', name: 'Fantasma', price: 10 }],
    });
    expect(r.summary).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(db.products).toHaveLength(before);
    expect(db.deletionCalls).toBe(0);
  });

  it('§17 export → reimport sem edição não corrompe; depois editando muda só o que foi editado', async () => {
    const r1 = await productsService.bulkImport({
      rows: [{
        line: 2, id: 'prod-a',
        brand: '3D Prime', material: 'PLA', price: 100, stock: 5,
        imageUrl: 'https://cdn/principal-a.jpg',
      }],
    });
    expect(r1.summary.updated).toBe(1);
    expect(r1.updated[0].imageUpdated).toBeUndefined();
    expect(db.images.filter((i) => i.productId === 'prod-a')).toHaveLength(3);

    const r2 = await productsService.bulkImport({
      rows: [{
        line: 2, id: 'prod-a',
        brand: 'Masterprint', material: 'PETG', price: 120, stock: 7,
        imageUrl: 'https://cdn/nova.jpg',
      }],
    });
    expect(r2.updated[0].imageUpdated).toBe(true);
    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toMatchObject({ brand: 'Masterprint', material: 'PETG', price: 120, stock: 7 });
    const imgs = db.images.filter((i) => i.productId === 'prod-a').sort((x, y) => x.position - y.position);
    expect(imgs[0].url).toBe('https://cdn/nova.jpg');
    expect(imgs).toHaveLength(4);
  });

  it('§18 planilha antiga com só Marca NUNCA vira material', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', brand: 'Masterprint' }],
    });
    expect(r.summary.updated).toBe(1);
    const a = db.products.find((p) => p.id === 'prod-a')!;
    expect(a).toMatchObject({ brand: 'Masterprint', material: 'PLA' });
  });

  it('§32 nenhum produto/imagem some por ausência no Excel', async () => {
    const before = {
      total: db.products.length,
      totalImgs: db.images.length,
      b: { ...db.products.find((p) => p.id === 'prod-b')! },
      c: { ...db.products.find((p) => p.id === 'prod-c')! },
    };
    await productsService.bulkImport({
      rows: [{ line: 2, id: 'prod-a', price: 111 }],
    });
    expect(db.products).toHaveLength(before.total);
    expect(db.images).toHaveLength(before.totalImgs);
    expect(db.products.find((p) => p.id === 'prod-b')!).toEqual(before.b);
    expect(db.products.find((p) => p.id === 'prod-c')!).toEqual(before.c);
    expect(db.deletionCalls).toBe(0);
  });
});
