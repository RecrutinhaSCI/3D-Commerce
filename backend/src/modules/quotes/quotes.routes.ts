import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { optionalAuthMiddleware } from '../../middlewares/optionalAuthMiddleware';
import { quoteFilesRateLimiter, quoteRateLimiter } from '../../middlewares/rateLimiters';
import { quoteFilesUpload } from '../../lib/upload';
import { quotesController } from './quotes.controller';

/**
 * Quotes — R6.
 * Público / cliente:
 *   POST /api/quotes                (anônimo ou autenticado — optionalAuth)
 *   POST /api/quotes/:id/files      (upload público por id — spec R6)
 *   GET  /api/me/quotes             (autenticado)
 *   GET  /api/me/quotes/:id         (autenticado)
 * Admin:
 *   GET  /api/admin/quotes
 *   GET  /api/admin/quotes/:id
 *   PUT  /api/admin/quotes/:id
 *   PUT  /api/admin/quotes/:id/status
 */
export const quotesRouter = Router();

// Público / auth opcional
quotesRouter.post('/quotes', quoteRateLimiter, optionalAuthMiddleware, asyncHandler(quotesController.create));
quotesRouter.post(
  '/quotes/:id/files',
  quoteFilesRateLimiter,
  quoteFilesUpload.array('files', 10),
  asyncHandler(quotesController.addFiles),
);

// Cliente autenticado — "meus"
quotesRouter.get('/me/quotes', authMiddleware, asyncHandler(quotesController.listMine));
quotesRouter.get('/me/quotes/:id', authMiddleware, asyncHandler(quotesController.getMine));

// Admin
quotesRouter.use('/admin/quotes', authMiddleware, adminMiddleware);
quotesRouter.get('/admin/quotes', asyncHandler(quotesController.listAdmin));
quotesRouter.get('/admin/quotes/:id', asyncHandler(quotesController.getAdmin));
quotesRouter.put('/admin/quotes/:id/status', asyncHandler(quotesController.updateStatus));
quotesRouter.put('/admin/quotes/:id', asyncHandler(quotesController.updateAdmin));
