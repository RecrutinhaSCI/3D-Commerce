import { api } from './api';
import type { ApiShippingOptions } from './types';

/**
 * Opções de entrega calculadas no backend (fonte única da regra de frete).
 * Só exibição — o valor cobrado é recalculado na criação do pedido.
 */
export const shippingService = {
  getOptions(subtotal: number, freeShipping = false) {
    return api.get<ApiShippingOptions>('/api/public/shipping/options', {
      anonymous: true,
      query: { subtotal: Number(subtotal.toFixed(2)), freeShipping },
    });
  },
};
