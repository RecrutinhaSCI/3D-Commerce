import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { ordersService } from './orders.service';
import {
  adminOrdersQuerySchema,
  createOrderSchema,
  meOrdersQuerySchema,
  updateOrderStatusSchema,
  updateOrderTrackingSchema,
} from './orders.schemas';

const idParam = z.object({ id: z.string().min(1) });

function requireUser(req: Request): string {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

export const ordersController = {
  async create(req: Request, res: Response) {
    const userId = requireUser(req);
    const input = createOrderSchema.parse(req.body);
    const order = await ordersService.createFromCart(userId, input);
    return created(res, { order });
  },

  async listMine(req: Request, res: Response) {
    const userId = requireUser(req);
    const query = meOrdersQuerySchema.parse(req.query);
    const result = await ordersService.listMine(userId, query);
    return ok(res, result);
  },

  async getMine(req: Request, res: Response) {
    const userId = requireUser(req);
    const { id } = idParam.parse(req.params);
    const order = await ordersService.getMine(userId, id);
    return ok(res, { order });
  },

  async listAdmin(req: Request, res: Response) {
    const query = adminOrdersQuerySchema.parse(req.query);
    const result = await ordersService.listAdmin(query);
    return ok(res, result);
  },

  async getAdmin(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const order = await ordersService.getAdmin(id);
    return ok(res, { order });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateOrderStatusSchema.parse(req.body);
    const order = await ordersService.updateStatus(id, input);
    return ok(res, { order });
  },

  async updateTracking(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateOrderTrackingSchema.parse(req.body);
    const order = await ordersService.updateTracking(id, input);
    return ok(res, { order });
  },
};
