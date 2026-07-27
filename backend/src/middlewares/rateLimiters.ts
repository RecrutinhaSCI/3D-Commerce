import rateLimit, { type Options } from 'express-rate-limit';
import { fail } from '../utils/apiResponse';

/**
 * Rate limiters — R10.
 * Respondem no envelope padrão da API ({ ok:false, error:{code,message} })
 * em vez do texto default do express-rate-limit. Contam por IP — o app
 * já tem `trust proxy` habilitado para funcionar atrás de Vercel/Render/Cloudflare.
 */
const handler: Options['handler'] = (_req, res) => {
  fail(res, 429, 'RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.');
};

/** Login e registro — 10 tentativas / 15 min por IP. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Criação de orçamentos (anônimo incluso) — 20 / hora por IP. */
export const quoteRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Uploads (produtos, banners, settings, testimonials, arquivos de orçamento) — 30 / hora por IP. */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Webhooks de pagamento — 120 / 5 min por IP (PSPs reenviam em rajada; brute force de assinatura não). */
export const webhookRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Validação pública de cupom — 30 tentativas / 10 min por IP (evita brute force de códigos). */
export const couponValidateRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});
