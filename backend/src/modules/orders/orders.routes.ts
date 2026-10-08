import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { orderRateLimiter } from '../../middlewares/rateLimiters';
import { ordersController } from './orders.controller';

/**
 * Orders — R5.
 * Cliente:
 *   POST /api/orders            (autenticado)
 *   GET  /api/me/orders         (autenticado)
 *   GET  /api/me/orders/:id     (autenticado)
 * Admin:
 *   GET  /api/admin/orders
 *   GET  /api/admin/orders/:id
 *   PUT  /api/admin/orders/:id/status
 *   PUT  /api/admin/orders/:id/tracking
 */
export const ordersRouter = Router();

// Cliente
ordersRouter.post('/orders', authMiddleware, orderRateLimiter, asyncHandler(ordersController.create));
ordersRouter.get('/me/orders', authMiddleware, asyncHandler(ordersController.listMine));
ordersRouter.get('/me/orders/:id', authMiddleware, asyncHandler(ordersController.getMine));

// Admin
ordersRouter.use('/admin/orders', authMiddleware, adminMiddleware);
ordersRouter.get('/admin/orders', asyncHandler(ordersController.listAdmin));
ordersRouter.get('/admin/orders/:id', asyncHandler(ordersController.getAdmin));
ordersRouter.put('/admin/orders/:id/status', asyncHandler(ordersController.updateStatus));
ordersRouter.put('/admin/orders/:id/tracking', asyncHandler(ordersController.updateTracking));
