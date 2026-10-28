import { ApiError } from '@/services/api';
import type { ApiLabelAction, ApiLabelMeError, ApiLabelStatus } from '@/services/shippingLabelsService';
import { formatBRL } from '@/utils/price';

/**
 * Apresentação do painel de expedição. SÓ textos e cores: quem decide
 * estado, preço e ações é o backend (`availableActions`).
 */

export type Tone = 'gray' | 'blue' | 'yellow' | 'green' | 'red';

export const TONE_CLASSES: Record<Tone, string> = {
  gray: 'bg-ink/5 text-ink-soft border-ink-line',
  blue: 'bg-sky-50 text-sky-800 border-sky-200',
  yellow: 'bg-amber-50 text-amber-800 border-amber-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const STATUS_META: Record<ApiLabelStatus | 'NONE', { label: string; tone: Tone }> = {
  NONE: { label: 'Não preparada', tone: 'gray' },
  PREPARED: { label: 'Preparada', tone: 'blue' },
  AWAITING_CONFIRMATION: { label: 'Aguardando confirmação', tone: 'blue' },
  PURCHASING: { label: 'Compra em processamento', tone: 'yellow' },
  PURCHASED: { label: 'Comprada', tone: 'green' },
  GENERATING: { label: 'Gerando etiqueta', tone: 'yellow' },
  LABEL_READY: { label: 'Etiqueta pronta', tone: 'green' },
  POSTED: { label: 'Postada', tone: 'green' },
  DELIVERED: { label: 'Entregue', tone: 'green' },
  NEEDS_RECONCILIATION: { label: 'Precisa verificar no Melhor Envio', tone: 'yellow' },
  CANCELING: { label: 'Cancelamento em processamento', tone: 'yellow' },
  ERROR: { label: 'Erro', tone: 'red' },
  CANCELED: { label: 'Cancelada', tone: 'red' },
  DISCARDED: { label: 'Preparação descartada', tone: 'gray' },
};

/** Ordem e rótulo dos botões. Só aparecem os que vierem em `availableActions`. */
export const ACTION_META: Array<{ action: ApiLabelAction; label: string; primary?: boolean; danger?: boolean }> = [
  { action: 'PREPARE', label: 'Preparar etiqueta', primary: true },
  { action: 'PURCHASE', label: 'Comprar e gerar etiqueta', primary: true },
  { action: 'REQUEST_CONFIRMATION', label: 'Atualizar/confirmar preço' },
  { action: 'GENERATE', label: 'Gerar etiqueta', primary: true },
  { action: 'DOWNLOAD', label: 'Baixar etiqueta', primary: true },
  { action: 'RECONCILE', label: 'Verificar no Melhor Envio' },
  { action: 'SYNC_STATUS', label: 'Atualizar status' },
  { action: 'CHECK_CANCELLABLE', label: 'Verificar cancelamento' },
  { action: 'CANCEL', label: 'Cancelar etiqueta', danger: true },
  { action: 'DISCARD_UNPAID', label: 'Descartar preparação', danger: true },
  { action: 'ADD_NOTE', label: 'Adicionar nota' },
];

/** Mensagem de "processando" por ação (bloqueia cliques repetidos). */
export const BUSY_TEXT: Partial<Record<ApiLabelAction | 'PRINT' | 'LOAD', string>> = {
  PREPARE: 'Preparando etiqueta…',
  PURCHASE: 'Compra em processamento…',
  REQUEST_CONFIRMATION: 'Consultando o preço no Melhor Envio…',
  GENERATE: 'Gerando etiqueta…',
  RECONCILE: 'Verificando no Melhor Envio…',
  SYNC_STATUS: 'Atualizando status…',
  CHECK_CANCELLABLE: 'Verificando no Melhor Envio…',
  CANCEL: 'Cancelando etiqueta…',
  DISCARD_UNPAID: 'Descartando preparação…',
  DOWNLOAD: 'Baixando etiqueta…',
  PRINT: 'Abrindo etiqueta para impressão…',
  ADD_NOTE: 'Salvando nota…',
};

/** Diferença = custo da etiqueta − frete cobrado. Positivo: a loja paga mais do que cobrou. */
export function differenceInfo(difference: number | null): { tone: Tone; sign: string; text: string } {
  if (difference === null) return { tone: 'gray', sign: '', text: 'Sem preço da etiqueta ainda.' };
  const cents = Math.round(difference * 100);
  if (cents === 0) return { tone: 'gray', sign: '', text: 'Empatado: a etiqueta custa o mesmo que o frete cobrado.' };
  if (cents > 0) {
    return { tone: 'red', sign: '−', text: `A loja vai pagar ${formatBRL(cents / 100)} a mais do que cobrou de frete.` };
  }
  return { tone: 'green', sign: '+', text: `A loja fica com ${formatBRL(-cents / 100)} de diferença no frete.` };
}

/** "+ R$ 1,45" (loja ganha) / "− R$ 0,20" (loja paga a mais), do ponto de vista da loja. */
export function formatDifference(difference: number | null): string {
  if (difference === null) return '—';
  const { sign } = differenceInfo(difference);
  return `${sign}${sign ? ' ' : ''}${formatBRL(Math.abs(Math.round(difference * 100)) / 100)}`;
}

export const formatCep = (cep: string | null | undefined) => (cep && /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '—');
export const formatDeadline = (days: number | null | undefined) =>
  !days ? '—' : days === 1 ? 'até 1 dia útil' : `até ${days} dias úteis`;
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// -----------------------------------------------------------------------------
// Erros: SEMPRE texto nosso, por código. Nunca a mensagem bruta da API.
// -----------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  ORDER_NOT_PAID: 'O pedido ainda não está pago. A etiqueta só pode ser comprada para pedidos pagos.',
  ORDER_CANCELED: 'Pedido cancelado: não é possível gerar etiqueta.',
  ORDER_NOT_FOUND: 'Pedido não encontrado.',
  PICKUP_ORDER: 'Pedido com retirada na loja não tem etiqueta de envio.',
  UNKNOWN_SERVICE: 'O serviço de entrega deste pedido não é suportado para etiqueta.',
  SENDER_MISSING: 'Remetente incompleto: cadastre os dados da loja em Configurações → Remetente das etiquetas.',
  NFE_REQUIRES_STATE_REGISTER: 'Envio com NF-e exige a inscrição estadual do remetente (Configurações → Remetente).',
  RECIPIENT_DOCUMENT: 'Falta o CPF/CNPJ do destinatário. Informe o documento no formulário.',
  PACKAGE_INVALID: 'Caixa inválida: confira peso e medidas.',
  REASON_REQUIRED: 'Informe o motivo (mínimo 5 caracteres).',
  NEEDS_RECONNECT: 'A conexão com o Melhor Envio precisa ser refeita em Configurações → Melhor Envio.',
  NOT_CONFIGURED: 'Integração com o Melhor Envio não configurada.',
  UNAUTHORIZED: 'O Melhor Envio recusou a credencial. Tente de novo em instantes.',
  FORBIDDEN: 'A conta conectada não tem permissão para etiquetas (escopo faltando). Reconecte o Melhor Envio autorizando as etiquetas.',
  INSUFFICIENT_BALANCE: 'Saldo insuficiente na carteira do Melhor Envio. Adicione saldo e verifique a etiqueta.',
  PRICE_CHANGED: 'O preço da etiqueta mudou. Confira o novo valor antes de comprar.',
  PURCHASE_IN_PROGRESS: 'Já existe uma compra desta etiqueta em andamento. Aguarde.',
  PURCHASE_CONFLICT: 'Esta compra já foi iniciada em outra aba ou dispositivo.',
  PREPARE_IN_PROGRESS: 'A preparação desta etiqueta ainda está em andamento.',
  OPERATION_IN_PROGRESS: 'Já existe uma operação em andamento nesta etiqueta. Aguarde.',
  GENERATION_IN_PROGRESS: 'A geração da etiqueta está em andamento.',
  RECONCILIATION_IN_PROGRESS: 'A verificação no Melhor Envio já está em andamento.',
  AMBIGUOUS: 'O Melhor Envio não respondeu com clareza. Nada será repetido automaticamente: use “Verificar no Melhor Envio”.',
  NEEDS_RECONCILIATION: 'Antes de qualquer ação, verifique a etiqueta no Melhor Envio.',
  CONFIRMATION_EXPIRED: 'A confirmação de preço expirou. Confira o preço de novo.',
  CONFIRMATION_INVALID: 'Confirmação inválida ou já usada. Confira o preço de novo.',
  CONFIRMATION_REQUIRED: 'Confira o preço antes de comprar.',
  ALREADY_PURCHASED: 'Esta etiqueta já foi comprada.',
  LABEL_CHANGED: 'A etiqueta mudou em outra aba. A tela foi atualizada.',
  LABEL_NOT_FOUND: 'Nenhuma etiqueta ativa para este pedido.',
  LABEL_NOT_GENERATED: 'Etiqueta ainda sendo gerada pelo Melhor Envio. Tente em instantes.',
  LABEL_FILE_UNVERIFIED: 'Não foi possível confirmar a etiqueta no Melhor Envio agora. Tente de novo.',
  LABEL_FILE_UNAVAILABLE: 'O Melhor Envio não entregou o arquivo da etiqueta agora. Tente de novo em instantes.',
  SANDBOX_PRINT_UNAVAILABLE: 'Ambiente de teste: o Melhor Envio não gera o PDF de etiquetas dos Correios (PAC/Sedex) no Sandbox. Nenhuma etiqueta real existe.',
  LABEL_DELIVERED: 'Envio já entregue: a etiqueta não está mais disponível.',
  NOT_CANCELLABLE: 'O Melhor Envio não permite cancelar esta etiqueta agora.',
  NOT_PURCHASED: 'Etiqueta ainda não comprada. Para trocar a caixa, use “Descartar preparação”.',
  DISCARD_NOT_ALLOWED: 'Não é seguro descartar esta etiqueta.',
  DISCARD_UNVERIFIED: 'Não foi possível provar no Melhor Envio que a etiqueta não foi paga. Nada foi descartado.',
  DISCARD_FAILED: 'Não foi possível remover do carrinho do Melhor Envio. Tente de novo.',
  CART_ADD_UNCERTAIN: 'A tentativa anterior pode ter deixado um item no carrinho do Melhor Envio. Descarte esta preparação antes de preparar de novo.',
  NOTHING_TO_RECONCILE: 'A etiqueta ainda não existe no Melhor Envio.',
  LABELS_DISABLED: 'Etiquetas do Melhor Envio estão desligadas no servidor.',
  LABELS_PRODUCTION_BLOCKED: 'Compra de etiquetas em produção está bloqueada no servidor.',
  RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  VALIDATION: 'O Melhor Envio recusou os dados da etiqueta. Confira caixa, documento e endereço.',
  GENERATION_FAILED: 'O Melhor Envio não gerou a etiqueta. Tente gerar de novo.',
  NOT_FOUND: 'Etiqueta não encontrada no Melhor Envio.',
  SERVER_ERROR: 'O Melhor Envio está instável no momento.',
  TIMEOUT: 'O Melhor Envio demorou para responder.',
  NETWORK_ERROR: 'Falha de conexão com o servidor.',
  INCONCLUSIVE: 'O estado no Melhor Envio é inconclusivo. Confira no painel do Melhor Envio.',
  STATUS_CONTRADICTION: 'O Melhor Envio não mostra esta etiqueta como paga. Verifique antes de qualquer ação.',
  LEASE_EXPIRED: 'Uma operação foi interrompida. Verifique no Melhor Envio.',
  PAID_AT_ME: 'A etiqueta consta como paga no Melhor Envio.',
  CANCELED_AT_ME: 'A etiqueta foi cancelada no Melhor Envio.',
  NOT_IN_CART: 'A etiqueta não está mais no carrinho do Melhor Envio.',
};

const FIELD_HINT: Record<string, string> = {
  weightKg: 'peso',
  heightCm: 'altura',
  widthCm: 'largura',
  lengthCm: 'comprimento',
  nfeKey: 'chave da NF-e',
};

const BALANCE_RE = /saldo|insufficient|balance/i;
const AMBIGUOUS_CODES = new Set(['TIMEOUT', 'SERVER_ERROR', 'NETWORK', 'BAD_RESPONSE', 'UNKNOWN']);

/** Código "de produto" para um erro do ME (classifica sem mostrar o texto dele). */
function meErrorKey(e: Pick<ApiLabelMeError, 'code' | 'outcome' | 'externalMessage' | 'fields'>): string {
  if (e.externalMessage && BALANCE_RE.test(e.externalMessage)) return 'INSUFFICIENT_BALANCE';
  if (e.code === 'VALIDATION' && e.fields.some((f) => /document/i.test(f))) return 'RECIPIENT_DOCUMENT';
  if (e.outcome === 'unknown' && AMBIGUOUS_CODES.has(e.code)) return 'AMBIGUOUS';
  return e.code;
}

const FALLBACK = 'Não foi possível concluir a operação.';

/** Mensagem segura para um código. */
export const messageForCode = (code: string | null | undefined) => (code && MESSAGES[code]) || FALLBACK;

/** Erro do ME embutido numa resposta 200 (`error`) ou em `lastError`. */
export function meErrorMessage(e: Pick<ApiLabelMeError, 'code' | 'outcome' | 'externalMessage' | 'fields'>): string {
  const key = meErrorKey(e);
  return MESSAGES[key] ?? FALLBACK;
}

/** Erro de requisição (ApiError) → texto nosso. Inclui 422 de caixa com o campo. */
export function requestErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return FALLBACK;
  if (err.status === 429 || err.code === 'RATE_LIMITED') {
    const wait = err.message.match(/Tente novamente em [^.]+\./)?.[0];
    return wait ? `${MESSAGES.RATE_LIMITED.replace(/ Aguarde.*$/, '')} ${wait}` : MESSAGES.RATE_LIMITED;
  }
  if (err.code === 'VALIDATION_ERROR') {
    const fe = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
    const fields = Object.keys(fe).map((k) => FIELD_HINT[k]).filter(Boolean);
    if (fe.nfeKey) return 'Chave da NF-e inválida (44 dígitos).';
    return fields.length ? `${MESSAGES.PACKAGE_INVALID.replace('peso e medidas', fields.join(', '))}` : 'Dados inválidos. Confira o formulário.';
  }
  const meError = (err.details as { error?: ApiLabelMeError } | undefined)?.error;
  if (meError?.code && !MESSAGES[err.code]) return meErrorMessage(meError);
  return messageForCode(err.code);
}

/** Erros de campo do 422 (zod flatten) para o formulário de preparação. */
export function prepareFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const fe = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
  return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? 'Valor inválido.']));
}
