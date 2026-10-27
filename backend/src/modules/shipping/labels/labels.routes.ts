import { Router } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';
import { authMiddleware } from '../../../middlewares/authMiddleware';
import { adminMiddleware } from '../../../middlewares/adminMiddleware';
import { labelsService } from './labels.service';
import { senderSchema } from './sender';

/**
 * Etiquetas do Melhor Envio — SÓ admin.
 *
 *   GET /api/admin/shipping-labels/config   → travas + prontidão do remetente
 *   GET /api/admin/shipping-labels/sender   → remetente salvo (ou sugestão)
 *   PUT /api/admin/shipping-labels/sender   → grava o remetente (validado)
 *
 * Preparar/comprar/gerar entram nas próximas etapas, atrás das travas
 * MELHOR_ENVIO_LABELS_ENABLED / MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION.
 */
export const labelsRouter = Router();

labelsRouter.use('/admin/shipping-labels', authMiddleware, adminMiddleware);

labelsRouter.get('/admin/shipping-labels/config', asyncHandler(async (_req, res) => ok(res, await labelsService.getConfig())));
labelsRouter.get('/admin/shipping-labels/sender', asyncHandler(async (_req, res) => ok(res, await labelsService.getSender())));
labelsRouter.put(
  '/admin/shipping-labels/sender',
  asyncHandler(async (req, res) => ok(res, await labelsService.updateSender(senderSchema.parse(req.body ?? {})))),
);
