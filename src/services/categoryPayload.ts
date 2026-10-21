import type { Category } from '@/types';

/**
 * Monta o corpo do PUT /api/admin/categories/:id a partir de um patch do
 * admin. Função pura (testável) — usada pelo store.
 *
 * `active` vem de UM só campo, conforme o tipo da categoria:
 * - categoria comum → checkbox "Ativa" (`active`);
 * - categoria sazonal → "Ativar campanha" (`seasonalActive`).
 *
 * Antes, `seasonalActive` sempre sobrescrevia `active`. Como o adapter monta
 * `seasonalActive = isSeasonal && active` (false em categoria comum), o
 * "Salvar" do modal mandava `active: false` e desativava a categoria.
 */
export function buildCategoryUpdatePayload(patch: Partial<Category>, currentIsSeasonal = false) {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.slug !== undefined) payload.slug = patch.slug;
  if (patch.description !== undefined) payload.description = patch.description ?? null;

  const isSeasonal = patch.isSeasonal ?? currentIsSeasonal;
  const active = isSeasonal ? patch.seasonalActive ?? patch.active : patch.active;
  if (active !== undefined) payload.active = active;

  if (patch.showInMenu !== undefined) payload.showInMenu = patch.showInMenu;
  if (patch.showInHome !== undefined) payload.showInHome = patch.showInHome;
  if (patch.isSeasonal !== undefined) payload.isSeasonal = patch.isSeasonal;
  if (patch.seasonalBanner !== undefined) payload.seasonalTitle = patch.seasonalBanner ?? null;
  // Cores da sazonal: campo vazio → null (volta ao visual padrão).
  if (patch.seasonalColors !== undefined) {
    payload.seasonalColorFrom = patch.seasonalColors?.from || null;
    payload.seasonalColorTo = patch.seasonalColors?.to || null;
    payload.seasonalTextColor = patch.seasonalColors?.text || null;
  }
  // `image`/`seasonalBannerImage` NÃO vão pelo PUT: só pelo upload dedicado.
  return payload;
}
