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

/**
 * Consulta o rastreamento de uma encomenda na API SeuRastreio.
 * A API tem CORS habilitado, então é chamada direto do browser.
 * A chave vem de VITE_SEURASTREIO_API_KEY (exposta no bundle — MVP sem backend).
 */
export async function fetchTracking(codigo: string): Promise<TrackingResult> {
  const apiKey = import.meta.env.VITE_SEURASTREIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave da API de rastreio não configurada. Defina VITE_SEURASTREIO_API_KEY no arquivo .env.',
    );
  }

  const code = codigo.trim();
  if (!code) throw new Error('Informe um código de rastreio.');

  const res = await fetch(`${BASE}/api/public/rastreio/${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    let message = `Não foi possível consultar o rastreio (erro ${res.status}).`;
    try {
      const err = await res.json();
      if (err?.message) message = err.message;
    } catch {
      // resposta sem corpo JSON — mantém mensagem padrão
    }
    throw new Error(message);
  }

  const data = (await res.json()) as Partial<TrackingResult>;

  const rawHistorico = Array.isArray(data.historico) ? data.historico : [];
  const historico = normalizeHistorico(rawHistorico, data.eventoMaisRecente);
  const status = data.status ?? 'unknown';
  // Se a API respondeu 200 mas sinalizou insucesso (ex.: código não encontrado),
  // trata como erro para não exibir "sem eventos" indevidamente.
  if (data.success === false || status === 'not_found') {
    throw new Error('Código de rastreio não encontrado. Confira o código e tente novamente.');
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
