/**
 * Store de autenticação do cliente final — R9.
 *
 * Fala com o backend real (JWT). Não guarda senha em localStorage.
 * O JWT fica em `localStorage['3dc-token-customer']` (gerenciado por api.ts).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '@/services/authService';
import { ApiError, getStoredToken, setAuthToken } from '@/services/api';
import type { ApiUser } from '@/services/types';
import type { Customer, CustomerAddress } from '@/types';
import { useCartStore } from '@/store/useCartStore';

function apiUserToInternal(u: ApiUser): Customer {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
    password: '',
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
  };
}

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  defaultAddress?: CustomerAddress;
}

interface CustomerAuthState {
  /** Sempre uma lista com no máximo 1 (o próprio) — mantido pra compat com telas antigas. */
  customers: Customer[];
  currentCustomerId: string | null;
  loading: boolean;

  init: () => Promise<void>;
  registerCustomer: (data: RegisterInput) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  loginCustomer: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logoutCustomer: () => void;
  updateCustomer: (patch: Partial<Omit<Customer, 'id' | 'password' | 'createdAt'>>) => void;
}

export const useCustomerAuthStore = create<CustomerAuthState>()(
  persist(
    (set, get) => ({
      customers: [],
      currentCustomerId: null,
      loading: false,

      async init() {
        const token = getStoredToken('customer');
        if (!token) return;
        try {
          const { user } = await authService.me(token);
          if (user.role !== 'CUSTOMER') {
            setAuthToken('customer', null);
            return;
          }
          const c = apiUserToInternal(user);
          set({ customers: [c], currentCustomerId: c.id });
        } catch {
          setAuthToken('customer', null);
          set({ customers: [], currentCustomerId: null });
        }
      },

      async registerCustomer(data) {
        try {
          const { user, token } = await authService.register({
            name: data.name,
            email: data.email,
            password: data.password,
            phone: data.phone,
          });
          setAuthToken('customer', token);
          const c = apiUserToInternal(user);
          if (data.defaultAddress) c.defaultAddress = data.defaultAddress;
          set({ customers: [c], currentCustomerId: c.id });
          // Puxa carrinho vazio recém-criado para o cliente novo.
          void useCartStore.getState().fetch();
          return { ok: true, customer: c };
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Erro ao criar conta.';
          return { ok: false, error: msg };
        }
      },

      async loginCustomer(email, password) {
        try {
          const { user, token } = await authService.login(email, password);
          if (user.role !== 'CUSTOMER') {
            return { ok: false, error: 'Esta conta não é de cliente.' };
          }
          setAuthToken('customer', token);
          const c = apiUserToInternal(user);
          set({ customers: [c], currentCustomerId: c.id });
          void useCartStore.getState().fetch();
          return { ok: true };
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'E-mail ou senha inválidos.';
          return { ok: false, error: msg };
        }
      },

      logoutCustomer() {
        setAuthToken('customer', null);
        set({ customers: [], currentCustomerId: null });
        useCartStore.getState().reset();
      },

      async updateCustomer(patch) {
        const id = get().currentCustomerId;
        if (!id) return;

        // 1) Salva mudanças reais no backend (name/phone). O endpoint aceita
        //    só esses dois campos — os demais (endereço padrão) ficam locais.
        const remotePayload: { name?: string; phone?: string } = {};
        if (patch.name !== undefined) remotePayload.name = patch.name;
        if (patch.phone !== undefined) remotePayload.phone = patch.phone;

        if (remotePayload.name !== undefined || remotePayload.phone !== undefined) {
          try {
            const { user } = await authService.updateMe(remotePayload);
            const remote = apiUserToInternal(user);
            set({
              customers: get().customers.map((c) =>
                c.id === id ? { ...c, ...remote, defaultAddress: patch.defaultAddress ?? c.defaultAddress } : c,
              ),
            });
            return;
          } catch {
            // cai para atualização otimista local abaixo
          }
        }

        // 2) Campos que ficam locais (defaultAddress).
        set({
          customers: get().customers.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        });
      },
    }),
    { name: '3dc-customer-auth', partialize: (s) => ({ customers: s.customers, currentCustomerId: s.currentCustomerId }) },
  ),
);

export function useCurrentCustomer(): Customer | null {
  const id = useCustomerAuthStore((s) => s.currentCustomerId);
  const customers = useCustomerAuthStore((s) => s.customers);
  if (!id) return null;
  return customers.find((c) => c.id === id) ?? null;
}
