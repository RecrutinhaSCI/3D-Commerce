import { z } from 'zod';

/** A URL só é navegada pelo browser; nunca é buscada pelo servidor. */
export function isSafeCourseUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
const safeUrl = z.string().trim().min(1).max(2000).refine(isSafeCourseUrl, 'Use uma URL http:// ou https:// válida, sem credenciais.');
const price = z.number().finite().min(0).max(99999999.99).multipleOf(0.01).nullable();
const courseFieldsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  eyebrow: z.string().trim().max(80).default(''),
  description: z.string().trim().max(10000).default(''),
  shortDescription: z.string().trim().max(500).default(''),
  coverImage: z.string().trim().max(2000).refine((v) => isSafeCourseUrl(v) || /^\/uploads\/site\/[A-Za-z0-9_.-]+$/.test(v), 'URL de capa inválida.').nullable().optional(),
  levelLabel: z.string().trim().max(80).default(''),
  originalPrice: price.optional(),
  price: price.optional(),
  externalUrl: safeUrl,
  buttonLabel: z.string().trim().min(1).max(80).default('Conhecer curso'),
  ctaType: z.enum(['external', 'whatsapp']).default('external'),
  featured: z.boolean().default(false),
  active: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(2147483647).default(0),
}).strict();
function validateWhatsApp(input: { ctaType?: string; externalUrl?: string }, ctx: z.RefinementCtx) {
  if (input.ctaType !== 'whatsapp' || !input.externalUrl || !isSafeCourseUrl(input.externalUrl)) return;
  const url = new URL(input.externalUrl);
  if (url.protocol !== 'https:' || !['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com'].includes(url.hostname) || url.port) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalUrl'], message: 'Use um link HTTPS oficial do WhatsApp.' });
  }
}
export const createCourseSchema = courseFieldsSchema.superRefine(validateWhatsApp);
export const updateCourseSchema = courseFieldsSchema.partial().superRefine(validateWhatsApp);
export const courseFieldNames = Object.keys(courseFieldsSchema.shape);
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
