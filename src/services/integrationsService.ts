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
}

export const integrationsService = {
  sandboxQuote(cep: string, couponFreeShipping: boolean, missingMeasures: boolean, aboveThreshold: boolean) {
    return api.post<ApiShippingQuote>('/api/admin/integrations/melhor-envio/sandbox/quote', {
      cep, couponFreeShipping,
      items: [{ productId: 'admin-simulation', quantity: 1, unitPrice: aboveThreshold ? 10000 : 100,
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
