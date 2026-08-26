import { useMemo } from 'react';
import type { Product } from '@/types';
import { Label } from '@/components/ui/Input';

// Teto de preço: maxPrice neste valor significa "sem limite superior".
export const MAX_PRICE = 100000;

export interface FiltersState {
  q: string;
  categories: string[];
  materials: string[];
  brands: string[];
  minPrice: number;
  maxPrice: number;
  inStockOnly: boolean;
}

interface Props {
  products: Product[];
  filters: FiltersState;
  setFilters: (f: FiltersState) => void;
}

export function ProductFilters({ products, filters, setFilters }: Props) {
  // R19-B — filtro só considera marcas realmente preenchidas. Nunca cai para
  // `material` como marca; strings vazias não viram opção "sem nome".
  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand?.trim()).filter((b): b is string => !!b))),
    [products],
  );

  function toggle<K extends 'materials' | 'brands' | 'categories'>(field: K, value: string) {
    const list = filters[field];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    setFilters({ ...filters, [field]: next });
  }

  return (
    <aside className="space-y-6 rounded-2xl border border-ink-line bg-bg-card p-5">
      <div>
        <Label>Marca</Label>
        <div className="space-y-1.5">
          {brands.map((b) => (
            <label key={b} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.brands.includes(b)}
                onChange={() => toggle('brands', b)}
                className="accent-ink"
              />
              {b}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Preço</Label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-mute">R$</span>
            <input
              type="number"
              min={0}
              step={10}
              placeholder="Mín"
              value={filters.minPrice || ''}
              onChange={(e) => setFilters({ ...filters, minPrice: Number(e.target.value) || 0 })}
              className="w-full rounded-xl border border-ink-line bg-white py-2 pl-8 pr-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
            />
          </div>
          <span className="text-ink-mute">—</span>
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-mute">R$</span>
            <input
              type="number"
              min={0}
              step={10}
              placeholder="Máx"
              value={filters.maxPrice >= MAX_PRICE ? '' : filters.maxPrice}
              onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value === '' ? MAX_PRICE : Number(e.target.value) })}
              className="w-full rounded-xl border border-ink-line bg-white py-2 pl-8 pr-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
            />
          </div>
        </div>
        {filters.minPrice > 0 && filters.maxPrice < MAX_PRICE && filters.minPrice > filters.maxPrice && (
          <p className="mt-1.5 text-xs text-rose-500">O valor mínimo deve ser menor que o máximo.</p>
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(e) => setFilters({ ...filters, inStockOnly: e.target.checked })}
            className="accent-ink"
          />
          Apenas em estoque
        </label>
      </div>

      <button
        onClick={() =>
          // Mantém a categoria da rota ativa ao limpar; zera apenas os filtros secundários.
          setFilters({
            ...filters,
            q: '',
            materials: [],
            brands: [],
            minPrice: 0,
            maxPrice: MAX_PRICE,
            inStockOnly: false,
          })
        }
        className="text-xs font-semibold text-ink-mute hover:text-ink underline"
      >
        Limpar filtros
      </button>
    </aside>
  );
}
