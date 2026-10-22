/**
 * OAuth do Melhor Envio: URL de autorização, state (seguro, uso único,
 * expira), callback, troca do code, tokens cifrados, renovação (rotação,
 * concorrência, lease, refresh inválido), cron e status — com Prisma em
 * memória e `fetch` simulado. Nenhum banco nem API real é tocado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Prisma em memória (só os formatos de `where` usados pelo módulo)
// ---------------------------------------------------------------------------
type State = { id: string; provider: string; environment: string; stateHash: string; userId: string; expiresAt: Date; usedAt: Date | null };
type Cred = {
  id: string; provider: string; environment: string; accessTokenEnc: string; refreshTokenEnc: string;
  accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date | null; scope: string | null; version: number;
  refreshLockUntil: Date | null; needsReconnect: boolean; lastRefreshedAt: Date | null; lastError: string | null;
  connectedByUserId: string | null; connectedAt: Date; updatedAt: Date;
};
const db = { states: [] as State[], creds: [] as Cred[] };
let seq = 0;
const lte = (d: Date | null | undefined, lim: { lt?: Date; gt?: Date }) =>
  (!lim.lt || (d !== null && d !== undefined && d < lim.lt)) && (!lim.gt || (d !== null && d !== undefined && d > lim.gt));

function applyData<T extends Record<string, unknown>>(row: T, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as object)) (row as Record<string, unknown>)[k] = (row[k] as number) + (v as { increment: number }).increment;
    else (row as Record<string, unknown>)[k] = v;
  }
  (row as Record<string, unknown>).updatedAt = new Date();
}
function credMatches(c: Cred, where: Record<string, unknown>) {
  if (where.id !== undefined && c.id !== where.id) return false;
  if (where.version !== undefined && c.version !== where.version) return false;
  if (where.OR) {
    const ors = where.OR as Array<{ refreshLockUntil: null | { lt: Date } }>;
    if (!ors.some((o) => (o.refreshLockUntil === null ? c.refreshLockUntil === null : lte(c.refreshLockUntil, o.refreshLockUntil)))) return false;
  }
  return true;
}
const prismaMock = {
  oAuthState: {
    create: vi.fn(async ({ data }: { data: Omit<State, 'id' | 'usedAt'> }) => {
      const row = { id: `st${++seq}`, usedAt: null, ...data };
      db.states.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<State> }) => {
      const rows = db.states.filter(
        (s) =>
          s.stateHash === where.stateHash && s.provider === where.provider && s.environment === where.environment &&
          (where.usedAt === null ? s.usedAt === null : true) &&
          lte(s.expiresAt, where.expiresAt as { gt: Date }),
      );
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
    findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) => db.states.find((s) => s.stateHash === where.stateHash) ?? null),
    deleteMany: vi.fn(async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
      const before = db.states.length;
      db.states = db.states.filter((s) => !(s.expiresAt < where.expiresAt.lt));
      return { count: before - db.states.length };
    }),
  },
  integrationCredential: {
    findUnique: vi.fn(async ({ where }: { where: { provider_environment: { provider: string; environment: string } } }) => {
      const k = where.provider_environment;
      const c = db.creds.find((x) => x.provider === k.provider && x.environment === k.environment);
      return c ? { ...c } : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: { provider_environment: { provider: string; environment: string } }; create: Partial<Cred>; update: Record<string, unknown> }) => {
      const k = where.provider_environment;
      const existing = db.creds.find((x) => x.provider === k.provider && x.environment === k.environment);
      if (existing) {
        applyData(existing, update);
        return existing;
      }
      const row = { id: `cr${++seq}`, version: 0, refreshLockUntil: null, needsReconnect: false, lastError: null, scope: null, refreshTokenExpiresAt: null, lastRefreshedAt: null, connectedByUserId: null, connectedAt: new Date(), updatedAt: new Date(), ...create } as Cred;
      db.creds.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = db.creds.filter((c) => credMatches(c, where));
      rows.forEach((r) => applyData(r, data));
      return { count: rows.length };
    }),
  },
};
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));

const oauth = await import('./melhorEnvioOAuth');
const { openSecret } = await import('../../lib/secretBox');
const { resolveMelhorEnvioOAuthConfig } = await import('../shipping/melhorEnvioConfig');

const KEY_HEX = randomBytes(32).toString('hex');
const SECRET = 'segredo-do-cliente-NAO-PODE-VAZAR';
function cfgFor(base = 'https://sandbox.melhorenvio.com.br') {
  return resolveMelhorEnvioOAuthConfig({
    MELHOR_ENVIO_BASE_URL: base,
    MELHOR_ENVIO_CLIENT_ID: '1234',
    MELHOR_ENVIO_CLIENT_SECRET: SECRET,
    MELHOR_ENVIO_REDIRECT_URI: 'https://staging.example.test/api/integrations/melhor-envio/callback',
    MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: KEY_HEX,
    MELHOR_ENVIO_USER_AGENT: '3DCommerce (dev@loja.test)',
    MELHOR_ENVIO_TIMEOUT_MS: '2000',
  });
}

let T = Date.UTC(2026, 9, 23, 12, 0, 0);
const now = () => T;
const DAY = 24 * 60 * 60 * 1000;

let issued = 0;
/** Simula POST /oauth/token: cada emissão gera um par NOVO (rotação). */
function tokenFetch(opts: { status?: number; body?: unknown; delayMs?: number } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.status && opts.status !== 200) return new Response('{"error":"invalid_grant"}', { status: opts.status });
    const n = ++issued;
    void init;
    return new Response(
      JSON.stringify(opts.body ?? { token_type: 'Bearer', expires_in: 2592000, access_token: `access-${n}`, refresh_token: `refresh-${n}` }),
      { status: 200 },
    );
  });
}
const bodyOf = (f: ReturnType<typeof tokenFetch>, i = 0) => JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body));

async function connect(cfg = cfgFor()) {
  const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfg, now });
  const state = new URL(authorizationUrl).searchParams.get('state')!;
  const fetchImpl = tokenFetch();
  const r = await oauth.handleOAuthCallback({ code: 'code-abc', state }, { config: cfg, now, fetchImpl });
  return { r, state, fetchImpl };
}

let logs: string[] = [];
beforeEach(() => {
  db.states = [];
  db.creds = [];
  issued = 0;
  T = Date.UTC(2026, 9, 23, 12, 0, 0);
  logs = [];
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
});

// ===========================================================================
describe('URL de autorização', () => {
  it('sandbox: endpoint oficial, parâmetros e escopo só de cotação', async () => {
    const { authorizationUrl, environment } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const u = new URL(authorizationUrl);
    expect(environment).toBe('sandbox');
    expect(`${u.origin}${u.pathname}`).toBe('https://sandbox.melhorenvio.com.br/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('1234');
    expect(u.searchParams.get('redirect_uri')).toBe('https://staging.example.test/api/integrations/melhor-envio/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('shipping-calculate');
    expect(authorizationUrl).not.toContain(SECRET);
  });

  it('produção: mesmo código, só muda o host', async () => {
    const { authorizationUrl, environment } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor('https://melhorenvio.com.br'), now });
    expect(environment).toBe('production');
    expect(authorizationUrl.startsWith('https://melhorenvio.com.br/oauth/authorize?')).toBe(true);
  });

  it('state: 256 bits aleatórios, só o HASH no banco, expira em 10 min, único a cada chamada', async () => {
    const a = new URL((await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now })).authorizationUrl).searchParams.get('state')!;
    const b = new URL((await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now })).authorizationUrl).searchParams.get('state')!;
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(db.states.map((s) => s.stateHash)).toEqual([oauth.hashState(a), oauth.hashState(b)]);
    expect(JSON.stringify(db.states)).not.toContain(a);
    expect(db.states[0].expiresAt.getTime() - T).toBe(10 * 60 * 1000);
    expect(db.states[0].userId).toBe('admin1');
  });

  it('OAuth não configurado: recusa sem gravar nada', async () => {
    const off = resolveMelhorEnvioOAuthConfig({});
    await expect(oauth.createAuthorizationUrl('admin1', { config: off, now })).rejects.toBeInstanceOf(oauth.OAuthUnavailableError);
    expect(db.states).toHaveLength(0);
  });
});

// ===========================================================================
describe('callback', () => {
  it('troca o code e grava os tokens CIFRADOS (nunca em claro)', async () => {
    const { r, fetchImpl } = await connect();
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.melhorenvio.com.br/oauth/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('3DCommerce (dev@loja.test)');
    expect(bodyOf(fetchImpl)).toEqual({
      grant_type: 'authorization_code',
      client_id: 1234,
      client_secret: SECRET,
      redirect_uri: 'https://staging.example.test/api/integrations/melhor-envio/callback',
      code: 'code-abc',
    });
    const cred = db.creds[0];
    expect(cred).toMatchObject({ provider: 'melhor_envio', environment: 'sandbox', needsReconnect: false, connectedByUserId: 'admin1', scope: 'shipping-calculate' });
    expect(JSON.stringify(cred)).not.toMatch(/access-1|refresh-1/);
    expect(openSecret(cred.accessTokenEnc, Buffer.from(KEY_HEX, 'hex'), 'melhor_envio:sandbox')).toBe('access-1');
    expect(cred.accessTokenExpiresAt.getTime() - T).toBe(30 * DAY);
    expect(cred.refreshTokenExpiresAt!.getTime() - T).toBe(45 * DAY);
  });

  it('state ausente ou inválido: recusa sem chamar o Melhor Envio', async () => {
    const fetchImpl = tokenFetch();
    expect(await oauth.handleOAuthCallback({ code: 'x' }, { config: cfgFor(), now, fetchImpl })).toEqual({ ok: false, reason: 'state' });
    expect(await oauth.handleOAuthCallback({ code: 'x', state: 'forjado' }, { config: cfgFor(), now, fetchImpl })).toEqual({ ok: false, reason: 'state' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('state reutilizado (replay): segunda chamada recusada, nenhuma troca extra', async () => {
    const { state } = await connect();
    const fetchImpl = tokenFetch();
    expect(await oauth.handleOAuthCallback({ code: 'outro', state }, { config: cfgFor(), now, fetchImpl })).toEqual({ ok: false, reason: 'state' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('state expirado (> 10 min): recusa', async () => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    T += 10 * 60 * 1000 + 1;
    expect(await oauth.handleOAuthCallback({ code: 'x', state }, { config: cfgFor(), now, fetchImpl: tokenFetch() })).toEqual({ ok: false, reason: 'state' });
  });

  it('state de outro ambiente (sandbox x produção) não vale', async () => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    const prod = cfgFor('https://melhorenvio.com.br');
    expect(await oauth.handleOAuthCallback({ code: 'x', state }, { config: prod, now, fetchImpl: tokenFetch() })).toEqual({ ok: false, reason: 'state' });
  });

  it('sem code: recusa (e o state já foi consumido)', async () => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    expect(await oauth.handleOAuthCallback({ state }, { config: cfgFor(), now, fetchImpl: tokenFetch() })).toEqual({ ok: false, reason: 'code' });
    expect(db.states[0].usedAt).not.toBeNull();
  });

  it('usuário negou no Melhor Envio (?error=access_denied): motivo "denied"', async () => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    expect(await oauth.handleOAuthCallback({ state, error: 'access_denied' }, { config: cfgFor(), now, fetchImpl: tokenFetch() })).toEqual({ ok: false, reason: 'denied' });
  });

  it.each([
    ['HTTP 500', { status: 500 }],
    ['code/cliente recusado (401)', { status: 401 }],
    ['resposta sem refresh_token', { body: { token_type: 'Bearer', expires_in: 100, access_token: 'a' } }],
    ['expires_in inválido', { body: { token_type: 'Bearer', expires_in: 0, access_token: 'a', refresh_token: 'r' } }],
  ])('troca falha (%s): motivo genérico "exchange", nada gravado', async (_l, opt) => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    const r = await oauth.handleOAuthCallback({ code: 'x', state }, { config: cfgFor(), now, fetchImpl: tokenFetch(opt) });
    expect(r).toEqual({ ok: false, reason: 'exchange' });
    expect(db.creds).toHaveLength(0);
  });

  it('JSON inválido na troca: "exchange"', async () => {
    const { authorizationUrl } = await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    const html = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await oauth.handleOAuthCallback({ code: 'x', state }, { config: cfgFor(), now, fetchImpl: html as unknown as typeof fetch })).toEqual({ ok: false, reason: 'exchange' });
  });
});

// ===========================================================================
describe('token válido para a cotação', () => {
  it('sem OAuth configurado: usa o token manual (sem tocar no banco)', async () => {
    expect(await oauth.getMelhorEnvioAccessToken('manual-1', { config: resolveMelhorEnvioOAuthConfig({}), now })).toEqual({ token: 'manual-1', source: 'manual' });
    expect(prismaMock.integrationCredential.findUnique).not.toHaveBeenCalled();
  });

  it('OAuth configurado mas não conectado: manual; sem manual = null', async () => {
    expect(await oauth.getMelhorEnvioAccessToken('manual-1', { config: cfgFor(), now })).toEqual({ token: 'manual-1', source: 'manual' });
    expect(await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now })).toBeNull();
  });

  it('conectado: prefere o token OAuth ao manual', async () => {
    await connect();
    expect(await oauth.getMelhorEnvioAccessToken('manual-1', { config: cfgFor(), now })).toEqual({ token: 'access-1', source: 'oauth' });
  });

  it('perto de expirar (< 7 dias): renova antes, grava o par NOVO (rotação) e sobe a versão', async () => {
    await connect();
    T += 24 * DAY;
    const fetchImpl = tokenFetch();
    expect(await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now, fetchImpl })).toEqual({ token: 'access-2', source: 'oauth' });
    expect(bodyOf(fetchImpl)).toEqual({ grant_type: 'refresh_token', client_id: 1234, client_secret: SECRET, refresh_token: 'refresh-1' });
    const cred = db.creds[0];
    expect(openSecret(cred.refreshTokenEnc, Buffer.from(KEY_HEX, 'hex'), 'melhor_envio:sandbox')).toBe('refresh-2');
    expect(cred.version).toBe(1);
    expect(cred.refreshLockUntil).toBeNull();
    expect(cred.accessTokenExpiresAt.getTime() - T).toBe(30 * DAY);
  });

  it('refresh recusado (expirado/revogado): needsReconnect, sem derrubar; cai no manual se houver', async () => {
    await connect();
    T += 31 * DAY; // access expirado
    const fetchImpl = tokenFetch({ status: 400 });
    expect(await oauth.getMelhorEnvioAccessToken('manual-1', { config: cfgFor(), now, fetchImpl })).toEqual({ token: 'manual-1', source: 'manual' });
    expect(db.creds[0]).toMatchObject({ needsReconnect: true, lastError: 'refresh_invalid' });
    // Sem manual: indisponível (o checkout trata como "só retirada").
    await expect(oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now })).rejects.toMatchObject({ reason: 'needs_reconnect' });
  });

  it('falha TEMPORÁRIA no refresh com token ainda válido: segue com o atual', async () => {
    await connect();
    T += 25 * DAY;
    const r = await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now, fetchImpl: tokenFetch({ status: 503 }) });
    expect(r).toEqual({ token: 'access-1', source: 'oauth' });
    expect(db.creds[0]).toMatchObject({ needsReconnect: false, lastError: 'refresh_temporary', refreshLockUntil: null });
  });

  it('concorrência: 5 pedidos simultâneos perto da expiração = UM refresh', async () => {
    await connect();
    T += 24 * DAY;
    const fetchImpl = tokenFetch({ delayMs: 20 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now, fetchImpl })),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r!.token))).toEqual(new Set(['access-2']));
  });

  it('lease de outro processo: espera a versão mudar e usa o token novo, sem chamar o Melhor Envio', async () => {
    await connect();
    T += 24 * DAY;
    db.creds[0].refreshLockUntil = new Date(T + 30_000); // outro processo renovando
    const fetchImpl = tokenFetch();
    let polls = 0;
    const sleep = async () => {
      if (++polls === 2) {
        // o "outro processo" termina: grava um par novo e sobe a versão
        const { sealSecret } = await import('../../lib/secretBox');
        Object.assign(db.creds[0], {
          accessTokenEnc: sealSecret('access-outro', Buffer.from(KEY_HEX, 'hex'), 'melhor_envio:sandbox'),
          accessTokenExpiresAt: new Date(T + 30 * DAY),
          version: db.creds[0].version + 1,
          refreshLockUntil: null,
        });
      }
    };
    const token = await oauth.refreshMelhorEnvioToken({ force: true }, { config: cfgFor(), now, fetchImpl, sleep });
    expect(token).toBe('access-outro');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 com token que JÁ foi trocado por outro request: devolve o novo sem renovar', async () => {
    await connect();
    const fetchImpl = tokenFetch();
    expect(await oauth.refreshMelhorEnvioToken({ failedAccessToken: 'access-antigo' }, { config: cfgFor(), now, fetchImpl })).toBe('access-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sandbox e produção têm credenciais separadas', async () => {
    await connect(cfgFor());
    expect(await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor('https://melhorenvio.com.br'), now })).toBeNull();
  });

  it('chave de cifragem trocada: needsReconnect (não derruba)', async () => {
    await connect();
    const other = resolveMelhorEnvioOAuthConfig({
      MELHOR_ENVIO_CLIENT_ID: '1234', MELHOR_ENVIO_CLIENT_SECRET: SECRET,
      MELHOR_ENVIO_REDIRECT_URI: 'https://staging.example.test/cb', MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    });
    expect(await oauth.getMelhorEnvioAccessToken('manual-1', { config: other, now })).toEqual({ token: 'manual-1', source: 'manual' });
    expect(db.creds[0]).toMatchObject({ needsReconnect: true, lastError: 'decrypt_failed' });
  });
});

// ===========================================================================
describe('cron diário e status', () => {
  it('estados: disabled → not_connected → fresh → refreshed → needs_reconnect', async () => {
    expect((await oauth.runMelhorEnvioTokenMaintenance({ config: resolveMelhorEnvioOAuthConfig({}), now })).status).toBe('disabled');
    expect((await oauth.runMelhorEnvioTokenMaintenance({ config: cfgFor(), now })).status).toBe('not_connected');
    await connect();
    expect((await oauth.runMelhorEnvioTokenMaintenance({ config: cfgFor(), now })).status).toBe('fresh');
    T += 24 * DAY;
    expect((await oauth.runMelhorEnvioTokenMaintenance({ config: cfgFor(), now, fetchImpl: tokenFetch() })).status).toBe('refreshed');
    T += 24 * DAY;
    expect((await oauth.runMelhorEnvioTokenMaintenance({ config: cfgFor(), now, fetchImpl: tokenFetch({ status: 401 }) })).status).toBe('needs_reconnect');
  });

  it('limpa states vencidos há mais de 1 dia', async () => {
    await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    T += 2 * DAY;
    await oauth.createAuthorizationUrl('admin1', { config: cfgFor(), now });
    const r = await oauth.runMelhorEnvioTokenMaintenance({ config: cfgFor(), now });
    expect(r.statesRemoved).toBe(1);
    expect(db.states).toHaveLength(1);
  });

  it('status do admin nunca inclui token', async () => {
    await connect();
    const s = await oauth.getMelhorEnvioOAuthStatus(false, { config: cfgFor(), now });
    expect(s).toMatchObject({ oauthConfigured: true, environment: 'sandbox', connected: true, needsReconnect: false, usingManualToken: false });
    expect(JSON.stringify(s)).not.toMatch(/access-|refresh-|v1\.|segredo/);
  });
});

// ===========================================================================
describe('segredos fora de logs', () => {
  it('nenhum log do fluxo inteiro contém code, state, tokens ou client secret', async () => {
    const { state } = await connect();
    T += 24 * DAY;
    await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now, fetchImpl: tokenFetch() });
    T += 31 * DAY;
    await oauth.getMelhorEnvioAccessToken(null, { config: cfgFor(), now, fetchImpl: tokenFetch({ status: 400 }) }).catch(() => null);
    await oauth.handleOAuthCallback({ code: 'code-xyz', state }, { config: cfgFor(), now, fetchImpl: tokenFetch() });
    const all = logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [SECRET, state, 'code-abc', 'code-xyz', 'access-1', 'refresh-1', 'access-2', 'refresh-2', KEY_HEX]) {
      expect(all).not.toContain(secret);
    }
  });
});
