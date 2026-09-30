import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { orderRateLimiter } from '../../middlewares/rateLimiters';
import { paymentsController } from './payments.controller';

/**
 * Payments — Mercado Pago (Checkout Transparente).
 *   POST /api/orders/:orderId/payments         cria o pagamento no MP (auth)
 *   GET  /api/orders/:orderId/payments/status  consulta/reconcilia o status (auth)
 *   POST /api/payments/webhook                 notificações do MP (T5, PÚBLICO)
 *   POST /api/admin/payments/reconcile         reconciliação em lote (admin)
 *
 * O webhook é PÚBLICO de propósito: a MP chama sem token. A autenticidade é
 * garantida pela assinatura `x-signature` validada no controller, não por
 * authMiddleware. Não adicione auth aqui.
 */
export const paymentsRouter = Router();

paymentsRouter.post(
  '/orders/:orderId/payments',
  authMiddleware,
  orderRateLimiter,
  asyncHandler(paymentsController.create),
);
paymentsRouter.get(
  '/orders/:orderId/payments/status',
  authMiddleware,
  asyncHandler(paymentsController.status),
);
paymentsRouter.post('/payments/webhook', asyncHandler(paymentsController.webhook));

// Reconciliação em lote (admin) — rede de segurança para webhooks perdidos.
paymentsRouter.post(
  '/admin/payments/reconcile',
  authMiddleware,
  adminMiddleware,
  asyncHandler(paymentsController.reconcile),
);
