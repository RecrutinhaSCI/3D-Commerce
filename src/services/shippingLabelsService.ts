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

// -----------------------------------------------------------------------------
// Etiqueta por pedido (Etapa 5). O backend decide TUDO: estado, preço, ações.
// -----------------------------------------------------------------------------

export type ApiLabelStatus =
  | 'PREPARED' | 'AWAITING_CONFIRMATION' | 'PURCHASING' | 'PURCHASED' | 'GENERATING' | 'LABEL_READY'
  | 'POSTED' | 'DELIVERED' | 'NEEDS_RECONCILIATION' | 'ERROR' | 'CANCELED' | 'CANCELING' | 'DISCARDED';

export type ApiLabelAction =
  | 'PREPARE' | 'REQUEST_CONFIRMATION' | 'PURCHASE' | 'RECONCILE' | 'GENERATE' | 'SYNC_STATUS'
  | 'DOWNLOAD' | 'CHECK_CANCELLABLE' | 'CANCEL' | 'DISCARD_UNPAID' | 'ADD_NOTE';

export interface ApiLabelPackage {
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
}

export interface ApiShipmentLabel {
  id: string;
  orderId: string;
  status: ApiLabelStatus;
  environment: string;
  isTest: boolean;
  service: { id: number; name: string | null };
  carrier: string | null;
  values: {
    customerShippingValue: number | null;
    quotedPrice: number | null;
    paidPrice: number | null;
    difference: number | null;
    differenceBasis: 'paid' | 'quoted' | null;
  };
  package: (ApiLabelPackage & { source: string }) | null;
  declaredValue: number | null;
  fiscal: { mode: 'DECLARATION' | 'NFE'; nfeKeyEnd: string | null };
  tracking: { code: string | null; melhorEnvio: string | null; orderSync: string };
  file: { requestedAt: string | null; verifiedAt: string | null; downloadable: boolean; sandboxPrintLimited: boolean };
  pendingConfirmation: { price: number | null; expiresAt: string } | null;
  dates: Record<'createdAt' | 'preparedAt' | 'purchasedAt' | 'generatedAt' | 'postedAt' | 'deliveredAt' | 'canceledAt' | 'lastSyncedAt', string | null>;
  cancelReason: string | null;
  lastError: { code: string; message: string | null } | null;
  requiresReconciliation: boolean;
  inProgress: boolean;
  availableActions: ApiLabelAction[];
  canPurchase: boolean;
  canGenerate: boolean;
  canCancel: boolean;
  canDiscard: boolean;
}

export interface ApiLabelConfirmation {
  /** Token de uso único — só existe na resposta que criou a confirmação. */
  token: string;
  price: number;
  customerShippingValue: number;
  difference: number;
  expiresAt: string;
}

/** Erro do Melhor Envio já sanitizado pelo backend. */
export interface ApiLabelMeError {
  code: string;
  outcome: 'not_sent' | 'rejected' | 'unknown';
  requiresReconciliation: boolean;
  message: string;
  externalMessage: string | null;
  fields: string[];
}

export interface ApiLabelOverview {
  order: {
    id: string;
    paid: boolean;
    canceled: boolean;
    serviceSupported: boolean;
    customerShippingValue: number | null;
    shippingMethod?: string | null;
    shippingServiceName?: string | null;
    shippingCarrier?: string | null;
    deadlineDays?: number | null;
    destinationCep?: string | null;
    trackingCode?: string | null;
    recipientDocumentMissing?: boolean;
    packageSuggestion?: { package: ApiLabelPackage | null; itemsMissingData: number };
    sender?: ApiSenderReadiness;
  };
  config: {
    enabled: boolean;
    environment: string;
    isTest: boolean;
    purchaseAllowed: boolean;
    /** Permissões OAuth para etiquetas: missing = reconexão necessária (backend já tirou as ações). */
    meAccess?: 'ok' | 'unverified' | 'missing';
    missingScopes?: string[];
  };
  label: ApiShipmentLabel | null;
  availableActions: ApiLabelAction[];
  history: Array<{ id: string; status: ApiLabelStatus; environment: string; isTest: boolean; paidPrice: number | null; trackingCode: string | null; cancelReason: string | null; createdAt: string; canceledAt: string | null }>;
  confirmation?: ApiLabelConfirmation;
  error?: ApiLabelMeError;
  warnings?: string[];
  cancellable?: boolean | null;
}

export interface PrepareLabelInput {
  package: ApiLabelPackage;
  fiscal: { mode: 'DECLARATION' } | { mode: 'NFE'; nfeKey: string };
  recipientDocument?: string | null;
}

const labelPath = (orderId: string, suffix = '') => `/api/admin/shipping-labels/orders/${encodeURIComponent(orderId)}/label${suffix}`;

export const shipmentLabelService = {
  overview: (orderId: string) => api.get<ApiLabelOverview>(labelPath(orderId)),
  prepare: (orderId: string, input: PrepareLabelInput) => api.post<ApiLabelOverview>(labelPath(orderId, '/prepare'), input),
  requestConfirmation: (orderId: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/confirmation'), {}),
  /** SÓ etiqueta + token: preço, serviço, ids e status são sempre relidos no backend. */
  purchase: (orderId: string, labelId: string, token: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/purchase'), { labelId, token }),
  reconcile: (orderId: string, reason?: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/reconcile'), reason ? { reason } : {}),
  generate: (orderId: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/generate'), {}),
  sync: (orderId: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/sync'), {}),
  cancellable: (orderId: string) => api.get<ApiLabelOverview>(labelPath(orderId, '/cancellable')),
  cancel: (orderId: string, labelId: string, reason: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/cancel'), { labelId, reason }),
  discard: (orderId: string, labelId: string, reason: string) => api.post<ApiLabelOverview>(labelPath(orderId, '/discard'), { labelId, reason }),
  addNote: (orderId: string, labelId: string, reason: string, evidence?: string) =>
    api.post<ApiLabelOverview>(labelPath(orderId, '/notes'), evidence ? { labelId, reason, evidence } : { labelId, reason }),
  /** PDF autenticado (o backend revalida no ME e baixa; nenhuma URL do ME chega aqui). */
  file: (orderId: string, disposition: 'inline' | 'attachment') => api.getBlob(labelPath(orderId, '/file'), { query: { disposition } }),
};

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
