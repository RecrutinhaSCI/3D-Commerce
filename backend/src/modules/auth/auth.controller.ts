import type { Request, Response } from 'express';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { authService } from './auth.service';
import {
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas';

export const authController = {
  async register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    return created(res, result);
  },

  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    return ok(res, result);
  },

  async me(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const user = await authService.getMe(req.user.id);
    return ok(res, { user });
  },

  async verifyEmail(req: Request, res: Response) {
    const input = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyEmailToken(input);
    return ok(res, result);
  },

  async forgotPassword(req: Request, res: Response) {
    const input = forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(input);
    // Resposta SEMPRE genérica — não revela se o e-mail existe.
    return ok(res, { message: 'Se o e-mail existir, enviamos o link de redefinição.' });
  },

  async resetPassword(req: Request, res: Response) {
    const input = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(input);
    return ok(res, { message: 'Senha redefinida com sucesso.' });
  },
};
