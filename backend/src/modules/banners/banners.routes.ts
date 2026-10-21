import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { adminUploadRateLimiter } from '../../middlewares/rateLimiters';
import { siteImageUpload } from '../../lib/upload';
import { bannersController } from './banners.controller';

/**
 * Banners — R8.
 * Público:
 *   GET  /api/public/banners
 * Admin (auth + admin):
 *   GET    /api/admin/banners
 *   POST   /api/admin/banners
 *   PUT    /api/admin/banners/:id
 *   DELETE /api/admin/banners/:id
 *   POST   /api/admin/banners/:id/image   (multipart, field "image")
 */
export const bannersRouter = Router();

// Público
bannersRouter.get('/public/banners', asyncHandler(bannersController.listPublic));

// Admin
bannersRouter.use('/admin/banners', authMiddleware, adminMiddleware);
bannersRouter.get('/admin/banners', asyncHandler(bannersController.listAdmin));
bannersRouter.post('/admin/banners', asyncHandler(bannersController.create));
bannersRouter.post(
  '/admin/banners/:id/image',
  adminUploadRateLimiter,
  siteImageUpload.single('image'),
  asyncHandler(bannersController.uploadImage),
);
bannersRouter.put('/admin/banners/:id', asyncHandler(bannersController.update));
bannersRouter.delete('/admin/banners/:id', asyncHandler(bannersController.remove));
