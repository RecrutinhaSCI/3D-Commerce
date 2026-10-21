/**
 * Capas do Blog (settings.blogCoversJson): gravar, trocar (apaga a anterior
 * só depois do banco), remover e rotas. Prisma e Blob mockados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';

const state: { row: Record<string, unknown> } = { row: {} };
const prismaMock = {
  siteSettings: {
    findUnique: vi.fn(async () => state.row),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.row = { ...state.row, ...data })),
    upsert: vi.fn(async () => state.row),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (state.row = { ...state.row, ...data })),
  },
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));
const unlink = vi.fn();
vi.mock('../../lib/upload', async (orig) => ({
  ...(await orig<typeof import('../../lib/upload')>()),
  safeUnlinkSiteImage: (u: string) => unlink(u),
}));

const { settingsService } = await import('./settings.service');
const { blogPostContentSchema } = await import('./settings.schemas');

const A = 'https://abc.public.blob.vercel-storage.com/site/a.webp';
const B = 'https://abc.public.blob.vercel-storage.com/site/b.webp';

beforeEach(() => {
  // Registro mínimo com os campos que o toDTO lê.
  state.row = {
    id: 'main', storeName: '3DCommerce', whatsapp: '', email: '', address: '',
    pixDiscountPercent: 0, freeShippingThreshold: 0, heroIntervalSeconds: 6,
    blogCoversJson: null, blogContentJson: null, createdAt: new Date(), updatedAt: new Date(),
  };
  unlink.mockClear();
});

describe('capas do blog', () => {
  it('grava a capa por slug e devolve no DTO público', async () => {
    const s = await settingsService.setBlogCover('guia-rapido', A);
    expect(s.blogCoversJson).toEqual({ 'guia-rapido': A });
    expect((await settingsService.getPublic()).blogCoversJson).toEqual({ 'guia-rapido': A });
    expect(unlink).not.toHaveBeenCalled();
  });

  it('trocar apaga a anterior; outras capas ficam intactas; remover apaga e tira do mapa', async () => {
    await settingsService.setBlogCover('post-1', A);
    await settingsService.setBlogCover('post-2', A.replace('a.webp', 'c.webp'));
    await settingsService.setBlogCover('post-1', B);
    expect(unlink).toHaveBeenCalledWith(A);
    expect(state.row.blogCoversJson).toMatchObject({ 'post-1': B, 'post-2': expect.stringContaining('c.webp') });

    const s = await settingsService.setBlogCover('post-1', null);
    expect(unlink).toHaveBeenLastCalledWith(B);
    expect(s.blogCoversJson).not.toHaveProperty('post-1');
    expect(s.blogCoversJson).toHaveProperty('post-2');
  });

  it('JSON inválido no banco vira mapa vazio (não quebra o settings)', async () => {
    state.row.blogCoversJson = ['lixo'];
    expect((await settingsService.getPublic()).blogCoversJson).toEqual({});
  });
});

describe('textos do blog (blog_content_json)', () => {
  it('grava os campos enviados por slug e devolve no DTO público', async () => {
    const md = '## Olá\n\n**negrito**';
    const input = blogPostContentSchema.parse({ title: '  Novo título ', content: md });
    const s = await settingsService.setBlogContent('post-1', input);
    expect(s.blogContentJson).toEqual({ 'post-1': { title: 'Novo título', content: md } });
    expect((await settingsService.getPublic()).blogContentJson['post-1'].title).toBe('Novo título');
  });

  it('salvar de novo SUBSTITUI a versão do slug; outros posts ficam intactos', async () => {
    await settingsService.setBlogContent('post-1', { title: 'A', excerpt: 'x' });
    await settingsService.setBlogContent('post-2', { title: 'B' });
    const s = await settingsService.setBlogContent('post-1', { content: 'só conteúdo' });
    expect(s.blogContentJson['post-1']).toEqual({ content: 'só conteúdo' });
    expect(s.blogContentJson['post-2']).toEqual({ title: 'B' });
  });

  it('null / campos vazios removem a versão salva (volta ao padrão do código)', async () => {
    await settingsService.setBlogContent('post-1', { title: 'A' });
    expect((await settingsService.setBlogContent('post-1', null)).blogContentJson).toEqual({});
    await settingsService.setBlogContent('post-1', { title: 'A' });
    const empty = blogPostContentSchema.parse({ title: '   ', content: '' });
    expect((await settingsService.setBlogContent('post-1', empty)).blogContentJson).toEqual({});
  });

  it('validação: campo desconhecido e texto grande demais são recusados', () => {
    expect(blogPostContentSchema.safeParse({ slug: 'outro' }).success).toBe(false);
    expect(blogPostContentSchema.safeParse({ title: 'x'.repeat(161) }).success).toBe(false);
    expect(blogPostContentSchema.safeParse({ content: 'x'.repeat(60_001) }).success).toBe(false);
  });

  it('JSON inválido no banco é ignorado sem quebrar o settings', async () => {
    state.row.blogContentJson = { ok: { title: 'T', lixo: 1 }, ruim: 'texto', vazio: { title: '' } };
    expect((await settingsService.getPublic()).blogContentJson).toEqual({ ok: { title: 'T' } });
  });
});

function routeHandlers(router: Router, method: string, path: string) {
  const layer = (router.stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>)
    .find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.map((s) => s.handle) ?? [];
}

describe('rotas das capas', () => {
  it('upload usa o limiter do admin; remoção existe; ambas sob /admin/settings (auth + admin)', async () => {
    const { settingsRouter } = await import('./settings.routes');
    const { adminUploadRateLimiter } = await import('../../middlewares/rateLimiters');
    expect(routeHandlers(settingsRouter, 'post', '/admin/settings/blog-covers/:slug')).toContain(adminUploadRateLimiter);
    expect(routeHandlers(settingsRouter, 'delete', '/admin/settings/blog-covers/:slug').length).toBeGreaterThan(0);
    expect(routeHandlers(settingsRouter, 'put', '/admin/settings/blog-posts/:slug').length).toBeGreaterThan(0);
    expect(routeHandlers(settingsRouter, 'delete', '/admin/settings/blog-posts/:slug').length).toBeGreaterThan(0);
    const guardedText = (settingsRouter.stack as Array<{ route?: unknown; regexp?: RegExp }>).find(
      (l) => !l.route && l.regexp?.test('/admin/settings/blog-posts/x'),
    );
    expect(guardedText).toBeTruthy();
    const guarded = (settingsRouter.stack as Array<{ route?: unknown; regexp?: RegExp }>).find(
      (l) => !l.route && l.regexp?.test('/admin/settings/blog-covers/x'),
    );
    expect(guarded).toBeTruthy();
  }, 30_000);
});
