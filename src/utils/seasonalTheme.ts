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
