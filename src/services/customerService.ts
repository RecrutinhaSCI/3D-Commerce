import { api } from './api';
import type { ApiPagination } from './types';
import type { PosPaymentMethod } from './posService';

export interface Customer {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  notes: string | null;
  origin: 'ECOMMERCE' | 'POS';
  hasLogin: boolean;
  createdAt: string;
}

export interface CustomerRow extends Customer {
  purchaseCount: number;
  totalSpent: number;
  lastPurchaseAt: string | null;
}

export interface CustomerAddress {
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string | null;
  district?: string;
  city?: string;
  state?: string;
}

export interface CustomerDetail {
  customer: Customer & { address: CustomerAddress | null };
  stats: { purchaseCount: number; totalSpent: number; totalOnline: number; totalPos: number; lastPurchaseAt: string | null };
  orders: Array<{ id: string; createdAt: string; total: number; status: string; paymentStatus: string; items: Array<{ productName: string; quantity: number }> }>;
  posSales: Array<{ id: string; number: number; createdAt: string; total: number; status: 'COMPLETED' | 'CANCELED'; paymentMethod: PosPaymentMethod; items: Array<{ productName: string; quantity: number }> }>;
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  notes?: string | null;
}

export const customerService = {
  /** POST: o termo pode ser CPF/telefone e não deve aparecer em URL nem em log de acesso. */
  list: (query: { search?: string; page?: number; limit?: number } = {}) =>
    api.post<{ customers: CustomerRow[]; pagination: ApiPagination }>('/api/admin/customers/search', query),
  get: (id: string) => api.get<CustomerDetail>(`/api/admin/customers/${id}`),
  create: (input: CustomerInput) => api.post<{ customer: Customer }>('/api/admin/customers', input),
  update: (id: string, input: Partial<CustomerInput>) => api.put<{ customer: Customer }>(`/api/admin/customers/${id}`, input),
};
