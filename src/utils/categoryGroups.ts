import type { Category } from '@/types';

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
