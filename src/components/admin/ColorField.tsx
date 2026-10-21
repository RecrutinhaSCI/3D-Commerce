import { useEffect, useState } from 'react';
import { hexToRgbText, parseColorInput } from '@/utils/seasonalTheme';

interface Props {
  label: string;
  /** #RRGGBB gravado; vazio = usando o padrão. */
  value: string | undefined;
  /** Cor padrão exibida quando `value` está vazio. */
  fallback: string;
  onChange: (next: string | undefined) => void;
}

/**
 * Cor com seletor visual + campo texto (aceita #RRGGBB, #RGB ou rgb(r, g, b)).
 * "Padrão" limpa o valor (volta ao visual original da loja).
 */
export function ColorField({ label, value, fallback, onChange }: Props) {
  const effective = value || fallback;
  const [text, setText] = useState(effective);
  const [invalid, setInvalid] = useState(false);

  // Sincroniza o texto quando a cor muda por fora (picker, "Padrão", reload).
  useEffect(() => {
    setText(effective);
    setInvalid(false);
  }, [effective]);

  function commit(raw: string) {
    const parsed = parseColorInput(raw);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed === fallback.toUpperCase() ? undefined : parsed);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-soft">{label}</span>
        {value && (
          <button type="button" onClick={() => onChange(undefined)} className="text-[11px] font-semibold text-ink-mute hover:text-ink">
            Padrão
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={effective.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase() === fallback.toUpperCase() ? undefined : e.target.value.toUpperCase())}
          aria-label={`${label} — seletor`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-line bg-bg-card p-1"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (parseColorInput(e.target.value)) commit(e.target.value);
          }}
          onBlur={(e) => commit(e.target.value)}
          aria-label={`${label} — HEX ou RGB`}
          aria-invalid={invalid}
          placeholder="#RRGGBB ou rgb(0, 0, 0)"
          className={`w-full rounded-xl border bg-bg-card px-3 py-2 font-mono text-xs uppercase outline-none focus:border-ink ${
            invalid ? 'border-rose-400' : 'border-ink-line'
          }`}
        />
      </div>
      <p className={`mt-1 text-[11px] ${invalid ? 'text-rose-500' : 'text-ink-mute'}`}>
        {invalid ? 'Use #RRGGBB, #RGB ou rgb(r, g, b).' : `${hexToRgbText(effective)}${value ? '' : ' · padrão'}`}
      </p>
    </div>
  );
}
