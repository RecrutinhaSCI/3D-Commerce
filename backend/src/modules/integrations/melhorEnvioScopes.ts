import type { LabelOperation } from '../shipping/labels/labelErrors';

/**
 * Scopes (permissões) do OAuth do Melhor Envio.
 *
 * Lista OFICIAL: tabela "Fluxo de Autorização" da documentação
 * (docs.melhorenvio.com.br/reference/fluxo-de-autorização), 24 scopes,
 * separados por ESPAÇO no parâmetro `scope`. Nada inventado aqui.
 *
 * A documentação NÃO mapeia rota → scope. O mapa abaixo é inferido pelo
 * nome/descrição oficial de cada scope e PRECISA ser confirmado no Sandbox
 * (Etapa 7): se uma rota pedir outro scope, ajusta-se só este mapa.
 */
export const ME_PROVIDER = 'melhor_envio';

export const ME_OFFICIAL_SCOPES: readonly string[] = [
  'cart-read', 'cart-write', 'companies-read', 'companies-write', 'coupons-read', 'coupons-write',
  'notifications-read', 'orders-read', 'products-read', 'products-write', 'purchases-read',
  'shipping-calculate', 'shipping-cancel', 'shipping-checkout', 'shipping-companies', 'shipping-generate',
  'shipping-preview', 'shipping-print', 'shipping-share', 'shipping-tracking', 'ecommerce-shipping',
  'transactions-read', 'users-read', 'users-write',
];

/** Cotação atual (PAC/Sedex) — nunca sai da lista pedida. */
export const ME_QUOTE_SCOPES: readonly string[] = ['shipping-calculate'];

/** Operação do cliente de etiquetas → scope oficial que ela exige (inferido; confirmar no Sandbox). */
export const ME_LABEL_SCOPE_BY_OPERATION: Readonly<Record<LabelOperation, string>> = {
  'cart.add': 'cart-write', // "Cadastrar e editar itens do carrinho"
  'cart.remove': 'cart-write',
  'order.get': 'orders-read', // "Visualizar etiquetas"
  'order.search': 'orders-read',
  checkout: 'shipping-checkout', // "Comprar fretes (saldo da carteira)"
  generate: 'shipping-generate',
  print: 'shipping-print',
  'print.file': 'shipping-print',
  tracking: 'shipping-tracking',
  cancellable: 'shipping-cancel',
  cancel: 'shipping-cancel',
};

export const ME_LABEL_SCOPES: readonly string[] = [...new Set(Object.values(ME_LABEL_SCOPE_BY_OPERATION))].sort();

/** O que o app pede ao autorizar: cotação + etiquetas (mínimo necessário). */
export const ME_REQUESTED_SCOPES: readonly string[] = [...new Set([...ME_QUOTE_SCOPES, ...ME_LABEL_SCOPES])];

/**
 * De onde veio a lista de scopes concedidos:
 *   response  — campo `scope` da resposta do /oauth/token (RFC 6749);
 *   token     — claim `scopes`/`scope` do próprio access token (JWT);
 *   requested — o ME não informou: pela RFC, igual ao pedido — NÃO confirmado;
 *   legacy    — conexão anterior à Etapa 6 (pedia só `shipping-calculate`).
 */
export type ScopeSource = 'response' | 'token' | 'requested' | 'legacy';

/** Lista normalizada: minúsculas, sem duplicados, ordenada. Aceita string (espaço/vírgula) ou array. */
export function normalizeScopes(raw: unknown): string[] | null {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : null;
  if (!parts) return null;
  const list = parts.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9-]{1,64}$/.test(s));
  return [...new Set(list)].sort();
}

/** Lê a claim de scopes de um JWT SEM validar assinatura (só para exibir/conferir; o token veio do ME por TLS). */
export function scopesFromJwt(token: string): string[] | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const raw = payload.scopes ?? payload.scope ?? payload.scp;
    if (raw === undefined) return null;
    // "*" (todos) não é scope oficial: não dá para afirmar nada.
    const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
    if (items.some((s) => String(s).trim() === '*')) return null;
    const list = normalizeScopes(raw);
    return list && list.length ? list : null;
  } catch {
    return null;
  }
}

/** Scopes concedidos numa resposta do /oauth/token (campo `scope` → claim do JWT → desconhecido). */
export function grantedScopes(json: Record<string, unknown>, accessToken: string): { scopes: string[]; source: ScopeSource } | null {
  const fromResponse = typeof json.scope === 'string' || Array.isArray(json.scope) ? normalizeScopes(json.scope) : null;
  if (fromResponse && fromResponse.length) return { scopes: fromResponse, source: 'response' };
  const fromToken = scopesFromJwt(accessToken);
  if (fromToken && fromToken.length) return { scopes: fromToken, source: 'token' };
  return null;
}

export interface ScopeEvaluation {
  granted: string[] | null;
  source: ScopeSource | null;
  /** Lista confirmada pelo ME (resposta ou token) — ou conexão legada, cujo pedido sabemos. */
  verified: boolean;
  required: { quote: string[]; labels: string[] };
  missing: { quote: string[]; labels: string[] };
  /** Concedidos que não estão na tabela oficial (só informativo; não bloqueia). */
  unknown: string[];
  quoteScopesOk: boolean;
  labelScopesComplete: boolean;
}

export function evaluateScopes(storedScope: string | null | undefined, storedSource: string | null | undefined): ScopeEvaluation {
  const granted = normalizeScopes(storedScope ?? null);
  const source: ScopeSource | null = granted
    ? storedSource === 'response' || storedSource === 'token' || storedSource === 'requested'
      ? storedSource
      : 'legacy'
    : null;
  const have = new Set(granted ?? []);
  const missingOf = (req: readonly string[]) => req.filter((s) => !have.has(s));
  const missing = { quote: missingOf(ME_QUOTE_SCOPES), labels: missingOf(ME_LABEL_SCOPES) };
  return {
    granted,
    source,
    verified: source === 'response' || source === 'token' || source === 'legacy',
    required: { quote: [...ME_QUOTE_SCOPES], labels: [...ME_LABEL_SCOPES] },
    missing,
    unknown: (granted ?? []).filter((s) => !ME_OFFICIAL_SCOPES.includes(s)),
    quoteScopesOk: granted !== null && missing.quote.length === 0,
    labelScopesComplete: granted !== null && missing.labels.length === 0,
  };
}

export type LabelsReadiness = 'not_connected' | 'reconnect_required' | 'scopes_unverified' | 'disabled' | 'production_blocked' | 'ready';

/**
 * Permissões da conexão para ETIQUETAS (scopes + flags). O front só exibe;
 * nenhuma comparação de string fica para ele. `ready` exige TUDO: conexão
 * válida, scopes CONFIRMADOS pelo ME, MELHOR_ENVIO_LABELS_ENABLED e (em
 * produção) MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION.
 */
export function labelsAccess(
  cred: { needsReconnect: boolean; scope: string | null; scopeSource: string | null } | null,
  oauthConfigured: boolean,
  labels: { enabled: boolean; purchaseAllowed: boolean },
) {
  const scopes = cred ? evaluateScopes(cred.scope, cred.scopeSource) : null;
  const connected = Boolean(oauthConfigured && cred && !cred.needsReconnect);
  const readiness: LabelsReadiness = !oauthConfigured || !cred
    ? 'not_connected'
    : cred.needsReconnect || !scopes!.labelScopesComplete
      ? 'reconnect_required'
      : !scopes!.verified
        ? 'scopes_unverified'
        : !labels.enabled
          ? 'disabled'
          : !labels.purchaseAllowed
            ? 'production_blocked'
            : 'ready';
  return {
    connected,
    scopes,
    missingScopes: scopes ? scopes.missing.labels : evaluateScopes(null, null).required.labels,
    needsReconnectForLabels: Boolean(cred) && (cred!.needsReconnect || !scopes!.labelScopesComplete),
    labelsScopesReady: Boolean(connected && scopes?.verified && scopes.labelScopesComplete),
    labelsReady: readiness === 'ready',
    readiness,
  };
}
