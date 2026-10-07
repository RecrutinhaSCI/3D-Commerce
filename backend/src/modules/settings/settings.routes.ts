import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { uploadRateLimiter } from '../../middlewares/rateLimiters';
import { siteImageUpload } from '../../lib/upload';
import { settingsController } from './settings.controller';

/**
 * Settings — R8.
 * Público:
 *   GET  /api/public/settings
 * Admin:
 *   GET  /api/admin/settings
 *   PUT  /api/admin/settings
 *   POST /api/admin/settings/logo  (multipart, field "logo")
 */
export const settingsRouter = Router();

// Público
settingsRouter.get('/public/settings', asyncHandler(settingsController.getPublic));

// Admin
settingsRouter.use('/admin/settings', authMiddleware, adminMiddleware);
settingsRouter.get('/admin/settings', asyncHandler(settingsController.getAdmin));
settingsRouter.put('/admin/settings', asyncHandler(settingsController.update));
settingsRouter.post(
  '/admin/settings/logo',
  uploadRateLimiter,
  siteImageUpload.single('logo'),
  asyncHandler(settingsController.uploadLogo),
);
// Upload avulso: usado para thumbnails dos vídeos do YouTube (retorna só a URL).
settingsRouter.post(
  '/admin/settings/upload-image',
  uploadRateLimiter,
  siteImageUpload.single('image'),
  asyncHandler(settingsController.uploadImage),
);
