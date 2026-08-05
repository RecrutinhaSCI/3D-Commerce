import { Prisma, ProductPurchaseMode, type Category, type Product, type ProductImage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { generateUniqueSlug } from '../../utils/slug';
import { decimalToNumber } from '../../utils/decimal';
import {
  PRODUCT_MEDIA_MAX_IMAGE_BYTES,
  PRODUCT_MEDIA_MAX_VIDEO_BYTES,
  classifyProductMedia,
  safeUnlinkProductImage,
} from '../../lib/upload';
import type {
  AdminListQuery,
  CreateProductInput,
  FeaturedQuery,
  PublicListQuery,
  UpdateProductInput,
} from './products.schemas';

type ProductWithRelations = Product & {
  category: Pick<Category, 'id' | 'name' | 'slug'> | null;
  images: ProductImage[];
};

/** DTO serializado — nunca vaza Prisma.Decimal para o cliente. */
export interface ProductDTO {
  id: string;
  categoryId: string;
  category: { id: string; name: string; slug: string } | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  price: number;
  promotionalPrice: number | null;
  sku: string | null;
  stock: number;
  active: boolean;
  featured: boolean;
  weight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  material: string | null;
  color: string | null;
  printTime: string | null;
  purchaseMode: ProductPurchaseMode;
  createdAt: string;
  updatedAt: string;
  images: Array<{
    id: string;
    url: string;
    alt: string | null;
    position: number;
    mediaType: 'image' | 'video';
    mimeType: string | null;
  }>;
}

function toDTO(p: ProductWithRelations): ProductDTO {
  return {
    id: p.id,
    categoryId: p.categoryId,
    category: p.category
      ? { id: p.category.id, name: p.category.name, slug: p.category.slug }
      : null,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    description: p.description,
    price: decimalToNumber(p.price) ?? 0,
    promotionalPrice: decimalToNumber(p.promotionalPrice),
    sku: p.sku,
    stock: p.stock,
    active: p.active,
    featured: p.featured,
    weight: decimalToNumber(p.weight),
    width: decimalToNumber(p.width),
    height: decimalToNumber(p.height),
    depth: decimalToNumber(p.depth),
    material: p.material,
    color: p.color,
    printTime: p.printTime,
    purchaseMode: p.purchaseMode,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    images: [...p.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        position: i.position,
        // Compat: linhas antigas (default do schema) já vêm como "image"; se o
        // cliente do banco devolveu string arbitrária, normalizamos.
        mediaType: i.mediaType === 'video' ? 'video' : 'image',
        mimeType: i.mimeType,
      })),
  };
}

const includeRelations = {
  category: { select: { id: true, name: true, slug: true } },
  images: true,
} as const;

async function slugExists(slug: string): Promise<boolean> {
  const row = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
  return !!row;
}

async function ensureSlug(base: string, incoming: string | undefined, currentSlug?: string): Promise<string> {
  if (incoming) {
    if (incoming !== currentSlug && (await slugExists(incoming))) {
      throw HttpError.conflict('Slug já em uso.');
    }
    return incoming;
  }
  return generateUniqueSlug(base, slugExists, currentSlug);
}

async function ensureUniqueSku(sku: string | null | undefined, currentId?: string) {
  if (!sku) return;
  const existing = await prisma.product.findFirst({
    where: { sku, ...(currentId ? { NOT: { id: currentId } } : {}) },
    select: { id: true },
  });
  if (existing) throw HttpError.conflict('SKU já em uso.');
}

async function ensureCategoryExists(categoryId: string) {
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!cat) throw HttpError.badRequest('Categoria informada não existe.');
}

function buildOrderBy(sort: PublicListQuery['sort']): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case 'price_asc': return { price: 'asc' };
    case 'price_desc': return { price: 'desc' };
    case 'name_asc': return { name: 'asc' };
    case 'name_desc': return { name: 'desc' };
    case 'newest':
    default: return { createdAt: 'desc' };
  }
}

function buildSearchWhere(search: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { shortDescription: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { material: { contains: search, mode: 'insensitive' } },
    ],
  };
}

export const productsService = {
  async listPublic(query: PublicListQuery) {
    const where: Prisma.ProductWhereInput = { active: true };
    if (query.category) where.category = { slug: query.category, active: true };
    if (query.featured !== undefined) where.featured = query.featured;
    if (query.purchaseMode) where.purchaseMode = query.purchaseMode;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {};
      if (query.minPrice !== undefined) (where.price as Prisma.DecimalFilter).gte = query.minPrice;
      if (query.maxPrice !== undefined) (where.price as Prisma.DecimalFilter).lte = query.maxPrice;
    }
    if (query.search) where.AND = [buildSearchWhere(query.search)];

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: includeRelations,
        orderBy: buildOrderBy(query.sort),
        skip,
        take: query.limit,
      }),
    ]);

    return {
      products: rows.map(toDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async listFeatured(query: FeaturedQuery) {
    const rows = await prisma.product.findMany({
      where: { active: true, featured: true },
      include: includeRelations,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { products: rows.map(toDTO) };
  },

  async getPublicBySlug(slug: string) {
    const row = await prisma.product.findFirst({
      where: { slug, active: true },
      include: includeRelations,
    });
    if (!row) throw HttpError.notFound('Produto não encontrado.');
    return toDTO(row);
  },

  async listAdmin(query: AdminListQuery) {
    const where: Prisma.ProductWhereInput = {};
    if (query.category) where.category = { slug: query.category };
    if (query.active !== undefined) where.active = query.active;
    if (query.featured !== undefined) where.featured = query.featured;
    if (query.purchaseMode) where.purchaseMode = query.purchaseMode;
    if (query.lowStock) where.stock = { lte: 5 };
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {};
      if (query.minPrice !== undefined) (where.price as Prisma.DecimalFilter).gte = query.minPrice;
      if (query.maxPrice !== undefined) (where.price as Prisma.DecimalFilter).lte = query.maxPrice;
    }
    if (query.search) where.AND = [buildSearchWhere(query.search)];

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: includeRelations,
        orderBy: buildOrderBy(query.sort),
        skip,
        take: query.limit,
      }),
    ]);

    return {
      products: rows.map(toDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async create(input: CreateProductInput) {
    await ensureCategoryExists(input.categoryId);
    await ensureUniqueSku(input.sku);
    const slug = await ensureSlug(input.name, input.slug);

    const product = await prisma.product.create({
      data: {
        categoryId: input.categoryId,
        name: input.name,
        slug,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        price: input.price,
        promotionalPrice: input.promotionalPrice ?? null,
        sku: input.sku ?? null,
        stock: input.stock ?? 0,
        active: input.active ?? true,
        featured: input.featured ?? false,
        weight: input.weight ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        depth: input.depth ?? null,
        material: input.material ?? null,
        color: input.color ?? null,
        printTime: input.printTime ?? null,
        purchaseMode: input.purchaseMode ?? ProductPurchaseMode.DIRECT,
      },
      include: includeRelations,
    });
    return toDTO(product);
  },

  async update(id: string, input: UpdateProductInput) {
    const current = await prisma.product.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Produto não encontrado.');

    if (input.categoryId && input.categoryId !== current.categoryId) {
      await ensureCategoryExists(input.categoryId);
    }
    if (input.sku !== undefined && input.sku !== current.sku) {
      await ensureUniqueSku(input.sku, id);
    }

    let slug = current.slug;
    if (input.slug !== undefined) {
      slug = await ensureSlug(input.name ?? current.name, input.slug, current.slug);
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        categoryId: input.categoryId ?? current.categoryId,
        name: input.name ?? current.name,
        slug,
        shortDescription:
          input.shortDescription === undefined ? current.shortDescription : input.shortDescription,
        description: input.description === undefined ? current.description : input.description,
        price: input.price ?? current.price,
        promotionalPrice:
          input.promotionalPrice === undefined ? current.promotionalPrice : input.promotionalPrice,
        sku: input.sku === undefined ? current.sku : input.sku,
        stock: input.stock === undefined ? current.stock : input.stock,
        active: input.active === undefined ? current.active : input.active,
        featured: input.featured === undefined ? current.featured : input.featured,
        weight: input.weight === undefined ? current.weight : input.weight,
        width: input.width === undefined ? current.width : input.width,
        height: input.height === undefined ? current.height : input.height,
        depth: input.depth === undefined ? current.depth : input.depth,
        material: input.material === undefined ? current.material : input.material,
        color: input.color === undefined ? current.color : input.color,
        printTime: input.printTime === undefined ? current.printTime : input.printTime,
        purchaseMode: input.purchaseMode ?? current.purchaseMode,
      },
      include: includeRelations,
    });
    return toDTO(updated);
  },

  /** Soft delete conforme spec — nunca deleta fisicamente para preservar histórico. */
  async remove(id: string) {
    const current = await prisma.product.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Produto não encontrado.');

    const updated = await prisma.product.update({
      where: { id },
      data: { active: false },
      include: includeRelations,
    });
    return { softDeleted: true, product: toDTO(updated) };
  },

  async addImages(id: string, files: Express.Multer.File[]) {
    if (files.length === 0) throw HttpError.badRequest('Nenhuma imagem enviada.');
    const product = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!product) {
      // Limpa uploads órfãos.
      files.forEach((f) => safeUnlinkProductImage(f.filename));
      throw HttpError.notFound('Produto não encontrado.');
    }

    // Segunda camada de validação além do Multer: bloqueia imagem >5MB
    // mesmo que o limite geral (8MB, cobrindo vídeo) tenha deixado passar.
    for (const file of files) {
      const mediaType = classifyProductMedia(file.mimetype);
      const limit = mediaType === 'video' ? PRODUCT_MEDIA_MAX_VIDEO_BYTES : PRODUCT_MEDIA_MAX_IMAGE_BYTES;
      if (file.size > limit) {
        // Rollback: apaga tudo que já veio antes de propagar o erro.
        files.forEach((f) => safeUnlinkProductImage(f.filename));
        const kind = mediaType === 'video' ? 'vídeo' : 'imagem';
        const mb = Math.round(limit / (1024 * 1024));
        throw HttpError.badRequest(`Arquivo "${file.originalname}": ${kind} acima de ${mb}MB.`);
      }
    }

    const startPos = product.images.length
      ? Math.max(...product.images.map((i) => i.position)) + 1
      : 0;

    await prisma.$transaction(
      files.map((file, index) =>
        prisma.productImage.create({
          data: {
            productId: id,
            url: `/uploads/products/${file.filename}`,
            alt: product.name,
            position: startPos + index,
            mediaType: classifyProductMedia(file.mimetype),
            mimeType: file.mimetype,
          },
        }),
      ),
    );

    const updated = await prisma.product.findUnique({ where: { id }, include: includeRelations });
    return toDTO(updated!);
  },

  async removeImage(imageId: string) {
    const image = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw HttpError.notFound('Imagem não encontrada.');
    await prisma.productImage.delete({ where: { id: imageId } });
    // Best-effort: apagar o arquivo físico se estiver em /uploads/products/.
    const prefix = '/uploads/products/';
    if (image.url.startsWith(prefix)) {
      safeUnlinkProductImage(image.url.slice(prefix.length));
    }
    return { imageId };
  },
};
