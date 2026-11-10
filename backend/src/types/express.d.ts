import type { UserRole } from '@prisma/client';

/**
 * Extensão do Express Request para carregar o usuário autenticado.
 * Populado pelo authMiddleware.
 */
declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      email: string;
      role: UserRole;
      /** Nome para auditoria (operador do PDV, movimentações de estoque). */
      name?: string;
    }
    interface Request {
      user?: AuthenticatedUser;
      /**
       * Body bruto capturado pelo express.json (verify) — necessário para
       * validar assinaturas HMAC de webhooks de pagamento (R19).
       */
      rawBody?: Buffer;
    }
  }
}

export {};
