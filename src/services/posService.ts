import { api } from './api';
import type { ApiPagination } from './types';

export type PosPaymentMethod = 'CASH' | 'PIX' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'OTHER';

export const PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  DEBIT_CARD: 'Cartão Débito',
  CREDIT_CARD: 'Cartão Crédito',
  OTHER: 'Outro',
};

export type StockMovementType =
  | 'ECOMMERCE_SALE' | 'POS_SALE' | 'INTERNAL_USE' | 'MANUAL_ADJUSTMENT' | 'RETURN' | 'CANCELLATION' | 'CORRECTION' | 'IMPORT';

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ECOMMERCE_SALE: 'E-commerce',
  POS_SALE: 'PDV',
  INTERNAL_USE: 'Uso interno',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
  RETURN: 'Devolução',
  CANCELLATION: 'Cancelamento',
  CORRECTION: 'Correção',
  IMPORT: 'Importação',
};

export interface PosProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  price: number;
  active: boolean;
  brand: string | null;
  material: string | null;
  color: string | null;
  category: string | null;
}

export interface CashSession {
  id: string;
  number: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedByName: string;
  openedById: string | null;
  openingCash: number;
  openingNote: string | null;
  closedAt: string | null;
  closedByName: string | null;
  salesCount: number;
  totalSold: number;
}

export type SaleItemPayload =
  | { type: 'product'; productId: string; quantity: number }
  | { type: 'free'; description: string; quantity: number; unitPrice: number };

export interface SalePayload {
  clientRequestId: string;
  items: SaleItemPayload[];
  discount: number;
  paymentMethod: PosPaymentMethod;
  amountReceived?: number | null;
  customerId?: string | null;
  notes?: string | null;
  expectedTotal?: number;
}

export interface PosSaleItem {
  id: string;
  productId: string | null;
  isFreeItem: boolean;
  description: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  netTotal: number;
  returnedQuantity: number;
}

export interface PosSale {
  id: string;
  number: number;
  label: string;
  cashSessionId: string;
  customerId: string | null;
  customerName: string | null;
  operatorName: string;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PosPaymentMethod;
  amountReceived: number | null;
  changeAmount: number | null;
  notes: string | null;
  status: 'COMPLETED' | 'CANCELED';
  canceledAt: string | null;
  canceledByName: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: PosSaleItem[];
  refundedTotal: number;
}

export interface ReportMovementRow {
  seq: number;
  at: string;
  type: StockMovementType;
  source: string;
  delta: number;
  before: number;
  after: number;
  reference: string | null;
  orderId: string | null;
  note: string | null;
  userName: string | null;
}

export interface ReportProductRow {
  productId: string;
  name: string;
  sku: string | null;
  initial: number;
  ecommerce: number;
  pos: number;
  internalUse: number;
  adjustments: number;
  returns: number;
  final: number;
  expectedFinal: number;
  discrepancy: number;
  movements: ReportMovementRow[];
}

export interface SessionReport {
  generatedAt: string;
  session: {
    id: string; number: number; status: 'OPEN' | 'CLOSED'; openedAt: string; openedByName: string; openingNote: string | null;
    closedAt: string | null; closedByName: string | null; closingNote: string | null;
  };
  summary: {
    salesCount: number; totalSold: number; subtotal: number; discounts: number; averageTicket: number; itemsSold: number;
    freeItemsCount: number; freeItemsTotal: number; canceledCount: number; canceledTotal: number; refundsCount: number;
    refundsTotal: number; netAfterRefunds: number;
  };
  payments: Array<{ method: PosPaymentMethod; count: number; total: number; refunds: number; net: number }>;
  cash: { opening: number; expected: number; counted: number | null; difference: number | null };
  stock: {
    products: ReportProductRow[];
    totals: { ecommerce: number; pos: number; internalUse: number; adjustments: number; returns: number };
    productsMoved: number;
    discrepancies: number;
    untracked: Array<{ productId: string; name: string; sku: string | null; initial: number; final: number }>;
  };
  sales: Array<{
    id: string; number: number; createdAt: string; status: 'COMPLETED' | 'CANCELED'; total: number; discount: number;
    paymentMethod: PosPaymentMethod; customerName: string | null; operatorName: string; itemsCount: number;
  }>;
  returns: Array<{ id: string; number: number; saleNumber: number; createdAt: string; refund: number; refundMethod: PosPaymentMethod; reason: string; operatorName: string }>;
}

export interface StockMovement {
  id: string;
  seq: number;
  productId: string;
  productName: string;
  productSku: string | null;
  type: StockMovementType;
  source: string;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  userName: string | null;
  note: string | null;
  orderId: string | null;
  referenceLabel: string | null;
  createdAt: string;
}

/** Id de uma ação do operador: repetir a mesma ação não duplica no backend. */
export function newRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const posService = {
  currentSession: () => api.get<{ session: CashSession | null }>('/api/admin/pos/session/current'),
  openSession: (input: { openingCash: number; note?: string | null }) =>
    api.post<{ session: CashSession }>('/api/admin/pos/sessions', input),
  closeSession: (id: string, input: { countedCash?: number | null; note?: string | null }) =>
    api.post<{ session: CashSession; report: SessionReport }>(`/api/admin/pos/sessions/${id}/close`, input),
  listSessions: (query?: { page?: number; limit?: number }) =>
    api.get<{ sessions: CashSession[]; pagination: ApiPagination }>('/api/admin/pos/sessions', { query }),
  getSession: (id: string) =>
    api.get<{ session: CashSession; report: SessionReport; live: boolean }>(`/api/admin/pos/sessions/${id}`),
  searchProducts: (query: { q?: string; category?: string; brand?: string; material?: string; limit?: number }) =>
    api.get<{ products: PosProduct[] }>('/api/admin/pos/products/search', { query }),
  lookupProduct: (code: string) =>
    api.get<{ product: PosProduct | null }>('/api/admin/pos/products/lookup', { query: { code } }),
  createSale: (input: SalePayload) => api.post<{ sale: PosSale; idempotent: boolean }>('/api/admin/pos/sales', input),
  getSale: (id: string) => api.get<{ sale: PosSale }>(`/api/admin/pos/sales/${id}`),
  cancelSale: (id: string, reason: string) =>
    api.post<{ sale: PosSale }>(`/api/admin/pos/sales/${id}/cancel`, { reason }),
  createReturn: (id: string, input: { clientRequestId: string; reason: string; items: Array<{ saleItemId: string; quantity: number }> }) =>
    api.post<{ return: { id: string; refundAmount: number } }>(`/api/admin/pos/sales/${id}/returns`, input),
  internalUse: (input: { clientRequestId: string; productId: string; quantity: number; note?: string | null }) =>
    api.post<{ movement: StockMovement }>('/api/admin/stock/internal-use', input),
  listMovements: (query?: { search?: string; type?: StockMovementType; page?: number; limit?: number }) =>
    api.get<{ movements: StockMovement[]; pagination: ApiPagination }>('/api/admin/stock/movements', { query }),
};
