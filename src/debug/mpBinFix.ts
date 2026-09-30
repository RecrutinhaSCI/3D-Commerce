/**
 * PROBE/FIX TEMPORÁRIO — busca de método por BIN do Mercado Pago.
 *
 * Sintoma: o Payment Brick mostra "Não foi possível obter a informação de
 * pagamento" (`no_payment_method_for_provided_bin`). Medição: a chamada
 * `GET api.mercadopago.com/v1/payment_methods/search` com `bins=<bin>` (plural)
 * retorna `results: []`, enquanto `bin=<bin>` (singular) retorna os métodos.
 *
 * Este shim intercepta fetch e XHR no contexto da página, e quando a URL da
 * busca usa `bins=` reescreve para `bin=`. Também loga o que captura, com o
 * marcador [MP-FIX], para diagnóstico. REMOVER após o conserto definitivo.
 */

function fixMpSearchUrl(url: string): string {
  try {
    if (!/mercadopago\.com/.test(url)) return url;
    if (!/payment_methods\/search/.test(url)) return url;
    const u = new URL(url, window.location.href);
    const bins = u.searchParams.get('bins');
    if (bins && !u.searchParams.get('bin')) {
      u.searchParams.delete('bins');
      // pega só o primeiro BIN, sem vírgulas, e usa `bin` singular
      u.searchParams.set('bin', bins.split(',')[0]);
      const fixed = u.toString();
      // eslint-disable-next-line no-console
      console.log('[MP-FIX] reescrito bins->bin:', url, '=>', fixed);
      return fixed;
    }
    // eslint-disable-next-line no-console
    console.log('[MP-FIX] search capturado (sem bins):', url);
    return url;
  } catch {
    return url;
  }
}

// --- fetch ---
const origFetch = window.fetch.bind(window);
window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    if (typeof input === 'string') {
      input = fixMpSearchUrl(input);
    } else if (input instanceof URL) {
      input = fixMpSearchUrl(input.toString());
    } else if (input instanceof Request) {
      const fixed = fixMpSearchUrl(input.url);
      if (fixed !== input.url) input = new Request(fixed, input);
    }
  } catch {
    /* passa direto se algo der errado */
  }
  return origFetch(input as RequestInfo, init);
};

// --- XMLHttpRequest ---
const origOpen = XMLHttpRequest.prototype.open;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
XMLHttpRequest.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
  try {
    const fixed = fixMpSearchUrl(typeof url === 'string' ? url : url.toString());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origOpen as any).call(this, method, fixed, ...rest);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origOpen as any).call(this, method, url, ...rest);
  }
};

// eslint-disable-next-line no-console
console.log('[MP-FIX] interceptor de BIN ativo');

export {};
