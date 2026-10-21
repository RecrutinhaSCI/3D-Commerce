import { Prisma, type Category } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { generateUniqueSlug, slugify } from '../../utils/slug';
import { safeUnlinkSiteImage } from '../../lib/upload';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schemas';

type CategoryDTO = Category & { productsCount?: number };

function toDTO(c: Category, productsCount?: number): CategoryDTO {
  return { ...c, productsCount };
}

async function slugExists(slug: string): Promise<boolean> {
  const row = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  return !!row;
}

async function ensureSlug(base: string, incoming: string | undefined, currentSlug?: string): Promise<string> {
  if (incoming) {
    // Slug informado explicitamente — validar unicidade (menos o próprio).
    if (incoming !== currentSlug && (await slugExists(incoming))) {
      throw HttpError.conflict('Slug já em uso.');
    }
    return incoming;
  }
  // Slug automático baseado no nome.
  return generateUniqueSlug(base, slugExists, currentSlug);
}

export const categoriesService = {
  /** Público: apenas categorias ativas, com contagem de produtos ativos. */
  async listPublic() {
    const rows = await prisma.category.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { products: { where: { active: true } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      active: c.active,
      isSeasonal: c.isSeasonal,
      seasonalTitle: c.seasonalTitle,
      seasonalDescription: c.seasonalDescription,
      seasonalBannerImage: c.seasonalBannerImage,
      imageUrl: c.imageUrl,
      showInMenu: c.showInMenu,
      showInHome: c.showInHome,
      seasonalColorFrom: c.seasonalColorFrom,
      seasonalColorTo: c.seasonalColorTo,
      seasonalTextColor: c.seasonalTextColor,
      productsCount: c._count.products,
    }));
  },

  /** Admin: todas as categorias com contagem total (ativos + inativos). */
  async listAdmin() {
    const rows = await prisma.category.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return rows.map((c) => ({
      ...c,
      productsCount: c._count.products,
    }));
  },

  async create(input: CreateCategoryInput) {
    const slug = await ensureSlug(input.name, input.slug);
    const created = await prisma.category.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        active: input.active ?? true,
        isSeasonal: input.isSeasonal ?? false,
        seasonalTitle: input.seasonalTitle ?? null,
        seasonalDescription: input.seasonalDescription ?? null,
        seasonalBannerImage: input.seasonalBannerImage ?? null,
        showInMenu: input.showInMenu ?? true,
        showInHome: input.showInHome ?? true,
        seasonalColorFrom: input.seasonalColorFrom ?? null,
        seasonalColorTo: input.seasonalColorTo ?? null,
        seasonalTextColor: input.seasonalTextColor ?? null,
      },
    });
    return toDTO(created);
  },

  async update(id: string, input: UpdateCategoryInput) {
    const current = await prisma.category.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Categoria não encontrada.');

    // Regras de slug:
    // - Se o usuário passou um slug novo, validamos unicidade (ignorando o próprio).
    // - Se o nome mudou mas slug não foi enviado, MANTEMOS o slug atual
    //   (para não quebrar URLs indexadas).
    let slug = current.slug;
    if (input.slug !== undefined) {
      slug = await ensureSlug(input.name ?? current.name, input.slug, current.slug);
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: input.name ?? current.name,
        slug,
        description: input.description === undefined ? current.description : input.description,
        active: input.active === undefined ? current.active : input.active,
        isSeasonal: input.isSeasonal === undefined ? current.isSeasonal : input.isSeasonal,
        seasonalTitle: input.seasonalTitle === undefined ? current.seasonalTitle : input.seasonalTitle,
        seasonalDescription:
          input.seasonalDescription === undefined ? current.seasonalDescription : input.seasonalDescription,
        seasonalBannerImage:
          input.seasonalBannerImage === undefined ? current.seasonalBannerImage : input.seasonalBannerImage,
        showInMenu: input.showInMenu === undefined ? current.showInMenu : input.showInMenu,
        showInHome: input.showInHome === undefined ? current.showInHome : input.showInHome,
        seasonalColorFrom: input.seasonalColorFrom === undefined ? current.seasonalColorFrom : input.seasonalColorFrom,
        seasonalColorTo: input.seasonalColorTo === undefined ? current.seasonalColorTo : input.seasonalColorTo,
        seasonalTextColor: input.seasonalTextColor === undefined ? current.seasonalTextColor : input.seasonalTextColor,
      },
    });
    return toDTO(updated);
  },

  /**
   * Grava (ou limpa, com `null`) a imagem do card (`imageUrl`) ou do banner
   * sazonal (`seasonalBannerImage`). A URL vem SEMPRE do upload do backend
   * (Vercel Blob em produção). O arquivo anterior só é apagado depois que o
   * banco foi atualizado — nunca fica categoria apontando para arquivo removido.
   */
  async setImage(id: string, field: 'imageUrl' | 'seasonalBannerImage', url: string | null) {
    const current = await prisma.category.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Categoria não encontrada.');
    const previous = current[field];
    const updated = await prisma.category.update({ where: { id }, data: { [field]: url } });
    if (previous && previous !== url) safeUnlinkSiteImage(previous);
    return toDTO(updated);
  },

  /**
   * Regras da spec:
   * - Se a categoria tem produtos vinculados → soft delete (active=false)
   *   e retorna `{ softDeleted: true }`.
   * - Caso contrário → hard delete e retorna `{ hardDeleted: true }`.
   */
  async remove(id: string) {
    const current = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!current) throw HttpError.notFound('Categoria não encontrada.');

    if (current._count.products > 0) {
      const updated = await prisma.category.update({ where: { id }, data: { active: false } });
      return { softDeleted: true, hardDeleted: false, category: toDTO(updated) };
    }

    try {
      await prisma.category.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        // FK inesperada — cai para soft delete por segurança.
        const updated = await prisma.category.update({ where: { id }, data: { active: false } });
        return { softDeleted: true, hardDeleted: false, category: toDTO(updated) };
      }
      throw e;
    }
    return { softDeleted: false, hardDeleted: true };
  },
};

// Exports auxiliares se algum outro módulo precisar (não usar diretamente aqui).
export { slugify };
