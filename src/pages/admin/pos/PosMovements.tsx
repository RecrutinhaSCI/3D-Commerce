import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useSEO } from '@/utils/seo';
import { ApiError } from '@/services/api';
import { MOVEMENT_LABELS, posService, type StockMovement, type StockMovementType } from '@/services/posService';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { PosNav } from './PosNav';

export default function PosMovements() {
  useSEO('Movimentações de estoque');
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<StockMovementType | ''>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    posService
      .listMovements({ search: query || undefined, type: type || undefined, page, limit: 50 })
      .then((r) => {
        if (!active) return;
        setRows(r.movements);
        setTotalPages(r.pagination.totalPages);
      })
      .catch((err) => active && toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar movimentações.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query, type, page]);

  return (
    <div>
      <PosNav />
      <h1 className="text-2xl font-bold">Movimentações de estoque</h1>
      <p className="mt-1 text-sm text-ink-mute">Histórico de tudo que alterou o estoque, de todas as origens.</p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Produto, SKU ou referência" aria-label="Buscar movimentação" />
        <Select value={type} onChange={(e) => { setType(e.target.value as StockMovementType | ''); setPage(1); }} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {(Object.keys(MOVEMENT_LABELS) as StockMovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
        </Select>
      </div>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-[11px] uppercase tracking-wide text-ink-mute">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Produto</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Referência</th>
              <th className="px-4 py-2 text-right">Mov.</th>
              <th className="px-4 py-2 text-right">Saldo</th>
              <th className="px-4 py-2">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-ink-line">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-mute">{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                <td className="px-4 py-2"><span className="font-semibold">{m.productName}</span>{m.productSku && <span className="block text-xs text-ink-mute">{m.productSku}</span>}</td>
                <td className="px-4 py-2">{MOVEMENT_LABELS[m.type]}</td>
                <td className="px-4 py-2 text-xs text-ink-soft">{[m.referenceLabel, m.note].filter(Boolean).join(' · ') || '—'}</td>
                <td className={`px-4 py-2 text-right font-semibold tabular-nums ${m.quantityDelta < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{m.quantityDelta > 0 ? '+' : ''}{m.quantityDelta}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-xs tabular-nums text-ink-mute">{m.quantityBefore} → {m.quantityAfter}</td>
                <td className="px-4 py-2 text-xs">{m.userName ?? 'Automático'}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-ink-mute">Nenhuma movimentação encontrada.</td></tr>}
            {loading && rows.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-ink-mute">Carregando...</td></tr>}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-ink-mute">Página {page} de {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
