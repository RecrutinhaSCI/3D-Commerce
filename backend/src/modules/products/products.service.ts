import { Prisma, ProductPurchaseMode, type Category, type Product, type ProductImage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { generateUniqueSlug, slugify } from '../../utils/slug';
import { decimalToNumber } from '../../utils/decimal';
import {
  PRODUCT_MEDIA_MAX_IMAGE_BYTES,
  PRODUCT_MEDIA_MAX_VIDEO_BYTES,
  classifyProductMedia,
  safeUnlinkProductImage,
} from '../../lib/upload';
import type {
  AdminListQuery,
  BulkImportInput,
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
  brand: string | null;
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
    brand: p.brand,
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

/**
 * R19-C — Validação SINTÁTICA de URL de imagem para o bulk import.
 * Aceita: `https://…`, `http://…`, e paths relativos servidos pelo próprio
 * backend (`/uploads/…`) — este último para compat com export→import.
 * Bloqueia: `javascript:`, `data:`, `file:`, `ftp:`, caminhos locais do
 * Windows/Unix, strings arbitrárias.
 * NÃO faz request nenhum; validação é textual.
 */
export function isSafeImageUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.startsWith('/uploads/')) {
    // Path servido pelo próprio backend. Bloqueia traversal e barras
    // duplicadas que poderiam mudar o host quando resolvidas.
    if (s.includes('..') || s.startsWith('//')) return false;
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

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
        brand: input.brand ?? null,
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
        // R19-B — brand e material são atualizados INDEPENDENTEMENTE. Nenhum
        // dos dois pode alterar o outro; `undefined` preserva o valor atual.
        brand: input.brand === undefined ? current.brand : input.brand,
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

  /**
   * R19-A — Importação em lote a partir de planilha Excel.
   *
   * PROMESSAS DE SEGURANÇA:
   *  • Nunca deleta nada. Nem produtos, nem imagens, nem variações.
   *  • Nunca sobrescreve produto existente por simples colisão de nome/slug.
   *  • Atualização parcial: só toca campos que a linha trouxe DEFINIDOS.
   *  • `undefined` no payload = preserva o valor atual (`estoque = 0` explícito
   *    continua funcionando porque veio como número, não `undefined`).
   *
   * MATCHING (ordem de precedência — sempre no banco, nunca no cache do front):
   *   1. `id` presente → busca produto por id. Se não existir, CONFLITO
   *      (não criamos com esse id — pode ser fruto de export antigo).
   *   2. `sku` presente → busca produto por SKU exato. Se não existir,
   *      criamos um produto NOVO carregando o SKU (unique garante).
   *   3. `slug` explícito na planilha → busca por slug. Se não existir,
   *      criamos NOVO com esse slug.
   *   4. Nenhum identificador confiável → derivamos slug do nome:
   *      • Se o slug derivado colide com produto existente → CONFLITO
   *        (não sobrescreve; usuário precisa adicionar id/sku/slug).
   *      • Se não colide → cria novo produto.
   */
  async bulkImport(input: BulkImportInput) {
    interface ReportItem {
      line: number;
      id?: string;
      name?: string;
      reason?: string;
      identifier?: string;
      // R19-C — bandeira única para diferenciar linhas que também mexeram na
      // imagem principal, sem inventar buckets novos no report.
      imageUpdated?: boolean;
    }
    const created: ReportItem[] = [];
    const updated: ReportItem[] = [];
    const skipped: ReportItem[] = [];
    const conflicts: ReportItem[] = [];

    // Cache local de categorias por nome (case-insensitive) para não repetir SELECT.
    const categoryCache = new Map<string, string>();
    async function resolveCategoryId(name: string): Promise<string | null> {
      const key = name.trim().toLowerCase();
      if (categoryCache.has(key)) return categoryCache.get(key)!;
      const cat = await prisma.category.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (cat) categoryCache.set(key, cat.id);
      return cat?.id ?? null;
    }

    /**
     * R19-C — Aplica a imagem principal DENTRO da mesma transação da linha.
     * Regras:
     *  • Sem galeria: cria em position=0.
     *  • URL igual à principal atual (menor position): no-op.
     *  • URL já existe como secundária: promove esse registro para principal,
     *    reindexando o resto — não cria duplicata.
     *  • URL nova: `updateMany +1` em todas as posições + `create` position=0.
     * Retorna `true` se houve alteração real na galeria, `false` se no-op.
     * Se qualquer passo falhar, o rollback é a transação da própria linha.
     */
    async function applyMainImage(
      tx: Prisma.TransactionClient,
      productId: string,
      url: string,
      altName: string,
    ): Promise<boolean> {
      const images = await tx.productImage.findMany({
        where: { productId },
        orderBy: { position: 'asc' },
        select: { id: true, url: true, position: true },
      });

      if (images.length === 0) {
        await tx.productImage.create({
          data: {
            productId,
            url,
            alt: altName,
            position: 0,
            mediaType: 'image',
          },
        });
        return true;
      }

      // Principal é sempre a de MENOR position (não assume ==0).
      const current = images[0];
      if (current.url === url) return false;

      const existingIdx = images.findIndex((i) => i.url === url);
      if (existingIdx > 0) {
        // Promove imagem secundária existente para principal, sem duplicar.
        // Reindexa: [encontrada, ...resto na ordem original].
        const promoted = images[existingIdx];
        const rest = images.filter((_, i) => i !== existingIdx);
        // Move a promovida para position temporária FORA da sequência para
        // evitar colisão com quem for ocupar o mesmo número.
        const tmp = -1;
        await tx.productImage.update({ where: { id: promoted.id }, data: { position: tmp } });
        for (let i = 0; i < rest.length; i++) {
          if (rest[i].position !== i + 1) {
            await tx.productImage.update({ where: { id: rest[i].id }, data: { position: i + 1 } });
          }
        }
        await tx.productImage.update({ where: { id: promoted.id }, data: { position: 0 } });
        return true;
      }

      // URL nova: empurra todas em +1 e insere em position=0.
      await tx.productImage.updateMany({
        where: { productId },
        data: { position: { increment: 1 } },
      });
      await tx.productImage.create({
        data: {
          productId,
          url,
          alt: altName,
          position: 0,
          mediaType: 'image',
        },
      });
      return true;
    }

    for (const row of input.rows) {
      try {
        // R19-C — Valida a URL da imagem ANTES de qualquer persistência.
        // Uma URL malformada não bloqueia as demais linhas do lote.
        let validatedImageUrl: string | undefined;
        if (row.imageUrl !== undefined) {
          if (!isSafeImageUrl(row.imageUrl)) {
            conflicts.push({
              line: row.line,
              name: row.name,
              reason:
                'Imagem inválida: protocolo/formato não permitido. ' +
                'Aceito: https://…, http://… ou /uploads/… (bloqueado javascript:, data:, file:, ftp:, caminhos locais).',
              identifier: row.imageUrl.slice(0, 80),
            });
            continue;
          }
          validatedImageUrl = row.imageUrl.trim();
        }

        // Categoria só é exigida na CRIAÇÃO. Se veio explicitamente, resolvemos
        // para validar antes de qualquer coisa (evita rolar update parcial e
        // depois estourar).
        let resolvedCategoryId: string | undefined;
        if (row.categoryName) {
          const cid = await resolveCategoryId(row.categoryName);
          if (!cid) {
            conflicts.push({
              line: row.line,
              name: row.name,
              reason: `Categoria "${row.categoryName}" não encontrada.`,
              identifier: row.categoryName,
            });
            continue;
          }
          resolvedCategoryId = cid;
        }

        // --- Fase 1: identificação do produto existente ---
        let existing = null as Awaited<ReturnType<typeof prisma.product.findUnique>>;
        let matchedBy: 'id' | 'sku' | 'slug' | null = null;

        if (row.id) {
          existing = await prisma.product.findUnique({ where: { id: row.id } });
          if (!existing) {
            conflicts.push({
              line: row.line,
              name: row.name,
              reason: `ID "${row.id}" informado não existe no banco. Removi/troquei este produto? Remova o ID e reimporte para criar como novo.`,
              identifier: row.id,
            });
            continue;
          }
          matchedBy = 'id';
        } else if (row.sku) {
          existing = await prisma.product.findFirst({ where: { sku: row.sku } });
          if (existing) matchedBy = 'sku';
        } else if (row.slug) {
          existing = await prisma.product.findFirst({ where: { slug: row.slug } });
          if (existing) matchedBy = 'slug';
        }

        // --- Fase 2A: UPDATE parcial (produto encontrado) ---
        if (existing) {
          const patch: Prisma.ProductUpdateInput = {};
          // Só entra na chave se veio DEFINIDA. Nunca `null`/`0`/`""` artificial.
          if (row.name !== undefined) patch.name = row.name;
          if (row.shortDescription !== undefined) patch.shortDescription = row.shortDescription;
          if (row.description !== undefined) patch.description = row.description;
          if (row.price !== undefined) patch.price = row.price;
          if (row.promotionalPrice !== undefined) patch.promotionalPrice = row.promotionalPrice;
          if (row.stock !== undefined) patch.stock = row.stock;
          if (row.active !== undefined) patch.active = row.active;
          if (row.featured !== undefined) patch.featured = row.featured;
          // R19-B — brand e material são independentes. Cada um só entra no
          // patch quando veio DEFINIDO na linha; nunca um afeta o outro.
          if (row.brand !== undefined) patch.brand = row.brand;
          if (row.material !== undefined) patch.material = row.material;
          if (resolvedCategoryId) patch.category = { connect: { id: resolvedCategoryId } };

          // Se sku VEIO e é diferente do atual, valida unicidade contra terceiros.
          if (row.sku && row.sku !== existing.sku) {
            await ensureUniqueSku(row.sku, existing.id);
            patch.sku = row.sku;
          }
          // Slug explícito na planilha vira novo slug (também com guarda).
          if (row.slug && row.slug !== existing.slug) {
            const taken = await slugExists(row.slug);
            if (taken) {
              conflicts.push({
                line: row.line,
                name: row.name ?? existing.name,
                reason: `Slug "${row.slug}" já está em uso por outro produto.`,
                identifier: row.slug,
              });
              continue;
            }
            patch.slug = row.slug;
          }

          // R19-C — Se a única alteração possível é a imagem, ainda vale
          // rodar a linha (só imagem). Sem imagem E sem patch → skipped.
          if (Object.keys(patch).length === 0 && validatedImageUrl === undefined) {
            skipped.push({
              line: row.line,
              name: existing.name,
              reason: 'Linha sem nenhum campo para atualizar.',
              identifier: existing.id,
            });
            continue;
          }

          // R19-C — Uma linha = uma unidade lógica atômica.
          // Se o update do produto ou a operação de galeria falhar, ambos
          // sofrem rollback juntos. Nunca sobra produto "meio-atualizado".
          const result = await prisma.$transaction(async (tx) => {
            const saved = Object.keys(patch).length
              ? await tx.product.update({
                  where: { id: existing!.id },
                  data: patch,
                  select: { id: true, name: true },
                })
              : { id: existing!.id, name: existing!.name };
            let imageUpdated = false;
            if (validatedImageUrl !== undefined) {
              imageUpdated = await applyMainImage(tx, saved.id, validatedImageUrl, saved.name);
            }
            return { saved, imageUpdated };
          });
          updated.push({
            line: row.line,
            id: result.saved.id,
            name: result.saved.name,
            imageUpdated: result.imageUpdated || undefined,
          });
          // matchedBy já cobrimos; a variável fica só para telemetria futura.
          void matchedBy;
          continue;
        }

        // --- Fase 2B: CRIAÇÃO (nenhum produto foi identificado) ---
        // Para criar, exigimos os campos mínimos.
        if (!row.name) {
          skipped.push({ line: row.line, reason: 'Nome é obrigatório para criar um novo produto.' });
          continue;
        }
        if (!resolvedCategoryId) {
          skipped.push({
            line: row.line,
            name: row.name,
            reason: 'Categoria é obrigatória para criar um novo produto.',
          });
          continue;
        }
        if (row.price === undefined) {
          skipped.push({
            line: row.line,
            name: row.name,
            reason: 'Preço é obrigatório para criar um novo produto.',
          });
          continue;
        }

        // Se veio SKU e ele já é usado por outro produto → conflito (matching
        // acima só entra em existing quando ACHOU; se não achou e o unique for
        // violado abaixo é porque outro produto tem esse SKU — impossível pelo
        // findFirst acima, mas defensivo contra corrida).
        if (row.sku) await ensureUniqueSku(row.sku);

        // Decisão de slug para CRIAÇÃO:
        // • Se veio `slug` explícito, respeitamos (unicidade validada abaixo).
        // • Senão, derivamos do nome. Se o derivado NÃO colide, criamos como
        //   novo produto — é criação inequívoca (nome não conflita).
        // • Se o derivado COLIDE com produto existente e a linha não trouxe
        //   NENHUM identificador (id/sku/slug), classificamos como CONFLITO —
        //   nunca aplicamos sufixo silencioso porque não temos como saber se
        //   é o mesmo produto ou um homônimo de outra marca (ex.: "PLA Preto"
        //   da 3D Prime vs. da Masterprint).
        let slug: string;
        if (row.slug) {
          if (await slugExists(row.slug)) {
            conflicts.push({
              line: row.line,
              name: row.name,
              reason: `Slug "${row.slug}" já está em uso por outro produto.`,
              identifier: row.slug,
            });
            continue;
          }
          slug = row.slug;
        } else {
          const derived = slugify(row.name);
          if (await slugExists(derived)) {
            conflicts.push({
              line: row.line,
              name: row.name,
              reason:
                `Já existe produto com slug derivado "${derived}". ` +
                'A linha não tem ID/SKU/slug explícito para confirmar que é o mesmo produto. ' +
                'Adicione a coluna "id" ou "sku" para atualizar, ou "slug" único para criar como novo.',
              identifier: derived,
            });
            continue;
          }
          slug = derived;
        }

        const createData: Prisma.ProductCreateInput = {
          name: row.name,
          slug,
          price: row.price,
          category: { connect: { id: resolvedCategoryId } },
        };
        if (row.sku !== undefined) createData.sku = row.sku;
        if (row.shortDescription !== undefined) createData.shortDescription = row.shortDescription;
        if (row.description !== undefined) createData.description = row.description;
        if (row.promotionalPrice !== undefined) createData.promotionalPrice = row.promotionalPrice;
        if (row.stock !== undefined) createData.stock = row.stock;
        if (row.active !== undefined) createData.active = row.active;
        if (row.featured !== undefined) createData.featured = row.featured;
        // R19-B — brand e material independentes na criação também.
        if (row.brand !== undefined) createData.brand = row.brand;
        if (row.material !== undefined) createData.material = row.material;

        // R19-C — Create + associação da imagem principal numa única transação.
        const result = await prisma.$transaction(async (tx) => {
          const saved = await tx.product.create({
            data: createData,
            select: { id: true, name: true },
          });
          let imageUpdated = false;
          if (validatedImageUrl !== undefined) {
            imageUpdated = await applyMainImage(tx, saved.id, validatedImageUrl, saved.name);
          }
          return { saved, imageUpdated };
        });
        created.push({
          line: row.line,
          id: result.saved.id,
          name: result.saved.name,
          imageUpdated: result.imageUpdated || undefined,
        });
      } catch (err) {
        // Um erro isolado não deve derrubar as demais linhas.
        const msg = err instanceof HttpError ? err.message : (err as Error)?.message ?? 'Erro inesperado.';
        skipped.push({ line: row.line, name: row.name, reason: msg });
      }
    }

    return {
      created,
      updated,
      skipped,
      conflicts,
      summary: {
        total: input.rows.length,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        conflicts: conflicts.length,
      },
    };
  },
};
