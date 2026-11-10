import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { created, ok } from '../../utils/apiResponse';
import { actorFrom } from '../stock/stock.routes';
import {
  cancelSaleSchema,
  closeSessionSchema,
  createReturnSchema,
  createSaleSchema,
  lookupSchema,
  openSessionSchema,
  productSearchSchema,
  sessionsQuerySchema,
} from './pos.schemas';
import { posService } from './pos.service';

const idParam = z.object({ id: z.string().min(1).max(60) });

/** PDV (frente de caixa) — tudo exige auth + admin. */
export const posRouter = Router();

posRouter.use('/admin/pos', authMiddleware, adminMiddleware);

posRouter.get('/admin/pos/session/current', asyncHandler(async (req, res) => {
  ok(res, { session: await posService.currentSession(actorFrom(req).id) });
}));
posRouter.get('/admin/pos/sessions', asyncHandler(async (req, res) => {
  ok(res, await posService.listSessions(sessionsQuerySchema.parse(req.query)));
}));
posRouter.post('/admin/pos/sessions', asyncHandler(async (req, res) => {
  created(res, { session: await posService.openSession(openSessionSchema.parse(req.body), actorFrom(req)) });
}));
posRouter.get('/admin/pos/sessions/:id', asyncHandler(async (req, res) => {
  ok(res, await posService.getSession(idParam.parse(req.params).id));
}));
posRouter.post('/admin/pos/sessions/:id/close', asyncHandler(async (req, res) => {
  ok(res, await posService.closeSession(idParam.parse(req.params).id, closeSessionSchema.parse(req.body), actorFrom(req)));
}));

posRouter.get('/admin/pos/products/search', asyncHandler(async (req, res) => {
  ok(res, await posService.searchProducts(productSearchSchema.parse(req.query)));
}));
posRouter.get('/admin/pos/products/lookup', asyncHandler(async (req, res) => {
  ok(res, await posService.lookupProduct(lookupSchema.parse(req.query).code));
}));

posRouter.post('/admin/pos/sales', asyncHandler(async (req, res) => {
  created(res, await posService.createSale(createSaleSchema.parse(req.body), actorFrom(req)));
}));
posRouter.get('/admin/pos/sales/:id', asyncHandler(async (req, res) => {
  ok(res, await posService.getSale(idParam.parse(req.params).id));
}));
posRouter.post('/admin/pos/sales/:id/cancel', asyncHandler(async (req, res) => {
  ok(res, await posService.cancelSale(idParam.parse(req.params).id, cancelSaleSchema.parse(req.body).reason, actorFrom(req)));
}));
posRouter.post('/admin/pos/sales/:id/returns', asyncHandler(async (req, res) => {
  created(res, await posService.createReturn(idParam.parse(req.params).id, createReturnSchema.parse(req.body), actorFrom(req)));
}));
