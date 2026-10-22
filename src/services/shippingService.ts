import { api } from './api';
import type { ApiShippingQuote } from './types';

/**
 * Frete calculado no backend (fonte única da regra). A cotação usa o carrinho
 * do usuário logado no servidor + o CEP; a criação do pedido recalcula com a
 * MESMA regra e recusa (409 SHIPPING_CHANGED) se o valor mudou.
 */
export const shippingService = {
  quote(cep: string, couponCode?: string | null) {
    return api.post<ApiShippingQuote>('/api/shipping/quote', { cep, couponCode: couponCode ?? null });
  },
};
