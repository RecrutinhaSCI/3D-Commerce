import bcrypt from 'bcryptjs';
import { UserRole, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { sendEmail } from '../../lib/email';
import { passwordResetEmail, verifyEmail } from '../../lib/emailTemplates';
import { HttpError } from '../../utils/httpError';
import { signAuthToken } from '../../utils/jwt';
import {
  EMAIL_VERIFY_TTL_MINUTES,
  PASSWORD_RESET_TTL_MINUTES,
  expiresInMinutes,
  generateToken,
  hashToken,
} from './authTokens';
import type {
  RegisterInput,
  LoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schemas';

/**
 * View pública do usuário — nunca inclui `passwordHash`.
 * Use este tipo em qualquer response que devolva `user`.
 */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  active: boolean;
  /** Cliente já confirmou o e-mail? A UI usa isto para exibir aviso não-bloqueante. */
  emailVerified: boolean;
  createdAt: string;
}

function toPublicUser(
  u: Pick<User, 'id' | 'name' | 'email' | 'phone' | 'role' | 'active' | 'emailVerified' | 'createdAt'>,
): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    active: u.active,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

const BCRYPT_ROUNDS = 10;

/**
 * Monta um link do frontend a partir do APP_URL, sem barra dupla.
 * Ex.: buildAppLink('/verificar-email', 'abc') => APP_URL/verificar-email?token=abc
 */
function buildAppLink(path: string, token: string): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

export const authService = {
  async register(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw HttpError.conflict('Este e-mail já está cadastrado.');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // Token de verificação: guardamos só o hash + expiração (~24h). O token
    // plano vive apenas no link do e-mail.
    const verifyPlain = generateToken();
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        phone: input.phone,
        role: UserRole.CUSTOMER,
        active: true,
        emailVerifyTokenHash: hashToken(verifyPlain),
        emailVerifyExpiresAt: expiresInMinutes(EMAIL_VERIFY_TTL_MINUTES),
      },
    });

    // Envio do e-mail de verificação NÃO bloqueia o cadastro: se o SMTP estiver
    // off (modo dev) ou falhar, apenas logamos e seguimos.
    const link = buildAppLink('/verificar-email', verifyPlain);
    try {
      const { subject, html, text } = verifyEmail(link);
      await sendEmail({ to: user.email, subject, html, text });
    } catch (err) {
      // Nunca logar o token/link — só a falha genérica.
      // eslint-disable-next-line no-console
      console.error('[auth] Falha ao enviar e-mail de verificação (cadastro segue):', (err as Error).message);
    }

    const token = signAuthToken({ sub: user.id, email: user.email, role: user.role });
    return { user: toPublicUser(user), token };
  },

  /**
   * Confirma o e-mail a partir do token plano. Valida hash + expiração,
   * seta `emailVerified=true` e limpa o token. Erro claro se inválido/expirado.
   */
  async verifyEmailToken(input: VerifyEmailInput): Promise<{ user: PublicUser }> {
    const tokenHash = hashToken(input.token);
    const user = await prisma.user.findFirst({ where: { emailVerifyTokenHash: tokenHash } });

    if (!user || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt.getTime() < Date.now()) {
      throw HttpError.badRequest('Link de verificação inválido ou expirado.');
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyTokenHash: null,
        emailVerifyExpiresAt: null,
      },
    });

    return { user: toPublicUser(updated) };
  },

  /**
   * Inicia recuperação de senha. Se o cliente existir, gera token de reset
   * (hash + expiração ~1h) e envia o e-mail. NÃO revela se o e-mail existe —
   * o controller sempre responde 200 genérico.
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Silencioso se não existir ou estiver inativo — não vaza enumeração.
    if (!user || !user.active) return;

    const resetPlain = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: hashToken(resetPlain),
        passwordResetExpiresAt: expiresInMinutes(PASSWORD_RESET_TTL_MINUTES),
      },
    });

    const link = buildAppLink('/redefinir-senha', resetPlain);
    try {
      const { subject, html, text } = passwordResetEmail(link);
      await sendEmail({ to: user.email, subject, html, text });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[auth] Falha ao enviar e-mail de reset de senha:', (err as Error).message);
    }
  },

  /**
   * Redefine a senha a partir do token de reset. Valida hash + expiração,
   * grava novo `passwordHash` (bcrypt, mesmo custo do register) e limpa o token.
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const tokenHash = hashToken(input.token);
    const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash } });

    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() < Date.now()) {
      throw HttpError.badRequest('Link de redefinição inválido ou expirado.');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  },

  async login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
    // DECISÃO (F2): login NÃO é bloqueado para quem ainda não verificou o
    // e-mail — isso evita travar o usuário logo após o cadastro. Apenas
    // expomos `emailVerified` no retorno (via toPublicUser) para a UI mostrar
    // um aviso não-bloqueante pedindo a confirmação.
    // Mesma mensagem para "não existe" e "senha errada" — não vaza enumeração.
    const invalid = HttpError.unauthorized('E-mail ou senha inválidos.');
    const disabled = HttpError.forbidden('Conta desativada. Fale com o suporte.');

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      // Preserva tempo constante (aproximado) mesmo quando o usuário não existe
      // — evita side-channel de enumeração por latência.
      await bcrypt.compare(input.password, '$2b$10$abcdefghijklmnopqrstuv');
      throw invalid;
    }
    if (!user.active) throw disabled;

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw invalid;

    const token = signAuthToken({ sub: user.id, email: user.email, role: user.role });
    return { user: toPublicUser(user), token };
  },

  async getMe(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw HttpError.unauthorized('Usuário não encontrado.');
    if (!user.active) throw HttpError.forbidden('Conta desativada.');
    return toPublicUser(user);
  },

  /** Usado pelo authMiddleware — retorna dados mínimos para popular req.user. */
  async findActiveUserById(userId: string) {
    return prisma.user.findFirst({
      where: { id: userId, active: true },
      select: { id: true, email: true, role: true },
    });
  },
};
