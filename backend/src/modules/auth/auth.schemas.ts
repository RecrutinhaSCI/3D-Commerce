import { z } from 'zod';

/** POST /api/auth/register */
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome (mínimo 2 caracteres).'),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(6, 'A senha precisa ter no mínimo 6 caracteres.'),
  phone: z.string().trim().optional(),
  // LGPD: aceite explícito da Política de Privacidade (gravado com data/versão).
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: 'É preciso aceitar a Política de Privacidade para criar a conta.' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe a senha.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** POST /api/auth/verify-email */
export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Token inválido.'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/** POST /api/auth/forgot-password */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** POST /api/auth/reset-password */
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token inválido.'),
  password: z.string().min(6, 'A senha precisa ter no mínimo 6 caracteres.'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
