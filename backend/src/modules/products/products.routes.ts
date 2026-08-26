import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { uploadRateLimiter } from '../../middlewares/rateLimiters';
import { productMediaUpload } from '../../lib/upload';
import { productsController } from './products.controller';

/**
 * Rotas de produtos — montadas sob `/api`.
 *
 * Público:
 *   GET  /api/public/products             (com filtros + paginação)
 *   GET  /api/public/products/featured
 *   GET  /api/public/products/:slug
 *
 * Admin (auth + admin):
 *   GET    /api/admin/products
 *   POST   /api/admin/products
 *   PUT    /api/admin/products/:id
 *   DELETE /api/admin/products/:id
 *   POST   /api/admin/products/:id/images
 *   DELETE /api/admin/products/images/:imageId
 */
export const productsRouter = Router();

// Público — ORDEM importa: /featured antes de /:slug.
productsRouter.get('/public/products', asyncHandler(productsController.listPublic));
productsRouter.get('/public/products/featured', asyncHandler(productsController.listFeatured));
productsRouter.get('/public/products/:slug', asyncHandler(productsController.getPublicBySlug));

// Admin — protegido.
productsRouter.use('/admin/products', authMiddleware, adminMiddleware);
productsRouter.get('/admin/products', asyncHandler(productsController.listAdmin));
productsRouter.post('/admin/products', asyncHandler(productsController.create));
// Imagens — ORDEM importa: `/images/:imageId` antes de `/:id/images` para
// evitar que ":id" capture "images".
productsRouter.delete(
  '/admin/products/images/:imageId',
  asyncHandler(productsController.removeImage),
);
productsRouter.post(
  '/admin/products/:id/images',
  uploadRateLimiter,
  // R20: campo continua "images" (compat com frontend), mas agora aceita
  // imagens + GIF + MP4 via productMediaUpload (validação por tipo no service).
  productMediaUpload.array('images', 10),
  asyncHandler(productsController.addImages),
);
productsRouter.put('/admin/products/:id', asyncHandler(productsController.update));
productsRouter.delete('/admin/products/:id', asyncHandler(productsController.remove));

// R19-A — Import em lote. Idempotente, nunca deleta, matching feito no banco
// (id → sku → slug explícito → conflito seguro em ambiguidade de nome).
productsRouter.post('/admin/products/import', asyncHandler(productsController.bulkImport));
