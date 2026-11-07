import { api } from './api';
import type { ApiShippingQuote } from './types';

/** Status da conexão OAuth com o Melhor Envio — o backend NUNCA devolve token. */
export interface ApiMelhorEnvioStatus {
  homologationOnly: boolean;
  oauthConfigured: boolean;
  environment: 'sandbox' | 'production';
  connected: boolean;
  needsReconnect: boolean;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
  usingManualToken: boolean;
  issues: string[];
  /** Etapa 6 — tudo calculado no backend; o front só exibe. */
  quoteAvailable: boolean;
  scopes: {
    granted: string[] | null;
    /** response | token = confirmado pelo ME; requested = não confirmado; legacy = conexão antiga. */
    source: 'response' | 'token' | 'requested' | 'legacy' | null;
    verified: boolean;
    required: { quote: string[]; labels: string[] };
    missingForQuote: string[];
    unknown: string[];
  };
  missingScopes: string[];
  needsReconnectForLabels: boolean;
  labelsScopesReady: boolean;
  labelsReady: boolean;
  labels: {
    readiness: 'not_connected' | 'reconnect_required' | 'scopes_unverified' | 'disabled' | 'production_blocked' | 'ready';
    enabled: boolean;
    purchaseAllowed: boolean;
    blockedReason: string | null;
  };
}

export const integrationsService = {
  sandboxQuote(cep: string, couponFreeShipping: boolean, missingMeasures: boolean, aboveThreshold: boolean) {
    return api.post<ApiShippingQuote>('/api/admin/integrations/melhor-envio/sandbox/quote', {
      cep, couponFreeShipping,
      items: [{ productId: 'admin-simulation', quantity: 1, unitPrice: aboveThreshold ? 400 : 100,
        weight: missingMeasures ? null : 1, width: 20, height: 10, depth: 20 }],
    });
  },
  sandboxRefresh() {
    return api.post<ApiMelhorEnvioStatus>('/api/admin/integrations/melhor-envio/sandbox/refresh', {});
  },
  melhorEnvioStatus() {
    return api.get<ApiMelhorEnvioStatus>('/api/admin/integrations/melhor-envio/status');
  },
  /** Gera a URL de autorização (state de uso único, 10 min) — o front redireciona. */
  startMelhorEnvioAuthorization() {
    return api.post<{ authorizationUrl: string; environment: string; expiresAt: string }>(
      '/api/admin/integrations/melhor-envio/authorize',
      {},
    );
  },
};
