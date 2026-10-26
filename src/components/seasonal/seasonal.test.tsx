// @vitest-environment jsdom
/**
 * Identidade da campanha sazonal no site público (render no cliente, jsdom).
 * Cobre: cores do admin chegando no visual, fim dos verdes fixos, hero só na
 * categoria sazonal, fallback sem imagem, estado vazio da campanha e links.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Category, Product } from '@/types';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useUIStore } from '@/store/useUIStore';
import { SeasonalHero } from './SeasonalHero';
import { SeasonalBanner } from '@/components/home/SeasonalBanner';
import { Header } from '@/components/layout/Header';
import { MegaMenu } from '@/components/layout/MegaMenu';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import CategoryPage from '@/pages/public/Category';
import { seasonalTheme } from '@/utils/seasonalTheme';

const COLORS = { from: '#1D4ED8', to: '#7C3AED', text: '#FFFFFF' };
const IMG = 'https://abc.public.blob.vercel-storage.com/site/campanha.webp';

const cat = (p: Partial<Category>): Category => ({
  id: 'c', slug: 'c', name: 'C', showInMenu: true, showInHome: true, order: 0, active: true, ...p,
});
const seasonal = cat({
  id: 'sz', slug: 'campanha-x', name: 'Campanha X', isSeasonal: true, seasonalActive: true,
  seasonalBanner: 'Edição Campanha X', description: 'Descrição da campanha', seasonalBannerImage: IMG, seasonalColors: COLORS,
});
const normal = cat({ id: 'pla', slug: 'filamentos-pla', name: 'Filamentos PLA', description: 'PLA 1.75mm' });
const product = (id: string, categoryId: string): Product => ({
  id, slug: id, name: `Produto ${id}`, description: 'd', shortDescription: 's', categoryIds: [categoryId], brand: 'Marca',
  images: [], price: 100, stock: 5, freeShipping: false, purchaseMode: 'direct', variations: [], badges: [],
  isHighlight: false, isLaunch: false, isOffer: false, isBestSeller: false, active: true, createdAt: '2026-01-01', attributes: {},
});

// jsdom não tem IntersectionObserver (usado pelo whileInView do Framer Motion).
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver ??= NoopIntersectionObserver;

/** jsdom serializa `color` do style como rgb(r, g, b) (gradiente fica em HEX). */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

// React 18: avisa que `act` está disponível neste ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Renderiza no cliente (como o navegador) e devolve o HTML resultante. */
function render(el: ReactElement, path = '/') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>));
  return host.innerHTML;
}
const renderCategory = (slug: string) =>
  render(
    <Routes>
      <Route path="/categoria/:slug" element={<CategoryPage />} />
    </Routes>,
    `/categoria/${slug}`,
  );

beforeEach(() => {
  useAdminDataStore.setState({ categories: [normal, seasonal], products: [product('p1', 'pla'), product('p2', 'sz')] });
  useUIStore.setState({ mobileMenuOpen: false });
});

const accent = seasonalTheme(COLORS).accent;
/** Trecho de style que o jsdom gera para `color: <hex>`. */
const colorStyle = (hex: string) => `color: ${rgb(hex)}`;

describe('SeasonalHero', () => {
  it('usa imagem, título, descrição e cores do admin', () => {
    const html = render(<SeasonalHero category={seasonal} variant="page" productCount={3} />);
    expect(html).toContain(`src="${IMG}"`);
    expect(html).toContain('Edição Campanha X');
    expect(html).toContain('Descrição da campanha');
    expect(html).toContain('Edição especial');
    expect(html).toContain(`linear-gradient(to right, ${COLORS.from}, ${COLORS.to})`);
    expect(html).toContain(colorStyle(COLORS.text));
    expect(html).toMatch(/<h1[^>]*>Edição Campanha X<\/h1>/);
    expect(html).toContain('3 produtos na coleção');
  });

  it('sem imagem: fallback só com o gradiente da campanha', () => {
    const html = render(<SeasonalHero category={{ ...seasonal, seasonalBannerImage: undefined }} variant="page" />);
    expect(html).not.toContain('<img');
    expect(html).toContain(`linear-gradient(to right, ${COLORS.from}`);
  });

  it('banner da Home aponta para o slug real da campanha', () => {
    const html = render(<SeasonalBanner />);
    expect(html).toContain('data-seasonal-hero="banner"');
    expect(html).toContain('href="/categoria/campanha-x"');
  });
});

describe('navegação usa a identidade da campanha (sem verde fixo)', () => {
  it('Header: link com a cor de destaque e slug correto', () => {
    const html = render(<Header />);
    const link = html.match(/<a[^>]*data-seasonal-link="header"[^>]*>[^<]*<\/a>/)?.[0] ?? '';
    expect(link).toContain('href="/categoria/campanha-x"');
    expect(link).toContain(colorStyle(accent));
    expect(link).not.toMatch(/emerald/);
  });

  it('MegaMenu: cartão da campanha com tint/borda/destaque do admin', () => {
    const html = render(<MegaMenu open onClose={() => {}} />);
    const card = html.match(/<a[^>]*data-seasonal-link="megamenu"[^>]*>/)?.[0] ?? '';
    expect(card).toContain('href="/categoria/campanha-x"');
    expect(card).toContain(colorStyle(accent));
    expect(card).not.toMatch(/emerald/);
    expect(html).not.toMatch(/bg-emerald-50|text-emerald-700/);
  });

  it('Menu mobile: campanha destacada com as mesmas cores', () => {
    useUIStore.setState({ mobileMenuOpen: true });
    const html = render(<MobileDrawer />);
    const link = html.match(/<a[^>]*data-seasonal-link="mobile"[^>]*>/)?.[0] ?? '';
    expect(link).toContain('href="/categoria/campanha-x"');
    expect(link).toContain(colorStyle(accent));
    expect(link).not.toMatch(/emerald/);
  });
});

describe('página /categoria/:slug', () => {
  it('categoria NORMAL mantém o layout da loja (sem hero sazonal)', () => {
    const html = renderCategory('filamentos-pla');
    expect(html).not.toContain('data-seasonal-hero');
    expect(html).toMatch(/<h1[^>]*>Filamentos PLA<\/h1>/);
    expect(html).toContain('Catálogo');
  });

  it('categoria SAZONAL recebe hero, cabeçalho da coleção e grade', () => {
    const html = renderCategory('campanha-x');
    expect(html).toContain('data-seasonal-hero="page"');
    expect(html).toContain('data-seasonal-collection-header');
    expect(html).toContain('Produto p2');
    expect(html).not.toContain('Produto p1');
    expect(html).toContain('1 produto na coleção');
  });

  it('campanha sem produtos: estado vazio da campanha (não o vazio genérico)', () => {
    useAdminDataStore.setState({ products: [product('p1', 'pla')] });
    const html = renderCategory('campanha-x');
    expect(html).toContain('está sendo preparada');
    expect(html).toContain('Edição Campanha X');
    expect(html).not.toContain('Tente remover alguns filtros');
    expect(html).toContain('href="/loja"');
  });
});
