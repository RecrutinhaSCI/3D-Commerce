/**
 * Materiais de produto — lista ÚNICA usada pelo formulário do admin, pela
 * importação do Excel e pelo tipo `Product['material']`.
 *
 * No backend/Prisma/Excel `material` é texto livre (sem enum), então valores
 * fora desta lista continuam válidos e são preservados; a lista só organiza o
 * que o admin escolhe e normaliza a grafia ("tpu" → "TPU").
 */
export const PRODUCT_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Resina'] as const;
export type KnownMaterial = (typeof PRODUCT_MATERIALS)[number];

const ALIASES: Record<string, KnownMaterial> = {
  RESIN: 'Resina',
  RESINA: 'Resina',
  RESINAS: 'Resina',
};

/** Grafia canônica de um material conhecido; desconhecido volta como veio (trim). */
export function normalizeMaterial(raw: string): string {
  const v = raw.trim();
  const up = v.toUpperCase();
  return PRODUCT_MATERIALS.find((m) => m.toUpperCase() === up) ?? ALIASES[up] ?? v;
}

/**
 * Material sugerido pelo nome da categoria ("Filamentos TPU" → TPU,
 * "Resinas" → Resina). Usado para pré-preencher produto novo.
 */
export function materialFromCategoryName(name: string): KnownMaterial | undefined {
  const last = name.trim().split(/\s+/).pop() ?? '';
  const m = normalizeMaterial(last);
  return (PRODUCT_MATERIALS as readonly string[]).includes(m) ? (m as KnownMaterial) : undefined;
}
