// Tipos DTO retornados pelo backend.
// Espelham exatamente o que o backend serializa em src/modules/*/service.ts.
// Ficam separados dos tipos internos do frontend em src/types/index.ts.

export type ApiUserRole = 'ADMIN' | 'CUSTOMER';
export type ApiPurchaseMode = 'DIRECT' | 'QUOTE' | 'BOTH';
export type ApiOrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELED';
export type ApiPaymentMethod = 'PIX' | 'CREDIT_CARD' | 'BOLETO';
export type ApiPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELED';
export type ApiQuoteStatus =
  | 'RECEIVED'
  | 'ANALYZING'
  | 'WAITING_CUSTOMER'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED_TO_ORDER';

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: ApiUserRole;
  active: boolean;
  createdAt: string;
}

export interface ApiCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  isSeasonal: boolean;
  seasonalTitle: string | null;
  seasonalDescription: string | null;
  seasonalBannerImage: string | null;
  productsCount?: number;
}

export interface ApiProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  /** R20 — "image" cobre JPG/PNG/WEBP/GIF; "video" cobre MP4. Antigos → "image". */
  mediaType: 'image' | 'video';
  mimeType: string | null;
}

export interface ApiProduct {
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
  // R19-B — brand (fabricante) e material são independentes no backend.
  brand: string | null;
  material: string | null;
  color: string | null;
  printTime: string | null;
  purchaseMode: ApiPurchaseMode;
  createdAt: string;
  updatedAt: string;
  stockUpdatedAt: string | null;
  images: ApiProductImage[];
}

export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiCartItem {
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
    purchaseMode: ApiPurchaseMode;
    category: { id: string; name: string; slug: string } | null;
    image: { id: string; url: string; alt: string | null } | null;
  };
}

export interface ApiCart {
  id: string;
  items: ApiCartItem[];
  subtotal: number;
  itemsCount: number;
  totalQuantity: number;
  updatedAt: string;
}

export interface ApiOrderAddress {
  recipientName: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
  country: string;
}

export interface ApiOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ApiOrder {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressSnapshot: ApiOrderAddress;
  subtotal: number;
  shippingValue: number;
  discountValue: number;
  totalBeforeDiscount: number;
  total: number;
  couponId: string | null;
  couponCode: string | null;
  couponDiscountType: ApiCouponDiscountType | null;
  status: ApiOrderStatus;
  paymentMethod: ApiPaymentMethod;
  paymentStatus: ApiPaymentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: ApiOrderItem[];
  user?: { id: string; name: string; email: string } | null;
}

export interface ApiQuoteFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface ApiQuote {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  title: string;
  description: string;
  material: string | null;
  color: string | null;
  quantity: number;
  deadline: string | null;
  estimatedValue: number | null;
  adminNotes: string | null;
  status: ApiQuoteStatus;
  createdAt: string;
  updatedAt: string;
  files: ApiQuoteFile[];
  user?: { id: string; name: string; email: string } | null;
}

export type ApiBannerSlot = 'HERO' | 'PROMO';

export interface ApiBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonLink: string | null;
  active: boolean;
  position: number;
  slot: ApiBannerSlot;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTestimonial {
  id: string;
  name: string;
  role: string | null;
  content: string;
  rating: number;
  avatarUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ApiCouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
export type ApiCouponStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'SCHEDULED';

export interface ApiCoupon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: ApiCouponDiscountType;
  discountValue: number;
  minOrderValue: number | null;
  maxDiscountValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  usageLimitPerCustomer: number | null;
  isActive: boolean;
  isSeasonal: boolean;
  seasonalName: string | null;
  status: ApiCouponStatus;
  ordersCount: number;
  revenue: number;
  discountGiven: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCouponValidation {
  valid: boolean;
  code: string;
  message: string;
  /** Código legível por máquina quando inválido: INVALID/INACTIVE/EXPIRED/etc. */
  reason?: string;
  discountType?: ApiCouponDiscountType;
  /** Valor bruto do cupom (% ou R$). */
  discountValue?: number;
  /** Desconto real em R$ para o carrinho enviado. */
  discountAmount: number;
  freeShipping: boolean;
  totalBeforeDiscount: number;
  totalAfterDiscount: number;
}

export type ApiScriptCategory =
  | 'COUPON'
  | 'POST_SALE'
  | 'QUOTE_RECOVERY'
  | 'LAUNCH'
  | 'SEASONAL_OFFER'
  | 'FREE_SHIPPING'
  | 'FEATURED_PRODUCT'
  | 'RETURNING_CUSTOMER';

export interface ApiLinkedCoupon {
  id: string;
  code: string;
  name: string;
  discountType: ApiCouponDiscountType;
  discountValue: number;
  minOrderValue: number | null;
  expiresAt: string | null;
}

export interface ApiCouponScript {
  id: string;
  title: string;
  description: string | null;
  messageTemplate: string;
  category: ApiScriptCategory;
  linkedCouponId: string | null;
  linkedCoupon: ApiLinkedCoupon | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiYoutubeVideo {
  title: string;
  url: string;
  thumbnail?: string;
  description?: string;
  enabled?: boolean;
}

export interface ApiTrustItem {
  title: string;
  description?: string;
  enabled?: boolean;
}

export interface ApiInstagramItem {
  image: string;
  url: string;
  caption?: string;
  enabled?: boolean;
}

export interface ApiSettings {
  id: string;
  storeName: string;
  whatsapp: string;
  email: string;
  instagram: string | null;
  address: string;
  cnpj: string | null;
  logoUrl: string | null;
  heroTitle: string | null;
  heroSubtitle: string | null;
  aboutTitle: string | null;
  aboutText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  pixDiscountPercent: number;
  freeShippingThreshold: number;
  shippingNote: string | null;
  // R17
  instagramHandle: string | null;
  youtubeUrl: string | null;
  youtubeHandle: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  communityInstagramEnabled: boolean;
  communityInstagramTitle: string | null;
  communityInstagramSubtitle: string | null;
  instagramItemsJson: ApiInstagramItem[];
  youtubeSectionEnabled: boolean;
  youtubeSectionTitle: string | null;
  youtubeSectionSubtitle: string | null;
  youtubeChannelUrl: string | null;
  youtubeChannelLabel: string | null;
  youtubeVideosJson: ApiYoutubeVideo[];
  newsletterEnabled: boolean;
  newsletterEyebrow: string | null;
  newsletterTitle: string | null;
  newsletterDescription: string | null;
  newsletterButtonText: string | null;
  newsletterPlaceholder: string | null;
  newsletterSuccessMessage: string | null;
  trustBlockEnabled: boolean;
  trustItemsJson: ApiTrustItem[];
  footerDescription: string | null;
  footerShowSocials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDashboard {
  metrics: {
    totalProducts: number;
    totalActiveProducts: number;
    totalInactiveProducts: number;
    totalCategories: number;
    totalActiveCategories: number;
    totalCustomers: number;
    totalOrders: number;
    totalQuotes: number;
    pendingOrders: number;
    pendingQuotes: number;
    paidOrders: number;
    estimatedRevenue: number;
    totalRevenue: number;
    averageOrderValue: number;
    lowStockCount: number;
  };
  recentOrders: Array<{
    id: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    status: ApiOrderStatus;
    paymentMethod: ApiPaymentMethod;
    paymentStatus: ApiPaymentStatus;
    total: number;
    createdAt: string;
    itemsCount: number;
  }>;
  recentQuotes: Array<{
    id: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    title: string;
    status: ApiQuoteStatus;
    estimatedValue: number | null;
    createdAt: string;
    filesCount: number;
    user: { id: string; name: string; email: string } | null;
  }>;
  lowStockProducts: Array<{
    id: string;
    name: string;
    slug: string;
    sku: string | null;
    stock: number;
    price: number;
    promotionalPrice: number | null;
    active: boolean;
    featured: boolean;
    category: { id: string; name: string; slug: string } | null;
    image: { id: string; url: string; alt: string | null } | null;
  }>;
  ordersByStatus: Record<ApiOrderStatus, number>;
  quotesByStatus: Record<ApiQuoteStatus, number>;
  productsByPurchaseMode: Record<ApiPurchaseMode, number>;
}
