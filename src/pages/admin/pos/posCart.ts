import type { PosProduct, SaleItemPayload } from '@/services/posService';

/** Regras do carrinho do PDV: puras e sem React. O backend revalida tudo. */

export interface ProductLine {
  key: string;
  kind: 'product';
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  /** Estoque visto na busca: só para avisar cedo; quem decide é o backend. */
  stock: number;
}

export interface FreeLine {
  key: string;
  kind: 'free';
  name: string;
  unitPrice: number;
  quantity: number;
}

export type CartLine = ProductLine | FreeLine;

export type CartResult = { ok: true; cart: CartLine[]; key: string } | { ok: false; error: string };

export const toCents = (v: number) => Math.round(v * 100);

export function addProduct(cart: CartLine[], product: PosProduct, quantity = 1): CartResult {
  const existing = cart.find((l): l is ProductLine => l.kind === 'product' && l.productId === product.id);
  const total = (existing?.quantity ?? 0) + quantity;
  if (total > product.stock) {
    return { ok: false, error: `Estoque insuficiente para "${product.name}" (disponível: ${product.stock}).` };
  }
  if (existing) {
    return { ok: true, key: existing.key, cart: cart.map((l) => (l === existing ? { ...existing, quantity: total, stock: product.stock, unitPrice: product.price } : l)) };
  }
  const key = `p:${product.id}`;
  return {
    ok: true,
    key,
    cart: [...cart, { key, kind: 'product', productId: product.id, name: product.name, sku: product.sku, unitPrice: product.price, quantity, stock: product.stock }],
  };
}

let freeSeq = 0;
export function addFreeItem(cart: CartLine[], item: { description: string; quantity: number; unitPrice: number }): CartResult {
  const key = `f:${++freeSeq}`;
  return { ok: true, key, cart: [...cart, { key, kind: 'free', name: item.description, unitPrice: item.unitPrice, quantity: item.quantity }] };
}

export function setQuantity(cart: CartLine[], key: string, quantity: number): CartResult {
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: 'Quantidade inválida.' };
  const line = cart.find((l) => l.key === key);
  if (!line) return { ok: false, error: 'Selecione um item.' };
  if (line.kind === 'product' && quantity > line.stock) {
    return { ok: false, error: `Estoque insuficiente para "${line.name}" (disponível: ${line.stock}).` };
  }
  return { ok: true, key, cart: cart.map((l) => (l.key === key ? { ...l, quantity } : l)) };
}

export function removeLine(cart: CartLine[], key: string): CartLine[] {
  return cart.filter((l) => l.key !== key);
}

export const lineTotal = (l: CartLine) => (toCents(l.unitPrice) * l.quantity) / 100;

export function cartTotals(cart: CartLine[], discount: number) {
  const subtotalCents = cart.reduce((acc, l) => acc + toCents(l.unitPrice) * l.quantity, 0);
  const discountCents = Math.min(toCents(discount), subtotalCents);
  return {
    items: cart.reduce((acc, l) => acc + l.quantity, 0),
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    total: (subtotalCents - discountCents) / 100,
  };
}

export function toSaleItems(cart: CartLine[]): SaleItemPayload[] {
  return cart.map((l) =>
    l.kind === 'product'
      ? { type: 'product', productId: l.productId, quantity: l.quantity }
      : { type: 'free', description: l.name, quantity: l.quantity, unitPrice: l.unitPrice },
  );
}

/** Entrada do leitor: "código" ou "3*código" (quantidade antes do código). */
export function parseScan(raw: string): { code: string; quantity: number } {
  const value = raw.trim();
  const match = value.match(/^(\d{1,4})\*(.+)$/);
  if (!match) return { code: value, quantity: 1 };
  return { code: match[2].trim(), quantity: Math.max(1, Number(match[1])) };
}

/** Troco em dinheiro, ou null enquanto o valor recebido não cobre o total. */
export function changeFor(total: number, received: number | null): number | null {
  if (received === null || !Number.isFinite(received)) return null;
  const change = toCents(received) - toCents(total);
  return change >= 0 ? change / 100 : null;
}
