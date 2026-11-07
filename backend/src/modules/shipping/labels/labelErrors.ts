/**
 * Erros do cliente de etiquetas do Melhor Envio.
 *
 * Princípio: erro HTTP ≠ "a operação não aconteceu". Todo erro diz:
 *   - `outcome`: o que sabemos do lado do Melhor Envio
 *       not_sent → nem chegou a ir (trava, configuração, credencial)
 *       rejected → o Melhor Envio RESPONDEU recusando (4xx)
 *       unknown  → timeout, rede, 5xx ou resposta ilegível: pode ter acontecido
 *   - `requiresReconciliation`: antes de qualquer nova tentativa é preciso
 *     CONSULTAR a etiqueta (GET /orders/{id}). Sempre true em operação
 *     financeira (checkout/cancelamento) que chegou ao Melhor Envio e falhou.
 *
 * Mensagens externas passam por `sanitizeExternalMessage` antes de serem
 * guardadas ou exibidas. Nunca carregam token, payload nem resposta bruta.
 */

export type LabelOperation =
  | 'cart.add'
  | 'cart.remove'
  | 'order.get'
  | 'order.search'
  | 'checkout'
  | 'generate'
  | 'print'
  | 'print.file'
  | 'tracking'
  | 'cancellable'
  | 'cancel';

/** Operações que movimentam dinheiro (compra / estorno). */
export const FINANCIAL_OPERATIONS: readonly LabelOperation[] = ['checkout', 'cancel'];
/** Operações que alteram algo no Melhor Envio (as financeiras inclusas). */
export const MUTATING_OPERATIONS: readonly LabelOperation[] = ['cart.add', 'cart.remove', 'checkout', 'generate', 'cancel'];

export type LabelApiErrorCode =
  | 'OPERATION_BLOCKED' // travas MELHOR_ENVIO_LABELS_* (antes de qualquer rede)
  | 'NOT_CONFIGURED' // sem OAuth/URL/credencial
  | 'NEEDS_RECONNECT' // OAuth precisa ser reautorizado no admin
  | 'UNAUTHORIZED' // 401 mesmo após renovar uma vez, ou renovação temporariamente indisponível
  | 'FORBIDDEN' // 403 — em geral escopo de etiqueta não autorizado
  | 'NOT_FOUND' // 404 — etiqueta inexistente nesta conta/ambiente
  | 'VALIDATION' // 400/422 — dados recusados
  | 'ALREADY_PAID' // checkout de etiqueta já paga (422 documentado)
  | 'NOT_CANCELLABLE' // cancelamento recusado/indisponível
  | 'GENERATION_FAILED' // geração recusada para a etiqueta
  | 'RATE_LIMITED' // 429
  | 'SERVER_ERROR' // 5xx
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_RESPONSE' // 2xx com corpo ilegível/inesperado
  | 'UNKNOWN'; // status HTTP não previsto

export type LabelErrorOutcome = 'not_sent' | 'rejected' | 'unknown';

export class LabelApiError extends Error {
  readonly operation: LabelOperation;
  readonly code: LabelApiErrorCode;
  readonly outcome: LabelErrorOutcome;
  readonly requiresReconciliation: boolean;
  /** Status HTTP do Melhor Envio, quando houve resposta. */
  readonly httpStatus: number | null;
  /** Mensagem do Melhor Envio já SANITIZADA (ou null). */
  readonly externalMessage: string | null;
  /** Nomes dos campos recusados (422), sem valores. */
  readonly fields: string[];
  /** Segundos sugeridos pelo 429 (Retry-After), quando informado. */
  readonly retryAfterSeconds: number | null;

  constructor(opts: {
    operation: LabelOperation;
    code: LabelApiErrorCode;
    outcome: LabelErrorOutcome;
    message: string;
    httpStatus?: number | null;
    externalMessage?: string | null;
    fields?: string[];
    retryAfterSeconds?: number | null;
  }) {
    super(opts.message);
    this.name = 'LabelApiError';
    this.operation = opts.operation;
    this.code = opts.code;
    this.outcome = opts.outcome;
    this.httpStatus = opts.httpStatus ?? null;
    this.externalMessage = opts.externalMessage ?? null;
    this.fields = opts.fields ?? [];
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.requiresReconciliation = needsReconciliation(opts.operation, opts.code, opts.outcome);
  }

  /** Forma segura para gravar em last_error_* / auditoria e devolver ao admin. */
  toSafeJSON() {
    return {
      operation: this.operation,
      code: this.code,
      outcome: this.outcome,
      requiresReconciliation: this.requiresReconciliation,
      httpStatus: this.httpStatus,
      message: this.message,
      externalMessage: this.externalMessage,
      fields: this.fields,
    };
  }
}

/** Erros em que o Melhor Envio recusou ANTES de processar (credencial/limite). */
const PRE_PROCESSING: readonly LabelApiErrorCode[] = ['UNAUTHORIZED', 'NEEDS_RECONNECT', 'FORBIDDEN', 'RATE_LIMITED'];

function needsReconciliation(op: LabelOperation, code: LabelApiErrorCode, outcome: LabelErrorOutcome): boolean {
  if (outcome === 'not_sent') return false;
  if (code === 'ALREADY_PAID') return true;
  if (outcome === 'unknown') return MUTATING_OPERATIONS.includes(op);
  // Recusa explícita (4xx): em operação financeira, ainda assim confirmar o
  // estado lá antes de tentar de novo — exceto recusas de credencial/limite.
  return FINANCIAL_OPERATIONS.includes(op) && !PRE_PROCESSING.includes(code);
}

// -----------------------------------------------------------------------------
// Sanitização de mensagens externas
// -----------------------------------------------------------------------------

const MAX_EXTERNAL = 200;

/**
 * Limpa uma mensagem vinda do Melhor Envio antes de guardar/exibir: remove
 * HTML, tokens (Bearer/JWT/longas sequências), e-mails, URLs, CPF/CNPJ/CEP e
 * telefones, colapsa espaços e corta em 200 caracteres.
 */
export function sanitizeExternalMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/bearer\s+\S+/gi, '[token]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{5}-?\d{3}\b/g, '[cep]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[telefone]')
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '[redigido]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length > MAX_EXTERNAL) s = `${s.slice(0, MAX_EXTERNAL - 1).trimEnd()}…`;
  return s;
}

/**
 * Extrai mensagens e nomes de campo de um corpo de erro de formato
 * desconhecido ({ message }, { error }, { errors: { campo: [msg] } }…),
 * limitado e sem valores enviados.
 */
export function extractErrorInfo(body: unknown): { messages: string[]; fields: string[] } {
  const messages: string[] = [];
  const fields: string[] = [];
  const push = (m: unknown) => {
    if (typeof m === 'string' && m.trim() && messages.length < 5) messages.push(m);
  };
  if (typeof body === 'string') push(body);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    push(b.message);
    if (typeof b.error === 'string') push(b.error);
    for (const bag of [b.errors, typeof b.error === 'object' ? b.error : undefined]) {
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
      for (const [field, val] of Object.entries(bag as Record<string, unknown>)) {
        if (fields.length < 20 && /^[\w.[\]-]{1,60}$/.test(field)) fields.push(field);
        for (const m of Array.isArray(val) ? val : [val]) push(m);
      }
    }
  }
  return { messages, fields };
}
