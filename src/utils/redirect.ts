/**
 * Destino pós-login a partir de `?redirect=` — só caminhos INTERNOS ("/algo"),
 * nunca URL externa ou "//host" (evita open redirect).
 */
export function safeRedirect(search: string, fallback = '/minha-conta'): string {
  const target = new URLSearchParams(search).get('redirect');
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

/** Link para o login que volta para `path` depois. */
export function loginUrl(path: string): string {
  return `/login?redirect=${encodeURIComponent(path)}`;
}
