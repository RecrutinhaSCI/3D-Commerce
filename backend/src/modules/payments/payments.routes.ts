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
 *   POST /api/admin/orders/:orderId/cancel     cancelar/estornar pedido (admin)
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

// Cancelar/estornar pedido (admin) — estorna no Mercado Pago se já foi pago.
paymentsRouter.post(
  '/admin/orders/:orderId/cancel',
  authMiddleware,
  adminMiddleware,
  asyncHandler(paymentsController.cancelOrder),
);

// Cron diário (Vercel Cron): reconcilia pagamentos e expira pedidos não pagos.
// Protegido por CRON_SECRET no controller (sem a env, responde 503).
paymentsRouter.get('/cron/expire-orders', asyncHandler(paymentsController.cronExpireOrders));

// Reconciliação em lote (admin) — rede de segurança para webhooks perdidos.
paymentsRouter.post(
  '/admin/payments/reconcile',
  authMiddleware,
  adminMiddleware,
  asyncHandler(paymentsController.reconcile),
);
