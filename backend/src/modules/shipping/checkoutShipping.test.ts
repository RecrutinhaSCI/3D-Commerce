/**
 * Regras do checkout (frontend, src/utils/checkoutShipping.ts) que evitam
 * mostrar frete errado: CEP completo, cotação amarrada a CEP + carrinho +
 * cupom e modalidade que respeita a escolha do cliente.
 */
import { describe, expect, it } from 'vitest';
import { effectiveShippingMethod, isCompleteCep, shippingQuoteKey } from '../../../../src/utils/checkoutShipping';

const opt = (method: 'PAC' | 'SEDEX' | 'PICKUP') => ({ method, label: method, deadline: '', price: 0 });

describe('isCompleteCep', () => {
  it('exige exatamente 8 dígitos (a máscara conta o hífen)', () => {
    expect(isCompleteCep('01310-100')).toBe(true);
    expect(isCompleteCep('01310100')).toBe(true);
    expect(isCompleteCep('12345-67')).toBe(false); // 8 caracteres, 7 dígitos
    expect(isCompleteCep('1234')).toBe(false);
    expect(isCompleteCep('')).toBe(false);
    expect(isCompleteCep(null)).toBe(false);
  });
});

describe('shippingQuoteKey — cotação antiga nunca vale', () => {
  const items = [{ productId: 'b', qty: 1 }, { productId: 'a', qty: 2 }];
  const base = shippingQuoteKey('01310-100', items, null);

  it('independe da máscara e da ordem dos itens', () => {
    expect(shippingQuoteKey('01310100', [...items].reverse(), null)).toBe(base);
  });

  it('muda com CEP, quantidade, item e cupom', () => {
    expect(shippingQuoteKey('69005-000', items, null)).not.toBe(base);
    expect(shippingQuoteKey('01310-100', [{ productId: 'b', qty: 2 }, { productId: 'a', qty: 2 }], null)).not.toBe(base);
    expect(shippingQuoteKey('01310-100', [{ productId: 'a', qty: 2 }], null)).not.toBe(base);
    expect(shippingQuoteKey('01310-100', items, 'FRETEGRATIS')).not.toBe(base);
  });
});

describe('effectiveShippingMethod — escolha do cliente preservada', () => {
  const full = { options: [opt('PAC'), opt('SEDEX'), opt('PICKUP')] };
  const pickupOnly = { options: [opt('PICKUP')] };

  it('usa a preferida quando existe na cotação', () => {
    expect(effectiveShippingMethod('SEDEX', full)).toBe('SEDEX');
  });

  it('indisponível → primeira opção (retirada), sem perder a preferência', () => {
    expect(effectiveShippingMethod('PAC', pickupOnly)).toBe('PICKUP');
    // Cotação voltou: a preferida (PAC) volta a valer — a retirada não "gruda".
    expect(effectiveShippingMethod('PAC', full)).toBe('PAC');
  });

  it('sem cotação ainda: mantém a preferida', () => {
    expect(effectiveShippingMethod('SEDEX', null)).toBe('SEDEX');
  });

  it('Sedex sumiu da cotação → primeira disponível', () => {
    expect(effectiveShippingMethod('SEDEX', { options: [opt('PAC'), opt('PICKUP')] })).toBe('PAC');
  });
});
