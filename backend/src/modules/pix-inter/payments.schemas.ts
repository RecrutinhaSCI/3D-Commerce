import { z } from 'zod';

/**
 * Payments — R19.
 * A criação de cobrança não recebe valores do cliente: valor, método e
 * expiração são derivados do PEDIDO no backend (backend é a autoridade).
 */

/** Params de criação: o pedido vem na URL. */
export const createPaymentParamsSchema = z.object({
  orderId: z.string().trim().min(1, 'orderId é obrigatório.'),
});
export type CreatePaymentParams = z.infer<typeof createPaymentParamsSchema>;

export const paymentIdParamsSchema = z.object({
  id: z.string().trim().min(1, 'id é obrigatório.'),
});

/** Simulação local (apenas provider MOCK fora de produção). */
export const simulatePaymentSchema = z.object({
  status: z.enum(['approved', 'expired', 'canceled'], {
    errorMap: () => ({ message: 'status deve ser approved, expired ou canceled.' }),
  }),
});
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;

export const webhookParamsSchema = z.object({
  provider: z.string().trim().min(1),
});
