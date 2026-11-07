// @vitest-environment jsdom
/**
 * Card "Melhor Envio" (Etapa 6): resumo Ambiente / OAuth / Cotação /
 * Etiquetas / Homologação vindo do backend, aviso de reconexão com os scopes
 * faltantes, botão de reconexão e avisos do retorno do callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ApiMelhorEnvioStatus } from '@/services/integrationsService';

const svc = vi.hoisted(() => ({ melhorEnvioStatus: vi.fn(), startMelhorEnvioAuthorization: vi.fn(), sandboxQuote: vi.fn(), sandboxRefresh: vi.fn() }));
vi.mock('@/services/integrationsService', () => ({ integrationsService: svc }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));

const { MelhorEnvioCard } = await import('./MelhorEnvioCard');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS = ['cart-write', 'orders-read', 'shipping-cancel', 'shipping-checkout', 'shipping-generate', 'shipping-print', 'shipping-tracking'];
const status = (p: Partial<ApiMelhorEnvioStatus> = {}): ApiMelhorEnvioStatus => ({
  homologationOnly: false, oauthConfigured: true, environment: 'sandbox', connected: true, needsReconnect: false,
  accessTokenExpiresAt: '2026-11-20T12:00:00.000Z', refreshTokenExpiresAt: null, lastRefreshedAt: null, connectedAt: null,
  lastError: null, usingManualToken: false, issues: [], quoteAvailable: true,
  scopes: { granted: ['shipping-calculate', ...LABELS], source: 'response', verified: true, required: { quote: ['shipping-calculate'], labels: LABELS }, missingForQuote: [], unknown: [] },
  missingScopes: [], needsReconnectForLabels: false, labelsScopesReady: true, labelsReady: true,
  labels: { readiness: 'ready', enabled: true, purchaseAllowed: true, blockedReason: null },
  ...p,
});

let root: Root | null = null;
let host: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});
async function render(s: ApiMelhorEnvioStatus, url = '/admin/configuracoes') {
  svc.melhorEnvioStatus.mockResolvedValue(s);
  root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter initialEntries={[url]}><MelhorEnvioCard /></MemoryRouter>));
}
const summary = () => host.querySelector('[data-testid="me-summary"]')!.textContent!;

describe('MelhorEnvioCard — permissões das etiquetas', () => {
  it('Sandbox completo: OAuth conectado, cotação disponível, permissões completas, homologação ativa', async () => {
    await render(status());
    expect(summary()).toMatch(/Ambiente\s*Sandbox/);
    expect(summary()).toMatch(/OAuth\s*Conectado/);
    expect(summary()).toMatch(/Cotação\s*Disponível/);
    expect(summary()).toMatch(/Etiquetas\s*Permissões completas/);
    expect(summary()).toMatch(/Homologação\s*Ativa/);
    expect(host.querySelector('[data-testid="me-reconnect-labels"]')).toBeNull();
  });

  it('conexão antiga só com cotação: "Reconexão necessária", scopes faltantes e cotação continua disponível', async () => {
    await render(status({
      scopes: { ...status().scopes, granted: ['shipping-calculate'], source: 'legacy' },
      missingScopes: LABELS, needsReconnectForLabels: true, labelsScopesReady: false, labelsReady: false,
      labels: { readiness: 'reconnect_required', enabled: true, purchaseAllowed: true, blockedReason: null },
    }));
    const box = host.querySelector('[data-testid="me-reconnect-labels"]')!.textContent!;
    expect(box).toContain('Reconexão necessária para habilitar geração de etiquetas.');
    expect(box).toContain('shipping-checkout');
    expect(box).toContain('cotação não para');
    expect(summary()).toMatch(/Cotação\s*Disponível/);
    expect(summary()).toMatch(/Etiquetas\s*Reconexão necessária/);
    expect(summary()).toMatch(/Homologação\s*Inativa/);
  });

  it('botão "Reconectar Melhor Envio" inicia o OAuth existente (backend pede os scopes)', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    svc.startMelhorEnvioAuthorization.mockResolvedValue({ authorizationUrl: 'https://sandbox.melhorenvio.com.br/oauth/authorize?x=1', environment: 'sandbox', expiresAt: '' });
    await render(status({ needsReconnectForLabels: true, missingScopes: ['cart-write'], labels: { readiness: 'reconnect_required', enabled: true, purchaseAllowed: true, blockedReason: null } }));
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent!.includes('Reconectar Melhor Envio'))!;
    await act(async () => btn.click());
    expect(svc.startMelhorEnvioAuthorization).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://sandbox.melhorenvio.com.br/oauth/authorize?x=1');
  });

  it.each([
    ['scopes_unverified', 'não confirmadas'],
    ['disabled', 'desligadas no servidor'],
    ['production_blocked', 'compra em produção bloqueada'],
  ] as const)('%s → texto próprio; homologação inativa', async (readiness, text) => {
    await render(status({ labelsReady: false, labels: { readiness, enabled: readiness !== 'disabled', purchaseAllowed: false, blockedReason: 'x' } }));
    expect(host.querySelector('[data-testid="me-labels"]')!.textContent).toContain(text);
    expect(summary()).toMatch(/Homologação\s*Inativa/);
  });

  it('retorno do callback com permissões incompletas: avisa (não comemora)', async () => {
    await render(status(), '/admin/configuracoes?melhorEnvio=conectado&permissoes=incompletas');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('não concedeu todas as permissões'), expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('retorno do callback cancelado: mensagem de cancelamento', async () => {
    await render(status(), '/admin/configuracoes?melhorEnvio=erro&motivo=negado');
    expect(toast.error).toHaveBeenCalledWith('Autorização cancelada no Melhor Envio.', expect.anything());
  });
});
