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
}

export interface MelhorEnvioConfig {
  /** Cotação real ligada (token + CEP de origem + URL válidos). */
  enabled: boolean;
  token: string | null;
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
  } else if (token) {
    issues.push('MELHOR_ENVIO_TOKEN definido sem SHIPPING_ORIGIN_CEP — cotação do Melhor Envio desligada (frete na tabela fixa).');
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

  const enabled = Boolean(token && originCep && urlOk);

  const userAgent = clean(raw.MELHOR_ENVIO_USER_AGENT) ?? ME_DEFAULT_USER_AGENT;
  if (enabled && !userAgent.includes('@')) {
    issues.push('MELHOR_ENVIO_USER_AGENT sem e-mail de contato — a API exige "Nome do app (email)".');
  }
  if (enabled && raw.NODE_ENV === 'production' && baseUrl.includes('sandbox')) {
    issues.push('Melhor Envio apontando para o SANDBOX — os preços de frete não são reais.');
  }

  return { enabled, token, baseUrl, userAgent, timeoutMs, originCep, issues };
}
