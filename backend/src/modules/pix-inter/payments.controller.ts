import type { Request, Response } from 'express';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import {
  createPaymentParamsSchema,
  paymentIdParamsSchema,
  simulatePaymentSchema,
  webhookParamsSchema,
} from './payments.schemas';
import { paymentsService } from './payments.service';

function requester(req: Request) {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

export const paymentsController = {
  /** POST /api/orders/:orderId/payments */
  async createForOrder(req: Request, res: Response) {
    const { orderId } = createPaymentParamsSchema.parse(req.params);
    const result = await paymentsService.createForOrder(requester(req), orderId);
    // Reuso idempotente devolve 200; cobrança nova devolve 201.
    if (result.reused) return ok(res, result.payment, { reused: true });
    return created(res, result.payment);
  },

  /** GET /api/orders/:orderId/payments */
  async listForOrder(req: Request, res: Response) {
    const { orderId } = createPaymentParamsSchema.parse(req.params);
    const payments = await paymentsService.listForOrder(requester(req), orderId);
    return ok(res, { payments });
  },

  /** GET /api/payments/:id */
  async getById(req: Request, res: Response) {
    const { id } = paymentIdParamsSchema.parse(req.params);
    const payment = await paymentsService.getById(requester(req), id);
    return ok(res, payment);
  },

  /** GET /api/admin/payments/:id — inclui trilha de eventos. */
  async getAdmin(req: Request, res: Response) {
    const { id } = paymentIdParamsSchema.parse(req.params);
    const payment = await paymentsService.getAdmin(id);
    return ok(res, payment);
  },

  /** POST /api/payments/:id/simulate — só MOCK fora de produção. */
  async simulate(req: Request, res: Response) {
    const { id } = paymentIdParamsSchema.parse(req.params);
    const input = simulatePaymentSchema.parse(req.body);
    const result = await paymentsService.simulate(requester(req), id, input);
    return ok(res, result);
  },

  /** POST /api/webhooks/payments/:provider — validação por provider. */
  async webhook(req: Request, res: Response) {
    const { provider } = webhookParamsSchema.parse(req.params);
    const result = await paymentsService.processWebhook(
      provider,
      req.rawBody,
      req.headers,
    );
    return ok(res, result);
  },
};
