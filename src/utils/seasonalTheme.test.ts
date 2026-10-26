import { describe, expect, it } from 'vitest';
import {
  SEASONAL_DEFAULTS,
  SITE_LIGHT_BG,
  contrastRatio,
  resolveSeasonalColors,
  seasonalAccent,
  seasonalTheme,
  withAlpha,
} from './seasonalTheme';

describe('seasonalTheme — identidade da campanha a partir das cores do admin', () => {
  it('sem cores gravadas usa os defaults (visual anterior preservado)', () => {
    const t = seasonalTheme(undefined);
    expect([t.from, t.to, t.text]).toEqual([SEASONAL_DEFAULTS.from, SEASONAL_DEFAULTS.to, SEASONAL_DEFAULTS.text]);
    expect(t.gradient).toBe(`linear-gradient(to right, ${SEASONAL_DEFAULTS.from}, ${SEASONAL_DEFAULTS.to})`);
  });

  it('cores do admin chegam ao gradiente e ao texto', () => {
    const t = seasonalTheme({ from: '#1D4ED8', to: '#7C3AED', text: '#FFFFFF' });
    expect(t.gradient).toContain('#1D4ED8');
    expect(t.gradient).toContain('#7C3AED');
    expect(t.text).toBe('#FFFFFF');
  });

  it('cor de destaque sempre legível (≥ 4,5:1) sobre o fundo claro — inclusive com paletas claras', () => {
    const palettes = [
      { from: '#059669', to: '#0F1115' }, // padrão
      { from: '#FDE047', to: '#FACC15' }, // amarelos claros (Páscoa?)
      { from: '#FFFFFF', to: '#F5F5F5' }, // branco
      { from: '#DC2626', to: '#16A34A' }, // Natal
      { from: '#F9A8D4', to: '#FBCFE8' }, // rosa claro (Dia das Mães?)
      { from: '#000000', to: '#111111' }, // Black Friday escuro
    ];
    for (const p of palettes) {
      const accent = seasonalAccent(resolveSeasonalColors(p));
      expect(contrastRatio(accent, SITE_LIGHT_BG), `${p.from}/${p.to} → ${accent}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cor já legível não é alterada (escolhe a mais contrastante do gradiente)', () => {
    expect(seasonalAccent(resolveSeasonalColors({ from: '#FDE047', to: '#1E3A8A' }))).toBe('#1E3A8A');
  });

  it('tint/borda são versões translúcidas do destaque', () => {
    const t = seasonalTheme({ from: '#1D4ED8', to: '#1D4ED8' });
    expect(t.tint).toBe(withAlpha(t.accent, 0.08));
    expect(t.border).toMatch(/^#[0-9A-F]{8}$/);
  });
});
