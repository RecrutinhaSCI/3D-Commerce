/**
 * Configuração do Melhor Envio — resolvida a partir das variáveis CRUAS.
 *
 * O Melhor Envio é opcional: valor inválido aqui NUNCA derruba o servidor.
 * Em vez disso a cotação real fica desligada (ou o valor cai no padrão) e o
 * motivo vai para `issues`, logado no boot e listado por `npm run check:config`.
 *
 * Função pura, sem importar `env` (o `config/env.ts` a usa — evita ciclo).
 */

export const ME_DEFAULT_BASE_URL = 'https://sandbox.melhorenvio.com.br';
export const ME_DEFAULT_USER_AGENT = '3DCommerce';
export const ME_DEFAULT_TIMEOUT_MS = 8000;
export const ME_TIMEOUT_RANGE = { min: 1000, max: 30000 } as const;

export interface MelhorEnvioRawEnv {
  NODE_ENV?: string;
  MELHOR_ENVIO_TOKEN?: string;
  MELHOR_ENVIO_BASE_URL?: string;
  MELHOR_ENVIO_USER_AGENT?: string;
  MELHOR_ENVIO_TIMEOUT_MS?: string | number;
  SHIPPING_ORIGIN_CEP?: string;
  MELHOR_ENVIO_CLIENT_ID?: string;
  MELHOR_ENVIO_CLIENT_SECRET?: string;
  MELHOR_ENVIO_REDIRECT_URI?: string;
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?: string;
}

export type MelhorEnvioEnvironment = 'sandbox' | 'production';

export interface MelhorEnvioConfig {
  /** Cotação real ligada (token manual OU OAuth + CEP de origem + URL válidos). */
  enabled: boolean;
  /** Token MANUAL (MELHOR_ENVIO_TOKEN) — fallback enquanto o OAuth não conecta. */
  token: string | null;
  /** OAuth do aplicativo configurado (a credencial em si fica no banco). */
  oauthEnabled: boolean;
  environment: MelhorEnvioEnvironment;
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  originCep: string | null;
  /** Problemas de configuração (sem valores sensíveis). */
  issues: string[];
}

const clean = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/^["']|["']$/g, '').trim();
  return s === '' ? undefined : s;
};

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function resolveMelhorEnvioConfig(raw: MelhorEnvioRawEnv): MelhorEnvioConfig {
  const issues: string[] = [];
  const token = clean(raw.MELHOR_ENVIO_TOKEN) ?? null;

  // URL base: inválida desliga a cotação (não dá para adivinhar o destino).
  const rawUrl = clean(raw.MELHOR_ENVIO_BASE_URL);
  let baseUrl = ME_DEFAULT_BASE_URL;
  let urlOk = true;
  if (rawUrl !== undefined) {
    if (isHttpUrl(rawUrl)) baseUrl = rawUrl.replace(/\/+$/, '');
    else {
      urlOk = false;
      issues.push('MELHOR_ENVIO_BASE_URL inválida — cotação do Melhor Envio desligada.');
    }
  }

  // CEP de origem: aceita com máscara; tamanho errado desliga a cotação.
  const rawCep = clean(raw.SHIPPING_ORIGIN_CEP);
  let originCep: string | null = null;
  if (rawCep !== undefined) {
    const digits = rawCep.replace(/\D/g, '');
    if (/^\d{8}$/.test(digits)) originCep = digits;
    else issues.push('SHIPPING_ORIGIN_CEP inválido (precisa ter 8 dígitos) — cotação do Melhor Envio desligada.');
  } else if (token || oauthCompleteHint(raw)) {
    issues.push('Melhor Envio (token ou OAuth) definido sem SHIPPING_ORIGIN_CEP — cotação do Melhor Envio desligada (frete na tabela fixa).');
  }

  // Timeout: fora da faixa cai no padrão (não desliga nada).
  let timeoutMs = ME_DEFAULT_TIMEOUT_MS;
  const rawTimeout = typeof raw.MELHOR_ENVIO_TIMEOUT_MS === 'number' ? raw.MELHOR_ENVIO_TIMEOUT_MS : clean(raw.MELHOR_ENVIO_TIMEOUT_MS);
  if (rawTimeout !== undefined) {
    const n = Number(rawTimeout);
    if (Number.isInteger(n) && n >= ME_TIMEOUT_RANGE.min && n <= ME_TIMEOUT_RANGE.max) timeoutMs = n;
    else {
      issues.push(
        `MELHOR_ENVIO_TIMEOUT_MS inválido (use ${ME_TIMEOUT_RANGE.min} a ${ME_TIMEOUT_RANGE.max}) — usando ${ME_DEFAULT_TIMEOUT_MS} ms.`,
      );
    }
  }

  const oauthEnabled = urlOk && resolveMelhorEnvioOAuthConfig(raw).enabled;
  const enabled = Boolean((token || oauthEnabled) && originCep && urlOk);

  const userAgent = clean(raw.MELHOR_ENVIO_USER_AGENT) ?? ME_DEFAULT_USER_AGENT;
  if (enabled && !userAgent.includes('@')) {
    issues.push('MELHOR_ENVIO_USER_AGENT sem e-mail de contato — a API exige "Nome do app (email)".');
  }
  if (enabled && raw.NODE_ENV === 'production' && baseUrl.includes('sandbox')) {
    issues.push('Melhor Envio apontando para o SANDBOX — os preços de frete não são reais.');
  }

  return { enabled, token, oauthEnabled, environment: environmentOf(baseUrl), baseUrl, userAgent, timeoutMs, originCep, issues };
}

/** Produção só no host oficial; qualquer outro (sandbox, mock local) = sandbox. */
export function environmentOf(baseUrl: string): MelhorEnvioEnvironment {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'melhorenvio.com.br' || host === 'www.melhorenvio.com.br' ? 'production' : 'sandbox';
  } catch {
    return 'sandbox';
  }
}

const oauthCompleteHint = (raw: MelhorEnvioRawEnv) =>
  Boolean(clean(raw.MELHOR_ENVIO_CLIENT_ID) && clean(raw.MELHOR_ENVIO_CLIENT_SECRET));

// -----------------------------------------------------------------------------
// OAuth do aplicativo (authorization code + refresh token)
// -----------------------------------------------------------------------------

export interface MelhorEnvioOAuthConfig {
  /** Client ID/secret, redirect URI e chave de cifragem válidos. */
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  /** Chave AES-256 (32 bytes) dos tokens no banco. */
  encryptionKey: Buffer | null;
  baseUrl: string;
  environment: MelhorEnvioEnvironment;
  userAgent: string;
  timeoutMs: number;
  /** Problemas (só NOMES de variáveis — nunca valores). */
  issues: string[];
}

/** Chave de 32 bytes em hex (64 caracteres) ou base64. */
export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  const v = clean(raw);
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  const b = Buffer.from(v, 'base64');
  return b.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(v) ? b : null;
}

export function resolveMelhorEnvioOAuthConfig(raw: MelhorEnvioRawEnv): MelhorEnvioOAuthConfig {
  const issues: string[] = [];
  const clientId = clean(raw.MELHOR_ENVIO_CLIENT_ID) ?? null;
  const clientSecret = clean(raw.MELHOR_ENVIO_CLIENT_SECRET) ?? null;
  const redirectUri = clean(raw.MELHOR_ENVIO_REDIRECT_URI) ?? null;
  const rawKey = clean(raw.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY);

  const rawUrl = clean(raw.MELHOR_ENVIO_BASE_URL);
  const baseUrl = rawUrl && isHttpUrl(rawUrl) ? rawUrl.replace(/\/+$/, '') : ME_DEFAULT_BASE_URL;
  const userAgent = clean(raw.MELHOR_ENVIO_USER_AGENT) ?? ME_DEFAULT_USER_AGENT;
  const t = Number(typeof raw.MELHOR_ENVIO_TIMEOUT_MS === 'number' ? raw.MELHOR_ENVIO_TIMEOUT_MS : clean(raw.MELHOR_ENVIO_TIMEOUT_MS));
  const timeoutMs = Number.isInteger(t) && t >= ME_TIMEOUT_RANGE.min && t <= ME_TIMEOUT_RANGE.max ? t : ME_DEFAULT_TIMEOUT_MS;
  const base = { baseUrl, environment: environmentOf(baseUrl), userAgent, timeoutMs };

  const anySet = Boolean(clientId || clientSecret || redirectUri || rawKey);
  if (!anySet) {
    return { enabled: false, clientId: null, clientSecret: null, redirectUri: null, encryptionKey: null, ...base, issues };
  }

  const missing = [
    !clientId && 'MELHOR_ENVIO_CLIENT_ID',
    !clientSecret && 'MELHOR_ENVIO_CLIENT_SECRET',
    !redirectUri && 'MELHOR_ENVIO_REDIRECT_URI',
    !rawKey && 'MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY',
  ].filter(Boolean);
  if (missing.length) issues.push(`OAuth do Melhor Envio incompleto (faltam ${missing.join(', ')}) — OAuth desligado.`);

  if (clientId && !/^\d+$/.test(clientId)) issues.push('MELHOR_ENVIO_CLIENT_ID inválido (precisa ser numérico) — OAuth desligado.');

  let redirectOk = false;
  if (redirectUri) {
    try {
      const u = new URL(redirectUri);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      redirectOk = u.protocol === 'https:' || (u.protocol === 'http:' && local && raw.NODE_ENV !== 'production');
    } catch {
      redirectOk = false;
    }
    if (!redirectOk) issues.push('MELHOR_ENVIO_REDIRECT_URI inválida (use HTTPS; http só em localhost fora de produção) — OAuth desligado.');
  }

  const encryptionKey = parseEncryptionKey(rawKey);
  if (rawKey && !encryptionKey) {
    issues.push('MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY inválida (32 bytes em hex de 64 caracteres ou base64) — OAuth desligado.');
  }

  const enabled = Boolean(missing.length === 0 && /^\d+$/.test(clientId ?? '') && redirectOk && encryptionKey);
  return {
    enabled,
    clientId: enabled ? clientId : null,
    clientSecret: enabled ? clientSecret : null,
    redirectUri: enabled ? redirectUri : null,
    encryptionKey: enabled ? encryptionKey : null,
    ...base,
    issues,
  };
}
