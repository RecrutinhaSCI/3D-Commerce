import type { TrackingEvent, TrackingResult } from '@/types';

const BASE = 'https://seurastreio.com.br';

/**
 * Consolida o histórico de eventos numa lista única, ordenada do mais recente
 * para o mais antigo, incluindo `eventoMaisRecente` caso não esteja no histórico.
 * A doc da API não garante a ordem de `historico`, então ordenamos por data aqui.
 */
function normalizeHistorico(
  historico: TrackingEvent[],
  eventoMaisRecente?: TrackingEvent,
): TrackingEvent[] {
  const eventos = [...historico];
  if (
    eventoMaisRecente &&
    !eventos.some((e) => e.data === eventoMaisRecente.data && e.descricao === eventoMaisRecente.descricao)
  ) {
    eventos.push(eventoMaisRecente);
  }
  return eventos.sort((a, b) => {
    const ta = new Date(a.data).getTime();
    const tb = new Date(b.data).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    return tb - ta; // mais recente primeiro
  });
}

/** Mensagens mostradas ao CLIENTE: nunca detalhes técnicos (env, HTTP, chave). */
export const TRACKING_MESSAGES = {
  unavailable: 'A consulta automática do rastreio está indisponível no momento. Use o código acima no site da transportadora.',
  notFound: 'Código de rastreio ainda não encontrado. Ele pode levar até 24h para aparecer após o envio.',
  busy: 'Muitas consultas em pouco tempo. Aguarde um instante e tente de novo.',
  generic: 'Não foi possível consultar o rastreio agora. Tente novamente em alguns minutos.',
  empty: 'Informe um código de rastreio.',
} as const;

/** Erro de rastreio com mensagem já segura para exibir ao cliente. */
export class TrackingError extends Error {
  constructor(public readonly kind: keyof typeof TRACKING_MESSAGES) {
    super(TRACKING_MESSAGES[kind]);
    this.name = 'TrackingError';
  }
}

/** A consulta automática (SeuRastreio) está configurada neste build? */
export function isTrackingConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SEURASTREIO_API_KEY);
}

/** Página pública de rastreio dos Correios (PAC/Sedex), para quando a consulta automática não existe. */
export const CORREIOS_TRACKING_URL = 'https://rastreamento.correios.com.br/app/index.php';

/**
 * Consulta o rastreamento de uma encomenda na API SeuRastreio.
 * A API tem CORS habilitado, então é chamada direto do browser.
 * A chave vem de VITE_SEURASTREIO_API_KEY (exposta no bundle — MVP sem backend).
 * Todo erro sai como `TrackingError` com mensagem amigável.
 */
export async function fetchTracking(codigo: string): Promise<TrackingResult> {
  const apiKey = import.meta.env.VITE_SEURASTREIO_API_KEY;
  if (!apiKey) {
    // Configuração ausente é problema da loja, não do cliente: mensagem neutra.
    if (import.meta.env.DEV) console.warn('[rastreio] VITE_SEURASTREIO_API_KEY ausente: consulta automática desligada.');
    throw new TrackingError('unavailable');
  }

  const code = codigo.trim();
  if (!code) throw new TrackingError('empty');

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/public/rastreio/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    throw new TrackingError('generic');
  }

  if (!res.ok) {
    // A mensagem da API (ex.: "token inválido") nunca vai para a tela.
    if (res.status === 404) throw new TrackingError('notFound');
    if (res.status === 429) throw new TrackingError('busy');
    if (res.status === 401 || res.status === 403) throw new TrackingError('unavailable');
    throw new TrackingError('generic');
  }

  let data: Partial<TrackingResult>;
  try {
    data = (await res.json()) as Partial<TrackingResult>;
  } catch {
    throw new TrackingError('generic');
  }

  const rawHistorico = Array.isArray(data.historico) ? data.historico : [];
  const historico = normalizeHistorico(rawHistorico, data.eventoMaisRecente);
  const status = data.status ?? 'unknown';
  // Se a API respondeu 200 mas sinalizou insucesso (ex.: código não encontrado),
  // trata como erro para não exibir "sem eventos" indevidamente.
  if (data.success === false || status === 'not_found') {
    throw new TrackingError('notFound');
  }

  return {
    carrierName: data.carrierName,
    status,
    success: data.success ?? true,
    // Fonte de verdade do evento atual: o campo explícito da API, com fallback ao topo do histórico ordenado.
    eventoMaisRecente: data.eventoMaisRecente ?? historico[0],
    historico,
    previsaoEntrega: data.previsaoEntrega,
    linkDetalhesCompletos: data.linkDetalhesCompletos,
  };
}
