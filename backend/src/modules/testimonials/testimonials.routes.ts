import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { adminUploadRateLimiter } from '../../middlewares/rateLimiters';
import { siteImageUpload } from '../../lib/upload';
import { testimonialsController } from './testimonials.controller';

/**
 * Testimonials — R8.
 * Público:
 *   GET  /api/public/testimonials
 * Admin (auth + admin):
 *   GET    /api/admin/testimonials
 *   POST   /api/admin/testimonials
 *   PUT    /api/admin/testimonials/:id
 *   DELETE /api/admin/testimonials/:id
 *   POST   /api/admin/testimonials/:id/avatar  (multipart, field "avatar")
 */
export const testimonialsRouter = Router();

// Público
testimonialsRouter.get('/public/testimonials', asyncHandler(testimonialsController.listPublic));

// Admin
testimonialsRouter.use('/admin/testimonials', authMiddleware, adminMiddleware);
testimonialsRouter.get('/admin/testimonials', asyncHandler(testimonialsController.listAdmin));
testimonialsRouter.post('/admin/testimonials', asyncHandler(testimonialsController.create));
testimonialsRouter.post(
  '/admin/testimonials/:id/avatar',
  adminUploadRateLimiter,
  siteImageUpload.single('avatar'),
  asyncHandler(testimonialsController.uploadAvatar),
);
testimonialsRouter.put('/admin/testimonials/:id', asyncHandler(testimonialsController.update));
testimonialsRouter.delete('/admin/testimonials/:id', asyncHandler(testimonialsController.remove));
