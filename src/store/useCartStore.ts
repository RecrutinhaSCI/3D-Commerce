/**
 * Store de carrinho — R9 / R13.
 *
 * Fonte da verdade dos ITENS: backend (`/api/cart`).
 * Fonte da verdade do DESCONTO: backend (`/api/coupons/validate` e, na criação
 * do pedido, `POST /api/orders` revalida o cupom). O frontend só exibe.
 *
 * Preserva a API interna usada pelos componentes:
 *   addItem, removeItem, updateQty, clear, applyCoupon, removeCoupon, count.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Product } from '@/types';
import { site } from '@/config/site';
import { getEffectivePrice } from '@/utils/price';
import { cartService } from '@/services/cartService';
import { couponService } from '@/services/couponService';
import { ApiError, getStoredToken } from '@/services/api';
import type { ApiCouponDiscountType } from '@/services/types';

/** Resultado de `addItem` — permite ao chamador abrir o drawer só no sucesso. */
export interface AddItemResult {
  ok: boolean;
  requiresAuth?: boolean;
  error?: string;
}

/** Cupom aplicado — cache visual; o backend revalida sempre no pedido. */
export interface AppliedCoupon {
  code: string;
  discountType: ApiCouponDiscountType;
  discountValue: number;
  discountAmount: number;
  freeShipping: boolean;
  message: string;
}

/** Resultado das operações de item — permite ao componente dar feedback. */
export interface CartOpResult {
  ok: boolean;
  error?: string;
}

interface CartState {
  items: CartItem[];
  appliedCoupon: AppliedCoupon | null;
  couponLoading: boolean;
  couponError: string | null;
  loading: boolean;
  lastError: string | null;
  /** IDs de itens com operação em andamento (evita clique duplo / corrida). */
  busyItems: string[];

  // Sincronização
  fetch: () => Promise<void>;
  reset: () => void;
  /** Leva o carrinho de visitante para a conta (chamar após login/cadastro). */
  mergeGuestCart: () => Promise<{ merged: number; failed: string[] }>;

  // Itens
  addItem: (productId: string, qty?: number, variationId?: string, variationLabel?: string) => Promise<AddItemResult>;
  removeItem: (productId: string, variationId?: string) => Promise<CartOpResult>;
  updateQty: (productId: string, qty: number, variationId?: string) => Promise<CartOpResult>;
  clear: () => Promise<void>;

  // Cupom (R13)
  applyCoupon: (code: string, subtotal: number) => Promise<boolean>;
  removeCoupon: () => void;
  clearCoupon: () => void;
  revalidateCoupon: (subtotal: number) => Promise<void>;

  count: () => number;
}

function hasCustomerToken(): boolean {
  return !!getStoredToken('customer');
}

/**
 * Carrinho de VISITANTE: sem login os itens ficam só no navegador (persistidos)
 * com `variationId = 'guest:<productId>'`. No login/cadastro, `mergeGuestCart`
 * envia tudo ao carrinho da conta (o backend valida estoque) e volta à API.
 */
const GUEST_PREFIX = 'guest:';
const isGuestItem = (variationId?: string) => !!variationId && variationId.startsWith(GUEST_PREFIX);

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedCoupon: null,
      couponLoading: false,
      couponError: null,
      loading: false,
      lastError: null,
      busyItems: [],

      async fetch() {
        if (!hasCustomerToken()) {
          // Visitante: mantém só os itens locais (descarta resquício da conta).
          set({ items: get().items.filter((i) => isGuestItem(i.variationId)) });
          return;
        }
        set({ loading: true });
        try {
          const { cart } = await cartService.get();
          set({
            items: cart.items.map((i) => ({
              productId: i.productId,
              qty: i.quantity,
              variationId: i.id,
              variationLabel: undefined,
            })),
            loading: false,
            lastError: null,
          });
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Erro ao carregar carrinho.';
          set({ loading: false, lastError: msg });
        }
      },

      reset() {
        set({ items: [], appliedCoupon: null, couponError: null, lastError: null, busyItems: [] });
      },

      async mergeGuestCart() {
        const guest = get().items.filter((i) => isGuestItem(i.variationId));
        const failed: string[] = [];
        let merged = 0;
        for (const it of guest) {
          try {
            await cartService.addItem(it.productId, it.qty);
            merged++;
          } catch {
            failed.push(it.productId); // ex.: sem estoque — o resto segue
          }
        }
        set({ items: get().items.filter((i) => !isGuestItem(i.variationId)) });
        await get().fetch();
        return { merged, failed };
      },

      async addItem(productId, qty = 1) {
        if (!hasCustomerToken()) {
          // Visitante: carrinho local (vai para a conta no login).
          const id = GUEST_PREFIX + productId;
          const items = get().items;
          const existing = items.find((i) => i.variationId === id);
          set({
            items: existing
              ? items.map((i) => (i.variationId === id ? { ...i, qty: i.qty + qty } : i))
              : [...items, { productId, qty, variationId: id }],
            lastError: null,
          });
          return { ok: true };
        }
        try {
          const { cart } = await cartService.addItem(productId, qty);
          set({
            items: cart.items.map((i) => ({
              productId: i.productId,
              qty: i.quantity,
              variationId: i.id,
              variationLabel: undefined,
            })),
            lastError: null,
          });
          return { ok: true };
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Erro ao adicionar item.';
          set({ lastError: msg });
          return { ok: false, error: msg };
        }
      },

      async removeItem(_productId, variationId) {
        if (!variationId) return { ok: false, error: 'Item inválido.' };
        if (isGuestItem(variationId)) {
          set({ items: get().items.filter((i) => i.variationId !== variationId) });
          return { ok: true };
        }
        // Guard: ignora se já há operação em andamento neste item.
        if (get().busyItems.includes(variationId)) return { ok: false, error: 'Aguarde…' };
        set({ busyItems: [...get().busyItems, variationId] });
        try {
          const { cart } = await cartService.removeItem(variationId);
          set({
            items: cart.items.map((i) => ({ productId: i.productId, qty: i.quantity, variationId: i.id })),
          });
          return { ok: true };
        } catch (err) {
          const error = err instanceof ApiError ? err.message : 'Não foi possível atualizar o carrinho.';
          set({ lastError: error });
          return { ok: false, error };
        } finally {
          set({ busyItems: get().busyItems.filter((id) => id !== variationId) });
        }
      },

      async updateQty(_productId, qty, variationId) {
        if (!variationId) return { ok: false, error: 'Item inválido.' };
        if (qty <= 0) {
          return get().removeItem(_productId, variationId);
        }
        if (isGuestItem(variationId)) {
          set({ items: get().items.map((i) => (i.variationId === variationId ? { ...i, qty } : i)) });
          return { ok: true };
        }
        // Guard contra clique duplo / respostas fora de ordem.
        if (get().busyItems.includes(variationId)) return { ok: false, error: 'Aguarde…' };
        set({ busyItems: [...get().busyItems, variationId] });
        try {
          const { cart } = await cartService.updateItem(variationId, qty);
          set({
            items: cart.items.map((i) => ({ productId: i.productId, qty: i.quantity, variationId: i.id })),
          });
          return { ok: true };
        } catch (err) {
          const error = err instanceof ApiError ? err.message : 'Não foi possível atualizar o carrinho.';
          set({ lastError: error });
          return { ok: false, error };
        } finally {
          set({ busyItems: get().busyItems.filter((id) => id !== variationId) });
        }
      },

      async clear() {
        if (hasCustomerToken()) {
          try {
            await cartService.clear();
          } catch {
            /* segue com limpeza local */
          }
        }
        set({ items: [], appliedCoupon: null, couponError: null, busyItems: [] });
      },

      // ------------------------------ Cupom (R13) ---------------------------
      async applyCoupon(code, subtotal) {
        const trimmed = code.trim().toUpperCase();
        if (!trimmed) {
          set({ couponError: 'Digite um código.' });
          return false;
        }
        set({ couponLoading: true, couponError: null });
        try {
          const result = await couponService.validate(trimmed, subtotal);
          if (!result.valid) {
            set({ couponLoading: false, couponError: result.message, appliedCoupon: null });
            return false;
          }
          set({
            couponLoading: false,
            couponError: null,
            appliedCoupon: {
              code: result.code,
              discountType: result.discountType ?? 'PERCENTAGE',
              discountValue: result.discountValue ?? 0,
              discountAmount: result.discountAmount,
              freeShipping: result.freeShipping,
              message: result.message,
            },
          });
          return true;
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Não foi possível aplicar o cupom.';
          set({ couponLoading: false, couponError: msg, appliedCoupon: null });
          return false;
        }
      },

      removeCoupon() {
        set({ appliedCoupon: null, couponError: null });
      },
      clearCoupon() {
        set({ appliedCoupon: null, couponError: null });
      },

      /** Revalida o cupom contra o subtotal atual; remove se ficou inválido. */
      async revalidateCoupon(subtotal) {
        const current = get().appliedCoupon;
        if (!current) return;
        try {
          const result = await couponService.validate(current.code, subtotal);
          if (!result.valid) {
            set({ appliedCoupon: null, couponError: result.message });
            return;
          }
          set({
            appliedCoupon: {
              ...current,
              discountAmount: result.discountAmount,
              freeShipping: result.freeShipping,
              message: result.message,
            },
            couponError: null,
          });
        } catch {
          // Falha de rede: mantém o cupom; o backend revalida no pedido.
        }
      },

      count() {
        return get().items.reduce((sum, i) => sum + i.qty, 0);
      },
    }),
    {
      name: '3dc-cart',
      // Persistimos o cupom (cache visual) e só os itens de VISITANTE — os da
      // conta vêm sempre da API.
      partialize: (s) => ({
        appliedCoupon: s.appliedCoupon,
        items: s.items.filter((i) => isGuestItem(i.variationId)),
      }),
    },
  ),
);

// -----------------------------------------------------------------------------
// Helpers de cálculo (mantidos para os componentes que já os importam)
// -----------------------------------------------------------------------------

export function getCartSubtotal(items: CartItem[], products: Product[]): number {
  return items.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.productId);
    if (!p) return sum;
    return sum + getEffectivePrice(p) * it.qty;
  }, 0);
}

/** Desconto em R$ para exibição. `discountAmount` vem revalidado do backend. */
export function getCartDiscount(subtotal: number, coupon?: AppliedCoupon | null): number {
  if (!coupon) return 0;
  if (coupon.freeShipping) return 0; // frete grátis não desconta no subtotal
  // Clampa ao subtotal para nunca exibir total negativo.
  return Number(Math.min(coupon.discountAmount, subtotal).toFixed(2));
}

/**
 * ESTIMATIVA de frete (PAC) para o carrinho/drawer. O valor real vem do
 * backend (/api/public/shipping/options) no checkout e é recalculado na
 * criação do pedido. `threshold` = "frete grátis acima de" do admin.
 */
export function getCartShipping(
  subtotal: number,
  coupon?: AppliedCoupon | null,
  threshold: number = site.freeShippingThreshold,
): number {
  if (coupon?.freeShipping) return 0;
  if (threshold > 0 && subtotal >= threshold) return 0;
  return 24.9;
}
