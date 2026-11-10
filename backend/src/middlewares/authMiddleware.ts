import type { RequestHandler } from 'express';
import { HttpError } from '../utils/httpError';
import { verifyAuthToken } from '../utils/jwt';
import { authService } from '../modules/auth/auth.service';

/**
 * Exige Authorization: Bearer <token>.
 * Valida assinatura + expiração, checa se o usuário ainda existe e está ativo,
 * e anexa `req.user = { id, email, role }`.
 */
export const authMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw HttpError.unauthorized('Token ausente ou mal formatado.');
    }

    let payload: ReturnType<typeof verifyAuthToken>;
    try {
      payload = verifyAuthToken(token);
    } catch {
      // Cobre TokenExpiredError, JsonWebTokenError e payloads corrompidos.
      throw HttpError.unauthorized('Token inválido ou expirado.');
    }

    const dbUser = await authService.findActiveUserById(payload.sub);
    if (!dbUser) {
      throw HttpError.unauthorized('Sessão inválida.');
    }

    req.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role, name: dbUser.name };
    next();
  } catch (err) {
    next(err);
  }
};
