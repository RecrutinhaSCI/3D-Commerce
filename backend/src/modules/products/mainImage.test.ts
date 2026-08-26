/**
 * R19-C — Testes da imagem principal via bulk import.
 * Prisma mockado: NENHUM banco é tocado (nem local, nem produção).
 *
 * Cobertura obrigatória:
 *   Caso 1  Produto novo com URL válida → cria ProductImage position=0.
 *   Caso 2  Produto novo sem URL → nenhum ProductImage é criado.
 *   Caso 3  Produto existente + célula vazia → imagem antiga permanece.
 *   Caso 4  Produto existente + URL nova → nova vira principal, galeria intacta.
 *   Caso 5  URL inválida derruba SOMENTE a linha, lote continua.
 *   Caso 6  URL sem extensão (CDN) é aceita.
 *   Caso 7  Reimport da mesma URL → no-op (sem duplicação).
 *   Caso 8  Galeria preservada quando nova principal é inserida.
 *   Caso 9  Regressão R19-A: matching seguro + zero delete.
 *   Caso 10 Regressão R19-B: brand/material independentes; imagem não interfere.
 *   Extras (etapa 17):
 *     A  URL inválida por linha (lote com 3 linhas, só a do meio falha).
 *     B  Falha no create da imagem sofre rollback do produto (atomicidade).
 *     C  Principal com position != 0 (fixture com posições 4 e 7).
 *     D  URL já existe como secundária → promove sem duplicar.
 *     E  Produto sem imagens → cria position=0.
 *     F  Relative path `/uploads/...` aceito.
 *     G  Protocolos perigosos (javascript:, data:, file:, ftp:) rejeitados um a um.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeProduct {
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
  images: FakeImage[];
  category: { id: string; name: string; slug: string } | null;
}
interface FakeImage {
  id: string; productId: string; url: string; alt: string | null;
  position: number; mediaType: string; mimeType: string | null;
}

const db = {
  products: [] as FakeProduct[],
  images: [] as FakeImage[],
  categories: [] as { id: string; name: string }[],
  deletionCalls: 0,
  imageCreateShouldThrow: false, // usado no teste de atomicidade
};

function nextId(prefix: string) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

function makeFake(partial: Partial<FakeProduct>): FakeProduct {
  return {
    id: partial.id ?? nextId('prod'),
    name: partial.name ?? 'X', slug: partial.slug ?? 'x', sku: partial.sku ?? null,
    price: partial.price ?? 100, promotionalPrice: partial.promotionalPrice ?? null,
    brand: partial.brand ?? null, material: partial.material ?? null,
    stock: partial.stock ?? 0, active: partial.active ?? true, featured: partial.featured ?? false,
    shortDescription: partial.shortDescription ?? null, description: partial.description ?? null,
    color: partial.color ?? null, printTime: partial.printTime ?? null,
    weight: partial.weight ?? null, width: partial.width ?? null,
    height: partial.height ?? null, depth: partial.depth ?? null,
    purchaseMode: partial.purchaseMode ?? 'DIRECT',
    categoryId: partial.categoryId ?? 'cat_fila',
    createdAt: partial.createdAt ?? new Date(), updatedAt: partial.updatedAt ?? new Date(),
    images: partial.images ?? [],
    category: partial.category ?? { id: 'cat_fila', name: 'Filamentos', slug: 'filamentos' },
  };
}

/**
 * `$transaction` do mock passa um `tx` com as MESMAS operações do prisma.
 * Rollback é simulado: quando o callback lança, revertemos snapshots.
 */
function snapshot() {
  return {
    products: db.products.map((p) => ({ ...p })),
    images: db.images.map((i) => ({ ...i })),
  };
}
function restore(s: ReturnType<typeof snapshot>) {
  db.products = s.products;
  db.images = s.images;
}

const mockPrisma: any = {
  product: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return db.products.find((p) => p.id === where.id) ?? null;
      if (where.slug) return db.products.find((p) => p.slug === where.slug) ?? null;
      return null;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      return db.products.find((p) => {
        if (where.sku !== undefined && p.sku !== where.sku) return false;
        if (where.slug !== undefined && p.slug !== where.slug) return false;
        return true;
      }) ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const p = makeFake({
        name: data.name, slug: data.slug, sku: data.sku ?? null,
        price: Number(data.price), brand: data.brand ?? null, material: data.material ?? null,
        stock: data.stock ?? 0, categoryId: data.category?.connect?.id ?? 'cat_fila',
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
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('delete produto proibido no bulk'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls++; throw new Error('deleteMany produto proibido'); }),
  },
  productImage: {
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      const list = db.images.filter((i) => i.productId === where.productId);
      if (orderBy?.position === 'asc') list.sort((a, b) => a.position - b.position);
      return list;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (db.imageCreateShouldThrow) throw new Error('simulated image create failure');
      const img: FakeImage = {
        id: nextId('img'), productId: data.productId, url: data.url,
        alt: data.alt ?? null, position: data.position ?? 0,
        mediaType: data.mediaType ?? 'image', mimeType: data.mimeType ?? null,
      };
      db.images.push(img);
      return img;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const img = db.images.find((i) => i.id === where.id);
      if (!img) throw new Error(`Image ${where.id} not found`);
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
    delete: vi.fn(async () => { db.deletionCalls++; throw new Error('delete de imagem proibido no bulk'); }),
    deleteMany: vi.fn(async () => { db.deletionCalls++; throw new Error('deleteMany de imagem proibido'); }),
  },
  category: {
    findFirst: vi.fn(async ({ where }: any) => {
      const q = where.name.equals.toLowerCase();
      return db.categories.find((c) => c.name.toLowerCase() === q) ?? null;
    }),
    findUnique: vi.fn(async ({ where }: any) => db.categories.find((c) => c.id === where.id) ?? null),
  },
  $transaction: vi.fn(async (fn: any) => {
    const s = snapshot();
    try {
      return await fn(mockPrisma);
    } catch (e) {
      restore(s);
      throw e;
    }
  }),
};

vi.mock('../../lib/prisma', () => ({ prisma: mockPrisma }));

const { productsService, isSafeImageUrl } = await import('./products.service');

describe('R19-C — imagem principal via bulk import', () => {
  beforeEach(() => {
    db.products = []; db.images = []; db.deletionCalls = 0;
    db.imageCreateShouldThrow = false;
    db.categories = [{ id: 'cat_fila', name: 'Filamentos' }];
  });

  // -------------------------------------------------------------------------
  // isSafeImageUrl (unit)
  // -------------------------------------------------------------------------
  describe('isSafeImageUrl', () => {
    it('aceita https/http e /uploads/', () => {
      expect(isSafeImageUrl('https://cdn.example.com/x.jpg')).toBe(true);
      expect(isSafeImageUrl('http://x.com/a')).toBe(true);
      expect(isSafeImageUrl('https://cdn.example.com/file?id=123')).toBe(true); // sem extensão
      expect(isSafeImageUrl('/uploads/products/abc.jpg')).toBe(true);
    });

    it('rejeita protocolos perigosos e strings arbitrárias', () => {
      expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeImageUrl('data:image/png;base64,aaa')).toBe(false);
      expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
      expect(isSafeImageUrl('ftp://server/x.jpg')).toBe(false);
      expect(isSafeImageUrl('abc')).toBe(false);
      expect(isSafeImageUrl('')).toBe(false);
      expect(isSafeImageUrl('C:\\Users\\me\\pic.jpg')).toBe(false);
      // Path traversal e barra dupla dentro de /uploads/ também são bloqueados.
      expect(isSafeImageUrl('/uploads/../etc/passwd')).toBe(false);
      expect(isSafeImageUrl('//attacker.com/x.jpg')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cenários bulk import
  // -------------------------------------------------------------------------
  it('CASO 1 — produto novo com URL válida cria imagem principal', async () => {
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'Produto Teste',
        categoryName: 'Filamentos', price: 10,
        imageUrl: 'https://example.com/teste.jpg',
      }],
    });
    expect(r.summary.created).toBe(1);
    const prod = db.products[0];
    const imgs = db.images.filter((i) => i.productId === prod.id);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ url: 'https://example.com/teste.jpg', position: 0, mediaType: 'image', alt: prod.name });
    expect(r.created[0].imageUpdated).toBe(true);
  });

  it('CASO 2 — produto novo sem URL não cria nenhuma imagem', async () => {
    const r = await productsService.bulkImport({
      rows: [{ line: 2, name: 'Só Produto', categoryName: 'Filamentos', price: 10 }],
    });
    expect(r.summary.created).toBe(1);
    expect(db.images).toHaveLength(0);
    expect(r.created[0].imageUpdated).toBeUndefined();
  });

  it('CASO 3 — célula vazia preserva imagem existente', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    db.images.push({
      id: 'i1', productId: 'p1', url: 'https://old.example.com/antiga.jpg',
      alt: 'X', position: 0, mediaType: 'image', mimeType: null,
    });
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', price: 200 }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.images).toHaveLength(1);
    expect(db.images[0].url).toBe('https://old.example.com/antiga.jpg');
    expect(r.updated[0].imageUpdated).toBeUndefined();
  });

  it('CASO 4 e 8 — URL nova vira principal, galeria intacta', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    db.images.push(
      { id: 'i1', productId: 'p1', url: 'https://x.com/principal.jpg', alt: 'p', position: 0, mediaType: 'image', mimeType: null },
      { id: 'i2', productId: 'p1', url: 'https://x.com/lateral.jpg', alt: 'l', position: 1, mediaType: 'image', mimeType: null },
      { id: 'i3', productId: 'p1', url: 'https://x.com/detalhe.jpg', alt: 'd', position: 2, mediaType: 'image', mimeType: null },
    );
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', imageUrl: 'https://x.com/nova-principal.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(r.updated[0].imageUpdated).toBe(true);
    const imgs = db.images.filter((i) => i.productId === 'p1').sort((a, b) => a.position - b.position);
    expect(imgs.map((i) => i.url)).toEqual([
      'https://x.com/nova-principal.jpg',
      'https://x.com/principal.jpg',
      'https://x.com/lateral.jpg',
      'https://x.com/detalhe.jpg',
    ]);
    expect(imgs.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    expect(db.deletionCalls).toBe(0);
  });

  it('CASO 5 e Extra G — protocolos perigosos são REJEITADOS individualmente', async () => {
    const rows = [
      { line: 2, name: 'A', categoryName: 'Filamentos', price: 10, imageUrl: 'abc' },
      { line: 3, name: 'B', categoryName: 'Filamentos', price: 10, imageUrl: 'javascript:alert(1)' },
      { line: 4, name: 'C', categoryName: 'Filamentos', price: 10, imageUrl: 'file:///etc/passwd' },
      { line: 5, name: 'D', categoryName: 'Filamentos', price: 10, imageUrl: 'ftp://x/y.jpg' },
      { line: 6, name: 'E', categoryName: 'Filamentos', price: 10, imageUrl: 'data:image/png;base64,x' },
    ];
    const r = await productsService.bulkImport({ rows });
    expect(r.summary.conflicts).toBe(5);
    expect(r.summary.created).toBe(0);
    expect(db.products).toHaveLength(0); // nenhuma criação parcial
    for (const c of r.conflicts) expect(c.reason).toMatch(/imagem inválida/i);
  });

  it('CASO 6 — URL sem extensão (CDN com query string) é aceita', async () => {
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'Prod CDN', categoryName: 'Filamentos', price: 10,
        imageUrl: 'https://cdn.example.com/file?id=123',
      }],
    });
    expect(r.summary.created).toBe(1);
    expect(db.images[0].url).toBe('https://cdn.example.com/file?id=123');
  });

  it('CASO 7 — reimport da mesma URL principal é no-op (sem duplicação)', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    db.images.push({
      id: 'i1', productId: 'p1', url: 'https://x.com/same.jpg', alt: 'a',
      position: 0, mediaType: 'image', mimeType: null,
    });
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', imageUrl: 'https://x.com/same.jpg', price: 999 }],
    });
    expect(r.summary.updated).toBe(1);
    expect(r.updated[0].imageUpdated).toBeUndefined();
    // Nada duplicado, nada mexido na galeria.
    expect(db.images).toHaveLength(1);
    expect(db.images[0].position).toBe(0);
    expect(db.products[0].price).toBe(999); // patch escalar aplicado
  });

  // -------------------------------------------------------------------------
  // Extras (etapa 17)
  // -------------------------------------------------------------------------
  it('EXTRA A — URL inválida NÃO derruba o lote inteiro', async () => {
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, name: 'ok1', categoryName: 'Filamentos', price: 10, imageUrl: 'https://ok/a.jpg' },
        { line: 3, name: 'bad', categoryName: 'Filamentos', price: 10, imageUrl: 'javascript:alert(1)' },
        { line: 4, name: 'ok2', categoryName: 'Filamentos', price: 10, imageUrl: 'https://ok/c.jpg' },
      ],
    });
    expect(r.summary).toMatchObject({ created: 2, conflicts: 1 });
    expect(db.products.map((p) => p.name).sort()).toEqual(['ok1', 'ok2']);
    expect(db.images.map((i) => i.url).sort()).toEqual(['https://ok/a.jpg', 'https://ok/c.jpg']);
  });

  it('EXTRA B — falha na imagem sofre ROLLBACK do produto (atomicidade por linha)', async () => {
    // Simula falha específica do create de imagem — o create do produto na
    // MESMA transação deve ser desfeito.
    db.imageCreateShouldThrow = true;
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'Produto Fantasma', categoryName: 'Filamentos', price: 10,
        imageUrl: 'https://x.com/a.jpg',
      }],
    });
    expect(r.summary.created).toBe(0);
    expect(r.summary.skipped).toBe(1);
    // NÃO ficou produto órfão no banco:
    expect(db.products).toHaveLength(0);
    expect(db.images).toHaveLength(0);
  });

  it('EXTRA C — principal é a de MENOR position, não necessariamente 0', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    db.images.push(
      { id: 'i1', productId: 'p1', url: 'https://x.com/principal-atual.jpg', alt: 'a', position: 4, mediaType: 'image', mimeType: null },
      { id: 'i2', productId: 'p1', url: 'https://x.com/secundaria.jpg', alt: 'b', position: 7, mediaType: 'image', mimeType: null },
    );
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', imageUrl: 'https://x.com/principal-atual.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(r.updated[0].imageUpdated).toBeUndefined(); // no-op mesmo com position=4
    expect(db.images).toHaveLength(2);
    // Posições inalteradas.
    expect(db.images.find((i) => i.id === 'i1')!.position).toBe(4);
    expect(db.images.find((i) => i.id === 'i2')!.position).toBe(7);
  });

  it('EXTRA D — URL já existe como secundária: PROMOVE sem duplicar', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    db.images.push(
      { id: 'i1', productId: 'p1', url: 'https://x.com/principal.jpg', alt: 'a', position: 0, mediaType: 'image', mimeType: null },
      { id: 'i2', productId: 'p1', url: 'https://x.com/lateral.jpg', alt: 'b', position: 1, mediaType: 'image', mimeType: null },
    );
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', imageUrl: 'https://x.com/lateral.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    const imgs = db.images.filter((i) => i.productId === 'p1').sort((a, b) => a.position - b.position);
    expect(imgs).toHaveLength(2); // NÃO duplicou
    expect(imgs[0].url).toBe('https://x.com/lateral.jpg');
    expect(imgs[1].url).toBe('https://x.com/principal.jpg');
  });

  it('EXTRA E — produto sem imagens: cria diretamente em position=0', async () => {
    db.products.push(makeFake({ id: 'p1', sku: 'SKU-P1' }));
    const r = await productsService.bulkImport({
      rows: [{ line: 2, sku: 'SKU-P1', imageUrl: 'https://x.com/nova.jpg' }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.images).toHaveLength(1);
    expect(db.images[0]).toMatchObject({ position: 0, url: 'https://x.com/nova.jpg' });
  });

  it('EXTRA F — path relativo /uploads/products/... é aceito', async () => {
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, name: 'Rel', categoryName: 'Filamentos', price: 10,
        imageUrl: '/uploads/products/abc.jpg',
      }],
    });
    expect(r.summary.created).toBe(1);
    expect(db.images[0].url).toBe('/uploads/products/abc.jpg');
  });

  // -------------------------------------------------------------------------
  // Regressões
  // -------------------------------------------------------------------------
  it('CASO 9 — regressão R19-A: matching seguro, zero delete', async () => {
    // Produto A já existe. Import tem: ID válido, ID inexistente, e criação inequívoca.
    db.products.push(makeFake({ id: 'p1', name: 'A', slug: 'a', sku: 'SKU-A' }));
    const r = await productsService.bulkImport({
      rows: [
        { line: 2, sku: 'SKU-A', price: 55 },
        { line: 3, id: 'fantasma_xyz', name: 'Ghost', price: 10 },
        { line: 4, name: 'Único e novo', categoryName: 'Filamentos', price: 10 },
      ],
    });
    expect(r.summary).toMatchObject({ updated: 1, created: 1, conflicts: 1, skipped: 0 });
    expect(db.deletionCalls).toBe(0);
    expect(db.products.find((p) => p.id === 'p1')!.price).toBe(55);
  });

  it('CASO 10 — regressão R19-B: brand/material continuam independentes, imagem não interfere', async () => {
    db.products.push(makeFake({
      id: 'p1', sku: 'SKU-P1', brand: '3D Prime', material: 'PLA',
    }));
    // Só atualiza brand + imagem; material precisa ficar intacto.
    const r = await productsService.bulkImport({
      rows: [{
        line: 2, sku: 'SKU-P1',
        brand: 'Masterprint',
        imageUrl: 'https://x.com/nova.jpg',
      }],
    });
    expect(r.summary.updated).toBe(1);
    expect(db.products[0]).toMatchObject({ brand: 'Masterprint', material: 'PLA' });
    expect(db.images[0].url).toBe('https://x.com/nova.jpg');
  });
});
