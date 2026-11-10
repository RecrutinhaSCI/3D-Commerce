import { z } from 'zod';
import { StockMovementType } from '@prisma/client';

/** Id gerado no cliente por ação do operador: retry/duplo clique não duplica. */
export const clientRequestId = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'clientRequestId inválido.');

export const internalUseSchema = z.object({
  clientRequestId,
  productId: z.string().trim().min(1).max(60),
  quantity: z.number().int().positive().max(100_000),
  note: z.string().trim().max(300).optional().nullable(),
});
export type InternalUseInput = z.infer<typeof internalUseSchema>;

export const movementsQuerySchema = z.object({
  productId: z.string().trim().min(1).max(60).optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
