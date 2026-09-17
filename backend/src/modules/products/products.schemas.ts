import { z } from 'zod';
import { ProductPurchaseMode } from '@prisma/client';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const skuRegex = /^[A-Za-z0-9._-]+$/;

const nullableNumber = () =>
  z.union([z.number(), z.string(), z.null()]).transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }).nullable().optional();

const positiveNumber = () =>
  z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return n;
  }).refine((n) => Number.isFinite(n) && n > 0, 'Precisa ser um número positivo.');

const nonNegativeInt = () =>
  z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Math.trunc(n);
  }).refine((n) => Number.isInteger(n) && n >= 0, 'Precisa ser inteiro não-negativo.');

export const createProductSchema = z.object({
  categoryId: z.string().min(1, 'categoryId é obrigatório.'),
  name: z.string().trim().min(2, 'Nome precisa ter no mínimo 2 caracteres.'),
  slug: z.string().trim().regex(slugRegex, 'Slug inválido.').optional(),
  shortDescription: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(10000).optional().nullable(),
  price: positiveNumber(),
  promotionalPrice: nullableNumber().refine(
    (v) => v === null || v === undefined || (typeof v === 'number' && v > 0),
    'Preço promocional precisa ser positivo.',
  ),
  sku: z.string().trim().regex(skuRegex, 'SKU inválido.').max(60).optional().nullable(),
  stock: nonNegativeInt().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  weight: nullableNumber(),
  width: nullableNumber(),
  height: nullableNumber(),
  depth: nullableNumber(),
  // R19-B — brand (fabricante) e material são independentes.
  brand: z.string().trim().max(80).optional().nullable(),
  material: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(80).optional().nullable(),
  printTime: z.string().trim().max(60).optional().nullable(),
  purchaseMode: z.nativeEnum(ProductPurchaseMode).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

const parseBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'))
  .optional();

export const publicListQuerySchema = z.object({
  category: z.string().trim().optional(),
  search: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  featured: parseBool,
  purchaseMode: z.nativeEnum(ProductPurchaseMode).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc', 'name_desc']).default('newest'),
});
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;

export const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});
export type FeaturedQuery = z.infer<typeof featuredQuerySchema>;

export const adminListQuerySchema = publicListQuerySchema.extend({
  active: parseBool,
  lowStock: parseBool,
  // R19-A: admin precisa listar o catálogo inteiro para operações em massa
  // (importar/exportar). O cap do público (100) fica só na parte pública.
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

// -----------------------------------------------------------------------------
// Bulk import (R19-A)
//
// Uma linha bruta da planilha. TODOS os campos são opcionais: célula vazia
// vira `undefined` (não `null`/`""`/`0`) e o backend NUNCA sobrescreve dado
// existente com valor não informado. `estoque = 0` explicitamente digitado
// continua valendo — a diferença entre "vazio" e "zero" é preservada porque
// o parser só envia a chave quando o valor está presente.
// -----------------------------------------------------------------------------
const importRowSchema = z.object({
  // Identificadores (na ordem de precedência do matching).
  id: z.string().trim().min(1).optional(),
  sku: z.string().trim().regex(skuRegex).max(60).optional(),
  slug: z.string().trim().regex(slugRegex).optional(),

  // Payload — todos opcionais. `undefined` = preservar.
  name: z.string().trim().min(2).max(200).optional(),
  categoryName: z.string().trim().min(1).max(120).optional(),
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().trim().max(10000).optional(),
  price: z.number().positive().optional(),
  promotionalPrice: z.number().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  // R19-B — brand e material são independentes no bulk import também.
  brand: z.string().trim().max(80).optional(),
  material: z.string().trim().max(80).optional(),

  // R19-C — URL da imagem principal. Validação sintática detalhada acontece
  // POR LINHA dentro do service (`isSafeImageUrl`), NÃO aqui, para que uma
  // única URL malformada não derrube o REQUEST inteiro do Zod: linhas boas
  // são processadas normalmente e as ruins viram conflito individual.
  imageUrl: z.string().trim().max(2000).optional(),

  // Só metadado (linha na planilha) para relatório.
  line: z.number().int().positive(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const bulkImportSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'Envie ao menos 1 linha.').max(500, 'Máx. 500 linhas por importação.'),
});
export type BulkImportInput = z.infer<typeof bulkImportSchema>;

// -----------------------------------------------------------------------------
// Bulk delete (R19-E) — desativação em massa (soft delete, coerente com o
// endpoint DELETE /admin/products/:id atual).
// -----------------------------------------------------------------------------
export const bulkDeleteSchema = z.object({
  ids: z
    .array(z.string().trim().min(1, 'ID vazio.').max(60))
    .min(1, 'Selecione ao menos 1 produto.')
    .max(200, 'Máx. 200 produtos por operação.'),
});
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
