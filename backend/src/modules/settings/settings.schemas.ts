import { z } from 'zod';

/**
 * URL segura: apenas http/https. Bloqueia javascript:, data:, vbscript: etc.
 * Aceita string vazia (tratada como "sem valor") e null.
 */
const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v),
    'URL inválida (use http:// ou https://).',
  );

const nullableSafeUrl = safeUrl.nullable();

/** Um vídeo do YouTube na seção comunidade. */
const youtubeVideoSchema = z.object({
  title: z.string().trim().min(1, 'Título do vídeo é obrigatório.').max(120),
  url: safeUrl.refine((v) => v !== '', 'Informe a URL do vídeo.'),
  thumbnail: safeUrl.optional().default(''),
  description: z.string().trim().max(300).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

/** Um item do bloco de confiança. */
const trustItemSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório.').max(80),
  description: z.string().trim().max(200).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

/** Post curado do Instagram — imagem local (upload) + link do post. */
const instagramItemSchema = z.object({
  image: z.string().trim().min(1, 'Imagem é obrigatória.').max(500),
  url: safeUrl.refine((v) => v !== '', 'Informe o link do post.'),
  caption: z.string().trim().max(140).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

// Todos os campos são opcionais no update, mas se enviados precisam ser válidos.
export const updateSettingsSchema = z
  .object({
    storeName: z.string().trim().min(2, 'storeName não pode ficar vazio.').max(120),
    whatsapp: z.string().trim().min(8).max(30),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    instagram: nullableSafeUrl,
    address: z.string().trim().min(2).max(500),
    cnpj: z.string().trim().max(30).nullable(),
    logoUrl: z.string().trim().max(500).nullable(),
    heroTitle: z.string().trim().max(200).nullable(),
    heroSubtitle: z.string().trim().max(500).nullable(),
    aboutTitle: z.string().trim().max(200).nullable(),
    aboutText: z.string().trim().max(5000).nullable(),
    seoTitle: z.string().trim().max(200).nullable(),
    seoDescription: z.string().trim().max(500).nullable(),
    pixDiscountPercent: z.coerce.number().min(0, 'não pode ser negativo.').max(100),
    freeShippingThreshold: z.coerce.number().min(0, 'não pode ser negativo.'),
    shippingNote: z.string().trim().max(300).nullable(),

    // --- R17: conteúdos editáveis ---
    instagramHandle: z.string().trim().max(60).nullable(),
    youtubeUrl: nullableSafeUrl,
    youtubeHandle: z.string().trim().max(60).nullable(),
    facebookUrl: nullableSafeUrl,
    tiktokUrl: nullableSafeUrl,

    communityInstagramEnabled: z.boolean(),
    communityInstagramTitle: z.string().trim().max(120).nullable(),
    communityInstagramSubtitle: z.string().trim().max(300).nullable(),
    instagramItemsJson: z.array(instagramItemSchema).max(12, 'Máximo de 12 posts.').nullable(),

    youtubeSectionEnabled: z.boolean(),
    youtubeSectionTitle: z.string().trim().max(120).nullable(),
    youtubeSectionSubtitle: z.string().trim().max(300).nullable(),
    youtubeChannelUrl: nullableSafeUrl,
    youtubeChannelLabel: z.string().trim().max(80).nullable(),
    youtubeVideosJson: z.array(youtubeVideoSchema).max(6, 'Máximo de 6 vídeos.').nullable(),

    newsletterEnabled: z.boolean(),
    newsletterEyebrow: z.string().trim().max(60).nullable(),
    newsletterTitle: z.string().trim().max(160).nullable(),
    newsletterDescription: z.string().trim().max(400).nullable(),
    newsletterButtonText: z.string().trim().max(40).nullable(),
    newsletterPlaceholder: z.string().trim().max(60).nullable(),
    newsletterSuccessMessage: z.string().trim().max(160).nullable(),

    trustBlockEnabled: z.boolean(),
    trustItemsJson: z.array(trustItemSchema).max(8, 'Máximo de 8 itens.').nullable(),

    footerDescription: z.string().trim().max(400).nullable(),
    footerShowSocials: z.boolean(),
  })
  .partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export type YoutubeVideo = z.infer<typeof youtubeVideoSchema>;
export type TrustItem = z.infer<typeof trustItemSchema>;
export type InstagramItem = z.infer<typeof instagramItemSchema>;
