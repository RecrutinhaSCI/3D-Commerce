/**
 * Localiza no banco as URLs de arquivo no formato antigo (`/uploads/<pasta>/x`),
 * gravadas quando os uploads iam para o disco do servidor. Na Vercel o disco
 * não é persistente, então essas URLs apontam para arquivos que não existem.
 *
 * `/uploads/seed/...` fica de fora: são as imagens do seed, versionadas em
 * `public/` e servidas pelo CDN da Vercel.
 *
 * Usado pelo `migrate-uploads.ts` (migração para o Blob) e pelo `check-config.ts`.
 */
import { prisma } from '../src/lib/prisma';

export type LegacyRef = {
  /** Onde está a URL — usado no relatório. */
  where: string;
  url: string;
  /** Grava a URL nova no banco. */
  update: (newUrl: string) => Promise<unknown>;
  /** Só imagens de produto podem ser apagadas com `--remove-missing`. */
  remove?: () => Promise<unknown>;
};

const LEGACY_RE = /^\/uploads\/(?!seed\/)[^/]+\/[^/]+$/;
export const isLegacyUploadUrl = (v: unknown): v is string => typeof v === 'string' && LEGACY_RE.test(v);

/** Troca, em profundidade, as strings `from` por `to` dentro de um valor JSON. */
function replaceDeep(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceDeep(v, from, to)]));
  }
  return value;
}

function collectDeep(value: unknown, out: Set<string>) {
  if (isLegacyUploadUrl(value)) out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectDeep(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectDeep(v, out));
}

export async function findLegacyUploads(): Promise<LegacyRef[]> {
  const refs: LegacyRef[] = [];

  const images = await prisma.productImage.findMany({
    where: { url: { startsWith: '/uploads/' } },
    select: { id: true, url: true, product: { select: { name: true } } },
  });
  for (const img of images) {
    if (!isLegacyUploadUrl(img.url)) continue;
    refs.push({
      where: `Produto "${img.product.name}"`,
      url: img.url,
      update: (url) => prisma.productImage.update({ where: { id: img.id }, data: { url } }),
      remove: () => prisma.productImage.delete({ where: { id: img.id } }),
    });
  }

  const categories = await prisma.category.findMany({
    where: { seasonalBannerImage: { startsWith: '/uploads/' } },
    select: { id: true, name: true, seasonalBannerImage: true },
  });
  for (const c of categories) {
    if (!isLegacyUploadUrl(c.seasonalBannerImage)) continue;
    refs.push({
      where: `Categoria "${c.name}" (banner sazonal)`,
      url: c.seasonalBannerImage,
      update: (url) => prisma.category.update({ where: { id: c.id }, data: { seasonalBannerImage: url } }),
    });
  }

  const banners = await prisma.banner.findMany({
    where: { imageUrl: { startsWith: '/uploads/' } },
    select: { id: true, title: true, imageUrl: true },
  });
  for (const b of banners) {
    if (!isLegacyUploadUrl(b.imageUrl)) continue;
    refs.push({
      where: `Banner "${b.title}"`,
      url: b.imageUrl,
      update: (url) => prisma.banner.update({ where: { id: b.id }, data: { imageUrl: url } }),
    });
  }

  const testimonials = await prisma.testimonial.findMany({
    where: { avatarUrl: { startsWith: '/uploads/' } },
    select: { id: true, name: true, avatarUrl: true },
  });
  for (const t of testimonials) {
    if (!isLegacyUploadUrl(t.avatarUrl)) continue;
    refs.push({
      where: `Depoimento de "${t.name}"`,
      url: t.avatarUrl,
      update: (url) => prisma.testimonial.update({ where: { id: t.id }, data: { avatarUrl: url } }),
    });
  }

  const quoteFiles = await prisma.quoteFile.findMany({
    where: { url: { startsWith: '/uploads/' } },
    select: { id: true, url: true, originalName: true },
  });
  for (const f of quoteFiles) {
    if (!isLegacyUploadUrl(f.url)) continue;
    refs.push({
      where: `Orçamento (arquivo "${f.originalName}")`,
      url: f.url,
      update: (url) => prisma.quoteFile.update({ where: { id: f.id }, data: { url } }),
    });
  }

  // Configurações do site: logo e listas em JSON (Instagram, YouTube, etc.).
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'main' } });
  if (settings) {
    for (const [field, value] of Object.entries(settings)) {
      const found = new Set<string>();
      collectDeep(value, found);
      for (const url of found) {
        refs.push({
          where: `Configurações do site (${field})`,
          url,
          update: async (newUrl) => {
            // Relê o campo: pode ter mais de uma URL antiga no mesmo JSON.
            const fresh = await prisma.siteSettings.findUniqueOrThrow({ where: { id: 'main' } });
            const current = (fresh as Record<string, unknown>)[field];
            return prisma.siteSettings.update({
              where: { id: 'main' },
              data: { [field]: replaceDeep(current, url, newUrl) },
            });
          },
        });
      }
    }
  }

  return refs;
}
