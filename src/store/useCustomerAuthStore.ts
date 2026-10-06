/**
 * Store de autenticação do cliente final — R9.
 *
 * Fala com o backend real (JWT). Não guarda senha em localStorage.
 * O JWT fica em `localStorage['3dc-token-customer']` (gerenciado por api.ts).
 * O endereço padrão vive no backend (/api/me/address) — o localStorage é só
 * cache para a primeira renderização.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authService } from '@/services/authService';
import { ApiError, getStoredToken, setAuthToken } from '@/services/api';
import type { ApiAddress, ApiUser } from '@/services/types';
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

function apiAddressToInternal(a: ApiAddress): CustomerAddress {
  return {
    cep: a.zipCode.replace(/^(\d{5})(\d{3})$/, '$1-$2'),
    street: a.street,
    number: a.number,
    complement: a.complement ?? undefined,
    district: a.district,
    city: a.city,
    state: a.state,
  };
}

function addressToApi(a: CustomerAddress) {
  return {
    zipCode: a.cep,
    street: a.street,
    number: a.number,
    complement: a.complement || null,
    district: a.district,
    city: a.city,
    state: a.state,
  };
}

/** Busca o endereço padrão no backend (best-effort: falha não desloga). */
async function fetchDefaultAddress(): Promise<CustomerAddress | undefined> {
  try {
    const { address } = await authService.getAddress();
    return address ? apiAddressToInternal(address) : undefined;
  } catch {
    return undefined;
  }
}

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  defaultAddress?: CustomerAddress;
}

type CustomerPatch = Partial<Omit<Customer, 'id' | 'password' | 'createdAt'>>;

interface CustomerAuthState {
  /** Sempre uma lista com no máximo 1 (o próprio) — mantido pra compat com telas antigas. */
  customers: Customer[];
  currentCustomerId: string | null;
  loading: boolean;

  init: () => Promise<void>;
  registerCustomer: (data: RegisterInput) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  loginCustomer: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logoutCustomer: () => void;
  /** Salva no backend (nome/telefone e endereço padrão). Devolve o resultado real. */
  updateCustomer: (patch: CustomerPatch) => Promise<{ ok: boolean; error?: string }>;
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
          c.defaultAddress = await fetchDefaultAddress();
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
          if (data.defaultAddress) {
            // Endereço informado no cadastro vai para o backend; se falhar,
            // a conta já existe — o cliente revisa em "Minha conta".
            try {
              const { address } = await authService.saveAddress(addressToApi(data.defaultAddress));
              c.defaultAddress = apiAddressToInternal(address);
            } catch {
              c.defaultAddress = undefined;
            }
          }
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
          c.defaultAddress = await fetchDefaultAddress();
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
        if (!id) return { ok: false, error: 'Faça login novamente.' };
        try {
          let next: Partial<Customer> = {};
          if (patch.name !== undefined || patch.phone !== undefined) {
            const { user } = await authService.updateMe({
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            });
            next = apiUserToInternal(user);
          }
          if (patch.defaultAddress) {
            const { address } = await authService.saveAddress(addressToApi(patch.defaultAddress));
            next.defaultAddress = apiAddressToInternal(address);
          }
          set({ customers: get().customers.map((c) => (c.id === id ? { ...c, ...next } : c)) });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof ApiError ? err.message : 'Não foi possível salvar seus dados.' };
        }
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
