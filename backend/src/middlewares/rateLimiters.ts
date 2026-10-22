import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { fail } from '../utils/apiResponse';

/**
 * Rate limiters — R10.
 * Respondem no envelope padrão da API ({ ok:false, error:{code,message} })
 * em vez do texto default do express-rate-limit. Contam por IP — o app
 * já tem `trust proxy` habilitado para funcionar atrás de Vercel/Render/Cloudflare.
 */
const handler: Options['handler'] = (req, res) => {
  fail(res, 429, 'RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.', retryDetails(req));
};

/**
 * Segundos até a janela liberar, para o front dizer "tente em X min" (o header
 * Retry-After não é legível pelo navegador em requisição cross-origin).
 */
function retryDetails(req: Parameters<Options['handler']>[0]) {
  const reset = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  if (!reset) return undefined;
  return { retryAfterSeconds: Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) };
}

/** Login e registro — 10 tentativas / 15 min por IP (limite amplo por origem). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/**
 * Anti brute-force de login — 5 tentativas / 15 min por (IP + e-mail).
 *
 * Complementa o `authRateLimiter` (que conta só por IP): um atacante que
 * varre a mesma conta a partir do mesmo IP é barrado após 5 tentativas,
 * sem prejudicar outros usuários legítimos atrás do mesmo IP (NAT/proxy),
 * que têm chaves distintas por e-mail. A chave combina o IP normalizado
 * (via `ipKeyGenerator`, seguro para IPv6) com o e-mail do corpo — quando
 * ausente/mal formado cai só no IP. Aplicar SOMENTE no login (o register
 * não tem alvo de conta a proteger).
 */
export const loginBruteForceRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  keyGenerator: (req) => {
    const ipKey = ipKeyGenerator(req.ip ?? '');
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return email ? `${ipKey}:${email}` : ipKey;
  },
});

/**
 * Criação de pedido e de pagamento — 20 / min por usuário (fallback IP).
 * Evita criação em massa/abuso de checkout por uma conta. Como as rotas são
 * autenticadas, conta por `req.user.id`; se por algum motivo não houver
 * usuário, cai no IP normalizado. NÃO usar no webhook do MP (chamado várias
 * vezes pelo provedor).
 */
export const orderRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
});

/**
 * Cotação de frete (checkout) — 30 / min por usuário. Cada chamada pode ir ao
 * Melhor Envio; o limite protege a cota da conta contra loop/abuso. O cache de
 * 10 min do cliente já absorve as repetições normais do checkout.
 */
export const shippingQuoteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
});

/** Formulário de contato e newsletter (públicos) — 10 / hora por IP. */
export const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
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

/**
 * Upload PÚBLICO de arquivos de orçamento (anônimo incluso) — 30 / hora por IP.
 * Contador próprio: não divide cota com os uploads do admin.
 */
export const quoteFilesRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/**
 * Uploads do ADMIN (imagens de produto, banners, logo, imagens do site,
 * avatares) — 120 / 10 min POR USUÁRIO autenticado.
 *
 * O front envia uma imagem por requisição (limite de 4,5 MB do corpo), então
 * reenviar o catálogo gera dezenas de uploads seguidos — o antigo limite de
 * 30/h por IP (dividido com o upload público de orçamento) travava o admin.
 * Contar por `req.user.id` também evita o IP de proxy compartilhado. Ainda
 * limita sessão roubada ou script fora de controle.
 *
 * DEVE vir depois do `authMiddleware` (as rotas admin aplicam auth+admin via
 * `router.use`). Sem usuário — não deveria acontecer — cai no IP.
 */
export const adminUploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    fail(
      res,
      429,
      'RATE_LIMITED',
      'Limite de uploads atingido. Aguarde alguns minutos e tente de novo.',
      retryDetails(req),
    );
  },
  keyGenerator: (req) => (req.user?.id ? `admin:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
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
