import { api } from './api';

/** Remetente das etiquetas (dados da loja no `from` do Melhor Envio). Só admin. */
export interface ApiShippingSender {
  name: string;
  /** CPF ou CNPJ, só dígitos. */
  document: string;
  /** Só dígitos ou "ISENTO"; obrigatória para envio com NF-e. */
  stateRegister: string | null;
  economicActivityCode: string | null;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  stateAbbr: string;
}

export interface ApiSenderReadiness {
  declaration: boolean;
  nfe: boolean;
  issues: string[];
}

export interface ApiSenderResponse {
  sender: ApiShippingSender | null;
  /** Pré-preenchimento a partir das configurações da loja (quando não há cadastro). */
  suggestion: ApiShippingSender | null;
  readiness: ApiSenderReadiness;
}

/** Travas do servidor — o front só EXIBE; quem decide é o backend. */
export interface ApiShippingLabelsConfig {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  isTest: boolean;
  purchaseAllowed: boolean;
  blockedReason: string | null;
  sender: ApiSenderReadiness;
}

export const shippingLabelsService = {
  config() {
    return api.get<ApiShippingLabelsConfig>('/api/admin/shipping-labels/config');
  },
  sender() {
    return api.get<ApiSenderResponse>('/api/admin/shipping-labels/sender');
  },
  saveSender(sender: ApiShippingSender) {
    return api.put<ApiSenderResponse>('/api/admin/shipping-labels/sender', sender);
  },
};
