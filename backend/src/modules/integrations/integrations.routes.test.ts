/**
 * Rotas do OAuth (HTTP de verdade, app mínimo): início só para admin, status
 * sem token, callback público com redirecionamento genérico e sem cache.
 * Prisma mockado e `fetch` externo simulado.
 */
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const states: Array<{ stateHash: string; provider: string; environment: string; userId: string; expiresAt: Date; usedAt: Date | null }> = [];
const creds: Array<Record<string, unknown>> = [];
const prismaMock = {
  user: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id.startsWith('admin') ? { id: where.id, email: 'a@t.test', role: 'ADMIN' } : { id: where.id, email: 'c@t.test', role: 'CUSTOMER' },
    ),
  },
  oAuthState: {
    create: vi.fn(async ({ data }: { data: (typeof states)[number] }) => {
      states.push({ ...data, usedAt: null });
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { stateHash: string; expiresAt: { gt: Date } }; data: { usedAt: Date } }) => {
      const rows = states.filter((s) => s.stateHash === where.stateHash && s.usedAt === null && s.expiresAt > where.expiresAt.gt);
      rows.forEach((r) => (r.usedAt = data.usedAt));
      return { count: rows.length };
    }),
    findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) => states.find((s) => s.stateHash === where.stateHash) ?? null),
  },
  integrationCredential: {
    findUnique: vi.fn(async () => (creds[0] ? { ...creds[0] } : null)),
    upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
      creds[0] = { id: 'c1', version: 0, needsReconnect: false, connectedAt: new Date(), ...create };
      return creds[0];
    }),
  },
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));

const realFetch = globalThis.fetch;
const tokenEndpoint = vi.fn(async () =>
  new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 2592000, access_token: 'ACCESS-SECRETO', refresh_token: 'REFRESH-SECRETO' }), { status: 200 }),
);
vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
  String(input).includes('melhorenvio') ? tokenEndpoint() : realFetch(input, init),
);

const { env } = await import('../../config/env');
const { integrationsRouter } = await import('./integrations.routes');
const { errorHandler } = await import('../../middlewares/errorHandler');
const { signAuthToken } = await import('../../utils/jwt');

const SECRET = 'CLIENT-SECRET-NAO-VAZA';
const ORIGINAL = {
  MELHOR_ENVIO_CLIENT_ID: env.MELHOR_ENVIO_CLIENT_ID,
  MELHOR_ENVIO_CLIENT_SECRET: env.MELHOR_ENVIO_CLIENT_SECRET,
  MELHOR_ENVIO_REDIRECT_URI: env.MELHOR_ENVIO_REDIRECT_URI,
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: env.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY,
  MELHOR_ENVIO_BASE_URL: env.MELHOR_ENVIO_BASE_URL,
  APP_URL: env.APP_URL,
};
function setOAuth(on: boolean) {
  env.MELHOR_ENVIO_CLIENT_ID = on ? '1234' : undefined;
  env.MELHOR_ENVIO_CLIENT_SECRET = on ? SECRET : undefined;
  env.MELHOR_ENVIO_REDIRECT_URI = on ? 'https://staging.example.test/api/integrations/melhor-envio/callback' : undefined;
  env.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY = on ? randomBytes(32).toString('hex') : undefined;
  env.MELHOR_ENVIO_BASE_URL = 'https://sandbox.melhorenvio.com.br';
  env.APP_URL = 'https://loja.example.test';
}

let server: http.Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', integrationsRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  Object.assign(env, ORIGINAL);
  vi.unstubAllGlobals();
});
beforeEach(() => {
  states.length = 0;
  creds.length = 0;
  setOAuth(true);
  tokenEndpoint.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const bearer = (id: string) => ({ Authorization: `Bearer ${signAuthToken({ sub: id, email: 'x@t.test', role: id.startsWith('admin') ? 'ADMIN' : 'CUSTOMER' })}` });
const authorize = (headers: Record<string, string> = {}) =>
  realFetch(`${base}/api/admin/integrations/melhor-envio/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
const callback = (qs: string) => realFetch(`${base}/api/integrations/melhor-envio/callback?${qs}`, { redirect: 'manual' });

describe('POST /admin/integrations/melhor-envio/authorize', () => {
  it('sem login = 401; cliente da loja = 403 (nenhum state criado)', async () => {
    expect((await authorize()).status).toBe(401);
    expect((await authorize(bearer('cliente-1'))).status).toBe(403);
    expect(states).toHaveLength(0);
  });

  it('admin: devolve a URL de autorização, sem client secret', async () => {
    const res = await authorize(bearer('admin-1'));
    const text = await res.text();
    expect(res.status).toBe(200);
    const url = new URL(JSON.parse(text).data.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://sandbox.melhorenvio.com.br/oauth/authorize');
    expect(text).not.toContain(SECRET);
    expect(states[0].userId).toBe('admin-1');
  });

  it('OAuth não configurado no servidor: 503 com mensagem genérica', async () => {
    setOAuth(false);
    const res = await authorize(bearer('admin-1'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});

describe('GET /integrations/melhor-envio/callback', () => {
  it('state inválido: 302 para o admin com motivo genérico, sem cache, sem code/state na URL', async () => {
    const res = await callback('code=CODE-SECRETO&state=forjado');
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toBe('https://loja.example.test/admin/configuracoes?melhorEnvio=erro&motivo=sessao');
    expect(loc).not.toMatch(/CODE-SECRETO|forjado/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(tokenEndpoint).not.toHaveBeenCalled();
  });

  it('fluxo completo: autoriza → callback troca o code → "conectado"; replay recusado', async () => {
    const start = await (await authorize(bearer('admin-1'))).json();
    const state = new URL(start.data.authorizationUrl).searchParams.get('state')!;
    const ok = await callback(`code=abc&state=${encodeURIComponent(state)}`);
    expect(ok.headers.get('location')).toBe('https://loja.example.test/admin/configuracoes?melhorEnvio=conectado');
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(creds[0])).not.toMatch(/ACCESS-SECRETO|REFRESH-SECRETO/);

    const replay = await callback(`code=abc&state=${encodeURIComponent(state)}`);
    expect(replay.headers.get('location')).toContain('motivo=sessao');
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
  });

  it('autorização negada: motivo "negado"', async () => {
    const start = await (await authorize(bearer('admin-1'))).json();
    const state = new URL(start.data.authorizationUrl).searchParams.get('state')!;
    const res = await callback(`error=access_denied&state=${encodeURIComponent(state)}`);
    expect(res.headers.get('location')).toContain('melhorEnvio=erro&motivo=negado');
  });
});

describe('GET /admin/integrations/melhor-envio/status', () => {
  it('só admin; nunca devolve token', async () => {
    expect((await realFetch(`${base}/api/admin/integrations/melhor-envio/status`, { headers: bearer('cliente-1') })).status).toBe(403);
    const start = await (await authorize(bearer('admin-1'))).json();
    const state = new URL(start.data.authorizationUrl).searchParams.get('state')!;
    await callback(`code=abc&state=${encodeURIComponent(state)}`);
    const res = await realFetch(`${base}/api/admin/integrations/melhor-envio/status`, { headers: bearer('admin-1') });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).data).toMatchObject({ oauthConfigured: true, connected: true, environment: 'sandbox' });
    expect(text).not.toMatch(/ACCESS-SECRETO|REFRESH-SECRETO|v1\.|CLIENT-SECRET/);
  });
});

describe('montagem no apiRouter real (ordem dos routers)', () => {
  it('callback é público de verdade: nenhum router anterior exige login (302, não 401)', async () => {
    const { apiRouter } = await import('../../routes');
    const app = express();
    app.use(apiRouter);
    app.use(errorHandler);
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    try {
      const port = (srv.address() as AddressInfo).port;
      const res = await realFetch(`http://127.0.0.1:${port}/api/integrations/melhor-envio/callback?code=x&state=forjado`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('melhorEnvio=erro');
      // E o início continua protegido.
      const start = await realFetch(`http://127.0.0.1:${port}/api/admin/integrations/melhor-envio/authorize`, { method: 'POST' });
      expect(start.status).toBe(401);
    } finally {
      srv.close();
    }
  }, 30_000);
});


describe('renovação de homologação — proteção', () => {
  it('exige ADMIN e bloqueia produção/modo público antes de renovar', async () => {
    const endpoint = base+'/api/admin/integrations/melhor-envio/sandbox/refresh';
    expect((await realFetch(endpoint,{method:'POST'})).status).toBe(401);
    expect((await realFetch(endpoint,{method:'POST',headers:bearer('cliente-refresh')})).status).toBe(403);
    env.MELHOR_ENVIO_HOMOLOGATION_ONLY='false';
    expect((await realFetch(endpoint,{method:'POST',headers:bearer('admin-refresh')})).status).toBe(404);
    env.MELHOR_ENVIO_HOMOLOGATION_ONLY='true';
    env.MELHOR_ENVIO_BASE_URL='https://melhorenvio.com.br';
    expect((await realFetch(endpoint,{method:'POST',headers:bearer('admin-refresh')})).status).toBe(404);
  });
});
