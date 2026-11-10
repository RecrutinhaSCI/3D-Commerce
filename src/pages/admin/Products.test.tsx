// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Product } from '@/types';
import Products from './Products';

vi.mock('@/components/admin/RemoteImageUploader', () => ({ RemoteImageUploader: () => null }));
vi.mock('@/components/admin/ProductImportModal', () => ({ ProductImportModal: () => null }));
vi.mock('@/utils/productExcel', () => ({ exportProductsXlsx: vi.fn(), downloadProductTemplate: vi.fn() }));
vi.mock('@/services/productService', () => ({ productService: { getAdminById: vi.fn().mockRejectedValue(new Error('offline')) } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const product = (id: string): Product => ({
  id, slug: id, name: `Produto ${id}`, brand: 'Marca', description: 'Descrição completa',
  shortDescription: 'Descrição curta', categoryIds: ['cat'], material: 'PLA', images: [],
  price: 20, stock: 10, purchaseMode: 'direct', active: true, isHighlight: false,
  freeShipping: false, variations: [], badges: [], isLaunch: false, isOffer: false,
  isBestSeller: false, createdAt: '2026-01-01', attributes: {},
});
let host: HTMLDivElement;
let root: Root;
let desktop = true;
const update = vi.fn();
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
const name = () => host.querySelector<HTMLInputElement>('input[name="name"]')!;
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
beforeEach(async () => {
  desktop = true;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop })));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  update.mockReset().mockResolvedValue(undefined);
  useAdminDataStore.setState({ products: [product('A'), product('B')], categories: [
    { id: 'cat', name: 'Categoria', slug: 'categoria', showInMenu: true, showInHome: true, order: 0 },
  ], updateProduct: update, ready: true, loading: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/produtos?marca=Marca']}><Products /><Location /></MemoryRouter>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('troca o formulário correto sem navegar e preserva filtros e seleção múltipla', async () => {
  await click('Produto A'); expect(name().value).toBe('Produto A');
  const selected = host.querySelector<HTMLInputElement>('input[aria-label="Selecionar Produto A"]')!;
  await act(async () => selected.click());
  await click('Produto B'); expect(name().value).toBe('Produto B');
  expect(selected.checked).toBe(true);
  expect(host.querySelector('output')!.textContent).toBe('/admin/produtos?marca=Marca');
  expect(window.confirm).not.toHaveBeenCalled();
});
it('cancelar mantém o rascunho; confirmar descarta e carrega o outro produto', async () => {
  await click('Produto A'); await type(name(), 'Produto alterado');
  await click('Produto B'); expect(name().value).toBe('Produto alterado');
  expect(window.confirm).toHaveBeenCalledOnce();
  vi.mocked(window.confirm).mockReturnValue(true);
  await click('Produto B'); expect(name().value).toBe('Produto B');
});
it('salva pela operação existente, bloqueia troca durante salvamento e limpa dirty após sucesso', async () => {
  let finish!: () => void;
  update.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await click('Produto A'); await type(name(), 'Produto salvo');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(update).toHaveBeenCalledWith('A', expect.objectContaining({ name: 'Produto salvo', price: 20, stock: 10 }));
  await click('Produto B'); expect(name().value).toBe('Produto salvo');
  await act(async () => finish());
  await click('Produto B'); expect(name().value).toBe('Produto B');
  expect(window.confirm).not.toHaveBeenCalled();
});
it('mobile mantém edição por navegação', async () => {
  desktop = false;
  await click('Produto A');
  expect(host.querySelector('output')!.textContent).toBe('/admin/produtos/A');
  expect(name()).toBeNull();
});
it('falha ao salvar mantém alterações e exige confirmação para trocar', async () => {
  update.mockRejectedValueOnce(new Error('offline'));
  await click('Produto A'); await type(name(), 'Rascunho mantido');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await click('Produto B');
  expect(name().value).toBe('Rascunho mantido');
  expect(window.confirm).toHaveBeenCalledOnce();
});
