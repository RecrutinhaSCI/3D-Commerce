import { z } from 'zod';
import { PosPaymentMethod } from '@prisma/client';
import { clientRequestId } from '../stock/stock.schemas';

const money = z.number().finite().nonnegative().max(9_999_999);
const note = z.string().trim().max(500).optional().nullable();

export const openSessionSchema = z.object({
  openingCash: money.default(0),
  note,
});
export type OpenSessionInput = z.infer<typeof openSessionSchema>;

export const closeSessionSchema = z.object({
  countedCash: money.optional().nullable(),
  note,
});
export type CloseSessionInput = z.infer<typeof closeSessionSchema>;

export const sessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SessionsQuery = z.infer<typeof sessionsQuerySchema>;

export const productSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(80).optional(),
  material: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ProductSearchQuery = z.infer<typeof productSearchSchema>;

export const lookupSchema = z.object({ code: z.string().trim().min(1).max(60) });

const quantity = z.number().int().positive().max(100_000);

const saleItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('product'),
    productId: z.string().trim().min(1).max(60),
    quantity,
    /** O operador confirmou vender um produto inativo no e-commerce. */
    confirmInactive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('free'),
    description: z.string().trim().min(2, 'Descreva o item livre.').max(200),
    quantity,
    unitPrice: z.number().finite().positive().max(9_999_999),
  }),
]);

export const createSaleSchema = z.object({
  clientRequestId,
  items: z.array(saleItemSchema).min(1, 'Adicione ao menos um item.').max(200),
  discount: money.default(0),
  paymentMethod: z.nativeEnum(PosPaymentMethod),
  amountReceived: money.optional().nullable(),
  customerId: z.string().trim().min(1).max(80).optional().nullable(),
  notes: note,
  /** Total que o operador viu: só conferência (o backend recalcula). */
  expectedTotal: money.optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo.').max(300),
});

export const createReturnSchema = z.object({
  clientRequestId,
  reason: z.string().trim().min(3, 'Informe o motivo.').max(300),
  items: z.array(z.object({ saleItemId: z.string().trim().min(1).max(60), quantity })).min(1).max(200),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
