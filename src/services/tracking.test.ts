import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTracking, isTrackingConfigured, TrackingError, TRACKING_MESSAGES } from './tracking';

/** Nada técnico pode chegar à tela do cliente. */
const TECHNICAL = /VITE_|\.env|SEURASTREIO|api[_ ]?key|token|Bearer|erro \d{3}|HTTP/i;

async function messageOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(TrackingError);
    return (e as Error).message;
  }
  throw new Error('deveria ter falhado');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('rastreio do cliente', () => {
  it('sem chave configurada: indisponível, mensagem amigável e sem chamar a API', async () => {
    vi.stubEnv('VITE_SEURASTREIO_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(isTrackingConfigured()).toBe(false);
    const msg = await messageOf(fetchTracking('AA123456789BR'));
    expect(msg).toBe(TRACKING_MESSAGES.unavailable);
    expect(msg).not.toMatch(TECHNICAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unavailable'],
    [403, 'unavailable'],
    [404, 'notFound'],
    [429, 'busy'],
    [500, 'generic'],
  ] as const)('HTTP %i da API vira mensagem amigável (%s), nunca a mensagem crua', async (status, kind) => {
    vi.stubEnv('VITE_SEURASTREIO_API_KEY', 'chave-de-teste');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid API token for key sk_live_x' }), { status })));
    const msg = await messageOf(fetchTracking('AA123456789BR'));
    expect(msg).toBe(TRACKING_MESSAGES[kind]);
    expect(msg).not.toMatch(TECHNICAL);
  });

  it('falha de rede e corpo inválido: mensagem genérica', async () => {
    vi.stubEnv('VITE_SEURASTREIO_API_KEY', 'chave-de-teste');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await messageOf(fetchTracking('AA123456789BR'))).toBe(TRACKING_MESSAGES.generic);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await messageOf(fetchTracking('AA123456789BR'))).toBe(TRACKING_MESSAGES.generic);
  });

  it('configurado e com eventos: devolve o histórico ordenado (mais recente primeiro)', async () => {
    vi.stubEnv('VITE_SEURASTREIO_API_KEY', 'chave-de-teste');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, status: 'in_transit', carrierName: 'Correios',
      historico: [
        { data: '2026-11-01T10:00:00Z', descricao: 'Postado' },
        { data: '2026-11-02T10:00:00Z', descricao: 'Em trânsito' },
      ],
    }), { status: 200 })));
    expect(isTrackingConfigured()).toBe(true);
    const r = await fetchTracking('AA123456789BR');
    expect(r.historico.map((e) => e.descricao)).toEqual(['Em trânsito', 'Postado']);
    expect(r.eventoMaisRecente?.descricao).toBe('Em trânsito');
  });

  it('todas as mensagens ao cliente são livres de termos técnicos', () => {
    for (const m of Object.values(TRACKING_MESSAGES)) expect(m).not.toMatch(TECHNICAL);
  });
});
