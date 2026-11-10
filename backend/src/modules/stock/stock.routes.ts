import { Router, type Request } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { internalUseSchema, movementsQuerySchema } from './stock.schemas';
import { stockService, type StockActor } from './stock.service';

/** Operador autenticado, para registrar quem fez cada movimentação. */
export function actorFrom(req: Request): StockActor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, name: req.user.name ?? req.user.email };
}

/**
 * GET  /api/admin/stock/movements     histórico filtrável
 * POST /api/admin/stock/internal-use  uso interno
 */
export const stockRouter = Router();

stockRouter.use('/admin/stock', authMiddleware, adminMiddleware);

stockRouter.get(
  '/admin/stock/movements',
  asyncHandler(async (req, res) => {
    ok(res, await stockService.listMovements(movementsQuerySchema.parse(req.query)));
  }),
);

stockRouter.post(
  '/admin/stock/internal-use',
  asyncHandler(async (req, res) => {
    created(res, await stockService.registerInternalUse(internalUseSchema.parse(req.body), actorFrom(req)));
  }),
);
