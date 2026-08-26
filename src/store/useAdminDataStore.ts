/**
 * Store de dados administrativos — R9.
 *
 * Antes (R1-R8): seedava produtos/categorias/etc em localStorage.
 * Agora: carrega da API real. Mantém a mesma "API pública" do store
 * para preservar todos os componentes que já lêem `useAdminDataStore(s => s.products)`.
 *
 * Estratégia:
 * - Chama `refresh()` no boot do app.
 * - Mutações admin (add/update/remove) chamam a API e atualizam cache local.
 * - `resetAll` faz refresh (não zera nada — dados agora vivem no banco).
 */
import { create } from 'zustand';
import { seedBlogPosts } from '@/data/blogPosts'; // continua local (sem endpoint)
import { seedFaqs } from '@/data/faqs'; // continua local (sem endpoint)
import type { Banner, Category, Order, OrderStatus, Product, StoreSettings } from '@/types';
import { productService } from '@/services/productService';
import { categoryService } from '@/services/categoryService';
import { bannerService } from '@/services/bannerService';
import { orderService } from '@/services/orderService';
import { settingsService } from '@/services/settingsService';
import { ApiError } from '@/services/api';
import {
  apiBannerToInternal,
  apiCategoryToInternal,
  apiOrderToInternal,
  apiProductToInternal,
  apiSettingsToInternal,
  enumAdapters,
} from '@/services/adapters';
import type { ApiOrderStatus, ApiPurchaseMode } from '@/services/types';

const DEFAULT_SETTINGS: StoreSettings = {
  name: '3DCommerce',
  whatsapp: '',
  instagram: '',
  email: '',
  address: '',
  cnpj: '',
  about: '',
  shippingNote: 'Enviamos para todo o Brasil',
  freeShippingThreshold: 299,
  pixDiscountPercent: 5,
  // R17 — conteúdos editáveis (fallbacks até a API carregar)
  instagramHandle: '',
  youtubeUrl: '',
  youtubeHandle: '',
  facebookUrl: '',
  tiktokUrl: '',
  communityInstagramEnabled: true,
  communityInstagramTitle: 'Acompanhe no Instagram',
  communityInstagramSubtitle: '',
  youtubeSectionEnabled: true,
  youtubeSectionTitle: 'Assista no YouTube',
  youtubeSectionSubtitle: 'Veja dicas, novidades e projetos em impressão 3D.',
  youtubeChannelUrl: '',
  youtubeChannelLabel: 'Ver canal',
  youtubeVideos: [],
  newsletterEnabled: true,
  newsletterEyebrow: 'Novidades',
  newsletterTitle: 'Receba ofertas e novidades da 3DCommerce',
  newsletterDescription: 'Cupons, novos filamentos e impressoras em primeira mão.',
  newsletterButtonText: 'Inscrever',
  newsletterPlaceholder: 'Seu e-mail',
  newsletterSuccessMessage: 'Inscrição realizada! Obrigado.',
  trustBlockEnabled: true,
  trustItems: [],
  footerDescription: '',
  footerShowSocials: true,
};

interface AdminDataState {
  products: Product[];
  categories: Category[];
  banners: Banner[];
  orders: Order[];
  settings: StoreSettings;
  ready: boolean;
  loading: boolean;

  refresh: () => Promise<void>;
  refreshPublic: () => Promise<void>;
  refreshAdmin: () => Promise<void>;

  // Produtos
  addProduct: (p: Product) => Promise<Product | null>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;

  // Categorias
  addCategory: (c: Category) => Promise<Category | null>;
  updateCategory: (id: string, patch: Partial<Category>) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;

  // Banners
  addBanner: (b: Banner) => Promise<Banner | null>;
  updateBanner: (id: string, patch: Partial<Banner>) => Promise<void>;
  removeBanner: (id: string) => Promise<void>;

  // Orders
  addOrder: (o: Order) => void;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;

  // Settings
  updateSettings: (patch: Partial<StoreSettings>) => Promise<{ ok: boolean; error?: string }>;

  resetAll: () => Promise<void>;
}

/** Mantido para compat com blog/faqs que continuam locais. */
export { seedBlogPosts, seedFaqs };

function purchaseModeToApi(pm: Product['purchaseMode']): ApiPurchaseMode {
  return enumAdapters.purchaseModeToApi(pm);
}

export const useAdminDataStore = create<AdminDataState>((set, get) => ({
  products: [],
  categories: [],
  banners: [],
  orders: [],
  settings: DEFAULT_SETTINGS,
  ready: false,
  loading: false,

  async refresh() {
    if (get().loading) return;
    set({ loading: true });
    try {
      // 1) Sempre carrega dados públicos (settings, categorias, produtos, banners).
      await get().refreshPublic();
      // 2) Se admin estiver logado, carrega dados admin também.
      await get().refreshAdmin();
    } finally {
      set({ ready: true, loading: false });
    }
  },

  async refreshPublic() {
    try {
      const [{ settings }, { categories: cats }, prodResp, bannersResp] = await Promise.all([
        settingsService.getPublic(),
        categoryService.listPublic(),
        productService.listPublic({ limit: 100 }),
        bannerService.listPublic(),
      ]);
      set({
        settings: apiSettingsToInternal(settings),
        categories: cats.map((c, i) => apiCategoryToInternal(c, i)),
        products: prodResp.products.map(apiProductToInternal),
        banners: bannersResp.banners.map(apiBannerToInternal),
      });
    } catch {
      // Falha silenciosa — mantém defaults. Componentes mostram empty states.
    }
  },

  async refreshAdmin() {
    try {
      // Só faz sentido se admin token existir.
      // R19-A: limit ampliado 100 → 500 (era o motivo de produtos "sumirem"
      // da tela do admin quando o catálogo passava de 100). Dívida técnica:
      // catálogos >500 pedem paginação real na listagem — fora do escopo.
      const [prod, cats, banners, orders] = await Promise.all([
        productService.listAdmin({ limit: 500 }).catch(() => null),
        categoryService.listAdmin().catch(() => null),
        bannerService.listAdmin().catch(() => null),
        orderService.listAdmin({ limit: 100 }).catch(() => null),
      ]);
      const patch: Partial<AdminDataState> = {};
      if (prod) patch.products = prod.products.map(apiProductToInternal);
      if (cats) patch.categories = cats.categories.map((c, i) => apiCategoryToInternal(c, i));
      if (banners) patch.banners = banners.banners.map(apiBannerToInternal);
      if (orders) patch.orders = orders.orders.map(apiOrderToInternal);
      set(patch);
    } catch {
      // ignora
    }
  },

  // -------------------------- Produtos --------------------------------------
  async addProduct(p) {
    try {
      const { product } = await productService.create({
        categoryId: p.categoryIds[0] ?? '',
        name: p.name,
        slug: p.slug || undefined,
        shortDescription: p.shortDescription,
        description: p.description,
        price: p.price,
        promotionalPrice: p.promoPrice ?? null,
        stock: p.stock,
        active: p.active,
        featured: p.isHighlight || p.isBestSeller,
        purchaseMode: purchaseModeToApi(p.purchaseMode),
        // R19-B — brand e material persistidos SEPARADAMENTE. Nunca derivar
        // um do outro. String vazia vira null (não há valor real informado).
        brand: p.brand?.trim() ? p.brand.trim() : null,
        material: p.material === '-' ? null : p.material ?? null,
      });
      const created = apiProductToInternal(product);
      set({ products: [created, ...get().products] });
      return created;
    } catch {
      return null;
    }
  },

  async updateProduct(id, patch) {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.description !== undefined) payload.description = patch.description;
    if (patch.shortDescription !== undefined) payload.shortDescription = patch.shortDescription;
    if (patch.price !== undefined) payload.price = patch.price;
    if (patch.promoPrice !== undefined) payload.promotionalPrice = patch.promoPrice ?? null;
    if (patch.stock !== undefined) payload.stock = patch.stock;
    if (patch.active !== undefined) payload.active = patch.active;
    if (patch.isHighlight !== undefined || patch.isBestSeller !== undefined) {
      payload.featured = patch.isHighlight ?? patch.isBestSeller;
    }
    if (patch.purchaseMode !== undefined) payload.purchaseMode = purchaseModeToApi(patch.purchaseMode);
    if (patch.categoryIds !== undefined && patch.categoryIds[0]) payload.categoryId = patch.categoryIds[0];
    // R19-B — brand e material são independentes. Cada um só entra no payload
    // quando explicitamente definido no patch; um NUNCA altera o outro.
    if (patch.brand !== undefined) payload.brand = patch.brand?.trim() ? patch.brand.trim() : null;
    if (patch.material !== undefined) payload.material = patch.material === '-' ? null : patch.material;

    try {
      const { product } = await productService.update(id, payload);
      const updated = apiProductToInternal(product);
      set({ products: get().products.map((p) => (p.id === id ? updated : p)) });
    } catch {
      // toasts já são disparados no componente que chama
    }
  },

  async removeProduct(id) {
    try {
      await productService.remove(id);
      // soft delete: reduz do cache também
      set({ products: get().products.filter((p) => p.id !== id) });
    } catch {
      // ignora
    }
  },

  // -------------------------- Categorias -----------------------------------
  async addCategory(c) {
    try {
      const { category } = await categoryService.create({
        name: c.name,
        slug: c.slug || undefined,
        description: c.description ?? null,
        active: c.showInMenu,
        isSeasonal: !!c.isSeasonal,
        seasonalTitle: c.seasonalBanner ?? null,
        seasonalBannerImage: c.seasonalBannerImage ?? null,
      });
      const created = apiCategoryToInternal(category, get().categories.length);
      set({ categories: [...get().categories, created] });
      return created;
    } catch {
      return null;
    }
  },

  async updateCategory(id, patch) {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.slug !== undefined) payload.slug = patch.slug;
    if (patch.description !== undefined) payload.description = patch.description ?? null;
    if (patch.showInMenu !== undefined) payload.active = patch.showInMenu;
    if (patch.isSeasonal !== undefined) payload.isSeasonal = patch.isSeasonal;
    if (patch.seasonalBanner !== undefined) payload.seasonalTitle = patch.seasonalBanner ?? null;
    if (patch.seasonalBannerImage !== undefined) payload.seasonalBannerImage = patch.seasonalBannerImage ?? null;

    try {
      const { category } = await categoryService.update(id, payload);
      const updated = apiCategoryToInternal(category, 0);
      set({ categories: get().categories.map((c) => (c.id === id ? { ...c, ...updated } : c)) });
    } catch {
      // ignora
    }
  },

  async removeCategory(id) {
    try {
      await categoryService.remove(id);
      set({ categories: get().categories.filter((c) => c.id !== id) });
    } catch {
      // ignora
    }
  },

  // -------------------------- Banners --------------------------------------
  async addBanner(b) {
    try {
      const { banner } = await bannerService.create({
        title: b.title,
        subtitle: b.subtitle ?? null,
        imageUrl: b.image || null,
        buttonText: b.ctaLabel ?? null,
        buttonLink: b.ctaLink ?? null,
        active: b.active,
        position: b.order,
      });
      const created = apiBannerToInternal(banner);
      set({ banners: [...get().banners, created] });
      return created;
    } catch {
      return null;
    }
  },

  async updateBanner(id, patch) {
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.subtitle !== undefined) payload.subtitle = patch.subtitle ?? null;
    if (patch.ctaLabel !== undefined) payload.buttonText = patch.ctaLabel ?? null;
    if (patch.ctaLink !== undefined) payload.buttonLink = patch.ctaLink ?? null;
    if (patch.image !== undefined) payload.imageUrl = patch.image || null;
    if (patch.active !== undefined) payload.active = patch.active;
    if (patch.order !== undefined) payload.position = patch.order;
    try {
      const { banner } = await bannerService.update(id, payload);
      const updated = apiBannerToInternal(banner);
      set({ banners: get().banners.map((b) => (b.id === id ? updated : b)) });
    } catch {
      // ignora
    }
  },

  async removeBanner(id) {
    try {
      await bannerService.remove(id);
      set({ banners: get().banners.filter((b) => b.id !== id) });
    } catch {
      // ignora
    }
  },

  // -------------------------- Orders ---------------------------------------
  addOrder(o) {
    // Chamado pelo Checkout somente como "otimista" — a lista real vem via refreshAdmin.
    set({ orders: [o, ...get().orders] });
  },

  async updateOrderStatus(id, status) {
    try {
      const apiStatus: ApiOrderStatus = enumAdapters.orderStatusToApi(status);
      const { order } = await orderService.updateStatus(id, { status: apiStatus });
      const updated = apiOrderToInternal(order);
      set({ orders: get().orders.map((o) => (o.id === id ? updated : o)) });
    } catch {
      // ignora
    }
  },

  // -------------------------- Settings -------------------------------------
  async updateSettings(patch) {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.storeName = patch.name;
    if (patch.whatsapp !== undefined) payload.whatsapp = patch.whatsapp;
    if (patch.email !== undefined) payload.email = patch.email;
    if (patch.instagram !== undefined) payload.instagram = patch.instagram || null;
    if (patch.address !== undefined) payload.address = patch.address;
    if (patch.cnpj !== undefined) payload.cnpj = patch.cnpj || null;
    if (patch.about !== undefined) payload.aboutText = patch.about || null;
    if (patch.shippingNote !== undefined) payload.shippingNote = patch.shippingNote || null;
    if (patch.freeShippingThreshold !== undefined) payload.freeShippingThreshold = patch.freeShippingThreshold;
    if (patch.pixDiscountPercent !== undefined) payload.pixDiscountPercent = patch.pixDiscountPercent;
    if (patch.logo !== undefined) payload.logoUrl = patch.logo || null;

    // --- R17: conteúdos editáveis ---
    if (patch.instagramHandle !== undefined) payload.instagramHandle = patch.instagramHandle || null;
    if (patch.youtubeUrl !== undefined) payload.youtubeUrl = patch.youtubeUrl || null;
    if (patch.youtubeHandle !== undefined) payload.youtubeHandle = patch.youtubeHandle || null;
    if (patch.facebookUrl !== undefined) payload.facebookUrl = patch.facebookUrl || null;
    if (patch.tiktokUrl !== undefined) payload.tiktokUrl = patch.tiktokUrl || null;
    if (patch.communityInstagramEnabled !== undefined) payload.communityInstagramEnabled = patch.communityInstagramEnabled;
    if (patch.communityInstagramTitle !== undefined) payload.communityInstagramTitle = patch.communityInstagramTitle || null;
    if (patch.communityInstagramSubtitle !== undefined) payload.communityInstagramSubtitle = patch.communityInstagramSubtitle || null;
    if (patch.youtubeSectionEnabled !== undefined) payload.youtubeSectionEnabled = patch.youtubeSectionEnabled;
    if (patch.youtubeSectionTitle !== undefined) payload.youtubeSectionTitle = patch.youtubeSectionTitle || null;
    if (patch.youtubeSectionSubtitle !== undefined) payload.youtubeSectionSubtitle = patch.youtubeSectionSubtitle || null;
    if (patch.youtubeChannelUrl !== undefined) payload.youtubeChannelUrl = patch.youtubeChannelUrl || null;
    if (patch.youtubeChannelLabel !== undefined) payload.youtubeChannelLabel = patch.youtubeChannelLabel || null;
    if (patch.youtubeVideos !== undefined) payload.youtubeVideosJson = patch.youtubeVideos;
    if (patch.newsletterEnabled !== undefined) payload.newsletterEnabled = patch.newsletterEnabled;
    if (patch.newsletterEyebrow !== undefined) payload.newsletterEyebrow = patch.newsletterEyebrow || null;
    if (patch.newsletterTitle !== undefined) payload.newsletterTitle = patch.newsletterTitle || null;
    if (patch.newsletterDescription !== undefined) payload.newsletterDescription = patch.newsletterDescription || null;
    if (patch.newsletterButtonText !== undefined) payload.newsletterButtonText = patch.newsletterButtonText || null;
    if (patch.newsletterPlaceholder !== undefined) payload.newsletterPlaceholder = patch.newsletterPlaceholder || null;
    if (patch.newsletterSuccessMessage !== undefined) payload.newsletterSuccessMessage = patch.newsletterSuccessMessage || null;
    if (patch.trustBlockEnabled !== undefined) payload.trustBlockEnabled = patch.trustBlockEnabled;
    if (patch.trustItems !== undefined) payload.trustItemsJson = patch.trustItems;
    if (patch.footerDescription !== undefined) payload.footerDescription = patch.footerDescription || null;
    if (patch.footerShowSocials !== undefined) payload.footerShowSocials = patch.footerShowSocials;

    try {
      const { settings } = await settingsService.update(payload);
      set({ settings: apiSettingsToInternal(settings) });
      return { ok: true };
    } catch (err) {
      const error = err instanceof ApiError ? err.message : 'Erro ao salvar configurações.';
      return { ok: false, error };
    }
  },

  async resetAll() {
    // Não zera nada real. Só refetch do banco.
    await get().refresh();
  },
}));
