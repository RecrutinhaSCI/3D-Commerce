import { z } from 'zod';

export const bannerSlotSchema = z.enum(['HERO', 'PROMO']);
export type BannerSlotInput = z.infer<typeof bannerSlotSchema>;

/** Selo flutuante do hero (ex.: "+ Vendido / PLA Preto 1kg / R$ 109,90"). */
export const heroBadgeSchema = z.object({
  enabled: z.boolean(),
  tag: z.string().trim().max(40).default(''),
  title: z.string().trim().max(60).default(''),
  info: z.string().trim().max(60).default(''),
});
export type HeroBadgeInput = z.infer<typeof heroBadgeSchema>;

export const createBannerSchema = z.object({
  title: z.string().trim().min(2, 'Título é obrigatório.').max(200),
  subtitle: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  buttonText: z.string().trim().max(60).optional().nullable(),
  buttonLink: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional().default(true),
  position: z.coerce.number().int().min(0).optional().default(0),
  slot: bannerSlotSchema.optional().default('HERO'),
  // null = sem selo.
  badgeLeft: heroBadgeSchema.optional().nullable(),
  badgeRight: heroBadgeSchema.optional().nullable(),
});
export type CreateBannerInput = z.infer<typeof createBannerSchema>;

export const updateBannerSchema = createBannerSchema.partial();
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
