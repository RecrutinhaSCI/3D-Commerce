/**
 * Rate limit de uploads: admin (por usuário, 120 / 10 min) e upload público de
 * orçamento (por IP, 30 / h) com contadores SEPARADOS. Sobe um app Express
 * mínimo com os limiters reais — nenhum banco é tocado.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Router } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// As rotas reais importam controllers → prisma; o mock evita conexão.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

const { adminUploadRateLimiter, quoteFilesRateLimiter } = await import('./rateLimiters');

let server: Server;
let base = '';

beforeAll(async () => {
  const app: Express = express();
  // Simula o authMiddleware: o admin chega com req.user já preenchido.
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    if (id) req.user = { id, email: `${id}@teste.local`, role: 'ADMIN' } as typeof req.user;
    next();
  });
  app.post('/admin/upload', adminUploadRateLimiter, (_req, res) => res.json({ ok: true }));
  app.post('/quotes/files', quoteFilesRateLimiter, (_req, res) => res.json({ ok: true }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, user?: string) =>
  fetch(base + path, { method: 'POST', headers: user ? { 'x-test-user': user } : {} });

async function hit(path: string, times: number, user?: string) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await post(path, user)).status);
  return statuses;
}

describe('rate limit de uploads', () => {
  it('admin: 120 uploads seguidos passam; o 121º recebe 429 com tempo de espera', async () => {
    const statuses = await hit('/admin/upload', 120, 'admin-a');
    expect(statuses.every((s) => s === 200)).toBe(true);

    const res = await post('/admin/upload', 'admin-a');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; details?: { retryAfterSeconds?: number } } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toMatch(/uploads/i);
    const wait = body.error.details?.retryAfterSeconds ?? 0;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10 * 60);
  });

  it('admin: o contador é por usuário, não por IP (mesmo IP, outro admin passa)', async () => {
    expect((await post('/admin/upload', 'admin-a')).status).toBe(429);
    expect((await post('/admin/upload', 'admin-b')).status).toBe(200);
  });

  it('público: admin estourado não afeta o upload de orçamento (contadores separados)', async () => {
    // admin-a já está em 429 (testes acima) — mesmo IP 127.0.0.1.
    const statuses = await hit('/quotes/files', 30);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('público: continua 30 / hora por IP — o 31º recebe 429', async () => {
    const res = await post('/quotes/files');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { details?: { retryAfterSeconds?: number } } };
    expect(body.error.details?.retryAfterSeconds).toBeGreaterThan(30 * 60);
  });

  it('admin: público estourado não afeta o upload do admin', async () => {
    expect((await post('/admin/upload', 'admin-c')).status).toBe(200);
  });
});

/** Middlewares da rota `METHOD path` dentro de um Router do Express. */
function routeHandlers(router: Router, method: string, path: string) {
  const layer = (router.stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>)
    .find((l) => l.route?.path === path && l.route.methods[method]);
  return layer?.route?.stack.map((s) => s.handle) ?? [];
}

describe('rotas de upload usam o limiter certo', () => {
  it('admin → adminUploadRateLimiter; orçamento público → quoteFilesRateLimiter', async () => {
    const [{ productsRouter }, { bannersRouter }, { settingsRouter }, { testimonialsRouter }, { quotesRouter }] =
      await Promise.all([
        import('../modules/products/products.routes'),
        import('../modules/banners/banners.routes'),
        import('../modules/settings/settings.routes'),
        import('../modules/testimonials/testimonials.routes'),
        import('../modules/quotes/quotes.routes'),
      ]);
    const admin: Array<[Router, string]> = [
      [productsRouter, '/admin/products/:id/images'],
      [bannersRouter, '/admin/banners/:id/image'],
      [settingsRouter, '/admin/settings/logo'],
      [settingsRouter, '/admin/settings/upload-image'],
      [testimonialsRouter, '/admin/testimonials/:id/avatar'],
    ];
    for (const [router, path] of admin) {
      const handlers = routeHandlers(router, 'post', path);
      expect(handlers, path).toContain(adminUploadRateLimiter);
      expect(handlers, path).not.toContain(quoteFilesRateLimiter);
    }
    const quote = routeHandlers(quotesRouter, 'post', '/quotes/:id/files');
    expect(quote).toContain(quoteFilesRateLimiter);
    expect(quote).not.toContain(adminUploadRateLimiter);
  }, 30_000); // importar as rotas carrega services/SDKs — lento no primeiro import
});

describe('diagnóstico de IP', () => {
  it('GET /admin/diagnostics/client-ip exige auth + admin', async () => {
    const [{ diagnosticsRouter }, { authMiddleware }, { adminMiddleware }] = await Promise.all([
      import('../routes/diagnostics.routes'),
      import('./authMiddleware'),
      import('./adminMiddleware'),
    ]);
    const handlers = routeHandlers(diagnosticsRouter, 'get', '/admin/diagnostics/client-ip');
    expect(handlers.slice(0, 2)).toEqual([authMiddleware, adminMiddleware]);
  }, 30_000);
});
