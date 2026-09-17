export type PurchaseMode = 'direct' | 'quote' | 'both';

export type ProductBadge = 'oferta' | 'lancamento' | 'mais-vendido' | 'esgotado' | 'frete-gratis';

export type VariationType =
  | 'cor'
  | 'material'
  | 'peso'
  | 'diametro'
  | 'voltagem'
  | 'tamanho'
  | 'modelo';

export interface ProductVariation {
  id: string;
  label: string;
  type: VariationType;
  inStock: boolean;
  priceDelta?: number;
  swatch?: string;
}

/** R20 — item da galeria do produto (imagem ou vídeo MP4). */
export interface ProductMediaItem {
  url: string;
  mediaType: 'image' | 'video';
  mimeType?: string | null;
  id?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  shortDescription: string;
  categoryIds: string[];
  brand: string;
  material?: 'PLA' | 'PETG' | 'ABS' | 'Resina' | '-';
  /** URLs simples (compat com código antigo — sempre em ordem). */
  images: string[];
  /** R20 — mídias com tipo (fonte da verdade para galeria/uploads).
   *  Opcional: mocks locais e criação otimista continuam válidos sem preencher. */
  media?: ProductMediaItem[];
  price: number;
  promoPrice?: number;
  pixPrice?: number;
  stock: number;
  freeShipping: boolean;
  purchaseMode: PurchaseMode;
  variations: ProductVariation[];
  badges: ProductBadge[];
  isHighlight: boolean;
  isLaunch: boolean;
  isOffer: boolean;
  isBestSeller: boolean;
  active: boolean;
  createdAt: string;
  /** R19-E — Data em que o estoque foi tocado de fato. `null`/ausente = sem histórico. */
  stockUpdatedAt?: string | null;
  attributes: Record<string, string>;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  image?: string;
  showInMenu: boolean;
  showInHome: boolean;
  order: number;
  isSeasonal?: boolean;
  seasonalBanner?: string;
  seasonalBannerImage?: string;
  seasonalActive?: boolean;
  productIds?: string[];
  color?: string;
}

/** Selo flutuante exibido sobre a imagem do Hero (ex.: "+ Vendido"). */
export interface HeroBadge {
  enabled: boolean;
  tag: string;    // ex.: "+ Vendido" / "Lançamento"
  title: string;  // ex.: "PLA Preto 1kg"
  info: string;   // ex.: "R$ 109,90" / "Suporte incluso"
}

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaLink?: string;
  image: string;
  position: 'hero' | 'promo' | 'filamentos' | 'impressoras' | 'sazonal';
  active: boolean;
  order: number;
  bgFrom?: string;
  bgTo?: string;
  /** Selos flutuantes sobre a imagem (apenas para a posição Hero). */
  badgeLeft?: HeroBadge;
  badgeRight?: HeroBadge;
}

export type OrderStatus =
  | 'novo'
  | 'aguardando-pagamento'
  | 'pago'
  | 'em-separacao'
  | 'enviado'
  | 'concluido'
  | 'cancelado';

export interface OrderItem {
  productId: string;
  name: string;
  image: string;
  variationLabel?: string;
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  createdAt: string;
  customerId?: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    cpf?: string;
  };
  address: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
  };
  items: OrderItem[];
  shipping: {
    method: string;
    price: number;
    deadline: string;
  };
  payment: {
    method: 'pix' | 'credito' | 'boleto';
    installments?: number;
  };
  coupon?: {
    code: string;
    discount: number;
  };
  subtotal: number;
  total: number;
  status: OrderStatus;
}

export interface YoutubeVideoItem {
  title: string;
  url: string;
  thumbnail?: string;
  description?: string;
  enabled?: boolean;
}

export interface TrustItemContent {
  title: string;
  description?: string;
  enabled?: boolean;
}

export interface InstagramItemContent {
  image: string;
  url: string;
  caption?: string;
  enabled?: boolean;
}

export interface StoreSettings {
  name: string;
  whatsapp: string;
  instagram: string;
  email: string;
  address: string;
  cnpj: string;
  about: string;
  shippingNote: string;
  freeShippingThreshold: number;
  pixDiscountPercent: number;
  logo?: string;
  // R17 — conteúdos editáveis
  instagramHandle: string;
  youtubeUrl: string;
  youtubeHandle: string;
  facebookUrl: string;
  tiktokUrl: string;
  communityInstagramEnabled: boolean;
  communityInstagramTitle: string;
  communityInstagramSubtitle: string;
  instagramItems: InstagramItemContent[];
  youtubeSectionEnabled: boolean;
  youtubeSectionTitle: string;
  youtubeSectionSubtitle: string;
  youtubeChannelUrl: string;
  youtubeChannelLabel: string;
  youtubeVideos: YoutubeVideoItem[];
  newsletterEnabled: boolean;
  newsletterEyebrow: string;
  newsletterTitle: string;
  newsletterDescription: string;
  newsletterButtonText: string;
  newsletterPlaceholder: string;
  newsletterSuccessMessage: string;
  trustBlockEnabled: boolean;
  trustItems: TrustItemContent[];
  footerDescription: string;
  footerShowSocials: boolean;
}

export interface CartItem {
  productId: string;
  variationId?: string;
  variationLabel?: string;
  qty: number;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  cover: string;
  author: string;
  category: string;
  readTime: string;
  createdAt: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
}

export interface CustomerAddress {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Apenas mock: NÃO usar em produção. Substituir por Supabase Auth na Fase 2. */
  password: string;
  createdAt: string;
  defaultAddress?: CustomerAddress;
}
