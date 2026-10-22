import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { openSecret, sealSecret, SecretBoxError } from '../../lib/secretBox';
import {
  resolveMelhorEnvioOAuthConfig,
  type MelhorEnvioEnvironment,
  type MelhorEnvioOAuthConfig,
} from '../shipping/melhorEnvioConfig';

/**
 * OAuth do aplicativo Melhor Envio (authorization code + refresh token).
 *
 * Fica POR BAIXO do cliente de cotação (`shipping/melhorEnvio.ts`): ele só
 * pede `getMelhorEnvioAccessToken()` e recebe um token válido.
 *
 *   - Endpoints oficiais: `{base}/oauth/authorize` e `POST {base}/oauth/token`
 *     (mesmo código para sandbox e produção — muda só o host).
 *   - Escopo: `shipping-calculate` (só cotação).
 *   - Access token 30 dias; refresh token 45 dias e pode ROTACIONAR a cada
 *     renovação — o novo é sempre gravado de forma atômica.
 *   - Tokens SEMPRE cifrados no banco (AES-256-GCM); state só como hash,
 *     uso único, 10 min.
 *   - Nada de token, code, state ou client secret em log, erro ou resposta.
 */

export const ME_PROVIDER = 'melhor_envio';
export const ME_OAUTH_SCOPE = 'shipping-calculate';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000;
/** Renova preventivamente quando faltam menos de 7 dias para expirar. */
export const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const LEASE_WAIT_MS = 5 * 1000;
const LEASE_POLL_MS = 250;

export interface OAuthDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Só para testes: config sem depender do `env`. */
  config?: MelhorEnvioOAuthConfig;
  sleep?: (ms: number) => Promise<void>;
}

/** Falha de token: `invalid_grant` = credencial/code/refresh recusado (não adianta repetir). */
export type OAuthTokenErrorKind = 'invalid_grant' | 'http' | 'bad_response' | 'timeout' | 'network';

export class OAuthTokenError extends Error {
  constructor(public readonly kind: OAuthTokenErrorKind) {
    super(`Falha no token do Melhor Envio (${kind}).`);
    this.name = 'OAuthTokenError';
  }
}

/** Sem token OAuth utilizável agora (o chamador decide o fallback). */
export class OAuthUnavailableError extends Error {
  constructor(public readonly reason: 'needs_reconnect' | 'refresh_failed' | 'refresh_in_progress' | 'decrypt_failed') {
    super(`Token OAuth do Melhor Envio indisponível (${reason}).`);
    this.name = 'OAuthUnavailableError';
  }
}

const cfgOf = (deps: OAuthDeps) => deps.config ?? resolveMelhorEnvioOAuthConfig(env);
const nowOf = (deps: OAuthDeps) => (deps.now ?? Date.now)();
const sleepOf = (deps: OAuthDeps) => deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
const aadOf = (environment: MelhorEnvioEnvironment) => `${ME_PROVIDER}:${environment}`;
export const hashState = (state: string) => createHash('sha256').update(state, 'utf8').digest('hex');

// Logs SEM segredo: só o código do evento.
function logWarn(event: string) {
  // eslint-disable-next-line no-console
  console.warn(`[melhor-envio:oauth] ${event}`);
}

// -----------------------------------------------------------------------------
// Autorização
// -----------------------------------------------------------------------------

/** Gera a URL do Melhor Envio para o ADMIN autorizar o app (state de uso único). */
export async function createAuthorizationUrl(userId: string, deps: OAuthDeps = {}) {
  const cfg = cfgOf(deps);
  if (!cfg.enabled || !cfg.clientId || !cfg.redirectUri) {
    throw new OAuthUnavailableError('needs_reconnect');
  }
  const state = randomBytes(32).toString('base64url');
  const expiresAt = new Date(nowOf(deps) + STATE_TTL_MS);
  await prisma.oAuthState.create({
    data: { provider: ME_PROVIDER, environment: cfg.environment, stateHash: hashState(state), userId, expiresAt },
  });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    state,
    scope: ME_OAUTH_SCOPE,
  });
  return {
    authorizationUrl: `${cfg.baseUrl}/oauth/authorize?${params.toString()}`,
    environment: cfg.environment,
    expiresAt: expiresAt.toISOString(),
  };
}

export type CallbackResult =
  | { ok: true }
  | { ok: false; reason: 'config' | 'state' | 'denied' | 'code' | 'exchange' };

/**
 * Callback público: valida e CONSOME o state (uso único, atômico), troca o
 * code pelos tokens e grava cifrado. Nunca lança — devolve só um motivo curto.
 */
export async function handleOAuthCallback(
  query: { code?: unknown; state?: unknown; error?: unknown },
  deps: OAuthDeps = {},
): Promise<CallbackResult> {
  const cfg = cfgOf(deps);
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.encryptionKey) {
    return { ok: false, reason: 'config' };
  }
  const state = typeof query.state === 'string' ? query.state : '';
  if (!state || state.length > 256) return { ok: false, reason: 'state' };

  const now = new Date(nowOf(deps));
  const stateHash = hashState(state);
  try {
    // Consumo ATÔMICO: só um request consegue marcar como usado (anti-replay).
    const consumed = await prisma.oAuthState.updateMany({
      where: { stateHash, provider: ME_PROVIDER, environment: cfg.environment, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      logWarn('callback: state inválido, expirado ou reutilizado');
      return { ok: false, reason: 'state' };
    }
    const stateRow = await prisma.oAuthState.findUnique({ where: { stateHash }, select: { userId: true } });

    if (query.error !== undefined) {
      logWarn('callback: autorização negada no Melhor Envio');
      return { ok: false, reason: 'denied' };
    }
    const code = typeof query.code === 'string' ? query.code : '';
    if (!code || code.length > 4096) return { ok: false, reason: 'code' };

    const tokens = await requestToken(
      {
        grant_type: 'authorization_code',
        client_id: Number(cfg.clientId),
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code,
      },
      cfg,
      deps,
    );
    await saveCredential(cfg, tokens, now, stateRow?.userId ?? null);
    logWarn(`callback: conectado (${cfg.environment})`);
    return { ok: true };
  } catch (err) {
    logWarn(`callback: falha na troca do code (${err instanceof OAuthTokenError ? err.kind : 'interno'})`);
    return { ok: false, reason: 'exchange' };
  }
}

// -----------------------------------------------------------------------------
// Token endpoint
// -----------------------------------------------------------------------------

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

async function requestToken(body: Record<string, unknown>, cfg: MelhorEnvioOAuthConfig, deps: OAuthDeps): Promise<TokenSet> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': cfg.userAgent },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new OAuthTokenError(controller.signal.aborted ? 'timeout' : 'network');
    }
    // 400/401: client, code ou refresh token recusados — repetir não resolve.
    if (res.status === 400 || res.status === 401) throw new OAuthTokenError('invalid_grant');
    if (!res.ok) throw new OAuthTokenError('http');

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new OAuthTokenError(controller.signal.aborted ? 'timeout' : 'bad_response');
    }
    const accessToken = json?.access_token;
    const refreshToken = json?.refresh_token;
    const expiresIn = Number(json?.expires_in);
    const tokenType = typeof json?.token_type === 'string' ? json.token_type.toLowerCase() : 'bearer';
    if (
      typeof accessToken !== 'string' || !accessToken ||
      typeof refreshToken !== 'string' || !refreshToken ||
      !Number.isFinite(expiresIn) || expiresIn <= 0 ||
      tokenType !== 'bearer'
    ) {
      throw new OAuthTokenError('bad_response');
    }
    return { accessToken, refreshToken, expiresInSec: expiresIn };
  } finally {
    clearTimeout(timer);
  }
}

function sealedData(cfg: MelhorEnvioOAuthConfig, tokens: TokenSet, now: Date) {
  const key = cfg.encryptionKey as Buffer;
  return {
    accessTokenEnc: sealSecret(tokens.accessToken, key, aadOf(cfg.environment)),
    refreshTokenEnc: sealSecret(tokens.refreshToken, key, aadOf(cfg.environment)),
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSec * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
  };
}

async function saveCredential(cfg: MelhorEnvioOAuthConfig, tokens: TokenSet, now: Date, userId: string | null) {
  const data = {
    ...sealedData(cfg, tokens, now),
    scope: ME_OAUTH_SCOPE,
    needsReconnect: false,
    lastError: null,
    refreshLockUntil: null,
    lastRefreshedAt: now,
    connectedByUserId: userId,
    connectedAt: now,
  };
  await prisma.integrationCredential.upsert({
    where: { provider_environment: { provider: ME_PROVIDER, environment: cfg.environment } },
    create: { provider: ME_PROVIDER, environment: cfg.environment, ...data },
    update: { ...data, version: { increment: 1 } },
  });
}

// -----------------------------------------------------------------------------
// Token válido para o cliente de cotação + renovação
// -----------------------------------------------------------------------------

type Credential = NonNullable<Awaited<ReturnType<typeof prisma.integrationCredential.findUnique>>>;

const findCredential = (environment: MelhorEnvioEnvironment) =>
  prisma.integrationCredential.findUnique({
    where: { provider_environment: { provider: ME_PROVIDER, environment } },
  });

function decryptAccess(cfg: MelhorEnvioOAuthConfig, cred: Credential): string {
  return openSecret(cred.accessTokenEnc, cfg.encryptionKey as Buffer, aadOf(cfg.environment));
}

async function markNeedsReconnect(id: string, lastError: string) {
  await prisma.integrationCredential.updateMany({
    where: { id },
    data: { needsReconnect: true, lastError, refreshLockUntil: null },
  });
}

/**
 * Token para chamar a API:
 *   - OAuth conectado e válido → access token (renova antes se faltar < 7 dias);
 *   - sem credencial OAuth (ou precisa reconectar) → MELHOR_ENVIO_TOKEN manual;
 *   - nada disponível → `null` (não configurado) ou OAuthUnavailableError.
 */
export async function getMelhorEnvioAccessToken(
  manualToken: string | null,
  deps: OAuthDeps = {},
): Promise<{ token: string; source: 'oauth' | 'manual' } | null> {
  const cfg = cfgOf(deps);
  const manual = manualToken ? { token: manualToken, source: 'manual' as const } : null;
  if (!cfg.enabled) return manual;

  const cred = await findCredential(cfg.environment);
  if (!cred) return manual;
  if (cred.needsReconnect) {
    if (manual) return manual;
    throw new OAuthUnavailableError('needs_reconnect');
  }

  const now = nowOf(deps);
  const expiresAt = cred.accessTokenExpiresAt.getTime();
  let current: string;
  try {
    current = decryptAccess(cfg, cred);
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    logWarn('token: não foi possível decifrar (chave trocada?) — reconexão necessária');
    await markNeedsReconnect(cred.id, 'decrypt_failed');
    if (manual) return manual;
    throw new OAuthUnavailableError('decrypt_failed');
  }
  if (expiresAt - now > REFRESH_WINDOW_MS) return { token: current, source: 'oauth' };

  try {
    return { token: await refreshMelhorEnvioToken({}, deps), source: 'oauth' };
  } catch {
    // Falha temporária com token ainda válido: segue com ele (o cron tenta de novo).
    if (expiresAt > now) return { token: current, source: 'oauth' };
    if (manual) return manual;
    throw new OAuthUnavailableError('refresh_failed');
  }
}

const inFlightRefresh = new Map<string, Promise<string>>();

/**
 * Renova o access token (refresh_token grant).
 *   - `failedAccessToken`: o token que levou 401 — se já foi trocado por outro
 *     processo/request, só devolve o novo (sem renovar de novo).
 *   - Concorrência: uma promessa por processo + LEASE no banco
 *     (refreshLockUntil) + versão otimista — só um processo chama o Melhor
 *     Envio; os demais esperam e relêem.
 *   - Refresh recusado → needsReconnect (não derruba nada).
 */
export function refreshMelhorEnvioToken(opts: { failedAccessToken?: string; force?: boolean } = {}, deps: OAuthDeps = {}): Promise<string> {
  const cfg = cfgOf(deps);
  const key = `${ME_PROVIDER}:${cfg.environment}`;
  const pending = inFlightRefresh.get(key);
  if (pending) return pending;
  const run = doRefresh(cfg, opts, deps).finally(() => inFlightRefresh.delete(key));
  inFlightRefresh.set(key, run);
  return run;
}

async function doRefresh(
  cfg: MelhorEnvioOAuthConfig,
  opts: { failedAccessToken?: string; force?: boolean },
  deps: OAuthDeps,
): Promise<string> {
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret || !cfg.encryptionKey) {
    throw new OAuthUnavailableError('needs_reconnect');
  }
  const cred = await findCredential(cfg.environment);
  if (!cred || cred.needsReconnect) throw new OAuthUnavailableError('needs_reconnect');

  const now = nowOf(deps);
  const currentAccess = decryptAccess(cfg, cred);
  // Outro request já trocou o token que falhou → usa o novo.
  if (opts.failedAccessToken && currentAccess !== opts.failedAccessToken) return currentAccess;
  // Já renovado por outro processo (fora da janela) e não é renovação forçada.
  if (!opts.force && !opts.failedAccessToken && cred.accessTokenExpiresAt.getTime() - now > REFRESH_WINDOW_MS) {
    return currentAccess;
  }

  // LEASE: só quem gravar o lock nesta versão chama o Melhor Envio.
  const leased = await prisma.integrationCredential.updateMany({
    where: {
      id: cred.id,
      version: cred.version,
      OR: [{ refreshLockUntil: null }, { refreshLockUntil: { lt: new Date(now) } }],
    },
    data: { refreshLockUntil: new Date(now + REFRESH_LEASE_MS) },
  });
  if (leased.count !== 1) return waitForOtherRefresh(cfg, cred.version, deps);

  try {
    const refreshToken = openSecret(cred.refreshTokenEnc, cfg.encryptionKey, aadOf(cfg.environment));
    const tokens = await requestToken(
      { grant_type: 'refresh_token', client_id: Number(cfg.clientId), client_secret: cfg.clientSecret, refresh_token: refreshToken },
      cfg,
      deps,
    );
    // Grava o par NOVO (o refresh pode ter rotacionado) só se a versão não mudou.
    const at = new Date(nowOf(deps));
    const saved = await prisma.integrationCredential.updateMany({
      where: { id: cred.id, version: cred.version },
      data: {
        ...sealedData(cfg, tokens, at),
        version: { increment: 1 },
        refreshLockUntil: null,
        needsReconnect: false,
        lastRefreshedAt: at,
        lastError: null,
      },
    });
    if (saved.count !== 1) logWarn('refresh: versão mudou durante a renovação');
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof OAuthTokenError && err.kind === 'invalid_grant') {
      logWarn('refresh: refresh token recusado — reconexão necessária');
      await markNeedsReconnect(cred.id, 'refresh_invalid');
    } else if (err instanceof SecretBoxError) {
      logWarn('refresh: não foi possível decifrar — reconexão necessária');
      await markNeedsReconnect(cred.id, 'decrypt_failed');
    } else {
      logWarn(`refresh: falha temporária (${err instanceof OAuthTokenError ? err.kind : 'interno'})`);
      await prisma.integrationCredential.updateMany({
        where: { id: cred.id },
        data: { lastError: 'refresh_temporary', refreshLockUntil: null },
      });
    }
    throw err;
  }
}

/** Outro processo está renovando: espera a versão mudar e usa o token novo. */
async function waitForOtherRefresh(cfg: MelhorEnvioOAuthConfig, version: number, deps: OAuthDeps): Promise<string> {
  const sleep = sleepOf(deps);
  for (let waited = 0; waited < LEASE_WAIT_MS; waited += LEASE_POLL_MS) {
    await sleep(LEASE_POLL_MS);
    const cred = await findCredential(cfg.environment);
    if (!cred || cred.needsReconnect) throw new OAuthUnavailableError('needs_reconnect');
    if (cred.version !== version) return decryptAccess(cfg, cred);
  }
  throw new OAuthUnavailableError('refresh_in_progress');
}

// -----------------------------------------------------------------------------
// Cron diário + status do admin
// -----------------------------------------------------------------------------

export type MaintenanceStatus = 'disabled' | 'not_connected' | 'needs_reconnect' | 'fresh' | 'refreshed' | 'error';

/**
 * Job do cron diário: renova preventivamente (antes da janela de 7 dias) e
 * limpa states vencidos. Separado da expiração de pedidos. Nunca lança.
 */
export async function runMelhorEnvioTokenMaintenance(deps: OAuthDeps = {}): Promise<{ status: MaintenanceStatus; statesRemoved: number }> {
  const cfg = cfgOf(deps);
  let statesRemoved = 0;
  try {
    const removed = await prisma.oAuthState.deleteMany({
      where: { provider: ME_PROVIDER, expiresAt: { lt: new Date(nowOf(deps) - 24 * 60 * 60 * 1000) } },
    });
    statesRemoved = removed.count;
    if (!cfg.enabled) return { status: 'disabled', statesRemoved };
    const cred = await findCredential(cfg.environment);
    if (!cred) return { status: 'not_connected', statesRemoved };
    if (cred.needsReconnect) return { status: 'needs_reconnect', statesRemoved };
    if (cred.accessTokenExpiresAt.getTime() - nowOf(deps) > REFRESH_WINDOW_MS) return { status: 'fresh', statesRemoved };
    await refreshMelhorEnvioToken({}, deps);
    return { status: 'refreshed', statesRemoved };
  } catch (err) {
    logWarn(`cron: manutenção do token falhou (${err instanceof OAuthTokenError ? err.kind : err instanceof OAuthUnavailableError ? err.reason : 'interno'})`);
    const cred = cfg.enabled ? await findCredential(cfg.environment).catch(() => null) : null;
    return { status: cred?.needsReconnect ? 'needs_reconnect' : 'error', statesRemoved };
  }
}

/** Status para o card do admin — NUNCA inclui token. */
export async function getMelhorEnvioOAuthStatus(manualTokenConfigured: boolean, deps: OAuthDeps = {}) {
  const cfg = cfgOf(deps);
  const cred = cfg.enabled ? await findCredential(cfg.environment) : null;
  return {
    homologationOnly: env.MELHOR_ENVIO_HOMOLOGATION_ONLY !== 'false',
    oauthConfigured: cfg.enabled,
    environment: cfg.environment,
    connected: Boolean(cred && !cred.needsReconnect),
    needsReconnect: Boolean(cred?.needsReconnect),
    accessTokenExpiresAt: cred?.accessTokenExpiresAt.toISOString() ?? null,
    refreshTokenExpiresAt: cred?.refreshTokenExpiresAt?.toISOString() ?? null,
    lastRefreshedAt: cred?.lastRefreshedAt?.toISOString() ?? null,
    connectedAt: cred?.connectedAt.toISOString() ?? null,
    lastError: cred?.lastError ?? null,
    /** Cotação usando o MELHOR_ENVIO_TOKEN manual (OAuth não conectado). */
    usingManualToken: manualTokenConfigured && !(cred && !cred.needsReconnect),
    /** Problemas de configuração (só nomes de variáveis). */
    issues: cfg.issues,
  };
}
