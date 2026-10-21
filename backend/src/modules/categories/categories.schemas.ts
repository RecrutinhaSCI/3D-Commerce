import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nome precisa ter no mínimo 2 caracteres.'),
  slug: z.string().trim().min(1).regex(slugRegex, 'Slug inválido.').optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  active: z.boolean().optional().default(true),
  isSeasonal: z.boolean().optional().default(false),
  seasonalTitle: z.string().trim().max(120).optional().nullable(),
  seasonalDescription: z.string().trim().max(500).optional().nullable(),
  seasonalBannerImage: z.string().trim().max(500).optional().nullable(),
  showInMenu: z.boolean().optional(),
  showInHome: z.boolean().optional(),
  // `imageUrl` NÃO entra aqui: só muda pelo upload (Vercel Blob) ou pela
  // remoção dedicada — evita gravar Base64/URL arbitrária pelo PUT.
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// Partial + preserva regras de cada campo. `.partial()` mantém validações.
export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
