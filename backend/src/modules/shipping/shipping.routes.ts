import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { shippingService } from './shipping.service';

/**
 * Frete — público.
 *   GET /api/public/shipping/options?subtotal=123.45&freeShipping=true
 * Só para EXIBIR as opções no checkout; o valor cobrado é recalculado na
 * criação do pedido a partir da modalidade escolhida.
 */
const querySchema = z.object({
  subtotal: z.coerce.number().min(0).default(0),
  freeShipping: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const shippingRouter = Router();

shippingRouter.get(
  '/public/shipping/options',
  asyncHandler(async (req, res) => {
    const { subtotal, freeShipping } = querySchema.parse(req.query);
    const [options, freeShippingThreshold] = await Promise.all([
      shippingService.getShippingOptions(subtotal, freeShipping),
      shippingService.getThreshold(),
    ]);
    return ok(res, { options, freeShippingThreshold });
  }),
);
