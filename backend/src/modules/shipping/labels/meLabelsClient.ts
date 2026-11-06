import { env } from '../../../config/env';
import {
  getMelhorEnvioAccessToken,
  OAuthTokenError,
  OAuthUnavailableError,
  refreshMelhorEnvioToken,
} from '../../integrations/melhorEnvioOAuth';
import {
  resolveMelhorEnvioConfig,
  resolveMelhorEnvioLabelsConfig,
  type MelhorEnvioEnvironment,
} from '../melhorEnvioConfig';
import {
  extractErrorInfo,
  FINANCIAL_OPERATIONS,
  LabelApiError,
  MUTATING_OPERATIONS,
  sanitizeExternalMessage,
  type LabelApiErrorCode,
  type LabelOperation,
} from './labelErrors';
import type { MeCartPayload } from './payload';

/**
 * Cliente das ETIQUETAS do Melhor Envio (API v2). Só HTTP + tradução de
 * respostas/erros — não decide fluxo, não grava banco, não mexe em pedido.
 *
 *   cart.add      POST   /api/v2/me/cart
 *   cart.remove   DELETE /api/v2/me/cart/{id}
 *   order.get     GET    /api/v2/me/orders/{id}
 *   order.search  GET    /api/v2/me/orders/search?q=
 *   checkout      POST   /api/v2/me/shipment/checkout      { orders: [id] }
 *   generate      POST   /api/v2/me/shipment/generate      { orders: [id] }
 *   print         POST   /api/v2/me/shipment/print         { mode: "private", orders: [id] }
 *   print.file    GET    /api/v2/me/imprimir/pdf/{id}
 *   tracking      POST   /api/v2/me/shipment/tracking      { orders: [id] }
 *   cancellable   POST   /api/v2/me/shipment/cancellable   { orders: [id] }
 *   cancel        POST   /api/v2/me/shipment/cancel        { order: { id, reason_id, description } }
 *
 * Regras:
 *   - Token SÓ do OAuth existente (sem fallback para o token manual da cotação).
 *   - 401 → renova o OAuth UMA vez e repete UMA vez (o 401 chega antes de
 *     qualquer processamento, então repetir não duplica compra).
 *   - Timeout/rede/5xx/corpo ilegível NUNCA são repetidos aqui: viram erro com
 *     `outcome: 'unknown'` (e reconciliação, se a operação altera algo).
 *   - Travas: tudo exige MELHOR_ENVIO_LABELS_ENABLED; operações que alteram
 *     algo na API de PRODUÇÃO exigem também MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION.
 *   - Log: só operação + código. Nunca token, payload, endereço ou resposta.
 */

export interface MeLabelsRuntimeConfig {
  enabled: boolean;
  allowProduction: boolean;
  environment: MelhorEnvioEnvironment;
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
}

export interface MeLabelsDeps {
  fetchImpl?: typeof fetch;
  /** Padrão: resolvida do env a cada chamada. */
  config?: MeLabelsRuntimeConfig;
  /** Padrão: OAuth existente (sem token manual). */
  getToken?: () => Promise<string | null>;
  /** Padrão: renovação do OAuth existente. */
  refreshToken?: (failedAccessToken: string) => Promise<string>;
  /** Padrão: console.warn (só operação + código). */
  log?: (line: string) => void;
}

export function labelsRuntimeConfig(): MeLabelsRuntimeConfig {
  const base = resolveMelhorEnvioConfig(env);
  const labels = resolveMelhorEnvioLabelsConfig(env);
  return {
    enabled: labels.enabled,
    allowProduction: labels.allowProduction,
    environment: labels.environment,
    baseUrl: base.baseUrl,
    userAgent: base.userAgent,
    timeoutMs: labels.timeoutMs,
  };
}

// -----------------------------------------------------------------------------
// Tipos de resposta (só o que usamos; valores numéricos já convertidos)
// -----------------------------------------------------------------------------

export interface MeLabelDates {
  createdAt: string | null;
  paidAt: string | null;
  generatedAt: string | null;
  postedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  expiredAt: string | null;
}

export interface MeCartItem {
  id: string;
  protocol: string | null;
  serviceId: number | null;
  price: number | null;
  status: string | null;
}

export interface MeOrderInfo {
  id: string;
  protocol: string | null;
  status: string | null;
  serviceId: number | null;
  price: number | null;
  tracking: string | null;
  selfTracking: string | null;
  dates: MeLabelDates;
}

export interface MeCheckoutResult {
  purchaseId: string | null;
  protocol: string | null;
  status: string | null;
  total: number | null;
  paidAt: string | null;
  /** A etiqueta pedida, como veio na compra. */
  order: { id: string; status: string | null; price: number | null };
}

export interface MeGenerateResult {
  accepted: boolean;
  message: string | null;
}

export interface MeTrackingInfo {
  id: string;
  status: string | null;
  tracking: string | null;
  selfTracking: string | null;
  dates: MeLabelDates;
}

export interface MeCancellableInfo {
  cancellable: boolean;
}

// -----------------------------------------------------------------------------
// Conversões tolerantes
// -----------------------------------------------------------------------------

/** UUID/IDs do Melhor Envio: só caracteres seguros (vai na URL). */
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, max = 80): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Status do ME: só [a-z_], minúsculo (nunca texto livre). */
function status(v: unknown): string | null {
  const s = str(v, 40)?.toLowerCase() ?? null;
  return s && /^[a-z_]+$/.test(s) ? s : null;
}

/** Código de rastreio: alfanumérico simples. */
function trackingCode(v: unknown): string | null {
  const s = str(v, 60);
  return s && /^[A-Za-z0-9-]+$/.test(s) ? s : null;
}

/**
 * Datas do ME vêm SEM fuso ("2026-11-06 20:44:41") e estão em UTC — observado
 * no Sandbox (06/11/2026): created_at = hora UTC da requisição (±1 s). Sem o
 * "Z", Date.parse usaria o fuso do servidor (+3 h numa máquina em Brasília).
 * Com fuso explícito (Z ou ±hh:mm), respeita o informado.
 */
function date(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const t = Date.parse(hasZone || !/T\d{2}:\d{2}/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function dates(o: Record<string, unknown>): MeLabelDates {
  return {
    createdAt: date(o.created_at),
    paidAt: date(o.paid_at),
    generatedAt: date(o.generated_at),
    postedAt: date(o.posted_at),
    deliveredAt: date(o.delivered_at),
    canceledAt: date(o.canceled_at),
    expiredAt: date(o.expired_at),
  };
}

function parseOrder(o: unknown): MeOrderInfo | null {
  if (!isObj(o)) return null;
  const id = str(o.id, 64);
  if (!id || !ID_RE.test(id)) return null;
  return {
    id,
    protocol: str(o.protocol),
    status: status(o.status),
    serviceId: num(o.service_id),
    price: num(o.price),
    tracking: trackingCode(o.tracking),
    selfTracking: trackingCode(o.self_tracking),
    dates: dates(o),
  };
}

function httpsUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Cliente
// -----------------------------------------------------------------------------

const MESSAGES: Record<LabelApiErrorCode, string> = {
  OPERATION_BLOCKED: 'Operação de etiqueta bloqueada pelas travas do servidor.',
  NOT_CONFIGURED: 'Integração de etiquetas do Melhor Envio não configurada.',
  NEEDS_RECONNECT: 'Conexão com o Melhor Envio precisa ser refeita em Configurações.',
  UNAUTHORIZED: 'O Melhor Envio recusou a credencial. Tente novamente em instantes.',
  FORBIDDEN: 'A conta conectada não tem permissão para esta operação (escopos de etiqueta).',
  NOT_FOUND: 'Etiqueta não encontrada no Melhor Envio.',
  VALIDATION: 'O Melhor Envio recusou os dados enviados.',
  // Texto real do 422: "Existe uma ou mais orders que já foram pagas ou inválidas."
  // (também para id removido/inexistente). Etiqueta REALMENTE paga responde 204.
  ALREADY_PAID: 'O Melhor Envio informou que a etiqueta já foi paga ou não é mais válida.',
  NOT_CANCELLABLE: 'O Melhor Envio não permitiu cancelar esta etiqueta.',
  GENERATION_FAILED: 'O Melhor Envio não gerou a etiqueta.',
  RATE_LIMITED: 'Muitas requisições ao Melhor Envio. Aguarde e tente de novo.',
  SERVER_ERROR: 'O Melhor Envio está instável no momento.',
  TIMEOUT: 'O Melhor Envio demorou para responder.',
  NETWORK: 'Não foi possível falar com o Melhor Envio.',
  BAD_RESPONSE: 'Resposta inesperada do Melhor Envio.',
  UNKNOWN: 'Erro inesperado do Melhor Envio.',
};

/**
 * Allowlist EXPLÍCITA dos hosts de onde o backend aceita baixar o PDF (a URL
 * inicial e CADA redirect). Novo host/CDN só entra aqui depois de visto no
 * Sandbox. Só HTTPS; IP literal e nomes locais nunca passam.
 */
export const LABEL_FILE_ALLOWED_DOMAINS: readonly string[] = ['melhorenvio.com.br'];
export const MAX_LABEL_FILE_REDIRECTS = 3;
const MAX_LABEL_PDF_BYTES = 10 * 1024 * 1024;

/** URL permitida para baixar o PDF? (HTTPS + host da allowlist ou subdomínio; sem credenciais/porta estranha.) */
export function isAllowedLabelFileUrl(raw: string | URL): boolean {
  let u: URL;
  try {
    u = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  // IP literal (v4/v6) ou nome local: nunca, mesmo que a allowlist mude.
  if (/^\[.*\]$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  return LABEL_FILE_ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

const ALREADY_PAID_RE =/j[áa]\s+(foram|foi)\s+pag|already\s+(been\s+)?paid/i;

type Raw = { status: number; body: unknown; headers: Headers };

export function createMeLabelsClient(deps: MeLabelsDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const log = deps.log ?? ((line: string) => console.warn(line));

  const fail = (
    operation: LabelOperation,
    code: LabelApiErrorCode,
    outcome: 'not_sent' | 'rejected' | 'unknown',
    extra: Partial<ConstructorParameters<typeof LabelApiError>[0]> = {},
  ): never => {
    const err = new LabelApiError({ operation, code, outcome, message: MESSAGES[code], ...extra });
    log(`[melhor-envio:etiquetas] ${operation} → ${code}${err.httpStatus ? ` (${err.httpStatus})` : ''}`);
    throw err;
  };

  function guard(operation: LabelOperation): MeLabelsRuntimeConfig {
    const cfg = deps.config ?? labelsRuntimeConfig();
    if (!cfg.enabled) return fail(operation, 'OPERATION_BLOCKED', 'not_sent');
    if (cfg.environment === 'production' && MUTATING_OPERATIONS.includes(operation) && !cfg.allowProduction) {
      return fail(operation, 'OPERATION_BLOCKED', 'not_sent');
    }
    return cfg;
  }

  async function token(operation: LabelOperation): Promise<string> {
    try {
      const t = deps.getToken ? await deps.getToken() : (await getMelhorEnvioAccessToken(null))?.token ?? null;
      if (!t) return fail(operation, 'NOT_CONFIGURED', 'not_sent');
      return t;
    } catch (err) {
      if (err instanceof LabelApiError) throw err;
      if (err instanceof OAuthUnavailableError) return fail(operation, 'NEEDS_RECONNECT', 'not_sent');
      return fail(operation, 'UNAUTHORIZED', 'not_sent');
    }
  }

  async function refreshed(operation: LabelOperation, failed: string): Promise<string> {
    try {
      return await (deps.refreshToken ?? ((f: string) => refreshMelhorEnvioToken({ failedAccessToken: f })))(failed);
    } catch (err) {
      const reconnect = err instanceof OAuthUnavailableError || (err instanceof OAuthTokenError && err.kind === 'invalid_grant');
      return fail(operation, reconnect ? 'NEEDS_RECONNECT' : 'UNAUTHORIZED', 'rejected', { httpStatus: 401 });
    }
  }

  /** Uma ida HTTP. Erros de transporte viram LabelApiError com outcome 'unknown'. */
  async function send(cfg: MeLabelsRuntimeConfig, operation: LabelOperation, method: string, path: string, body: unknown, accessToken: string): Promise<Raw> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(`${cfg.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            'User-Agent': cfg.userAgent,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const aborted = controller.signal.aborted || (err as Error)?.name === 'AbortError';
        return fail(operation, aborted ? 'TIMEOUT' : 'NETWORK', 'unknown');
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        return fail(operation, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', 'unknown', { httpStatus: res.status });
      }
      let parsed: unknown = undefined;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text.slice(0, 500);
        }
      }
      return { status: res.status, body: parsed, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Requisição completa: trava, token, 401→renova uma vez, tradução de erro HTTP. */
  async function call(operation: LabelOperation, method: string, path: string, body?: unknown): Promise<Raw> {
    const cfg = guard(operation);
    let accessToken = await token(operation);
    let res = await send(cfg, operation, method, path, body, accessToken);
    if (res.status === 401) {
      accessToken = await refreshed(operation, accessToken);
      res = await send(cfg, operation, method, path, body, accessToken);
      if (res.status === 401) return fail(operation, 'NEEDS_RECONNECT', 'rejected', { httpStatus: 401 });
    }
    if (res.status >= 200 && res.status < 300) return res;
    return httpError(operation, res);
  }

  function httpError(operation: LabelOperation, res: Raw): never {
    const info = extractErrorInfo(res.body);
    const externalMessage = sanitizeExternalMessage(info.messages.join(' · '));
    const extra = { httpStatus: res.status, externalMessage, fields: info.fields };
    const s = res.status;
    if (s === 403) return fail(operation, 'FORBIDDEN', 'rejected', extra);
    if (s === 404) return fail(operation, 'NOT_FOUND', 'rejected', extra);
    if (s === 429) {
      const retry = num(res.headers.get('retry-after'));
      return fail(operation, 'RATE_LIMITED', 'rejected', { ...extra, retryAfterSeconds: retry !== null && retry >= 0 ? retry : null });
    }
    if (s === 400 || s === 422) {
      if (operation === 'checkout' && info.messages.some((m) => ALREADY_PAID_RE.test(m))) {
        return fail(operation, 'ALREADY_PAID', 'rejected', extra);
      }
      if (operation === 'cancel') return fail(operation, 'NOT_CANCELLABLE', 'rejected', extra);
      return fail(operation, 'VALIDATION', 'rejected', extra);
    }
    if (s >= 500) return fail(operation, 'SERVER_ERROR', 'unknown', extra);
    // 3xx, 409, outros 4xx: não sabemos o que aconteceu do lado de lá.
    return fail(operation, 'UNKNOWN', 'unknown', extra);
  }

  const badResponse = (operation: LabelOperation, httpStatus: number): never => fail(operation, 'BAD_RESPONSE', 'unknown', { httpStatus });

  const assertId = (operation: LabelOperation, id: string) => {
    if (!ID_RE.test(id)) fail(operation, 'VALIDATION', 'not_sent');
  };

  /** Mapa `{ [id]: {...} }` das rotas em lote: pega o item da nossa etiqueta. */
  const entryFor = (body: unknown, id: string) => (isObj(body) && isObj(body[id]) ? (body[id] as Record<string, unknown>) : null);

  return {
    /** Insere o frete no carrinho. Devolve o id (UUID) a ser gravado ANTES de qualquer checkout. */
    async addToCart(payload: MeCartPayload): Promise<MeCartItem> {
      const op = 'cart.add';
      const res = await call(op, 'POST', '/api/v2/me/cart', payload);
      const o = isObj(res.body) ? res.body : null;
      const id = o ? str(o.id, 64) : null;
      if (!o || !id || !ID_RE.test(id)) return badResponse(op, res.status);
      return { id, protocol: str(o.protocol), serviceId: num(o.service_id), price: num(o.price), status: status(o.status) };
    },

    /** Remove do carrinho (etiqueta ainda não paga). */
    async removeFromCart(id: string): Promise<void> {
      const op = 'cart.remove';
      assertId(op, id);
      await call(op, 'DELETE', `/api/v2/me/cart/${id}`);
    },

    /** Estado atual de uma etiqueta (fonte da verdade para reconciliar). */
    async getOrder(id: string): Promise<MeOrderInfo> {
      const op = 'order.get';
      assertId(op, id);
      const res = await call(op, 'GET', `/api/v2/me/orders/${id}`);
      return parseOrder(res.body) ?? badResponse(op, res.status);
    },

    /** Pesquisa por id, protocolo, rastreio ou documento (reconciliação). */
    async searchOrders(query: string): Promise<MeOrderInfo[]> {
      const op = 'order.search';
      const q = query.trim();
      if (!/^[A-Za-z0-9-]{3,64}$/.test(q)) return fail(op, 'VALIDATION', 'not_sent');
      const res = await call(op, 'GET', `/api/v2/me/orders/search?q=${encodeURIComponent(q)}`);
      // Sem resultado o ME responde 204 SEM corpo (Sandbox, 06/11/2026): lista vazia.
      if (res.status === 204 && res.body === undefined) return [];
      // A documentação não fixa o envelope: aceita lista direta ou { data: [...] }.
      const list = Array.isArray(res.body) ? res.body : isObj(res.body) && Array.isArray(res.body.data) ? res.body.data : null;
      if (!list) return badResponse(op, res.status);
      return list.map(parseOrder).filter((o): o is MeOrderInfo => o !== null);
    },

    /**
     * COMPRA (debita a carteira). Uma chamada, uma etiqueta, nenhuma repetição
     * automática além do 401. Qualquer falha após o envio exige reconciliação.
     */
    async checkout(id: string): Promise<MeCheckoutResult> {
      const op = 'checkout';
      assertId(op, id);
      const res = await call(op, 'POST', '/api/v2/me/shipment/checkout', { orders: [id] });
      const purchase = isObj(res.body) && isObj(res.body.purchase) ? res.body.purchase : null;
      const orders = purchase && Array.isArray(purchase.orders) ? purchase.orders : null;
      const mine = orders?.find((o) => isObj(o) && o.id === id) as Record<string, unknown> | undefined;
      // Sem a nossa etiqueta na resposta não dá para afirmar a compra: ambíguo.
      if (!purchase || !mine) return badResponse(op, res.status);
      return {
        purchaseId: str(purchase.id, 64),
        protocol: str(purchase.protocol),
        status: status(purchase.status),
        total: num(purchase.total),
        paidAt: date(purchase.paid_at),
        order: { id, status: status(mine.status), price: num(mine.price) },
      };
    },

    /** Pede a geração (pode ser assíncrona no ME; confirmar por tracking/getOrder). */
    async generate(id: string): Promise<MeGenerateResult> {
      const op = 'generate';
      assertId(op, id);
      const res = await call(op, 'POST', '/api/v2/me/shipment/generate', { orders: [id] });
      const entry = entryFor(res.body, id);
      if (!entry || typeof entry.status !== 'boolean') return badResponse(op, res.status);
      const message = sanitizeExternalMessage(entry.message);
      if (!entry.status) return fail(op, 'GENERATION_FAILED', 'rejected', { httpStatus: res.status, externalMessage: message });
      return { accepted: true, message };
    },

    /**
     * Link de impressão em modo PRIVADO (exige login no ME). O modo público
     * não é oferecido: o link exporia o endereço do cliente a quem o tivesse.
     */
    async print(id: string): Promise<{ url: string }> {
      const op = 'print';
      assertId(op, id);
      const res = await call(op, 'POST', '/api/v2/me/shipment/print', { mode: 'private', orders: [id] });
      const url = isObj(res.body) ? httpsUrl(res.body.url) : null;
      return url ? { url } : badResponse(op, res.status);
    },

    /**
     * URL temporária do PDF (o backend baixa e entrega ao admin). Formato REAL
     * (Sandbox, 06/11/2026, PAC e Sedex): LISTA com uma URL pré-assinada
     * (`["https://…/pdf/…?X-Amz-…"]`, validade 1800 s); `{ url }` continua
     * aceito. Recém-gerada pode responder 404 "E-PRT-0007: Etiqueta pdf não
     * processada" por alguns segundos. O host da URL passa pela allowlist no
     * download (`downloadLabelPdf`).
     */
    async getLabelFile(id: string): Promise<{ url: string }> {
      const op = 'print.file';
      assertId(op, id);
      const res = await call(op, 'GET', `/api/v2/me/imprimir/pdf/${id}`);
      const raw = Array.isArray(res.body) ? res.body.find((v) => typeof v === 'string') : isObj(res.body) ? res.body.url : null;
      const url = httpsUrl(raw);
      return url ? { url } : badResponse(op, res.status);
    },

    /**
     * Baixa o PDF a partir da URL temporária de `getLabelFile`. Vai SEM o token
     * do ME (a URL já é a autorização), só para host do Melhor Envio, com
     * timeout, limite de tamanho e conferência de que é mesmo um PDF. A URL
     * nunca é gravada nem devolvida ao navegador.
     */
    async downloadLabelPdf(url: string): Promise<Buffer> {
      const op = 'print.file';
      const cfg = guard(op);
      if (!isAllowedLabelFileUrl(url)) return fail(op, 'BAD_RESPONSE', 'not_sent');
      let target = new URL(url);
      // Um timeout para a cadeia inteira (redirects inclusos).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        let res: Response;
        for (let hop = 0; ; hop++) {
          try {
            // redirect: 'manual' → cada destino passa pela allowlist antes de ser buscado.
            // Cabeçalhos fixos a cada salto: NUNCA Authorization/token do ME.
            res = await fetchImpl(target.toString(), {
              method: 'GET',
              redirect: 'manual',
              headers: { Accept: 'application/pdf', 'User-Agent': cfg.userAgent },
              signal: controller.signal,
            });
          } catch (err) {
            return fail(op, (err as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', 'unknown');
          }
          if (res.status < 300 || res.status >= 400) break;
          const location = res.headers.get('location');
          if (!location || hop >= MAX_LABEL_FILE_REDIRECTS) return fail(op, 'BAD_RESPONSE', 'rejected', { httpStatus: res.status });
          let next: URL;
          try {
            next = new URL(location, target);
          } catch {
            return fail(op, 'BAD_RESPONSE', 'rejected', { httpStatus: res.status });
          }
          if (!isAllowedLabelFileUrl(next)) return fail(op, 'BAD_RESPONSE', 'rejected', { httpStatus: res.status });
          target = next;
        }
        if (!res.ok) return fail(op, res.status === 404 ? 'NOT_FOUND' : res.status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN', 'rejected', { httpStatus: res.status });
        const declared = Number(res.headers.get('content-length') ?? 0);
        if (declared > MAX_LABEL_PDF_BYTES) return fail(op, 'BAD_RESPONSE', 'rejected', { httpStatus: res.status });
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_LABEL_PDF_BYTES || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
          return fail(op, 'BAD_RESPONSE', 'rejected', { httpStatus: res.status });
        }
        return buf;
      } finally {
        clearTimeout(timer);
      }
    },

    async tracking(id: string): Promise<MeTrackingInfo> {
      const op = 'tracking';
      assertId(op, id);
      const res = await call(op, 'POST', '/api/v2/me/shipment/tracking', { orders: [id] });
      const entry = entryFor(res.body, id);
      if (!entry) return badResponse(op, res.status);
      return {
        id,
        status: status(entry.status),
        tracking: trackingCode(entry.tracking),
        selfTracking: trackingCode(entry.melhorenvio_tracking ?? entry.self_tracking),
        dates: dates(entry),
      };
    },

    async cancellable(id: string): Promise<MeCancellableInfo> {
      const op = 'cancellable';
      assertId(op, id);
      const res = await call(op, 'POST', '/api/v2/me/shipment/cancellable', { orders: [id] });
      const entry = entryFor(res.body, id);
      if (!entry || typeof entry.cancellable !== 'boolean') return badResponse(op, res.status);
      return { cancellable: entry.cancellable };
    },

    /** Cancela (estorno em até ~12h). `reason_id` "2" conforme o exemplo da documentação. */
    async cancel(id: string, description: string): Promise<{ canceled: true }> {
      const op = 'cancel';
      assertId(op, id);
      const desc = description.replace(/\s+/g, ' ').trim().slice(0, 255) || 'Cancelado pelo admin da loja';
      const res = await call(op, 'POST', '/api/v2/me/shipment/cancel', { order: { id, reason_id: '2', description: desc } });
      const entry = entryFor(res.body, id);
      if (!entry || typeof entry.canceled !== 'boolean') return badResponse(op, res.status);
      if (!entry.canceled) return fail(op, 'NOT_CANCELLABLE', 'rejected', { httpStatus: res.status });
      return { canceled: true };
    },
  };
}

export type MeLabelsClient = ReturnType<typeof createMeLabelsClient>;

/** Operações financeiras, reexportadas para quem orquestra (Etapa 3). */
export { FINANCIAL_OPERATIONS };
