import type { Category } from '@/types';

/**
 * ÚNICA forma de montar a URL pública de uma categoria. Rota canônica:
 * `/categoria/:slug` (AppRoutes), com o slug REAL vindo do banco/admin —
 * nunca um slug curto inventado no front (`/categoria/pla`) nem sem prefixo
 * (`/filamentos-abs`).
 */
export const categoryPath = (slug: string) => `/categoria/${encodeURIComponent(slug)}`;

/** Link do grupo "todos os filamentos" (Shop entende `?grupo=filamentos`). */
export const FILAMENTS_GROUP_PATH = '/loja?grupo=filamentos';

/** Visível no menu: ativa + flag "Mostrar no menu" do admin. */
export const showsInMenu = (c: Pick<Category, 'active' | 'showInMenu'>) => c.active !== false && c.showInMenu;

/** Visível nos cards da Home: ativa + "Mostrar na home" + não sazonal (tem bloco próprio). */
export const showsInHome = (c: Pick<Category, 'active' | 'showInHome' | 'isSeasonal'>) =>
  c.active !== false && c.showInHome && !c.isSeasonal;

/**
 * Agrupamento das categorias para a navegação (mega menu e /loja?grupo=…).
 *
 * "Material" = categoria de filamento/resina. Reconhece o padrão real do
 * catálogo (`filamentos-pla`, `filamentos-petg`, …) e os slugs curtos antigos
 * do seed (`pla`, `petg`, `abs`, `resinas`).
 */
const LEGACY_MATERIAL_SLUGS = new Set(['pla', 'petg', 'abs', 'asa', 'tpu', 'resinas']);

export const isFilamentCategory = (c: Pick<Category, 'slug'>) =>
  c.slug.startsWith('filamento') || ['pla', 'petg', 'abs', 'asa', 'tpu'].includes(c.slug);

export const isMaterialCategory = (c: Pick<Category, 'slug'>) =>
  isFilamentCategory(c) || c.slug.startsWith('resina') || LEGACY_MATERIAL_SLUGS.has(c.slug);

/** "Filamentos PLA" → "PLA"; nomes sem o prefixo ficam como estão. */
export const materialLabel = (name: string) =>
  name.replace(/^(filamentos?|resinas?)\s+/i, '').trim() || name;

/** Ordem de exibição dos materiais mais comuns; o resto vem depois, A→Z. */
const MATERIAL_ORDER = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];
export function sortMaterials<T extends Pick<Category, 'name'>>(cats: T[]): T[] {
  const rank = (c: T) => {
    const i = MATERIAL_ORDER.indexOf(materialLabel(c.name).toUpperCase());
    return i === -1 ? MATERIAL_ORDER.length : i;
  };
  return [...cats].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Categoria ATIVA de um material ("PLA", "PETG", "Resina"…) pelo nome do
 * cadastro — "Filamentos PLA" → PLA, "Resinas" → Resina. Sem categoria
 * correspondente devolve `undefined` (quem chama não mostra o link).
 */
export function findMaterialCategory<T extends Pick<Category, 'name' | 'slug' | 'active'>>(
  categories: T[],
  material: string,
): T | undefined {
  const key = singular(material.trim().toUpperCase());
  return categories.find(
    (c) => c.active !== false && isMaterialCategory(c) && singular(materialLabel(c.name).toUpperCase()) === key,
  );
}

const singular = (s: string) => s.replace(/S$/, '');

/**
 * Compat com URLs antigas que circularam (favoritos, buscadores, banners):
 * `/categoria/pla` → categoria "Filamentos PLA"; `/filamentos-abs` → idem.
 * Só resolve para uma categoria ATIVA que existe — nunca inventa slug.
 */
export function resolveCategoryAlias<T extends Pick<Category, 'name' | 'slug' | 'active'>>(
  categories: T[],
  rawSlug: string,
): T | undefined {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) return undefined;
  const active = categories.filter((c) => c.active !== false);
  return (
    active.find((c) => c.slug === slug) ??
    active.find((c) => c.slug === `filamentos-${slug}`) ??
    findMaterialCategory(active, slug)
  );
}
