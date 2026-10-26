/**
 * Cores do banner da categoria sazonal. Os defaults reproduzem EXATAMENTE o
 * visual anterior (Tailwind `from-emerald-600 to-ink text-bg`), então
 * campanhas sem cor gravada não mudam.
 */
export const SEASONAL_DEFAULTS = {
  from: '#059669', // emerald-600
  to: '#0F1115', // ink
  text: '#FAFAF7', // bg
} as const;

export interface SeasonalColors {
  from: string;
  to: string;
  text: string;
}

/** Cores efetivas: gravadas ou padrão. */
export function resolveSeasonalColors(c?: Partial<SeasonalColors> | null): SeasonalColors {
  return {
    from: c?.from || SEASONAL_DEFAULTS.from,
    to: c?.to || SEASONAL_DEFAULTS.to,
    text: c?.text || SEASONAL_DEFAULTS.text,
  };
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * Aceita `#RRGGBB`, `RRGGBB`, `#RGB` e `rgb(r, g, b)` / `r, g, b`.
 * Devolve `#RRGGBB` em maiúsculas, ou `null` se inválido.
 */
export function parseColorInput(raw: string): string | null {
  const v = raw.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(v);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^(?:rgb\s*\()?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i.exec(v);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].every((n) => n <= 255)) return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
  }
  return null;
}

/** `#RRGGBB` → `rgb(r, g, b)` (exibição). */
export function hexToRgbText(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '';
  return `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
}

// ---------------------------------------------------------------------------
// Identidade da campanha fora do hero (Header, MegaMenu, menu mobile…).
// Tudo derivado de resolveSeasonalColors(): nada de cor fixa por campanha.
// ---------------------------------------------------------------------------

/** Fundo claro do site (bg). Elementos sazonais fora do hero ficam sobre ele. */
export const SITE_LIGHT_BG = '#FAFAF7';

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? m[1] : '000000';
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const toHex = ([r, g, b]: [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

/** Luminância relativa (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura `hex` com preto (amount 0–1). */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)]);
}

/** Cor com transparência: `#RRGGBB` + alfa → `#RRGGBBAA`. */
export function withAlpha(hex: string, alpha: number): string {
  return `${toHex(hexToRgb(hex))}${hex2(alpha * 255)}`;
}

/**
 * Cor de destaque da campanha LEGÍVEL sobre o fundo claro do site (texto de
 * link, ícone, borda). Escolhe a cor do gradiente com mais contraste e, se
 * ainda ficar abaixo de 4,5:1 (WCAG AA), escurece até atingir.
 */
export function seasonalAccent(colors: SeasonalColors, background: string = SITE_LIGHT_BG): string {
  const candidates = [colors.from, colors.to].map((c) => toHex(hexToRgb(c)));
  let best = candidates.reduce((a, b) => (contrastRatio(b, background) > contrastRatio(a, background) ? b : a));
  for (let i = 0; i < 20 && contrastRatio(best, background) < 4.5; i++) best = darken(best, 0.1);
  return best;
}

export interface SeasonalTheme extends SeasonalColors {
  /** Texto/ícone/borda legíveis sobre fundo claro. */
  accent: string;
  /** Fundo suave (cartões do menu). */
  tint: string;
  /** Borda suave. */
  border: string;
  /** Gradiente do hero/banner. */
  gradient: string;
}

/** Identidade visual completa da campanha a partir das cores do admin. */
export function seasonalTheme(c?: Partial<SeasonalColors> | null): SeasonalTheme {
  const colors = resolveSeasonalColors(c);
  const accent = seasonalAccent(colors);
  return {
    ...colors,
    accent,
    tint: withAlpha(accent, 0.08),
    border: withAlpha(accent, 0.28),
    gradient: `linear-gradient(to right, ${colors.from}, ${colors.to})`,
  };
}
