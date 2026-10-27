// @vitest-environment jsdom
/**
 * Card "Remetente das etiquetas": pré-preenche pela sugestão, mostra o estado
 * das travas vindo do backend, envia só os campos do remetente e exibe os
 * erros de campo do 422. Serviço mockado — nenhuma rede.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApiShippingLabelsConfig, ApiShippingSender } from '@/services/shippingLabelsService';
import { ApiError } from '@/services/api';

const svc = vi.hoisted(() => ({ sender: vi.fn(), config: vi.fn(), saveSender: vi.fn() }));
vi.mock('@/services/shippingLabelsService', () => ({ shippingLabelsService: svc }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const { ShippingSenderCard } = await import('./ShippingSenderCard');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SENDER: ApiShippingSender = {
  name: 'Loja Teste', document: '11222333000181', stateRegister: '1234567890', economicActivityCode: null,
  phone: '54999990000', email: 'loja@t.test', postalCode: '95700000', address: 'Rua A', number: '10',
  complement: null, district: 'Centro', city: 'Bento Gonçalves', stateAbbr: 'RS',
};
const config = (p: Partial<ApiShippingLabelsConfig> = {}): ApiShippingLabelsConfig => ({
  enabled: false, environment: 'sandbox', isTest: true, purchaseAllowed: false, blockedReason: 'x',
  sender: { declaration: false, nfe: false, issues: [] }, ...p,
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

async function render() {
  root = createRoot(host);
  await act(async () => root!.render(<ShippingSenderCard />));
}
const input = (name: string) => host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
function type(name: string, value: string) {
  const el = input(name);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const submit = () => act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

describe('ShippingSenderCard', () => {
  it('sem cadastro: pré-preenche pela sugestão e avisa; travas desligadas', async () => {
    svc.sender.mockResolvedValue({ sender: null, suggestion: { ...SENDER, address: '', city: '' }, readiness: { declaration: false, nfe: false, issues: [] } });
    svc.config.mockResolvedValue(config());
    await render();
    expect(input('name').value).toBe('Loja Teste');
    expect(input('postalCode').value).toBe('95700000');
    expect(host.textContent).toContain('Ainda não cadastrado');
    expect(host.textContent).toContain('Etiquetas desligadas');
    expect(svc.saveSender).not.toHaveBeenCalled();
  });

  it('Sandbox ligado: selo de etiqueta de TESTE', async () => {
    svc.sender.mockResolvedValue({ sender: SENDER, suggestion: null, readiness: { declaration: true, nfe: true, issues: [] } });
    svc.config.mockResolvedValue(config({ enabled: true, purchaseAllowed: true }));
    await render();
    expect(host.textContent).toContain('Sandbox — etiquetas de teste');
    expect(host.querySelector('[data-testid="sender-readiness"]')!.textContent).toMatch(/NF-e:\s*pronto/);
  });

  it('salvar envia SÓ os campos do remetente (vazios opcionais → null)', async () => {
    svc.sender.mockResolvedValue({ sender: SENDER, suggestion: null, readiness: { declaration: true, nfe: true, issues: [] } });
    svc.config.mockResolvedValue(config({ enabled: true, purchaseAllowed: true }));
    svc.saveSender.mockImplementation(async (s: ApiShippingSender) => ({ sender: s, suggestion: null, readiness: { declaration: true, nfe: false, issues: ['Envio com NF-e exige a inscrição estadual do remetente.'] } }));
    await render();
    type('stateRegister', '');
    type('city', 'Garibaldi');
    await submit();
    expect(svc.saveSender).toHaveBeenCalledTimes(1);
    const sent = svc.saveSender.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(Object.keys(SENDER).sort());
    expect(sent).toMatchObject({ city: 'Garibaldi', stateRegister: null, complement: null, economicActivityCode: null });
    expect(host.textContent).toContain('exige a inscrição estadual');
  });

  it('422 do backend: mostra o erro no campo', async () => {
    svc.sender.mockResolvedValue({ sender: SENDER, suggestion: null, readiness: { declaration: true, nfe: true, issues: [] } });
    svc.config.mockResolvedValue(config());
    svc.saveSender.mockRejectedValue(
      new ApiError(422, { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: { fieldErrors: { document: ['CPF ou CNPJ inválido.'] } } }),
    );
    await render();
    await submit();
    expect(host.textContent).toContain('CPF ou CNPJ inválido.');
  });

  it('falha ao carregar: mensagem de erro, sem formulário', async () => {
    svc.sender.mockRejectedValue(new Error('rede'));
    svc.config.mockResolvedValue(config());
    await render();
    expect(host.textContent).toContain('Não foi possível carregar o remetente');
    expect(host.querySelector('[name="name"]')).toBeNull();
  });
});
