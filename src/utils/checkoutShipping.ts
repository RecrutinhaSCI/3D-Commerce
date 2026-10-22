/**
 * Regras puras da escolha de frete no checkout (sem React), testadas em
 * backend/src/modules/shipping/checkoutShipping.test.ts.
 */
import type { ApiShippingMethod, ApiShippingQuote } from '@/services/types';

/** CEP com exatamente 8 dígitos (com ou sem máscara). */
export function isCompleteCep(cep: string | null | undefined): boolean {
  return (cep ?? '').replace(/\D/g, '').length === 8;
}

/**
 * Identidade da cotação: CEP + carrinho (produto:quantidade) + cupom. Uma
 * cotação calculada para outra combinação nunca vale para a tela atual.
 */
export function shippingQuoteKey(cep: string, items: Array<{ productId: string; qty: number }>, couponCode: string | null): string {
  const cart = items.map((i) => `${i.productId}:${i.qty}`).sort().join('|');
  return `${cep.replace(/\D/g, '')}|${cart}|${couponCode ?? ''}`;
}

/**
 * Modalidade efetiva: a que o cliente escolheu, ou — só enquanto ela não
 * existir na cotação — a primeira disponível. A escolha do cliente é
 * preservada: quando a cotação volta, a preferida volta a valer.
 */
export function effectiveShippingMethod(
  preferred: ApiShippingMethod,
  quote: Pick<ApiShippingQuote, 'options'> | null,
): ApiShippingMethod {
  if (!quote || quote.options.some((o) => o.method === preferred)) return preferred;
  return quote.options[0]?.method ?? preferred;
}
