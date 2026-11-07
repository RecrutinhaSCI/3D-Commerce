import { z } from 'zod';

/**
 * Embalagem REAL da etiqueta, sempre confirmada (ou corrigida) pelo admin.
 * O que for usado fica gravado em shipment_labels.package_json.
 *
 * Limites aqui são só de sanidade (evitar digitação absurda). As regras da
 * transportadora são validadas pelo próprio Melhor Envio ao inserir no carrinho.
 */
export const PACKAGE_LIMITS = { maxWeightKg: 30, maxSideCm: 100 } as const;

const side = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} inválida.` })
    .positive(`${label} precisa ser maior que zero.`)
    .max(PACKAGE_LIMITS.maxSideCm, `${label}: máximo de ${PACKAGE_LIMITS.maxSideCm} cm.`);

export const packageSchema = z
  .object({
    weightKg: z.coerce
      .number({ invalid_type_error: 'Peso inválido.' })
      .positive('Peso precisa ser maior que zero.')
      .max(PACKAGE_LIMITS.maxWeightKg, `Peso: máximo de ${PACKAGE_LIMITS.maxWeightKg} kg.`),
    heightCm: side('Altura'),
    widthCm: side('Largura'),
    lengthCm: side('Comprimento'),
  })
  .strict();
export type ShipmentPackage = z.infer<typeof packageSchema>;

/** Gravado na etiqueta: medidas + de onde vieram. */
export interface StoredPackage extends ShipmentPackage {
  /** `suggested` = aceitou a sugestão sem mudar; `admin` = informou/corrigiu. */
  source: 'suggested' | 'admin';
}

/** Volume no formato do Melhor Envio: dimensões inteiras (cm, arredondadas para cima) e peso em kg. */
export function toMelhorEnvioVolume(p: ShipmentPackage) {
  return {
    height: Math.ceil(p.heightCm),
    width: Math.ceil(p.widthCm),
    length: Math.ceil(p.lengthCm),
    weight: Math.round(p.weightKg * 1000) / 1000,
  };
}

export interface PackageItem {
  quantity: number;
  /** kg */
  weight: number | null;
  /** cm */
  width: number | null;
  height: number | null;
  depth: number | null;
}

export interface PackageSuggestion {
  /** null quando algum item não tem peso/medidas (o admin informa a caixa). */
  package: ShipmentPackage | null;
  /** Itens (linhas) sem peso ou medidas. */
  itemsMissingData: number;
}

/**
 * Sugestão de caixa a partir dos produtos: peso somado; largura e comprimento
 * pelo maior item; altura empilhada (soma por quantidade). É só ponto de
 * partida — o admin confirma a embalagem real.
 */
export function suggestPackage(items: PackageItem[]): PackageSuggestion {
  const ok = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const missing = items.filter((i) => !(ok(i.weight) && ok(i.width) && ok(i.height) && ok(i.depth))).length;
  if (items.length === 0 || missing > 0) return { package: null, itemsMissingData: missing };

  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  const weightKg = round(items.reduce((s, i) => s + i.weight! * i.quantity, 0), 3);
  const widthCm = Math.max(...items.map((i) => i.width!));
  const lengthCm = Math.max(...items.map((i) => i.depth!));
  const heightCm = round(items.reduce((s, i) => s + i.height! * i.quantity, 0), 2);
  const clamp = (v: number, max: number) => Math.min(v, max);
  return {
    package: {
      weightKg: clamp(weightKg, PACKAGE_LIMITS.maxWeightKg),
      heightCm: clamp(heightCm, PACKAGE_LIMITS.maxSideCm),
      widthCm: clamp(widthCm, PACKAGE_LIMITS.maxSideCm),
      lengthCm: clamp(lengthCm, PACKAGE_LIMITS.maxSideCm),
    },
    itemsMissingData: 0,
  };
}
