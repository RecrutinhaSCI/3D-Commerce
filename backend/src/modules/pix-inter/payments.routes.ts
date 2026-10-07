import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { webhookRateLimiter } from '../../middlewares/rateLimiters';
import { paymentsController } from './payments.controller';

/**
 * Payments — R19.
 * Cliente (autenticado, dono do pedido):
 *   POST /api/orders/:orderId/payments      → cria/reusa cobrança Pix
 *   GET  /api/orders/:orderId/payments      → lista cobranças do pedido
 *   GET  /api/payments/:id                  → consulta status
 *   POST /api/payments/:id/simulate         → simula status (só MOCK, fora de produção)
 * Admin:
 *   GET  /api/admin/payments/:id            → cobrança + trilha de eventos
 * Público (autenticação própria por provider — assinatura HMAC etc.):
 *   POST /api/webhooks/payments/:provider
 */
export const paymentsRouter = Router();

// Cliente
paymentsRouter.post('/orders/:orderId/payments', authMiddleware, asyncHandler(paymentsController.createForOrder));
paymentsRouter.get('/orders/:orderId/payments', authMiddleware, asyncHandler(paymentsController.listForOrder));
paymentsRouter.post('/payments/:id/simulate', authMiddleware, asyncHandler(paymentsController.simulate));
paymentsRouter.get('/payments/:id', authMiddleware, asyncHandler(paymentsController.getById));

// Admin
paymentsRouter.get('/admin/payments/:id', authMiddleware, adminMiddleware, asyncHandler(paymentsController.getAdmin));

// Webhook — sem authMiddleware: a autenticidade é validada pelo provider
// (HMAC do body bruto no MOCK; mecanismo próprio do Inter no futuro).
paymentsRouter.post('/webhooks/payments/:provider', webhookRateLimiter, asyncHandler(paymentsController.webhook));
