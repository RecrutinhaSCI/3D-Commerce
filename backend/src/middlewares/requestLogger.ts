import type { RequestHandler } from 'express';

/**
 * Parâmetros de query que NUNCA vão para o log (OAuth, tokens, segredos).
 * Comparação sem diferenciar maiúsculas.
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'secret',
  'password',
  'senha',
  'key',
  'signature',
]);

/** URL para log: mantém o caminho e troca valores sensíveis da query por [redacted]. */
export function sanitizeUrlForLog(originalUrl: string): string {
  const q = originalUrl.indexOf('?');
  if (q === -1) return originalUrl;
  const path = originalUrl.slice(0, q);
  const params = new URLSearchParams(originalUrl.slice(q + 1));
  const safe = [...params.entries()].map(([k, v]) =>
    `${encodeURIComponent(k)}=${SENSITIVE_QUERY_KEYS.has(k.toLowerCase()) ? '[redacted]' : encodeURIComponent(v)}`,
  );
  return safe.length ? `${path}?${safe.join('&')}` : path;
}

/**
 * Logger leve para desenvolvimento. Em produção pode ser substituído por pino/winston.
 * Formato: `[METHOD] /path status XXms` — query com segredos redigida.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[${req.method}] ${sanitizeUrlForLog(req.originalUrl)} ${res.statusCode} ${ms}ms`);
  });
  next();
};
