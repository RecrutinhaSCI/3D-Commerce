import { describe, expect, it } from 'vitest';
import type { PosProduct } from '@/services/posService';
import { addFreeItem, addProduct, cartTotals, changeFor, parseScan, removeLine, setQuantity, toSaleItems, type CartLine } from './posCart';

const product = (id: string, stock: number, price = 10): PosProduct => ({
  id, name: `Produto ${id}`, sku: id, barcode: null, stock, price, active: true, brand: null, material: null, color: null, category: null,
});

function added(cart: CartLine[], p: PosProduct, qty = 1) {
  const r = addProduct(cart, p, qty);
  if (!r.ok) throw new Error(r.error);
  return r.cart;
}

describe('carrinho do PDV', () => {
  it('bipar o mesmo produto soma a quantidade numa linha', () => {
    const cart = added(added([], product('A', 5)), product('A', 5), 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it('não passa do estoque ao adicionar nem ao alterar quantidade', () => {
    const cart = added([], product('A', 2), 2);
    expect(addProduct(cart, product('A', 2)).ok).toBe(false);
    expect(addProduct([], product('B', 0)).ok).toBe(false);
    expect(setQuantity(cart, cart[0].key, 3).ok).toBe(false);
    expect(setQuantity(cart, cart[0].key, 1).ok).toBe(true);
  });

  it('quantidade inválida é recusada', () => {
    const cart = added([], product('A', 5));
    for (const q of [0, -1, 1.5, NaN]) expect(setQuantity(cart, cart[0].key, q).ok).toBe(false);
  });

  it('item livre não depende de estoque e nunca agrupa', () => {
    const one = addFreeItem([], { description: 'Serviço', quantity: 100, unitPrice: 5 });
    if (!one.ok) throw new Error();
    const two = addFreeItem(one.cart, { description: 'Serviço', quantity: 1, unitPrice: 5 });
    if (!two.ok) throw new Error();
    expect(two.cart).toHaveLength(2);
    expect(toSaleItems(two.cart)[0]).toEqual({ type: 'free', description: 'Serviço', quantity: 100, unitPrice: 5 });
  });

  it('remove só a linha indicada', () => {
    const cart = added(added([], product('A', 5)), product('B', 5));
    expect(removeLine(cart, cart[0].key).map((l) => l.name)).toEqual(['Produto B']);
  });

  it('totais em centavos, sem erro de ponto flutuante', () => {
    const cart = added([], product('A', 9, 0.1), 3);
    expect(cartTotals(cart, 0)).toMatchObject({ items: 3, subtotal: 0.3, total: 0.3 });
    expect(cartTotals(cart, 0.1).total).toBe(0.2);
  });

  it('desconto nunca deixa o total negativo', () => {
    expect(cartTotals(added([], product('A', 5, 10)), 50)).toMatchObject({ discount: 10, total: 0 });
  });

  it('payload de produto só leva id e quantidade (preço é do backend)', () => {
    expect(toSaleItems(added([], product('A', 5), 2))).toEqual([{ type: 'product', productId: 'A', quantity: 2 }]);
  });
});

describe('leitura', () => {
  it('código puro e multiplicador', () => {
    expect(parseScan(' 789123 ')).toEqual({ code: '789123', quantity: 1 });
    expect(parseScan('3*789123')).toEqual({ code: '789123', quantity: 3 });
    expect(parseScan('filamento pla')).toEqual({ code: 'filamento pla', quantity: 1 });
  });
});

describe('troco', () => {
  it('calcula, e devolve null quando o valor não cobre', () => {
    expect(changeFor(90, 100)).toBe(10);
    expect(changeFor(90, 90)).toBe(0);
    expect(changeFor(90, 80)).toBeNull();
    expect(changeFor(90, null)).toBeNull();
  });
});
