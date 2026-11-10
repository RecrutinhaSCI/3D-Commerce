// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { ApiError } from '@/services/api';
import type { CashSession, PosProduct, SessionReport } from '@/services/posService';

const service = vi.hoisted(() => ({
  currentSession: vi.fn(), openSession: vi.fn(), closeSession: vi.fn(), listSessions: vi.fn(), getSession: vi.fn(),
  searchProducts: vi.fn(), lookupProduct: vi.fn(), createSale: vi.fn(), getSale: vi.fn(), cancelSale: vi.fn(),
  createReturn: vi.fn(), internalUse: vi.fn(), listMovements: vi.fn(),
}));
const customers = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }));

vi.mock('@/services/posService', async (original) => ({ ...(await original<object>()), posService: service }));
vi.mock('@/services/customerService', () => ({ customerService: customers }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import Pos from './Pos';
import PosSessionDetail from './PosSessionDetail';
import Customers from '../Customers';

const session: CashSession = {
  id: 's1', number: 7, status: 'OPEN', openedAt: '2026-11-10T11:00:00Z', openedByName: 'Ana', openedById: 'u1', openingCash: 50,
  openingNote: null, closedAt: null, closedByName: null, salesCount: 0, totalSold: 0,
};
const product = (id: string, stock = 10, price = 25): PosProduct => ({
  id, name: `Produto ${id}`, sku: `SKU-${id}`, barcode: null, stock, price, active: true, brand: 'Marca', material: 'PLA', color: null, category: 'Filamentos',
});
const saleResult = { sale: { id: 'v1', label: 'PDV-1', total: 25, changeAmount: null } };

let host: HTMLDivElement;
let root: Root;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wait = (ms = 260) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function render(ui: React.ReactNode, path = '/admin/pdv') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>); });
  await flush();
}
const scanInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Leitura de produto"]')!;
const byLabel = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const text = () => document.body.textContent ?? '';

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function press(key: string, target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  await flush();
}
async function click(label: string | RegExp) {
  const matches = (el: Element) => {
    const t = el.textContent?.trim() ?? '';
    return typeof label === 'string' ? t === label : label.test(t);
  };
  const button = [...document.querySelectorAll('button')].filter(matches).pop();
  expect(button, `botão ${label}`).toBeTruthy();
  await act(async () => button!.click());
  await flush();
}
async function submit(el: Element) {
  await act(async () => { el.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}
async function scan(code: string) {
  await type(scanInput(), code);
  await submit(scanInput());
}

beforeEach(() => {
  vi.clearAllMocks();
  service.currentSession.mockResolvedValue({ session });
  service.lookupProduct.mockImplementation(async (code: string) => ({ product: code.startsWith('nao') ? null : product(code) }));
  service.searchProducts.mockResolvedValue({ products: [product('X')] });
  service.createSale.mockResolvedValue(saleResult);
  customers.list.mockResolvedValue({ customers: [{ id: 'c1', name: 'Maria', phone: '5499', email: null }], pagination: { page: 1, totalPages: 1, total: 1 } });
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe('PDV', () => {
  it('sem caixa aberto, pede a abertura e entra no terminal ao abrir', async () => {
    service.currentSession.mockResolvedValue({ session: null });
    service.openSession.mockResolvedValue({ session });
    await render(<Pos />);
    expect(text()).toContain('Abrir caixa');
    await type(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, '100,50');
    await click('Abrir caixa');
    expect(service.openSession).toHaveBeenCalledWith({ openingCash: 100.5, note: null });
    expect(scanInput()).toBeTruthy();
  });

  it('leitor: código + Enter adiciona, e bipes rápidos não se perdem', async () => {
    let release: () => void = () => {};
    service.lookupProduct.mockImplementationOnce(() => new Promise((r) => { release = () => r({ product: product('A') }); }));
    await render(<Pos />);
    await scan('A');
    await scan('B');
    expect(scanInput().value).toBe('');
    await act(async () => release());
    await flush();
    expect(text()).toContain('Produto A');
    expect(text()).toContain('Produto B');
  });

  it('multiplicador 3*código', async () => {
    await render(<Pos />);
    await scan('3*A');
    expect(service.lookupProduct).toHaveBeenCalledWith('A');
    expect(document.querySelector('tbody tr td:nth-child(2)')!.textContent).toBe('3');
  });

  it('texto que não é código abre a pesquisa com o termo', async () => {
    await render(<Pos />);
    await scan('nao-e-codigo');
    expect(byLabel('Pesquisar produto').value).toBe('nao-e-codigo');
  });

  it('avisa estoque insuficiente sem adicionar', async () => {
    service.lookupProduct.mockResolvedValue({ product: product('A', 0) });
    await render(<Pos />);
    await scan('A');
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Estoque insuficiente'));
    expect(document.querySelector('tbody')).toBeNull();
  });

  describe('produto inativo no e-commerce', () => {
    const MESSAGE = 'Este produto está inativo no e-commerce. Deseja continuar?';
    const inactive = (id = 'I') => ({ ...product(id), active: false });

    it('pergunta antes de adicionar, com foco seguro em Voltar', async () => {
      service.lookupProduct.mockResolvedValue({ product: inactive() });
      await render(<Pos />);
      await scan('I');
      expect(text()).toContain(MESSAGE);
      expect(document.activeElement?.textContent).toBe('Voltar');
      expect(document.querySelector('tbody')).toBeNull();
    });

    it('Continuar adiciona e a venda leva a confirmação', async () => {
      service.lookupProduct.mockResolvedValue({ product: inactive() });
      await render(<Pos />);
      await scan('I');
      await click('Continuar');
      expect(document.querySelector('tbody tr')).toBeTruthy();
      await wait(400);
      await press('F9');
      await click('Confirmar venda');
      expect(service.createSale.mock.calls[0][0].items).toEqual([{ type: 'product', productId: 'I', quantity: 1, confirmInactive: true }]);
    });

    it('Voltar e Esc não adicionam, e a leitura seguinte continua', async () => {
      service.lookupProduct.mockResolvedValueOnce({ product: inactive() }).mockResolvedValueOnce({ product: inactive() });
      await render(<Pos />);
      await scan('I');
      await click('Voltar');
      await wait(400);
      expect(document.querySelector('tbody')).toBeNull();
      await scan('I');
      await press('Escape');
      await wait(400);
      expect(document.querySelector('tbody')).toBeNull();
      await scan('A');
      expect(text()).toContain('Produto A');
    });

    it('bipar de novo o item já confirmado não pergunta outra vez', async () => {
      service.lookupProduct.mockResolvedValue({ product: inactive() });
      await render(<Pos />);
      await scan('I');
      await click('Continuar');
      await wait(400);
      await scan('I');
      await wait(400);
      expect(text()).not.toContain(MESSAGE);
      expect(document.querySelector('tbody tr td:nth-child(2)')!.textContent).toBe('2');
    });

    it('produto ativo não pergunta', async () => {
      await render(<Pos />);
      await scan('A');
      expect(text()).not.toContain(MESSAGE);
    });

    it('pela pesquisa F3 também pergunta', async () => {
      service.searchProducts.mockResolvedValue({ products: [inactive('Z')] });
      await render(<Pos />);
      await press('F3');
      await wait();
      await press('Enter', byLabel('Pesquisar produto'));
      expect(text()).toContain(MESSAGE);
      await click('Continuar');
      expect(document.querySelector('tbody tr')).toBeTruthy();
    });

    it('ficou inativo depois de entrar no carrinho: backend recusa e a tela pede confirmação', async () => {
      service.createSale.mockRejectedValueOnce(new ApiError(409, {
        code: 'INACTIVE_PRODUCT_NOT_CONFIRMED', message: 'x', details: { products: [{ id: 'A', name: 'Produto A' }] },
      }));
      await render(<Pos />);
      await scan('A');
      await press('F9');
      await click('Confirmar venda');
      expect(text()).toContain(MESSAGE);
      await click('Continuar');
      await wait(400);
      await press('F9');
      await click('Confirmar venda');
      expect(service.createSale.mock.calls[1][0].items[0]).toMatchObject({ productId: 'A', confirmInactive: true });
    });
  });

  it('F3 pesquisa e Enter adiciona o produto', async () => {
    await render(<Pos />);
    await press('F3');
    await wait();
    expect(service.searchProducts).toHaveBeenCalled();
    await press('Enter', byLabel('Pesquisar produto'));
    expect(text()).toContain('SKU-X');
    expect(document.querySelector('tbody tr')).toBeTruthy();
  });

  it('pesquisa filtra por categoria, marca e material', async () => {
    await render(<Pos />);
    await press('F3');
    await type(byLabel('Filtrar por marca'), 'Voolt');
    await type(byLabel('Filtrar por material'), 'PETG');
    await type(byLabel('Filtrar por categoria'), 'Filamentos');
    await wait();
    expect(service.searchProducts).toHaveBeenLastCalledWith(expect.objectContaining({ brand: 'Voolt', material: 'PETG', category: 'Filamentos' }));
  });

  it('F4 altera quantidade, F6 remove o item selecionado', async () => {
    await render(<Pos />);
    await scan('A');
    await press('F4');
    await type(byLabel('Quantidade'), '4');
    await submit(byLabel('Quantidade'));
    expect(document.querySelector('tbody tr td:nth-child(2)')!.textContent).toBe('4');
    await press('Escape');
    await wait();
    await press('F6');
    expect(document.querySelector('tbody')).toBeNull();
  });

  it('F2 volta o foco para a leitura', async () => {
    await render(<Pos />);
    (document.activeElement as HTMLElement | null)?.blur();
    await press('F2');
    expect(document.activeElement).toBe(scanInput());
  });

  it('F-keys ficam inertes com modal aberto e Esc fecha', async () => {
    await render(<Pos />);
    await press('F7');
    expect(text()).toContain('sem cadastro no catálogo');
    await press('F3');
    expect(service.searchProducts).not.toHaveBeenCalled();
    await press('Escape');
    await wait(400);
    expect(text()).not.toContain('sem cadastro no catálogo');
  });

  it('F7 item livre entra no total e vai como free no payload', async () => {
    await render(<Pos />);
    await press('F7');
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[role=dialog] input')];
    await type(inputs[0], 'Peça personalizada');
    await type(inputs[1], '2');
    await type(inputs[2], '35,50');
    await click('Adicionar à venda');
    await wait(400);
    expect(text()).toContain('Peça personalizada');
    await press('F9');
    await click('Confirmar venda');
    expect(service.createSale.mock.calls[0][0]).toMatchObject({
      items: [{ type: 'free', description: 'Peça personalizada', quantity: 2, unitPrice: 35.5 }],
      expectedTotal: 71,
    });
  });

  it('F10 vincula cliente à venda', async () => {
    await render(<Pos />);
    await scan('A');
    await press('F10');
    await wait();
    await press('Enter', byLabel('Buscar cliente'));
    await wait(400);
    expect(text()).toContain('Maria');
    await press('F9');
    await click('Confirmar venda');
    expect(service.createSale.mock.calls[0][0]).toMatchObject({ customerId: 'c1' });
  });

  it('F10: Enter no botão Novo não escolhe o primeiro da lista', async () => {
    await render(<Pos />);
    await press('F10');
    await wait();
    const novo = [...document.querySelectorAll('button')].find((b) => /Novo$/.test(b.textContent ?? ''))!;
    await press('Enter', novo);
    expect(text()).toContain('Cliente da venda');
    expect(text()).not.toContain('Maria · ');
  });

  describe('cliente dentro do pagamento', () => {
    async function typeNotes(value: string) {
      const area = document.querySelector<HTMLTextAreaElement>('[role=dialog] textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const notes = () => document.querySelector<HTMLTextAreaElement>('[role=dialog] textarea')!.value;
    const checked = () => document.querySelector('[role=radio][aria-checked=true]')!.textContent;

    async function fillPayment() {
      await scan('A');
      await press('F9');
      await click('Dinheiro');
      await type(byLabel('Desconto'), '5');
      await type(byLabel('Valor recebido'), '50');
      await typeNotes('Retira amanhã');
    }

    it('F10 escolhe o cliente, volta sem perder nada e a venda sai vinculada', async () => {
      await render(<Pos />);
      await fillPayment();
      expect(text()).toContain('Consumidor não identificado');
      expect(text()).toContain('Selecionar cliente · F10');
      await press('F10');
      await wait();
      expect(text()).toContain('Cliente da venda');
      await press('Enter', byLabel('Buscar cliente'));
      await wait(400);
      expect(text()).not.toContain('Cliente da venda');
      expect(text()).toContain('Maria');
      expect(text()).toContain('Trocar cliente · F10');
      expect([checked(), byLabel('Desconto').value, byLabel('Valor recebido').value, notes()]).toEqual(['Dinheiro', '5', '50', 'Retira amanhã']);
      expect(document.activeElement).toBe(byLabel('Valor recebido'));
      await click('Confirmar venda');
      expect(service.createSale.mock.calls[0][0]).toMatchObject({
        customerId: 'c1', paymentMethod: 'CASH', discount: 5, amountReceived: 50, notes: 'Retira amanhã', items: [{ type: 'product', productId: 'A', quantity: 1 }],
      });
    });

    it('funciona com o mouse', async () => {
      await render(<Pos />);
      await scan('A');
      await press('F9');
      await click(/Selecionar cliente/);
      await wait();
      await click(/^Maria/);
      await wait(400);
      expect(text()).toContain('Trocar cliente · F10');
    });

    it('Esc fecha só a busca e mantém o pagamento; cliente segue opcional', async () => {
      await render(<Pos />);
      await fillPayment();
      await press('F10');
      await wait();
      await press('Escape');
      await wait(400);
      expect(text()).not.toContain('Cliente da venda');
      expect(byLabel('Desconto').value).toBe('5');
      await click('Confirmar venda');
      expect(service.createSale.mock.calls[0][0]).toMatchObject({ customerId: null, discount: 5 });
    });

    it('cadastro rápido reaproveita o mesmo fluxo e volta ao pagamento', async () => {
      customers.create.mockResolvedValue({ customer: { id: 'c2', name: 'João Novo' } });
      await render(<Pos />);
      await fillPayment();
      await press('F10');
      await wait();
      await click(/Novo$/);
      await type(document.querySelector<HTMLInputElement>('[role=dialog] input[required]')!, 'João Novo');
      await click('Cadastrar e usar na venda');
      await wait(400);
      expect(text()).toContain('João Novo');
      expect(byLabel('Valor recebido').value).toBe('50');
      await click('Confirmar venda');
      expect(service.createSale.mock.calls[0][0]).toMatchObject({ customerId: 'c2' });
    });

    it('F10 segue inerte nos outros modais', async () => {
      await render(<Pos />);
      await press('F7');
      await press('F10');
      await wait();
      expect(text()).not.toContain('Cliente da venda');
    });
  });

  it('F10 cadastro rápido, sem login', async () => {
    customers.create.mockResolvedValue({ customer: { id: 'c2', name: 'João Novo' } });
    await render(<Pos />);
    await press('F10');
    await wait();
    await click(/Novo$/);
    const name = document.querySelector<HTMLInputElement>('[role=dialog] input[required]')!;
    await type(name, 'João Novo');
    await click('Cadastrar e usar na venda');
    expect(customers.create).toHaveBeenCalledWith({ name: 'João Novo', phone: null, email: null, document: null });
  });

  it('pagamento em dinheiro: desconto, recebido e troco; limpa a venda ao concluir', async () => {
    service.createSale.mockResolvedValue({ sale: { id: 'v1', label: 'PDV-1', total: 20, changeAmount: 30 } });
    await render(<Pos />);
    await scan('A');
    await press('F9');
    await click('Dinheiro');
    await type(byLabel('Desconto'), '5');
    await type(byLabel('Valor recebido'), '50');
    expect(text()).toContain('Troco');
    await click('Confirmar venda');
    expect(service.createSale.mock.calls[0][0]).toMatchObject({
      paymentMethod: 'CASH', discount: 5, amountReceived: 50, expectedTotal: 20, items: [{ type: 'product', productId: 'A', quantity: 1 }],
    });
    expect(text()).toContain('PDV-1');
    await click('Nova venda');
    await wait(400);
    expect(document.querySelector('tbody')).toBeNull();
  });

  it('valor recebido menor que o total bloqueia a confirmação', async () => {
    await render(<Pos />);
    await scan('A');
    await press('F9');
    await click('Dinheiro');
    await type(byLabel('Valor recebido'), '10');
    await click('Confirmar venda').catch(() => undefined);
    expect(service.createSale).not.toHaveBeenCalled();
  });

  it('falha de rede: tentar de novo reusa o id; recusa do servidor gera outro', async () => {
    service.createSale.mockRejectedValueOnce(new ApiError(0, { code: 'NETWORK_ERROR', message: 'rede' }));
    service.createSale.mockRejectedValueOnce(new ApiError(409, { code: 'INSUFFICIENT_STOCK', message: 'sem estoque' }));
    await render(<Pos />);
    await scan('A');
    await press('F9');
    await click('Confirmar venda');
    await click('Confirmar venda');
    await click('Confirmar venda');
    const ids = service.createSale.mock.calls.map((c) => c[0].clientRequestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
    expect(toast.error).toHaveBeenCalledWith('sem estoque');
  });

  it('F8 pede confirmação antes de descartar a venda', async () => {
    await render(<Pos />);
    await scan('A');
    await press('F8');
    expect(document.querySelector('tbody')).toBeTruthy();
    await click('Descartar venda');
    await wait(400);
    expect(document.querySelector('tbody')).toBeNull();
  });

  it('uso interno exige produto e registra sem virar venda', async () => {
    service.internalUse.mockResolvedValue({ movement: {} });
    await render(<Pos />);
    await click(/Uso interno/);
    await wait();
    await press('Enter', byLabel('Pesquisar produto'));
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[role=dialog] input')];
    await type(inputs[0], '2');
    await type(inputs[1], 'Produção interna');
    await click('Registrar uso interno');
    expect(service.internalUse).toHaveBeenCalledWith(expect.objectContaining({ productId: 'X', quantity: 2, note: 'Produção interna' }));
    expect(service.createSale).not.toHaveBeenCalled();
  });

  it('fechar caixa mostra o esperado e envia o contado', async () => {
    service.getSession.mockResolvedValue({ report: { summary: { salesCount: 2, totalSold: 90 }, cash: { expected: 140 } } });
    service.closeSession.mockResolvedValue({});
    await render(<Routes><Route path="/admin/pdv" element={<Pos />} /><Route path="/admin/pdv/historico/:id" element={<p>Relatório aberto</p>} /></Routes>);
    await click(/Fechar caixa$/);
    await flush();
    expect(text()).toContain('R$');
    const counted = document.querySelector<HTMLInputElement>('[role=dialog] input')!;
    await type(counted, '140');
    await submit(counted);
    expect(service.closeSession).toHaveBeenCalledWith('s1', { countedCash: 140, note: null });
    expect(text()).toContain('Relatório aberto');
  });

  it('fechar caixa fica bloqueado com venda em andamento', async () => {
    await render(<Pos />);
    await scan('A');
    const close = [...document.querySelectorAll('button')].find((b) => /Fechar caixa$/.test(b.textContent ?? ''))!;
    expect(close.disabled).toBe(true);
  });
});

const report = (over: Partial<SessionReport['stock']> = {}): SessionReport => ({
  generatedAt: '2026-11-10T21:00:00Z',
  session: { id: 's1', number: 7, status: 'CLOSED', openedAt: '2026-11-10T11:00:00Z', openedByName: 'Ana', openingNote: null, closedAt: '2026-11-10T21:00:00Z', closedByName: 'Ana', closingNote: null },
  summary: { salesCount: 1, totalSold: 500, subtotal: 500, discounts: 0, averageTicket: 500, itemsSold: 5, freeItemsCount: 0, freeItemsTotal: 0, canceledCount: 0, canceledTotal: 0, refundsCount: 0, refundsTotal: 0, netAfterRefunds: 500 },
  payments: [{ method: 'PIX', count: 1, total: 500, refunds: 0, net: 500 }],
  cash: { opening: 0, expected: 0, counted: null, difference: null },
  stock: {
    products: [{
      productId: 'p1', name: 'Filamento Preto', sku: 'F', initial: 20, ecommerce: -2, pos: -5, internalUse: -1, adjustments: 0, imports: 0, cancellations: 0, returns: 1, final: 13, expectedFinal: 13, discrepancy: 0,
      movements: [{ seq: 1, at: '2026-11-10T12:15:00Z', type: 'POS_SALE', source: 'POS', delta: -2, before: 20, after: 18, reference: 'Venda #PDV-104', orderId: null, note: null, userName: 'Ana' }],
    }],
    totals: { ecommerce: -2, pos: -5, internalUse: -1, adjustments: 0, imports: 0, cancellations: 0, returns: 1 },
    productsMoved: 1, discrepancies: 0, untracked: [], ...over,
  },
  sales: [{ id: 'v1', number: 104, createdAt: '2026-11-10T12:15:00Z', status: 'COMPLETED', total: 500, discount: 0, paymentMethod: 'PIX', customerName: null, operatorName: 'Ana', itemsCount: 5 }],
  returns: [],
});
const route = <Routes><Route path="/admin/pdv/historico/:id" element={<PosSessionDetail />} /></Routes>;

describe('fechamento', () => {
  it('mostra inicial, origens e final; expandir revela de onde saiu cada item', async () => {
    service.getSession.mockResolvedValue({ report: report(), live: false });
    await render(route, '/admin/pdv/historico/s1');
    const row = document.querySelector('tbody tr')!;
    expect([...row.querySelectorAll('td')].slice(1).map((td) => td.textContent)).toEqual(['20', '-2', '-5', '-1', '—', '—', '—', '+1', '13']);
    const detail = document.querySelector('[data-testid="stock-detail"]')!;
    expect(detail.className).toContain('hidden');
    expect(detail.className).toContain('print:table-row');
    await act(async () => (row as HTMLElement).click());
    expect(detail.className).not.toContain('hidden');
    expect(detail.textContent).toContain('Venda #PDV-104');
  });

  it('alerta divergência de estoque', async () => {
    service.getSession.mockResolvedValue({ report: report({ discrepancies: 1 }), live: false });
    await render(route, '/admin/pdv/historico/s1');
    expect(document.querySelector('[role=alert]')?.textContent).toContain('sem registro');
  });

  it('caixa fechado só oferece devolução; cancelar exige caixa aberto e motivo', async () => {
    const sale = { id: 'v1', label: 'PDV-104', status: 'COMPLETED', paymentMethod: 'PIX', operatorName: 'Ana', customerName: null, createdAt: '2026-11-10T12:15:00Z', total: 500, refundedTotal: 0, items: [{ id: 'i1', description: 'Filamento', quantity: 5, returnedQuantity: 0, unitPrice: 100, netTotal: 500, isFreeItem: false }] };
    service.getSale.mockResolvedValue({ sale });
    service.getSession.mockResolvedValue({ report: report(), live: false });
    await render(route, '/admin/pdv/historico/s1');
    await click(/PDV-104/);
    await flush();
    expect(text()).toContain('Devolver itens');
    expect(text()).not.toContain('Cancelar venda');
    await click('Devolver itens');
    service.createReturn.mockResolvedValue({ return: { refundAmount: 100 } });
    await type(byLabel('Quantidade a devolver de Filamento'), '1');
    await type(document.querySelectorAll<HTMLInputElement>('[role=dialog] input')[1], 'Defeito');
    await click('Confirmar devolução');
    expect(service.createReturn).toHaveBeenCalledWith('v1', expect.objectContaining({ reason: 'Defeito', items: [{ saleItemId: 'i1', quantity: 1 }] }));
  });

  it('caixa aberto permite cancelar com motivo', async () => {
    const sale = { id: 'v1', label: 'PDV-104', status: 'COMPLETED', paymentMethod: 'PIX', operatorName: 'Ana', customerName: null, createdAt: '2026-11-10T12:15:00Z', total: 500, refundedTotal: 0, items: [] };
    service.getSale.mockResolvedValue({ sale });
    service.cancelSale.mockResolvedValue({ sale });
    service.getSession.mockResolvedValue({ report: report(), live: true });
    await render(route, '/admin/pdv/historico/s1');
    await click(/PDV-104/);
    await flush();
    await click('Cancelar venda');
    await type(document.querySelector<HTMLInputElement>('[role=dialog] input')!, 'Erro');
    await click('Confirmar cancelamento');
    expect(service.cancelSale).toHaveBeenCalledWith('v1', 'Erro');
  });
});

describe('Clientes', () => {
  const row = { id: 'c1', userId: null, name: 'Maria', email: 'm@t.test', phone: '5499', document: null, notes: null, origin: 'POS', hasLogin: false, createdAt: '', purchaseCount: 2, totalSpent: 150, lastPurchaseAt: '2026-11-10T12:00:00Z' };

  it('lista, busca e abre o detalhe com históricos', async () => {
    customers.list.mockResolvedValue({ customers: [row], pagination: { page: 1, totalPages: 1, total: 1 } });
    customers.get.mockResolvedValue({
      customer: { ...row, document: '52998224725', address: { street: 'Rua A', number: '10', city: 'Passo Fundo', state: 'RS' } },
      stats: { purchaseCount: 2, totalSpent: 150, totalOnline: 100, totalPos: 50, lastPurchaseAt: '2026-11-10T12:00:00Z' },
      orders: [{ id: 'ordabc123', createdAt: '2026-11-09T12:00:00Z', total: 100, status: 'CONFIRMED', paymentStatus: 'PAID', items: [{ productName: 'PLA', quantity: 1 }] }],
      posSales: [{ id: 'v1', number: 104, createdAt: '2026-11-10T12:00:00Z', total: 50, status: 'COMPLETED', paymentMethod: 'PIX', items: [{ productName: 'PETG', quantity: 1 }] }],
    });
    await render(<Customers />, '/admin/clientes');
    expect(text()).toContain('Maria');
    await type(byLabel('Buscar cliente'), '5499');
    await wait(320);
    expect(customers.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '5499', page: 1 }));
    await act(async () => (document.querySelector('tbody tr') as HTMLElement).click());
    await flush();
    expect(text()).toContain('529.982.247-25');
    expect(text()).toContain('PDV-104');
    expect(text()).toContain('Pedido #ABC123');
    expect(text()).toContain('Passo Fundo');
  });

  it('estado vazio', async () => {
    customers.list.mockResolvedValue({ customers: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    await render(<Customers />, '/admin/clientes');
    expect(text()).toContain('Nenhum cliente encontrado');
  });
});
