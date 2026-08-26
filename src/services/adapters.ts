/**
 * Adapters entre DTOs do backend (`ApiXxx`) e tipos internos do frontend
 * (`src/types/index.ts`), que existem desde antes da integração.
 *
 * Isso permite manter os componentes atuais praticamente intactos:
 * o store carrega da API e chama o adapter — os componentes continuam
 * lendo os mesmos campos que sempre leram.
 */
import type {
  Banner,
  Category,
  Order,
  OrderStatus as OrderStatusInternal,
  Product,
  PurchaseMode,
  StoreSettings,
} from '@/types';
import type {
  ApiBanner,
  ApiCategory,
  ApiOrder,
  ApiOrderStatus,
  ApiProduct,
  ApiPurchaseMode,
  ApiSettings,
} from './types';
import { apiAssetUrl } from './api';
import { productSvg } from '@/utils/productImage';

// ------ enums ---------------------------------------------------------------

const PURCHASE_MODE_TO_INTERNAL: Record<ApiPurchaseMode, PurchaseMode> = {
  DIRECT: 'direct',
  QUOTE: 'quote',
  BOTH: 'both',
};
const PURCHASE_MODE_TO_API: Record<PurchaseMode, ApiPurchaseMode> = {
  direct: 'DIRECT',
  quote: 'QUOTE',
  both: 'BOTH',
};

const ORDER_STATUS_TO_INTERNAL: Record<ApiOrderStatus, OrderStatusInternal> = {
  PENDING: 'novo',
  CONFIRMED: 'pago',
  IN_PRODUCTION: 'em-separacao',
  READY: 'em-separacao',
  SHIPPED: 'enviado',
  DELIVERED: 'concluido',
  CANCELED: 'cancelado',
};
const ORDER_STATUS_TO_API: Record<OrderStatusInternal, ApiOrderStatus> = {
  novo: 'PENDING',
  'aguardando-pagamento': 'PENDING',
  pago: 'CONFIRMED',
  'em-separacao': 'IN_PRODUCTION',
  enviado: 'SHIPPED',
  concluido: 'DELIVERED',
  cancelado: 'CANCELED',
};

export const enumAdapters = {
  purchaseModeToInternal: (m: ApiPurchaseMode): PurchaseMode => PURCHASE_MODE_TO_INTERNAL[m],
  purchaseModeToApi: (m: PurchaseMode): ApiPurchaseMode => PURCHASE_MODE_TO_API[m],
  orderStatusToInternal: (s: ApiOrderStatus): OrderStatusInternal => ORDER_STATUS_TO_INTERNAL[s],
  orderStatusToApi: (s: OrderStatusInternal): ApiOrderStatus => ORDER_STATUS_TO_API[s],
};

// ------ product -------------------------------------------------------------

export function apiProductToInternal(p: ApiProduct): Product {
  const badges: Product['badges'] = [];
  if (p.promotionalPrice != null && p.promotionalPrice < p.price) badges.push('oferta');
  if (p.featured) badges.push('mais-vendido');
  if (p.stock <= 0) badges.push('esgotado');

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? '',
    shortDescription: p.shortDescription ?? '',
    categoryIds: p.categoryId ? [p.categoryId] : [],
    // R19-B — Marca vem SOMENTE do campo `brand` do backend. Nunca cair para
    // `material` (isso era o bug: mostrar o material como se fosse marca).
    // Vazio é exibido como vazio; nada de default artificial "3DCommerce".
    brand: p.brand ?? '',
    material: (p.material as Product['material']) ?? '-',
    images: p.images.length
      ? p.images.map((img) => apiAssetUrl(img.url))
      : [productSvg(p.name, 'generic', p.slug.length)],
    media: p.images.length
      ? p.images.map((img) => ({
          id: img.id,
          url: apiAssetUrl(img.url),
          // Se o backend não enviou (rota antiga em cache), inferimos pela extensão.
          mediaType: img.mediaType ?? (/\.mp4($|\?)/i.test(img.url) ? 'video' : 'image'),
          mimeType: img.mimeType ?? null,
        }))
      : [{ url: productSvg(p.name, 'generic', p.slug.length), mediaType: 'image', mimeType: null }],
    price: p.price,
    promoPrice: p.promotionalPrice ?? undefined,
    stock: p.stock,
    freeShipping: false,
    purchaseMode: enumAdapters.purchaseModeToInternal(p.purchaseMode),
    variations: [],
    badges,
    isHighlight: p.featured,
    isLaunch: false,
    isOffer: p.promotionalPrice != null && p.promotionalPrice < p.price,
    isBestSeller: p.featured,
    active: p.active,
    createdAt: p.createdAt,
    attributes: {
      ...(p.material ? { Material: p.material } : {}),
      ...(p.color ? { Cor: p.color } : {}),
      ...(p.printTime ? { 'Tempo de impressão': p.printTime } : {}),
      ...(p.weight ? { Peso: `${p.weight} kg` } : {}),
    },
  };
}

// ------ category ------------------------------------------------------------

export function apiCategoryToInternal(c: ApiCategory, order = 0): Category {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description ?? undefined,
    showInMenu: c.active,
    showInHome: c.active && !c.isSeasonal,
    order,
    isSeasonal: c.isSeasonal,
    seasonalActive: c.isSeasonal && c.active,
    seasonalBanner: c.seasonalTitle ?? undefined,
    seasonalBannerImage: c.seasonalBannerImage
      ? apiAssetUrl(c.seasonalBannerImage)
      : undefined,
  };
}

// ------ banner --------------------------------------------------------------

export function apiBannerToInternal(b: ApiBanner): Banner {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle ?? undefined,
    ctaLabel: b.buttonText ?? undefined,
    ctaLink: b.buttonLink ?? undefined,
    image: b.imageUrl ? apiAssetUrl(b.imageUrl) : '',
    position: 'hero',
    active: b.active,
    order: b.position,
  };
}

// ------ settings ------------------------------------------------------------

/**
 * Fallbacks de conteúdo editável (R17). Único lugar com textos padrão — usados
 * quando o admin ainda não preencheu o campo. Evita textos fixos espalhados.
 */
export const CONTENT_DEFAULTS = {
  communityInstagramTitle: 'Acompanhe no Instagram',
  communityInstagramSubtitle: '',
  youtubeSectionTitle: 'Assista no YouTube',
  youtubeSectionSubtitle: 'Veja dicas, novidades e projetos em impressão 3D.',
  youtubeChannelLabel: 'Ver canal',
  newsletterEyebrow: 'Novidades',
  newsletterTitle: 'Receba ofertas e novidades da 3DCommerce',
  newsletterDescription: 'Cupons, novos filamentos e impressoras em primeira mão.',
  newsletterButtonText: 'Inscrever',
  newsletterPlaceholder: 'Seu e-mail',
  newsletterSuccessMessage: 'Inscrição realizada! Obrigado.',
} as const;

export function apiSettingsToInternal(s: ApiSettings): StoreSettings {
  return {
    name: s.storeName,
    whatsapp: s.whatsapp,
    instagram: s.instagram ?? '',
    email: s.email,
    address: s.address,
    cnpj: s.cnpj ?? '',
    about: s.aboutText ?? '',
    shippingNote: s.shippingNote ?? '',
    freeShippingThreshold: s.freeShippingThreshold,
    pixDiscountPercent: s.pixDiscountPercent,
    logo: s.logoUrl ? apiAssetUrl(s.logoUrl) : undefined,
    // R17
    instagramHandle: s.instagramHandle ?? '',
    youtubeUrl: s.youtubeUrl ?? '',
    youtubeHandle: s.youtubeHandle ?? '',
    facebookUrl: s.facebookUrl ?? '',
    tiktokUrl: s.tiktokUrl ?? '',
    communityInstagramEnabled: s.communityInstagramEnabled,
    communityInstagramTitle: s.communityInstagramTitle || CONTENT_DEFAULTS.communityInstagramTitle,
    communityInstagramSubtitle: s.communityInstagramSubtitle ?? CONTENT_DEFAULTS.communityInstagramSubtitle,
    youtubeSectionEnabled: s.youtubeSectionEnabled,
    youtubeSectionTitle: s.youtubeSectionTitle || CONTENT_DEFAULTS.youtubeSectionTitle,
    youtubeSectionSubtitle: s.youtubeSectionSubtitle || CONTENT_DEFAULTS.youtubeSectionSubtitle,
    youtubeChannelUrl: s.youtubeChannelUrl ?? '',
    youtubeChannelLabel: s.youtubeChannelLabel || CONTENT_DEFAULTS.youtubeChannelLabel,
    youtubeVideos: (s.youtubeVideosJson ?? []).map((v) => ({
      title: v.title,
      url: v.url,
      thumbnail: v.thumbnail,
      description: v.description,
      enabled: v.enabled,
    })),
    newsletterEnabled: s.newsletterEnabled,
    newsletterEyebrow: s.newsletterEyebrow || CONTENT_DEFAULTS.newsletterEyebrow,
    newsletterTitle: s.newsletterTitle || CONTENT_DEFAULTS.newsletterTitle,
    newsletterDescription: s.newsletterDescription || CONTENT_DEFAULTS.newsletterDescription,
    newsletterButtonText: s.newsletterButtonText || CONTENT_DEFAULTS.newsletterButtonText,
    newsletterPlaceholder: s.newsletterPlaceholder || CONTENT_DEFAULTS.newsletterPlaceholder,
    newsletterSuccessMessage: s.newsletterSuccessMessage || CONTENT_DEFAULTS.newsletterSuccessMessage,
    trustBlockEnabled: s.trustBlockEnabled,
    trustItems: (s.trustItemsJson ?? []).map((t) => ({
      title: t.title,
      description: t.description,
      enabled: t.enabled,
    })),
    footerDescription: s.footerDescription ?? '',
    footerShowSocials: s.footerShowSocials,
  };
}

// ------ order ---------------------------------------------------------------

export function apiOrderToInternal(o: ApiOrder): Order {
  return {
    id: o.id,
    createdAt: o.createdAt,
    customerId: o.userId ?? undefined,
    customer: {
      name: o.customerName,
      email: o.customerEmail,
      phone: o.customerPhone,
    },
    address: {
      cep: o.addressSnapshot.zipCode,
      street: o.addressSnapshot.street,
      number: o.addressSnapshot.number,
      complement: o.addressSnapshot.complement ?? undefined,
      district: o.addressSnapshot.district,
      city: o.addressSnapshot.city,
      state: o.addressSnapshot.state,
    },
    items: o.items.map((it) => ({
      productId: it.productId ?? '',
      name: it.productName,
      image: '',
      qty: it.quantity,
      unitPrice: it.unitPrice,
    })),
    shipping: {
      method: 'Frete',
      price: o.shippingValue,
      deadline: '',
    },
    payment: {
      method:
        o.paymentMethod === 'PIX'
          ? 'pix'
          : o.paymentMethod === 'CREDIT_CARD'
          ? 'credito'
          : 'boleto',
    },
    coupon: o.couponCode
      ? { code: o.couponCode, discount: o.discountValue }
      : undefined,
    subtotal: o.subtotal,
    total: o.total,
    status: enumAdapters.orderStatusToInternal(o.status),
  };
}
