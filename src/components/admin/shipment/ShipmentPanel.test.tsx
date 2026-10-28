// @vitest-environment jsdom
/**
 * Painel "Expedição / Melhor Envio": estados, botões SÓ de availableActions,
 * modal de compra com os valores do backend, payloads sem campos proibidos,
 * download bloqueado sem confirmação, erros sempre traduzidos e layout
 * mobile básico. Serviço mockado — nenhuma rede.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/services/api';
import type { ApiLabelOverview, ApiShipmentLabel } from '@/services/shippingLabelsService';

const svc = vi.hoisted(() => ({
  overview: vi.fn(), prepare: vi.fn(), requestConfirmation: vi.fn(), purchase: vi.fn(), reconcile: vi.fn(), generate: vi.fn(),
  sync: vi.fn(), cancellable: vi.fn(), cancel: vi.fn(), discard: vi.fn(), addNote: vi.fn(), file: vi.fn(),
}));
vi.mock('@/services/shippingLabelsService', () => ({ shipmentLabelService: svc }));

const { ShipmentPanel, IN_PROGRESS_POLL_MS } = await import('./ShipmentPanel');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// -----------------------------------------------------------------------------

const FUTURE = '2099-01-01T00:00:00.000Z';
const label = (p: Partial<ApiShipmentLabel> = {}): ApiShipmentLabel => ({
  id: 'lab1', orderId: 'o1', status: 'AWAITING_CONFIRMATION', environment: 'sandbox', isTest: true,
  service: { id: 1, name: 'PAC' }, carrier: 'Correios',
  values: { customerShippingValue: 24.9, quotedPrice: 23.45, paidPrice: null, difference: -1.45, differenceBasis: 'quoted' },
  package: { weightKg: 1.2, widthCm: 20, heightCm: 10, lengthCm: 30, source: 'admin' }, declaredValue: 212.3,
  fiscal: { mode: 'DECLARATION', nfeKeyEnd: null }, tracking: { code: null, melhorEnvio: null, orderSync: 'SANDBOX_NEVER' },
  file: { requestedAt: null, verifiedAt: null, downloadable: false, sandboxPrintLimited: true },
  pendingConfirmation: { price: 23.45, expiresAt: FUTURE },
  dates: { createdAt: '2026-10-28T12:00:00.000Z', preparedAt: '2026-10-28T12:00:00.000Z', purchasedAt: null, generatedAt: null, postedAt: null, deliveredAt: null, canceledAt: null, lastSyncedAt: null },
  cancelReason: null, lastError: null, requiresReconciliation: false, inProgress: false,
  availableActions: ['REQUEST_CONFIRMATION', 'PURCHASE', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE'],
  canPurchase: true, canGenerate: false, canCancel: false, canDiscard: true,
  ...p,
});
const overview = (l: ApiShipmentLabel | null, p: Partial<ApiLabelOverview> = {}): ApiLabelOverview => ({
  order: {
    id: 'o1', paid: true, canceled: false, serviceSupported: true, customerShippingValue: 24.9, shippingMethod: 'PAC',
    deadlineDays: 5, destinationCep: '01310100', recipientDocumentMissing: false,
    packageSuggestion: { package: { weightKg: 0.8, widthCm: 15, heightCm: 8, lengthCm: 22 }, itemsMissingData: 0 },
    sender: { declaration: true, nfe: true, issues: [] },
  },
  config: { enabled: true, environment: 'sandbox', isTest: true, purchaseAllowed: true },
  label: l,
  availableActions: l ? l.availableActions : ['PREPARE'],
  history: [],
  ...p,
});
const CONFIRMATION = { token: 'TOKEN-UNICO-1', price: 23.45, customerShippingValue: 24.9, difference: -1.45, expiresAt: FUTURE };

const PURCHASED = label({
  status: 'PURCHASED', pendingConfirmation: null,
  values: { customerShippingValue: 24.9, quotedPrice: 23.45, paidPrice: 23.45, difference: -1.45, differenceBasis: 'paid' },
  availableActions: ['GENERATE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE'],
});
const READY = label({
  ...PURCHASED, status: 'LABEL_READY', tracking: { code: 'AB123456789BR', melhorEnvio: null, orderSync: 'SANDBOX_NEVER' },
  file: { requestedAt: FUTURE, verifiedAt: FUTURE, downloadable: true, sandboxPrintLimited: true },
  availableActions: ['DOWNLOAD', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'RECONCILE', 'ADD_NOTE'],
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
  document.body.innerHTML = '';
  root = null;
  vi.useRealTimers();
});

async function render(ov: ApiLabelOverview) {
  svc.overview.mockResolvedValue(ov);
  root = createRoot(host);
  await act(async () => root!.render(<ShipmentPanel orderId="o1" />));
}
const text = () => document.body.textContent ?? '';
const actionButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[data-action]')].map((b) => b.dataset.action);
const btn = (action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

// -----------------------------------------------------------------------------

describe('estados do painel', () => {
  it('sem etiqueta: "Não preparada", Sandbox avisado, só Preparar', async () => {
    await render(overview(null));
    expect(byTestId('label-status')!.textContent).toBe('Não preparada');
    expect(byTestId('label-status')!.dataset.tone).toBe('gray');
    expect(byTestId('sandbox-banner')!.textContent).toContain('Ambiente de teste — nenhuma postagem real será gerada.');
    expect(actionButtons()).toEqual(['PREPARE']);
    expect(text()).toContain('01310-100');
    expect(text()).toContain('até 5 dias úteis');
  });

  it('preparada: confirmar preço e descartar', async () => {
    await render(overview(label({ status: 'PREPARED', pendingConfirmation: null, availableActions: ['REQUEST_CONFIRMATION', 'DISCARD_UNPAID', 'ADD_NOTE'] })));
    expect(byTestId('label-status')!.dataset.tone).toBe('blue');
    expect(actionButtons()).toEqual(['REQUEST_CONFIRMATION', 'DISCARD_UNPAID', 'ADD_NOTE']);
  });

  it('aguardando confirmação: valores cobrado/custo/diferença visíveis', async () => {
    await render(overview(label()));
    const v = byTestId('label-values')!.textContent!;
    expect(v).toMatch(/Frete cobrado do cliente\s*R\$\s*24,90/);
    expect(v).toMatch(/Custo atual da etiqueta\s*R\$\s*23,45/);
    expect(byTestId('label-difference')!.textContent).toMatch(/\+\s*R\$\s*1,45/);
    expect(actionButtons()).toEqual(['PURCHASE', 'REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE']);
  });

  it('comprando (lease ativo): processamento claro, botões travados, acompanha pelo backend', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render(overview(label({ status: 'PURCHASING', inProgress: true, pendingConfirmation: null, availableActions: ['ADD_NOTE'] })));
    expect(byTestId('label-status')!.textContent).toBe('Compra em processamento');
    expect(byTestId('label-status')!.dataset.tone).toBe('yellow');
    expect(byTestId('busy')!.textContent).toContain('Operação em andamento');
    expect(btn('ADD_NOTE').disabled).toBe(true);
    expect(svc.overview).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(IN_PROGRESS_POLL_MS));
    expect(svc.overview).toHaveBeenCalledTimes(2);
  });

  it('precisa reconciliação: aviso e só "Verificar no Melhor Envio"', async () => {
    await render(overview(label({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true, pendingConfirmation: null, lastError: { code: 'TIMEOUT', message: 'x' }, availableActions: ['RECONCILE', 'ADD_NOTE'] })));
    expect(byTestId('needs-reconciliation')!.textContent).toContain('Nada é comprado de novo automaticamente');
    expect(actionButtons()).toEqual(['RECONCILE', 'ADD_NOTE']);
  });

  it('comprada: preço pago e diferença real; gerar/cancelar', async () => {
    await render(overview(PURCHASED));
    expect(byTestId('label-status')!.dataset.tone).toBe('green');
    expect(byTestId('label-values')!.textContent).toMatch(/Preço pago\s*R\$\s*23,45/);
    expect(actionButtons()).toEqual(['GENERATE', 'RECONCILE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'ADD_NOTE']);
  });

  it('geração em andamento: sem download, aviso de geração', async () => {
    await render(overview(label({ ...PURCHASED, status: 'GENERATING', inProgress: true, availableActions: ['ADD_NOTE'] })));
    expect(byTestId('label-status')!.textContent).toBe('Gerando etiqueta');
    expect(actionButtons()).not.toContain('DOWNLOAD');
    expect(actionButtons()).not.toContain('PRINT');
  });

  it('pronta mas arquivo ainda não confirmado pelo ME: download BLOQUEADO', async () => {
    await render(overview(label({ ...READY, file: { ...READY.file, downloadable: false, verifiedAt: null }, availableActions: ['SYNC_STATUS', 'CANCEL', 'RECONCILE', 'ADD_NOTE'] })));
    expect(byTestId('file-pending')!.textContent).toContain('Etiqueta ainda sendo gerada');
    expect(actionButtons()).not.toContain('DOWNLOAD');
    expect(actionButtons()).not.toContain('PRINT');
  });

  it('etiqueta pronta: baixar e imprimir; rastreio de teste não vai para o pedido', async () => {
    await render(overview(READY));
    expect(actionButtons()).toEqual(['DOWNLOAD', 'RECONCILE', 'SYNC_STATUS', 'CHECK_CANCELLABLE', 'CANCEL', 'ADD_NOTE', 'PRINT']);
    expect(text()).toContain('AB123456789BR');
    expect(text()).toContain('não é copiado para o pedido');
  });

  it('cancelada: histórico, e só preparar outra', async () => {
    await render(overview(null, { history: [{ id: 'l0', status: 'CANCELED', environment: 'sandbox', isTest: true, paidPrice: 23.45, trackingCode: null, cancelReason: 'Cliente desistiu', createdAt: FUTURE, canceledAt: FUTURE }] }));
    expect(text()).toContain('Etiquetas anteriores (1)');
    expect(text()).toContain('Cancelada');
    expect(text()).toContain('Cliente desistiu');
    expect(actionButtons()).toEqual(['PREPARE']);
  });

  it('erro: mensagem NOSSA pelo código, nunca a mensagem guardada', async () => {
    await render(overview(label({ status: 'ERROR', pendingConfirmation: null, lastError: { code: 'VALIDATION', message: 'RAW <b>erro</b> do ME 52998224725' }, availableActions: ['REQUEST_CONFIRMATION', 'RECONCILE', 'DISCARD_UNPAID', 'ADD_NOTE'] })));
    expect(byTestId('label-status')!.dataset.tone).toBe('red');
    expect(byTestId('last-error')!.textContent).toContain('O Melhor Envio recusou os dados da etiqueta');
    expect(text()).not.toContain('RAW');
    expect(text()).not.toContain('52998224725');
  });

  it('produção: sem faixa de teste', async () => {
    await render(overview(label({ ...READY, environment: 'production', isTest: false }), { config: { enabled: true, environment: 'production', isTest: false, purchaseAllowed: true } }));
    expect(byTestId('sandbox-banner')).toBeNull();
    expect(byTestId('env-production')!.textContent).toContain('Produção');
  });

  it('botão SÓ se availableActions permitir (mesmo com status "pronta")', async () => {
    await render(overview(label({ ...READY, availableActions: ['ADD_NOTE'] })));
    expect(actionButtons()).toEqual(['ADD_NOTE']);
  });

  it('travas desligadas: aviso e nenhum botão de compra', async () => {
    await render(overview(null, { availableActions: [], config: { enabled: false, environment: 'sandbox', isTest: true, purchaseAllowed: false } }));
    expect(text()).toContain('desligadas no servidor');
    expect(host.querySelector('[data-testid="label-actions"]')).toBeNull();
  });
});

describe('preparação e compra', () => {
  it('preparar: pré-preenche a caixa sugerida e envia SÓ caixa + fiscal; abre a confirmação', async () => {
    await render(overview(null));
    svc.prepare.mockResolvedValue({ ...overview(label()), confirmation: CONFIRMATION, warnings: ['Destinatário sem CPF/CNPJ: o Melhor Envio pode exigir o documento.'] });
    await click(btn('PREPARE'));
    const input = (n: string) => document.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
    expect(input('weightKg').value).toBe('0.8');
    expect(input('lengthCm').value).toBe('22');
    expect(byTestId('prepare-warnings')!.textContent).toContain('Caixa sugerida');
    await act(async () => byTestId('prepare-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(svc.prepare).toHaveBeenCalledWith('o1', { package: { weightKg: 0.8, heightCm: 8, widthCm: 15, lengthCm: 22 }, fiscal: { mode: 'DECLARATION' } });
    expect(byTestId('purchase-modal')).not.toBeNull();
    expect(text()).toContain('Destinatário sem CPF/CNPJ');
  });

  it('caixa inválida (422): erro no campo, modal continua aberto', async () => {
    await render(overview(null));
    svc.prepare.mockRejectedValue(new ApiError(422, { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: { fieldErrors: { weightKg: ['Peso: máximo de 30 kg.'] } } }));
    await click(btn('PREPARE'));
    await act(async () => byTestId('prepare-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(text()).toContain('Peso: máximo de 30 kg.');
    expect(text()).toContain('Caixa inválida: confira peso');
    expect(byTestId('prepare-form')).not.toBeNull();
  });

  it.each([
    [-1.45, 'green', /\+\s*R\$\s*1,45/, 'fica com'],
    [0, 'gray', /R\$\s*0,00/, 'Empatado'],
    [0.2, 'red', /−\s*R\$\s*0,20/, 'a mais do que cobrou'],
  ])('modal de compra: diferença %s → %s', async (difference, tone, value, explanation) => {
    await render(overview(label()));
    svc.requestConfirmation.mockResolvedValue({ ...overview(label()), confirmation: { ...CONFIRMATION, difference, price: 24.9 + difference } });
    await click(btn('PURCHASE'));
    const d = byTestId('confirm-difference')!;
    expect(d.dataset.tone).toBe(tone);
    expect(d.textContent).toMatch(value);
    expect(d.textContent).toContain(explanation);
    expect(byTestId('confirm-customer')!.textContent).toMatch(/24,90/);
    expect(text()).toContain('Serviço');
    expect(text()).toContain('Correios');
  });

  it('comprar envia SÓ (pedido, etiqueta, token); duplo clique compra uma vez; token não é reusado', async () => {
    await render(overview(label()));
    svc.requestConfirmation.mockResolvedValue({ ...overview(label()), confirmation: CONFIRMATION });
    let release!: (v: unknown) => void;
    svc.purchase.mockReturnValue(new Promise((r) => (release = r)));
    await click(btn('PURCHASE'));
    const confirm = byTestId('confirm-purchase')!;
    await click(confirm);
    await click(confirm);
    expect(svc.purchase).toHaveBeenCalledTimes(1);
    expect(svc.purchase.mock.calls[0]).toEqual(['o1', 'lab1', 'TOKEN-UNICO-1']);
    expect(text()).toContain('Compra em processamento…');
    await act(async () => release(overview(READY)));
    expect(byTestId('label-status')!.textContent).toBe('Etiqueta pronta');
    expect(byTestId('notice')!.textContent).toContain('comprada e gerada');
  });

  it('preço alterado: modal reabre com o novo preço e o NOVO token', async () => {
    await render(overview(label()));
    svc.requestConfirmation.mockResolvedValue({ ...overview(label()), confirmation: CONFIRMATION });
    const fresh = { ...CONFIRMATION, token: 'TOKEN-NOVO-2', price: 25.1, difference: 0.2 };
    svc.purchase.mockRejectedValueOnce(new ApiError(409, { code: 'PRICE_CHANGED', message: 'x', details: { previousPrice: 23.45, price: 25.1, confirmation: fresh } }));
    await click(btn('PURCHASE'));
    await click(byTestId('confirm-purchase')!);
    expect(byTestId('purchase-modal')!.textContent).toMatch(/O preço mudou de R\$\s*23,45 para R\$\s*25,10/);
    expect(byTestId('confirm-price')!.textContent).toMatch(/25,10/);
    svc.purchase.mockResolvedValueOnce(overview(READY));
    await click(byTestId('confirm-purchase')!);
    expect(svc.purchase.mock.calls[1]).toEqual(['o1', 'lab1', 'TOKEN-NOVO-2']);
  });

  it('resposta ambígua no checkout: aviso amarelo de verificação, sem nova tentativa', async () => {
    await render(overview(label()));
    svc.requestConfirmation.mockResolvedValue({ ...overview(label()), confirmation: CONFIRMATION });
    svc.purchase.mockResolvedValue({
      ...overview(label({ status: 'NEEDS_RECONCILIATION', requiresReconciliation: true, availableActions: ['RECONCILE', 'ADD_NOTE'] })),
      error: { code: 'TIMEOUT', outcome: 'unknown', requiresReconciliation: true, message: 'raw', externalMessage: null, fields: [] },
    });
    await click(btn('PURCHASE'));
    await click(byTestId('confirm-purchase')!);
    expect(byTestId('notice')!.dataset.testid).toBe('notice');
    expect(byTestId('notice')!.textContent).toContain('Nada será repetido automaticamente');
    expect(svc.purchase).toHaveBeenCalledTimes(1);
    expect(actionButtons()).toEqual(['RECONCILE', 'ADD_NOTE']);
  });
});

describe('download, erros e mobile', () => {
  it('baixar: pede o PDF autenticado ao backend (nenhuma URL do ME)', async () => {
    const createObjectURL = vi.fn(() => 'blob:local');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await render(overview(READY));
    svc.file.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await click(btn('DOWNLOAD'));
    expect(svc.file).toHaveBeenCalledWith('o1', 'attachment');
    expect(createObjectURL).toHaveBeenCalled();
    expect(byTestId('notice')!.textContent).toContain('Download da etiqueta iniciado');
    expect(anchorClick).toHaveBeenCalled();
    anchorClick.mockRestore();
  });

  it('download recusado (ainda gerando / Sandbox): mensagem clara e estado relido', async () => {
    await render(overview(READY));
    svc.file.mockRejectedValueOnce(new ApiError(409, { code: 'LABEL_NOT_GENERATED', message: 'x' }));
    await click(btn('DOWNLOAD'));
    expect(byTestId('notice')!.textContent).toContain('Etiqueta ainda sendo gerada');
    expect(svc.overview).toHaveBeenCalledTimes(2);
    svc.file.mockRejectedValueOnce(new ApiError(409, { code: 'SANDBOX_PRINT_UNAVAILABLE', message: 'x' }));
    await click(btn('PRINT'));
    expect(byTestId('notice')!.textContent).toContain('não gera o PDF de etiquetas dos Correios');
  });

  it.each([
    ['ORDER_NOT_PAID', 'não está pago'],
    ['PICKUP_ORDER', 'retirada na loja'],
    ['SENDER_MISSING', 'Remetente incompleto'],
    ['NEEDS_RECONNECT', 'precisa ser refeita'],
    ['FORBIDDEN', 'escopo faltando'],
    ['PURCHASE_IN_PROGRESS', 'compra desta etiqueta em andamento'],
    ['NEEDS_RECONCILIATION', 'verifique a etiqueta no Melhor Envio'],
    ['NOT_CANCELLABLE', 'não permite cancelar'],
  ])('erro %s → mensagem específica', async (code, expected) => {
    await render(overview(PURCHASED));
    svc.generate.mockRejectedValue(new ApiError(409, { code, message: '<script>raw da API</script>' }));
    await click(btn('GENERATE'));
    expect(byTestId('notice')!.textContent!.toLowerCase()).toContain(expected.toLowerCase());
    expect(text()).not.toContain('raw da API');
  });

  it('código desconhecido, saldo insuficiente e rate limit: nunca o texto bruto', async () => {
    await render(overview(PURCHASED));
    svc.generate.mockRejectedValueOnce(new ApiError(500, { code: 'ALGO_NOVO', message: 'stack trace secreto' }));
    await click(btn('GENERATE'));
    expect(byTestId('notice')!.textContent).toBe('Não foi possível concluir a operação.');
    svc.generate.mockResolvedValueOnce({ ...overview(PURCHASED), error: { code: 'VALIDATION', outcome: 'rejected', requiresReconciliation: false, message: 'x', externalMessage: 'Saldo insuficiente para a compra', fields: [] } });
    await click(btn('GENERATE'));
    expect(byTestId('notice')!.textContent).toContain('Saldo insuficiente na carteira');
    expect(text()).not.toContain('para a compra');
    svc.generate.mockRejectedValueOnce(new ApiError(429, { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente em 40 segundos.' }));
    await click(btn('GENERATE'));
    expect(byTestId('notice')!.textContent).toContain('Tente novamente em 40 segundos.');
  });

  it('cancelar exige motivo e envia SÓ etiqueta + motivo', async () => {
    await render(overview(READY));
    svc.cancel.mockResolvedValue(overview(null));
    await click(btn('CANCEL'));
    const area = document.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    const submit = [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].pop()!;
    expect(submit.disabled).toBe(true);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(area, 'Cliente desistiu');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(submit);
    expect(svc.cancel).toHaveBeenCalledWith('o1', 'lab1', 'Cliente desistiu');
  });

  it('mobile: botões empilham, valores importantes visíveis, nada força largura', async () => {
    await render(overview(READY));
    const actions = byTestId('label-actions')!;
    expect(actions.className).toContain('flex-col');
    expect(actions.className).toContain('sm:flex-row');
    expect(byTestId('shipment-panel')!.className).toContain('min-w-0');
    for (const dd of byTestId('label-values')!.querySelectorAll('dd')) expect(dd.className).toContain('break-words');
    expect(byTestId('label-values')!.textContent).toMatch(/Diferença/);
  });
});
