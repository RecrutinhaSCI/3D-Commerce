import { api } from './api';

/** Status da conexão OAuth com o Melhor Envio — o backend NUNCA devolve token. */
export interface ApiMelhorEnvioStatus {
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
