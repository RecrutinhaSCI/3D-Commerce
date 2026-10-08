import crypto from 'crypto';

/**
 * Tokens de verificação de e-mail e reset de senha.
 *
 * Modelo de segurança: o token PLANO só existe no link enviado ao usuário.
 * No banco guardamos apenas o hash SHA-256 (determinístico) — isso permite
 * buscar o usuário pelo hash do token recebido, sem nunca persistir o segredo
 * em texto. SHA-256 sem sal é adequado aqui porque o token tem alta entropia
 * (32 bytes aleatórios), diferente de senhas (que exigem bcrypt).
 */

/** Gera um token plano forte (256 bits) em hex. Só ele vai no link do e-mail. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash determinístico do token — é o que persiste no banco. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Data de expiração daqui a `minutes` minutos. */
export function expiresInMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/** Janela padrão de verificação de e-mail: 24h. */
export const EMAIL_VERIFY_TTL_MINUTES = 60 * 24;
/** Janela padrão de reset de senha: 1h. */
export const PASSWORD_RESET_TTL_MINUTES = 60;
