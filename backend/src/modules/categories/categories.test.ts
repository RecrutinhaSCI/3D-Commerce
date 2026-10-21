/**
 * Categorias: imagem do card (Vercel Blob), flags de exibição e rotas.
 * Prisma e remoção de arquivo mockados — nenhum banco nem Blob é tocado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';

type Row = {
  id: string; name: string; slug: string; description: string | null; active: boolean;
  isSeasonal: boolean; seasonalTitle: string | null; seasonalDescription: string | null;
  seasonalBannerImage: string | null; imageUrl: string | null; showInMenu: boolean; showInHome: boolean;
  createdAt: Date; updatedAt: Date;
};

const db = { rows: [] as Row[] };
const row = (p: Partial<Row>): Row => ({
  id: 'c1', name: 'Filamentos PLA', slug: 'filamentos-pla', description: null, active: true,
  isSeasonal: false, seasonalTitle: null, seasonalDescription: null, seasonalBannerImage: null,
  imageUrl: null, showInMenu: true, showInHome: true, createdAt: new Date(), updatedAt: new Date(), ...p,
});

const prismaMock = {
  category: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; slug?: string } }) =>
      db.rows.find((r) => (where.id ? r.id === where.id : r.slug === where.slug)) ?? null),
    findMany: vi.fn(async () => db.rows.map((r) => ({ ...r, _count: { products: 3 } }))),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const r = db.rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return { ...r };
    }),
  },
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));

const unlink = vi.fn();
vi.mock('../../lib/upload', async (orig) => ({
  ...(await orig<typeof import('../../lib/upload')>()),
  safeUnlinkSiteImage: (u: string) => unlink(u),
}));

const { categoriesService } = await import('./categories.service');
const { updateCategorySchema } = await import('./categories.schemas');

const BLOB_A = 'https://abc.public.blob.vercel-storage.com/site/a.webp';
const BLOB_B = 'https://abc.public.blob.vercel-storage.com/site/b.webp';

beforeEach(() => {
  db.rows = [row({})];
  unlink.mockClear();
});

describe('imagem da categoria', () => {
  it('grava a URL do upload em imageUrl e ela volta na listagem pública', async () => {
    const updated = await categoriesService.setImage('c1', 'imageUrl', BLOB_A);
    expect(updated.imageUrl).toBe(BLOB_A);
    const [pub] = await categoriesService.listPublic();
    expect(pub).toMatchObject({ imageUrl: BLOB_A, showInMenu: true, showInHome: true });
  });

  it('substituir apaga o arquivo ANTERIOR depois de gravar; remover limpa e apaga', async () => {
    await categoriesService.setImage('c1', 'imageUrl', BLOB_A);
    expect(unlink).not.toHaveBeenCalled();

    await categoriesService.setImage('c1', 'imageUrl', BLOB_B);
    expect(db.rows[0].imageUrl).toBe(BLOB_B);
    expect(unlink).toHaveBeenCalledWith(BLOB_A);

    await categoriesService.setImage('c1', 'imageUrl', null);
    expect(db.rows[0].imageUrl).toBeNull();
    expect(unlink).toHaveBeenLastCalledWith(BLOB_B);
  });

  it('banner sazonal usa o mesmo fluxo, em seasonalBannerImage', async () => {
    await categoriesService.setImage('c1', 'seasonalBannerImage', BLOB_A);
    expect(db.rows[0]).toMatchObject({ seasonalBannerImage: BLOB_A, imageUrl: null });
  });

  it('categoria inexistente → 404, nada é gravado nem apagado', async () => {
    await expect(categoriesService.setImage('nao-existe', 'imageUrl', BLOB_A)).rejects.toMatchObject({ status: 404 });
    expect(unlink).not.toHaveBeenCalled();
  });

  it('PUT não aceita imageUrl (só pelo upload): o campo é descartado', () => {
    const parsed = updateCategorySchema.parse({ name: 'X Y', imageUrl: 'data:image/png;base64,AAAA' });
    expect(parsed).not.toHaveProperty('imageUrl');
  });
});

describe('flags de exibição', () => {
  it('showInMenu/showInHome são gravados sem mexer em active', async () => {
    const u = await categoriesService.update('c1', { showInMenu: false, showInHome: false });
    expect(u).toMatchObject({ active: true, showInMenu: false, showInHome: false });
  });

  it('flags ausentes no PUT preservam o valor atual', async () => {
    db.rows = [row({ showInHome: false })];
    const u = await categoriesService.update('c1', { description: 'nova' });
    expect(u).toMatchObject({ showInMenu: true, showInHome: false, description: 'nova' });
  });
});

/** Middlewares da rota `METHOD path` dentro de um Router do Express. */
function routeHandlers(router: Router, method: string, path: string) {
  const layer = (router.stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>)
    .find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.map((s) => s.handle) ?? [];
}

describe('rotas de imagem da categoria', () => {
  it('upload e remoção existem (card e sazonal); upload usa o limiter do admin', async () => {
    const { categoriesRouter } = await import('./categories.routes');
    const { adminUploadRateLimiter } = await import('../../middlewares/rateLimiters');
    for (const p of ['/admin/categories/:id/image', '/admin/categories/:id/seasonal-image']) {
      expect(routeHandlers(categoriesRouter, 'post', p), p).toContain(adminUploadRateLimiter);
      expect(routeHandlers(categoriesRouter, 'delete', p).length, p).toBeGreaterThan(0);
    }
    // Auth + admin aplicados a /admin/categories via router.use (antes das rotas).
    const guarded = (categoriesRouter.stack as Array<{ route?: unknown; regexp?: RegExp }>).find(
      (l) => !l.route && l.regexp?.test('/admin/categories/x/image'),
    );
    expect(guarded).toBeTruthy();
  }, 30_000);
});
