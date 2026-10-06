import {
  Prisma,
  ProductPurchaseMode,
  type Cart,
  type CartItem,
  type Category,
  type Product,
  type ProductImage,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { decimalToNumber } from '../../utils/decimal';
import type { AddItemInput, UpdateItemInput } from './cart.schemas';

type CartItemWithRelations = CartItem & {
  product: Product & {
    category: Pick<Category, 'id' | 'name' | 'slug'> | null;
    images: ProductImage[];
  };
};

type CartWithItems = Cart & { items: CartItemWithRelations[] };

/** DTO — nunca vaza Prisma.Decimal para o cliente. */
export interface CartDTO {
  id: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    product: {
      id: string;
      name: string;
      slug: string;
      sku: string | null;
      stock: number;
      active: boolean;
      purchaseMode: ProductPurchaseMode;
      category: { id: string; name: string; slug: string } | null;
      image: { id: string; url: string; alt: string | null } | null;
    };
  }>;
  subtotal: number;
  itemsCount: number;
  totalQuantity: number;
  updatedAt: string;
}

function toCartDTO(cart: CartWithItems): CartDTO {
  const items = cart.items.map((it) => {
    // Sempre o preço ATUAL do produto (o mesmo que o pedido vai cobrar).
    const unitPrice = decimalToNumber(effectivePrice(it.product)) ?? 0;
    const lineTotal = Number((unitPrice * it.quantity).toFixed(2));
    const mainImage = [...it.product.images].sort((a, b) => a.position - b.position)[0] ?? null;
    return {
      id: it.id,
      productId: it.productId,
      quantity: it.quantity,
      unitPrice,
      lineTotal,
      product: {
        id: it.product.id,
        name: it.product.name,
        slug: it.product.slug,
        sku: it.product.sku,
        stock: it.product.stock,
        active: it.product.active,
        purchaseMode: it.product.purchaseMode,
        category: it.product.category
          ? { id: it.product.category.id, name: it.product.category.name, slug: it.product.category.slug }
          : null,
        image: mainImage ? { id: mainImage.id, url: mainImage.url, alt: mainImage.alt } : null,
      },
    };
  });
  const subtotal = Number(items.reduce((acc, i) => acc + i.lineTotal, 0).toFixed(2));
  return {
    id: cart.id,
    items,
    subtotal,
    itemsCount: items.length,
    totalQuantity: items.reduce((acc, i) => acc + i.quantity, 0),
    updatedAt: cart.updatedAt.toISOString(),
  };
}

const includeCartRelations = {
  items: {
    include: {
      product: {
        include: {
          category: { select: { id: true, name: true, slug: true } },
          images: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.CartInclude;

/** Retorna o carrinho do user; cria on-demand se não existir. */
async function ensureCart(userId: string): Promise<CartWithItems> {
  const existing = await prisma.cart.findUnique({
    where: { userId },
    include: includeCartRelations,
  });
  if (existing) return existing;
  return prisma.cart.create({
    data: { userId },
    include: includeCartRelations,
  });
}

/**
 * Preço atual efetivo (promotional se houver, senão price). Fonte única usada
 * pelo carrinho e pela criação do pedido — o `cartItem.unitPrice` gravado na
 * adição fica só como histórico e NÃO define o valor cobrado.
 */
export function effectivePrice(product: Pick<Product, 'price' | 'promotionalPrice'>): Prisma.Decimal {
  return product.promotionalPrice ?? product.price;
}

export const cartService = {
  async get(userId: string): Promise<CartDTO> {
    const cart = await ensureCart(userId);
    return toCartDTO(cart);
  },

  async addItem(userId: string, input: AddItemInput): Promise<CartDTO> {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw HttpError.notFound('Produto não encontrado.');
    if (!product.active) throw HttpError.badRequest('Produto não está disponível.');
    if (product.purchaseMode === ProductPurchaseMode.QUOTE) {
      throw HttpError.badRequest('Este produto é apenas via orçamento.');
    }

    const cart = await ensureCart(userId);
    const existingItem = cart.items.find((i) => i.productId === input.productId);
    const finalQty = (existingItem?.quantity ?? 0) + input.quantity;
    if (finalQty > product.stock) {
      throw HttpError.badRequest(
        `Quantidade solicitada (${finalQty}) excede o estoque (${product.stock}).`,
      );
    }

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: finalQty },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          quantity: input.quantity,
          unitPrice: effectivePrice(product),
        },
      });
    }

    const updated = await ensureCart(userId);
    return toCartDTO(updated);
  },

  async updateItem(userId: string, itemId: string, input: UpdateItemInput): Promise<CartDTO> {
    const item = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true, product: { select: { stock: true, active: true, name: true } } },
    });
    if (!item || item.cart.userId !== userId) {
      // Não vaza se o item existe em outro user — sempre 404.
      throw HttpError.notFound('Item do carrinho não encontrado.');
    }
    if (!item.product.active) throw HttpError.badRequest('Produto não está disponível.');
    if (input.quantity > item.product.stock) {
      throw HttpError.badRequest(
        `Quantidade (${input.quantity}) excede o estoque (${item.product.stock}).`,
      );
    }

    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: input.quantity },
    });

    const updated = await ensureCart(userId);
    return toCartDTO(updated);
  },

  async removeItem(userId: string, itemId: string): Promise<CartDTO> {
    const item = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== userId) {
      throw HttpError.notFound('Item do carrinho não encontrado.');
    }
    await prisma.cartItem.delete({ where: { id: itemId } });
    const updated = await ensureCart(userId);
    return toCartDTO(updated);
  },

  async clear(userId: string): Promise<CartDTO> {
    const cart = await ensureCart(userId);
    if (cart.items.length > 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
    const updated = await ensureCart(userId);
    return toCartDTO(updated);
  },
};
