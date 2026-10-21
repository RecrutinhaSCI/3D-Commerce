import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { adminUploadRateLimiter } from '../../middlewares/rateLimiters';
import { siteImageUpload } from '../../lib/upload';
import { categoriesController } from './categories.controller';

/**
 * Rotas de categorias — montadas sob `/api`.
 *
 * Público:
 *   GET    /api/public/categories
 * Admin (auth + admin):
 *   GET    /api/admin/categories
 *   POST   /api/admin/categories
 *   PUT    /api/admin/categories/:id
 *   DELETE /api/admin/categories/:id
 *   POST   /api/admin/categories/:id/image           (multipart, campo "image")
 *   DELETE /api/admin/categories/:id/image
 *   POST   /api/admin/categories/:id/seasonal-image  (multipart, campo "image")
 *   DELETE /api/admin/categories/:id/seasonal-image
 */
export const categoriesRouter = Router();

// Público
categoriesRouter.get('/public/categories', asyncHandler(categoriesController.listPublic));

// Admin
categoriesRouter.use('/admin/categories', authMiddleware, adminMiddleware);
categoriesRouter.get('/admin/categories', asyncHandler(categoriesController.listAdmin));
categoriesRouter.post('/admin/categories', asyncHandler(categoriesController.create));
categoriesRouter.put('/admin/categories/:id', asyncHandler(categoriesController.update));
categoriesRouter.delete('/admin/categories/:id', asyncHandler(categoriesController.remove));
// Imagens — mesmo armazenamento dos demais assets do site (Vercel Blob).
categoriesRouter.post(
  '/admin/categories/:id/image',
  adminUploadRateLimiter,
  siteImageUpload.single('image'),
  asyncHandler(categoriesController.uploadImage('imageUrl')),
);
categoriesRouter.delete('/admin/categories/:id/image', asyncHandler(categoriesController.removeImage('imageUrl')));
categoriesRouter.post(
  '/admin/categories/:id/seasonal-image',
  adminUploadRateLimiter,
  siteImageUpload.single('image'),
  asyncHandler(categoriesController.uploadImage('seasonalBannerImage')),
);
categoriesRouter.delete(
  '/admin/categories/:id/seasonal-image',
  asyncHandler(categoriesController.removeImage('seasonalBannerImage')),
);
