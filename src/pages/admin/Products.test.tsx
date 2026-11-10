// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Product } from '@/types';
import toast from 'react-hot-toast';
import Products from './Products';
import { productService } from '@/services/productService';
import type { ApiProduct } from '@/services/types';

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
const discardDialog = () => document.querySelector('[role="dialog"][aria-label="Descartar alterações?"]');
const pressed = (text: string) => [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)!.getAttribute('aria-pressed');
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)!;
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
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop, addListener: vi.fn(), removeListener: vi.fn() })));
  update.mockReset().mockResolvedValue(undefined);
  useAdminDataStore.setState({ products: [product('A'), product('B')], categories: [
    { id: 'cat', name: 'Categoria', slug: 'categoria', showInMenu: true, showInHome: true, order: 0 },
  ], updateProduct: update, ready: true, loading: false });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  // StrictMode como no main.tsx: sem ele o falso "alterado" do formulário não aparece.
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/admin/produtos?marca=Marca']}><Products /><Location /></MemoryRouter></StrictMode>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('troca o formulário correto sem navegar e preserva filtros e seleção múltipla', async () => {
  await click('Produto A'); expect(name().value).toBe('Produto A');
  const selected = host.querySelector<HTMLInputElement>('input[aria-label="Selecionar Produto A"]')!;
  await act(async () => selected.click());
  await click('Produto B'); expect(name().value).toBe('Produto B');
  expect(selected.checked).toBe(true);
  expect(host.querySelector('output')!.textContent).toBe('/admin/produtos?marca=Marca');
  expect(discardDialog()).toBeNull();
});
it('A → B troca o formulário e o destaque da lista', async () => {
  await click('Produto A');
  expect(pressed('Produto A')).toBe('true');
  await click('Produto B');
  expect(name().value).toBe('Produto B');
  expect(pressed('Produto A')).toBe('false');
  expect(pressed('Produto B')).toBe('true');
});
it('A editado → B → cancelar: continua em A com o rascunho', async () => {
  await click('Produto A'); await type(name(), 'Produto alterado');
  await click('Produto B');
  expect(discardDialog()).toBeTruthy();
  expect(name().value).toBe('Produto alterado');
  await click('Continuar editando');
  expect(name().value).toBe('Produto alterado');
  expect(pressed('Produto A')).toBe('true');
});
it('A editado → B → confirmar: abre B', async () => {
  await click('Produto A'); await type(name(), 'Produto alterado');
  await click('Produto B');
  await click('Descartar alterações');
  expect(name().value).toBe('Produto B');
  expect(pressed('Produto B')).toBe('true');
});
it('rascunho também protege links, inclusive os de fora da página', async () => {
  const outside = document.createElement('a');
  outside.href = '/admin/pedidos';
  outside.setAttribute('href', '/admin/pedidos');
  document.body.appendChild(outside);
  await click('Produto A'); await type(name(), 'Produto alterado');
  await act(async () => outside.click());
  expect(discardDialog()).toBeTruthy();
  expect(host.querySelector('output')!.textContent).toBe('/admin/produtos?marca=Marca');
  await click('Descartar alterações');
  expect(host.querySelector('output')!.textContent).toBe('/admin/pedidos');
  outside.remove();
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
  expect(discardDialog()).toBeNull();
});
const apiProduct = (id: string, stock: number) => ({
  id, slug: id, name: `Produto ${id}`, categoryId: 'cat', category: null, description: 'Descrição completa',
  shortDescription: 'Descrição curta', price: 20, promotionalPrice: null, sku: null, stock, active: true, featured: false,
  weight: null, width: null, height: null, depth: null, brand: 'Marca', material: 'PLA', color: null, printTime: null,
  purchaseMode: 'DIRECT', createdAt: '2026-01-01', updatedAt: '2026-01-01', stockUpdatedAt: null, images: [],
}) as unknown as ApiProduct;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

it('dados vindos do backend não marcam o formulário como alterado: A → B sem perguntar', async () => {
  vi.mocked(productService.getAdminById).mockImplementation(async (id) => ({ product: apiProduct(id, 10) }));
  await click('Produto A'); await flush();
  expect(host.textContent).not.toContain('Alterações não salvas');
  await click('Produto B'); await flush();
  expect(name().value).toBe('Produto B');
  expect(discardDialog()).toBeNull();
});
it('mobile mantém edição por navegação', async () => {
  desktop = false;
  await click('Produto A');
  expect(host.querySelector('output')!.textContent).toBe('/admin/produtos/A');
  expect(name()).toBeNull();
});
const field = (fieldName: string) => host.querySelector<HTMLInputElement>(`[name="${fieldName}"]`)!;
const submit = () => act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const withoutDescriptions = () => useAdminDataStore.setState({
  products: [{ ...product('A'), shortDescription: '', description: '' }, product('B')],
});
it('produto sem descrições salva o ajuste de preço', async () => {
  withoutDescriptions();
  await click('Produto A');
  await type(field('price'), '91.5');
  await submit();
  expect(update).toHaveBeenCalledWith('A', expect.objectContaining({ price: 91.5, shortDescription: '', description: '' }));
  expect(host.textContent).not.toContain('Alterações não salvas');
});
it('descrição preenchida ainda respeita o mínimo, e o bloqueio avisa', async () => {
  withoutDescriptions();
  await click('Produto A');
  await type(field('shortDescription'), 'abc');
  await submit();
  expect(update).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('Descrição curta com no mínimo 5 caracteres');
});
it('falha ao salvar mantém alterações e exige confirmação para trocar', async () => {
  update.mockRejectedValueOnce(new Error('offline'));
  await click('Produto A'); await type(name(), 'Rascunho mantido');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await click('Produto B');
  expect(name().value).toBe('Rascunho mantido');
  expect(discardDialog()).toBeTruthy();
});
