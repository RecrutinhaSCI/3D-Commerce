/**
 * Peso e dimensões da EMBALAGEM — regra ÚNICA de limites e precisão.
 *
 * ARQUIVO ESPELHADO — mantenha IDÊNTICOS:
 *   backend/src/shared/physicalLimits.ts  (schemas de produto e import)
 *   src/shared/physicalLimits.ts          (formulário e leitura da planilha)
 * O teste backend/src/shared/physicalLimits.sync.test.ts falha se divergirem.
 * (O Render só enxerga `backend/`, por isso não há uma pasta comum.)
 * PURO: sem imports, sem Node, sem Prisma.
 *
 * Precisão = a das colunas no banco: peso `Decimal(10,3)` (kg), medidas
 * `Decimal(10,2)` (cm). O mínimo é o menor valor que não arredonda para zero.
 */

export const PHYSICAL_FIELDS = ['weight', 'width', 'height', 'depth'] as const;
export type PhysicalField = (typeof PHYSICAL_FIELDS)[number];

export const PHYSICAL_LIMITS: Record<PhysicalField, { min: number; max: number; decimals: number; label: string; step: string }> = {
  weight: { min: 0.001, max: 100, decimals: 3, label: 'Peso (kg)', step: '0.001' },
  width: { min: 0.01, max: 300, decimals: 2, label: 'Largura (cm)', step: '0.01' },
  height: { min: 0.01, max: 300, decimals: 2, label: 'Altura (cm)', step: '0.01' },
  depth: { min: 0.01, max: 300, decimals: 2, label: 'Profundidade (cm)', step: '0.01' },
};

/** Arredonda à precisão da coluna. */
export function roundPhysical(field: PhysicalField, value: number): number {
  return Number(value.toFixed(PHYSICAL_LIMITS[field].decimals));
}

const fmt = (n: number) => String(n).replace('.', ',');

/** Mensagem de erro para um valor numérico, ou `null` se válido (já arredondado). */
export function physicalError(field: PhysicalField, value: number): string | null {
  const { min, max, label } = PHYSICAL_LIMITS[field];
  if (!Number.isFinite(value)) return `${label} inválido.`;
  const rounded = roundPhysical(field, value);
  if (rounded < min || rounded > max) return `${label} deve estar entre ${fmt(min)} e ${fmt(max)}.`;
  return null;
}

/** Produto tem as 4 medidas válidas (> 0)? Base para cotar frete. */
export function hasAllPhysical(p: Partial<Record<PhysicalField, number | null | undefined>>): boolean {
  return PHYSICAL_FIELDS.every((f) => typeof p[f] === 'number' && (p[f] as number) > 0);
}
