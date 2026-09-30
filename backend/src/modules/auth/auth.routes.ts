import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { authRateLimiter, loginBruteForceRateLimiter } from '../../middlewares/rateLimiters';
import { authController } from './auth.controller';

/**
 * Auth — R3 + F2 (segurança).
 * POST /api/auth/register         → cria cliente + retorna JWT (envia verificação)
 * POST /api/auth/login            → JWT do cliente ou admin
 * GET  /api/auth/me               → dados do usuário autenticado (sem passwordHash)
 * POST /api/auth/verify-email     → confirma e-mail via token
 * POST /api/auth/forgot-password  → inicia reset de senha (200 genérico)
 * POST /api/auth/reset-password   → redefine a senha via token
 */
export const authRouter = Router();

authRouter.post('/register', authRateLimiter, asyncHandler(authController.register));
authRouter.post(
  '/login',
  authRateLimiter,
  loginBruteForceRateLimiter,
  asyncHandler(authController.login),
);
authRouter.get('/me', authMiddleware, asyncHandler(authController.me));

authRouter.post('/verify-email', authRateLimiter, asyncHandler(authController.verifyEmail));
authRouter.post('/forgot-password', authRateLimiter, asyncHandler(authController.forgotPassword));
authRouter.post('/reset-password', authRateLimiter, asyncHandler(authController.resetPassword));
