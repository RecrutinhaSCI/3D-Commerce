import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/apiResponse';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { shippingQuoteRateLimiter } from '../../middlewares/rateLimiters';
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

const quoteSchema = z.object({
  // Formato validado no service (sempre 400 "CEP inválido.").
  cep: z.string().trim().max(20, 'CEP inválido.'),
  couponCode: z.string().trim().max(40).optional().nullable(),
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

/**
 * Cotação para o carrinho do usuário logado (checkout).
 *   POST /api/shipping/quote  { cep, couponCode? }
 * Itens, preços e medidas vêm do CARRINHO no banco — nunca do cliente.
 * Resposta: { status: 'ok' | 'fixed' | 'unavailable', message, retryable,
 * freeShippingThreshold, freeShippingApplied, options } — sem códigos internos.
 * A criação do pedido recalcula com a MESMA regra (`quoteForItems`).
 */
shippingRouter.post(
  '/shipping/quote',
  authMiddleware,
  shippingQuoteRateLimiter,
  asyncHandler(async (req, res) => {
    const input = quoteSchema.parse(req.body ?? {});
    const quote = await shippingService.quoteForCart(req.user!.id, input);
    return ok(res, quote);
  }),
);

// Simulação em memória: nunca consulta/grava produtos, carrinhos ou pedidos.
const sandboxQuoteSchema = z.object({
  cep: z.string().trim().max(20),
  couponFreeShipping: z.boolean().default(false),
  items: z.array(z.object({
    productId: z.string().max(80), quantity: z.number().int().min(1).max(10),
    unitPrice: z.number().min(0).max(100000),
    weight: z.number().positive().max(30).nullable(),
    width: z.number().positive().max(200).nullable(),
    height: z.number().positive().max(200).nullable(),
    depth: z.number().positive().max(200).nullable(),
  }).strict()).min(1).max(10),
}).strict();

shippingRouter.post('/admin/integrations/melhor-envio/sandbox/quote',
  authMiddleware, adminMiddleware, shippingQuoteRateLimiter,
  asyncHandler(async (req, res) => {
    const input = sandboxQuoteSchema.parse(req.body ?? {});
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    res.set('Cache-Control', 'no-store');
    return ok(res, await shippingService.quoteSandboxForItems({ ...input, subtotal }));
  }),
);
