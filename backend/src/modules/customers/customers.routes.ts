import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { created, ok } from '../../utils/apiResponse';
import { createCustomerSchema, customersQuerySchema, updateCustomerSchema } from './customers.schemas';
import { customersService } from './customers.service';

const idParam = z.object({ id: z.string().min(1).max(80) });

/** Clientes — dados pessoais: tudo exige auth + admin. */
export const customersRouter = Router();

customersRouter.use('/admin/customers', authMiddleware, adminMiddleware);

// POST de propósito: o termo pode ser CPF ou telefone, e query string vai para
// logs de acesso, histórico e proxies. No corpo, nada disso fica registrado.
customersRouter.post(
  '/admin/customers/search',
  asyncHandler(async (req, res) => {
    ok(res, await customersService.list(customersQuerySchema.parse(req.body ?? {})));
  }),
);
customersRouter.post(
  '/admin/customers',
  asyncHandler(async (req, res) => {
    created(res, { customer: await customersService.create(createCustomerSchema.parse(req.body)) });
  }),
);
customersRouter.get(
  '/admin/customers/:id',
  asyncHandler(async (req, res) => {
    ok(res, await customersService.get(idParam.parse(req.params).id));
  }),
);
customersRouter.put(
  '/admin/customers/:id',
  asyncHandler(async (req, res) => {
    const customer = await customersService.update(idParam.parse(req.params).id, updateCustomerSchema.parse(req.body));
    ok(res, { customer });
  }),
);
