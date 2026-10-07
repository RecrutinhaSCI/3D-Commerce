/**
 * Integração REAL (Postgres) do fluxo de catálogo: exclusão, `active`,
 * export → planilha .xlsx → parse → import, imagens e idempotência.
 *
 * Diferente dos outros testes (fakes in-memory), este usa o banco de verdade
 * e o MESMO código do frontend que gera/lê a planilha (`src/utils/productExcel`),
 * então cobre o caminho que o cliente usa no Admin.
 *
 * Só roda com TEST_DATABASE_URL apontando para um banco LOCAL cujo nome
 * termina em "_test" — o teste APAGA o conteúdo das tabelas. Ex.:
 *   docker run -d --name pg-test -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:18-alpine
 *   (crie o banco "app_test" e rode `prisma migrate deploy` nele)
 *   TEST_DATABASE_URL=postgresql://postgres:x@localhost:55432/app_test npx vitest run
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import { buildExportRows, parseWorkbook } from '../../../../src/utils/productExcel';
import type { ApiProduct } from '../../../../src/services/types';

const TEST_URL = process.env.TEST_DATABASE_URL;

function isSafeTestDb(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && /_test$/.test(u.pathname.slice(1));
  } catch {
    return false;
  }
}

const enabled = isSafeTestDb(TEST_URL);
if (enabled) {
  // Precisa vir ANTES de importar o service (o client do Prisma lê no import).
  process.env.DATABASE_URL = TEST_URL;
  process.env.JWT_SECRET ??= 'test-secret-local-only-123456';
}

const { productsService } = enabled ? await import('./products.service') : ({} as never);
const { prisma } = enabled ? await import('../../lib/prisma') : ({} as { prisma: PrismaClient });

// ---------------------------------------------------------------------------
// Helpers: simulam exatamente o que o Admin faz
// ---------------------------------------------------------------------------

/** Botão "Exportar Excel": lista admin → linhas → arquivo .xlsx (buffer). */
async function exportXlsx(): Promise<XLSX.WorkBook> {
  const { products } = await productsService.listAdmin({ page: 1, limit: 500, sort: 'name_asc' } as never);
  const ws = XLSX.utils.json_to_sheet(buildExportRows(products as unknown as ApiProduct[]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  // Ida e volta pelo formato binário, como no download/upload real.
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(buf, { type: 'buffer' });
}

function sheetRows(wb: XLSX.WorkBook): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });
}

function workbookFrom(rows: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Produtos');
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
}

/** Modal "Importar Excel": parse → só linhas válidas → sem chaves undefined. */
async function importWorkbook(wb: XLSX.WorkBook) {
  const parsed = parseWorkbook(wb);
  const rows = parsed.rows
    .filter((r) => r.errors.length === 0)
    .map((r) => Object.fromEntries(Object.entries({ line: r.line, ...r.data }).filter(([, v]) => v !== undefined)));
  return { parsed, report: await productsService.bulkImport({ rows } as never) };
}

async function snapshot(sku: string) {
  return prisma.product.findFirstOrThrow({ where: { sku }, include: { images: { orderBy: { position: 'asc' } } } });
}

async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE order_items, orders, cart_items, carts, product_images, products, categories, users RESTART IDENTITY CASCADE',
  );
  await prisma.category.createMany({
    data: [
      { id: 'cat-pla', name: 'Filamentos PLA', slug: 'filamentos-pla' },
      { id: 'cat-petg', name: 'Filamentos PETG', slug: 'filamentos-petg' },
    ],
  });
}

const PLANILHA_INICIAL = [
  { nome: 'Produto A', sku: 'SKU-A', categoria: 'Filamentos PLA', preco: 100, estoque: 10, marca: '3D Prime', material: 'PLA', descricao_curta: 'Curta A', imagem: 'https://cdn.exemplo.com/a.jpg' },
  { nome: 'Produto B', sku: 'SKU-B', categoria: 'Filamentos PETG', preco: 200, estoque: 0, marca: 'Voolt', material: 'PETG', descricao_curta: 'Curta B', imagem: 'https://cdn.exemplo.com/b.jpg', ativo: 'sim' },
  { nome: 'Produto C', sku: 'SKU-C', categoria: 'Filamentos PLA', preco: 300, estoque: 3, marca: 'Masterprint', material: 'PLA', descricao_curta: 'Curta C', destaque_home: 'não' },
];

describe.skipIf(!enabled)('Catálogo + Excel — integração com Postgres real', () => {
  beforeEach(resetDb);
  afterAll(async () => { await prisma.$disconnect(); });

  it('banco limpo: listagens vazias e export sem linhas', async () => {
    expect((await productsService.listAdmin({ page: 1, limit: 50 } as never)).products).toEqual([]);
    expect((await productsService.listPublic({ page: 1, limit: 12 } as never)).products).toEqual([]);
    expect(sheetRows(await exportXlsx())).toEqual([]);
  });

  it('Cenário A — importação inicial cria com todos os campos', async () => {
    const before = Date.now();
    const { report } = await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    expect(report.summary).toMatchObject({ created: 3, updated: 0, conflicts: 0, skipped: 0 });

    const a = await snapshot('SKU-A');
    expect(a).toMatchObject({ name: 'Produto A', slug: 'produto-a', stock: 10, brand: '3D Prime', material: 'PLA', categoryId: 'cat-pla', active: true });
    expect(Number(a.price)).toBe(100);
    expect(a.images.map((i) => [i.url, i.position])).toEqual([['https://cdn.exemplo.com/a.jpg', 0]]);
    expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(a.stockUpdatedAt).not.toBeNull();

    const b = await snapshot('SKU-B');
    expect(b.stock).toBe(0); // 0 é valor válido
    const c = await snapshot('SKU-C');
    expect(c.images).toHaveLength(0);
    expect(c.featured).toBe(false); // "não" explícito
  });

  it('Cenário B — exportação: todos os registros, colunas e valores corretos', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const rows = sheetRows(await exportXlsx());
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'ativo', 'categoria', 'criado_em', 'descricao_completa', 'descricao_curta', 'destaque_home',
      'estoque', 'estoque_atualizado_em', 'id', 'imagem', 'marca', 'material', 'nome', 'preco',
      'preco_promocional', 'sku', 'slug',
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.nome, r]));
    const a = await snapshot('SKU-A');
    expect(byName['Produto A']).toMatchObject({
      id: a.id, sku: 'SKU-A', slug: 'produto-a', marca: '3D Prime', material: 'PLA',
      imagem: 'https://cdn.exemplo.com/a.jpg', categoria: 'Filamentos PLA', preco: 100, estoque: 10, ativo: 'sim',
    });
    // Produto sem foto exporta imagem VAZIA (nunca o placeholder SVG do front).
    expect(byName['Produto C'].imagem).toBe('');
  });

  it('Cenário C — reimportação parcial: só preço de A e estoque de B mudam', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const [a0, b0, c0] = await Promise.all(['SKU-A', 'SKU-B', 'SKU-C'].map(snapshot));

    const rows = sheetRows(await exportXlsx()).map((r) => {
      if (r.sku === 'SKU-A') return { ...r, preco: 149.9 };
      if (r.sku === 'SKU-B') return { ...r, estoque: 25 };
      return r;
    });
    const { report } = await importWorkbook(workbookFrom(rows));
    expect(report.summary).toMatchObject({ created: 0, updated: 2, unchanged: 1, conflicts: 0, skipped: 0 });

    const [a1, b1, c1] = await Promise.all(['SKU-A', 'SKU-B', 'SKU-C'].map(snapshot));
    expect(Number(a1.price)).toBe(149.9);
    expect({ ...a1, price: null, updatedAt: null }).toEqual({ ...a0, price: null, updatedAt: null });
    expect(a1.stockUpdatedAt).toEqual(a0.stockUpdatedAt); // preço não mexe no carimbo de estoque
    expect(b1.stock).toBe(25);
    expect(b1.stockUpdatedAt!.getTime()).toBeGreaterThan(b0.stockUpdatedAt!.getTime());
    expect({ ...b1, stock: 0, stockUpdatedAt: null, updatedAt: null }).toEqual({ ...b0, stock: 0, stockUpdatedAt: null, updatedAt: null });
    expect(c1).toEqual(c0); // intocado, inclusive updatedAt
  });

  it('Cenário D — célula vazia e coluna ausente não apagam; 0 e "não" são valores válidos', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const a0 = await snapshot('SKU-A');
    // Células vazias em campos existentes + colunas ausentes (só sku/estoque/ativo).
    const { report } = await importWorkbook(workbookFrom([
      { sku: 'SKU-A', nome: '', marca: '', material: '', descricao_curta: '', imagem: '', preco: '', estoque: 0, ativo: 'não' },
    ]));
    expect(report.summary).toMatchObject({ updated: 1, conflicts: 0 });
    const a1 = await snapshot('SKU-A');
    expect(a1).toMatchObject({ name: a0.name, brand: a0.brand, material: a0.material, shortDescription: a0.shortDescription, stock: 0, active: false });
    expect(Number(a1.price)).toBe(Number(a0.price));
    expect(a1.images).toEqual(a0.images);
  });

  it('Cenário E — imagens: vazia preserva, nova vira principal sem duplicar, secundária é promovida', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const a = await snapshot('SKU-A');
    await prisma.productImage.create({ data: { productId: a.id, url: '/uploads/products/lateral.jpg', position: 1 } });

    // Imagem nova → principal; antiga desce para secundária. Nada duplicado.
    await importWorkbook(workbookFrom([{ sku: 'SKU-A', imagem: 'https://cdn.exemplo.com/a-v2.jpg' }]));
    expect((await snapshot('SKU-A')).images.map((i) => i.url)).toEqual([
      'https://cdn.exemplo.com/a-v2.jpg', 'https://cdn.exemplo.com/a.jpg', '/uploads/products/lateral.jpg',
    ]);

    // Mesma imagem de novo → no-op (não duplica).
    const again = await importWorkbook(workbookFrom([{ sku: 'SKU-A', imagem: 'https://cdn.exemplo.com/a-v2.jpg' }]));
    expect(again.report.summary).toMatchObject({ unchanged: 1, updated: 0 });
    expect((await snapshot('SKU-A')).images).toHaveLength(3);

    // Planilha ANTIGA exportava a URL absoluta do backend; deve casar com o path salvo.
    const legacy = await importWorkbook(workbookFrom([{ sku: 'SKU-A', imagem: 'https://threed-commerce-backend.onrender.com/uploads/products/lateral.jpg' }]));
    expect(legacy.report.updated[0]?.imageUpdated).toBe(true);
    expect((await snapshot('SKU-A')).images.map((i) => i.url)).toEqual([
      '/uploads/products/lateral.jpg', 'https://cdn.exemplo.com/a-v2.jpg', 'https://cdn.exemplo.com/a.jpg',
    ]);

    // Planilha ANTIGA com placeholder SVG no lugar da foto: ignora a imagem e
    // aplica o resto da linha (antes a linha inteira virava conflito).
    const placeholder = await importWorkbook(workbookFrom([{ sku: 'SKU-C', imagem: 'data:image/svg+xml;utf8,%3Csvg%3E', estoque: 7 }]));
    expect(placeholder.report.summary).toMatchObject({ updated: 1, conflicts: 0 });
    const c = await snapshot('SKU-C');
    expect(c.stock).toBe(7);
    expect(c.images).toHaveLength(0);

    // Export → reimport sem edição preserva a galeria inteira.
    const rt = await importWorkbook(await exportXlsx());
    expect(rt.report.summary).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect((await snapshot('SKU-A')).images).toHaveLength(3);
  });

  it('Cenário F — exclusão individual e em massa: some do admin, do público e do export; histórico de pedido fica', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const [a, b, c] = await Promise.all(['SKU-A', 'SKU-B', 'SKU-C'].map(snapshot));

    // Pedido antigo com A + carrinho aberto com B.
    const user = await prisma.user.create({ data: { name: 'Cliente', email: 'cliente@teste.local', passwordHash: 'x' } });
    await prisma.order.create({
      data: {
        userId: user.id, customerName: 'Cliente', customerEmail: 'cliente@teste.local', customerPhone: '1',
        addressSnapshot: {}, subtotal: 100, total: 100, paymentMethod: 'PIX',
        items: { create: [{ productId: a.id, productName: a.name, productSku: a.sku, quantity: 1, unitPrice: 100, total: 100 }] },
      },
    });
    await prisma.cart.create({ data: { userId: user.id, items: { create: [{ productId: b.id, quantity: 1, unitPrice: 200 }] } } });

    await productsService.remove(a.id);
    const bulk = await productsService.bulkDelete([b.id, 'id-inexistente']);
    expect(bulk).toMatchObject({ deleted: 1, notFound: ['id-inexistente'] });

    const admin = await productsService.listAdmin({ page: 1, limit: 50 } as never);
    expect(admin.products.map((p: ApiProduct) => p.sku)).toEqual(['SKU-C']);
    const pub = await productsService.listPublic({ page: 1, limit: 12 } as never);
    expect(pub.products.map((p: ApiProduct) => p.sku)).toEqual(['SKU-C']);
    await expect(productsService.getPublicBySlug(a.slug)).rejects.toMatchObject({ status: 404 });
    await expect(productsService.getAdminById(a.id)).rejects.toMatchObject({ status: 404 });
    expect(sheetRows(await exportXlsx()).map((r) => r.sku)).toEqual(['SKU-C']);
    expect(await prisma.productImage.count({ where: { productId: { in: [a.id, b.id] } } })).toBe(0);

    // Pedido preservado com snapshot, sem vínculo.
    const item = await prisma.orderItem.findFirstOrThrow();
    expect(item).toMatchObject({ productId: null, productName: 'Produto A', productSku: 'SKU-A' });
    expect(await prisma.cartItem.count()).toBe(0);

    // Reimportar planilha ANTIGA (com o ID do produto apagado) NÃO o ressuscita.
    const old = await importWorkbook(workbookFrom([{ id: a.id, nome: 'Produto A', sku: 'SKU-A', preco: 100, ativo: 'sim' }]));
    expect(old.report.summary).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(await prisma.product.count({ where: { id: a.id } })).toBe(0);
    expect(c.id).toBeTruthy();
  });

  it('active=false (desativar) some da loja pública mas continua no admin e no export', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const b = await snapshot('SKU-B');
    await productsService.update(b.id, { active: false } as never);

    const pub = await productsService.listPublic({ page: 1, limit: 12 } as never);
    expect(pub.products.map((p: ApiProduct) => p.sku).sort()).toEqual(['SKU-A', 'SKU-C']);
    await expect(productsService.getPublicBySlug(b.slug)).rejects.toMatchObject({ status: 404 });
    expect((await productsService.getAdminById(b.id)).active).toBe(false);
    const exported = sheetRows(await exportXlsx()).find((r) => r.sku === 'SKU-B')!;
    expect(exported.ativo).toBe('não');
    // Reimportar o próprio export não reativa.
    await importWorkbook(await exportXlsx());
    expect((await snapshot('SKU-B')).active).toBe(false);
  });

  it('Cenário G — novos + existentes no mesmo lote: update parcial + criação, sem duplicar', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const rows = [
      ...sheetRows(await exportXlsx()).map((r) => (r.sku === 'SKU-C' ? { ...r, estoque: 99 } : r)),
      { nome: 'Produto D', sku: 'SKU-D', categoria: 'Filamentos PETG', preco: 50, estoque: 1 },
    ];
    const { report } = await importWorkbook(workbookFrom(rows));
    expect(report.summary).toMatchObject({ created: 1, updated: 1, unchanged: 2, conflicts: 0 });
    expect(await prisma.product.count()).toBe(4);
    expect((await snapshot('SKU-C')).stock).toBe(99);
  });

  it('Cenário H — mesma planilha 2x: não duplica, não reescreve, não cria histórico falso', async () => {
    const wb = workbookFrom(PLANILHA_INICIAL);
    await importWorkbook(wb);
    const before = await Promise.all(['SKU-A', 'SKU-B', 'SKU-C'].map(snapshot));
    const { report } = await importWorkbook(wb);
    expect(report.summary).toMatchObject({ created: 0, updated: 0, unchanged: 3, conflicts: 0 });
    const after = await Promise.all(['SKU-A', 'SKU-B', 'SKU-C'].map(snapshot));
    expect(after).toEqual(before); // inclusive updatedAt e stockUpdatedAt
    expect(await prisma.product.count()).toBe(3);
    expect(await prisma.productImage.count()).toBe(2);
  });

  it('Cenário I — conflitos não escrevem nada e as linhas válidas seguem', async () => {
    await importWorkbook(workbookFrom(PLANILHA_INICIAL));
    const [a, c] = await Promise.all(['SKU-A', 'SKU-C'].map(snapshot));
    const before = await prisma.product.findMany({ orderBy: { sku: 'asc' } });

    const { parsed, report } = await importWorkbook(workbookFrom([
      { sku: 'SKU-DUP', nome: 'Dup 1', categoria: 'Filamentos PLA', preco: 1 },        // 2: SKU duplicado
      { sku: 'SKU-DUP', nome: 'Dup 2', categoria: 'Filamentos PLA', preco: 1 },        // 3: SKU duplicado
      { slug: 'produto-a', nome: 'Outro', categoria: 'Filamentos PLA', preco: 1, estoque: 1, sku: 'SKU-NOVO' }, // 4: slug de A com SKU novo
      { id: 'nao-existe', preco: 5 },                                                  // 5: ID inexistente
      { id: a.id, sku: 'SKU-B', preco: 1 },                                            // 6: ID de A + SKU de B
      { nome: 'X', preco: 'abc' },                                                     // 7: linha inválida (front)
      { nome: 'Sem Categoria', sku: 'SKU-Z', categoria: 'Não Existe', preco: 10 },     // 8: categoria inexistente
      { sku: 'SKU-C', imagem: 'javascript:alert(1)' },                                 // 9: imagem inválida
      { nome: 'Produto Novo OK', sku: 'SKU-OK', categoria: 'Filamentos PLA', preco: 10 }, // 10: válida
    ]));

    expect(parsed.rows.find((r) => r.line === 7)!.errors.length).toBeGreaterThan(0);
    const reasons = Object.fromEntries(report.conflicts.map((c: { line: number; reason: string }) => [c.line, c.reason]));
    expect(reasons[2]).toMatch(/SKU duplicado/);
    expect(reasons[3]).toMatch(/SKU duplicado/);
    expect(reasons[5]).toMatch(/não existe/);
    expect(reasons[6]).toMatch(/Conflito de identidade/);
    expect(reasons[8]).toMatch(/Categoria "Não Existe" não encontrada/);
    expect(reasons[9]).toMatch(/Imagem inválida/);
    // Linha 4: SKU novo + slug já existente → conflito de slug (não sobrescreve A).
    expect(report.conflicts.map((c: { line: number }) => c.line)).toContain(4);
    expect(report.created.map((c: { sku?: string }) => c.sku)).toEqual(['SKU-OK']);

    // Nada nos existentes mudou.
    const after = await prisma.product.findMany({ where: { sku: { not: 'SKU-OK' } }, orderBy: { sku: 'asc' } });
    expect(after).toEqual(before);
    expect((await snapshot('SKU-C')).images).toEqual(c.images);
  });
});
