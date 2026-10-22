import { Router } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { integrationAuthorizeRateLimiter, integrationCallbackRateLimiter } from '../../middlewares/rateLimiters';
import { resolveMelhorEnvioConfig } from '../shipping/melhorEnvioConfig';
import {
  createAuthorizationUrl,
  getMelhorEnvioOAuthStatus,
  handleOAuthCallback,
  OAuthUnavailableError,
} from './melhorEnvioOAuth';

/**
 * Integrações OAuth (Melhor Envio).
 *
 *   POST /api/admin/integrations/melhor-envio/authorize   (admin)
 *        → { authorizationUrl, environment, expiresAt }
 *        O front redireciona o navegador para essa URL (o JWT do admin vai no
 *        header, por isso o início é um POST e não um link).
 *   GET  /api/admin/integrations/melhor-envio/status      (admin)
 *        → status da conexão — NUNCA o token.
 *   GET  /api/integrations/melhor-envio/callback?code&state   (público)
 *        → 302 para /admin/configuracoes?melhorEnvio=conectado|erro&motivo=…
 *        Só motivos genéricos; detalhes técnicos ficam no log (sem segredo).
 */
export const integrationsRouter = Router();

const CALLBACK_REASONS: Record<string, string> = {
  config: 'configuracao',
  state: 'sessao',
  denied: 'negado',
  code: 'sessao',
  exchange: 'falha',
};

integrationsRouter.post(
  '/admin/integrations/melhor-envio/authorize',
  authMiddleware,
  adminMiddleware,
  integrationAuthorizeRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      return ok(res, await createAuthorizationUrl(req.user!.id));
    } catch (err) {
      if (err instanceof OAuthUnavailableError) {
        throw new HttpError(503, 'INTEGRATION_NOT_CONFIGURED', 'Integração com o Melhor Envio não configurada no servidor.');
      }
      throw err;
    }
  }),
);

integrationsRouter.get(
  '/admin/integrations/melhor-envio/status',
  authMiddleware,
  adminMiddleware,
  asyncHandler(async (_req, res) => {
    const manual = Boolean(resolveMelhorEnvioConfig(env).token);
    return ok(res, await getMelhorEnvioOAuthStatus(manual));
  }),
);

integrationsRouter.get(
  '/integrations/melhor-envio/callback',
  integrationCallbackRateLimiter,
  asyncHandler(async (req, res) => {
    const result = await handleOAuthCallback({ code: req.query.code, state: req.query.state, error: req.query.error });
    // A URL desta página tem o code: nada de cache nem Referer.
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const target = new URL('/admin/configuracoes', env.APP_URL);
    if (result.ok) target.searchParams.set('melhorEnvio', 'conectado');
    else {
      target.searchParams.set('melhorEnvio', 'erro');
      target.searchParams.set('motivo', CALLBACK_REASONS[result.reason] ?? 'falha');
    }
    return res.redirect(302, target.toString());
  }),
);
