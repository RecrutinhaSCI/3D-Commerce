import { z } from 'zod';

export const bannerSlotSchema = z.enum(['HERO', 'PROMO']);
export type BannerSlotInput = z.infer<typeof bannerSlotSchema>;

export const createBannerSchema = z.object({
  title: z.string().trim().min(2, 'Título é obrigatório.').max(200),
  subtitle: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  buttonText: z.string().trim().max(60).optional().nullable(),
  buttonLink: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional().default(true),
  position: z.coerce.number().int().min(0).optional().default(0),
  slot: bannerSlotSchema.optional().default('HERO'),
});
export type CreateBannerInput = z.infer<typeof createBannerSchema>;

export const updateBannerSchema = createBannerSchema.partial();
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
