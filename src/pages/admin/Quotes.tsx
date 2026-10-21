import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Paperclip, Save, X } from 'lucide-react';
import { Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { useSEO } from '@/utils/seo';
import { quoteService } from '@/services/quoteService';
import { ApiError, apiAssetUrl } from '@/services/api';
import type { ApiQuote, ApiQuoteStatus } from '@/services/types';
import { formatBRL } from '@/utils/price';
import { editOnDoubleClick } from '@/utils/rowEdit';

const QUOTE_STATUSES: ApiQuoteStatus[] = [
  'RECEIVED',
  'ANALYZING',
  'WAITING_CUSTOMER',
  'APPROVED',
  'REJECTED',
  'CONVERTED_TO_ORDER',
];

const STATUS_LABEL: Record<ApiQuoteStatus, string> = {
  RECEIVED: 'Recebido',
  ANALYZING: 'Em análise',
  WAITING_CUSTOMER: 'Aguardando cliente',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CONVERTED_TO_ORDER: 'Virou pedido',
};

const STATUS_TONE: Record<ApiQuoteStatus, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700',
  ANALYZING: 'bg-amber-100 text-amber-700',
  WAITING_CUSTOMER: 'bg-violet-100 text-violet-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  CONVERTED_TO_ORDER: 'bg-ink text-bg',
};

function StatusBadge({ status }: { status: ApiQuoteStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function Quotes() {
  useSEO('Admin Orçamentos');
  const [params, setParams] = useSearchParams();
  const initialStatus = (params.get('status') as ApiQuoteStatus) ?? 'all';
  const [filter, setFilter] = useState<'all' | ApiQuoteStatus>(initialStatus as 'all' | ApiQuoteStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState<ApiQuote[]>([]);
  const [active, setActive] = useState<ApiQuote | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { quotes: list } = await quoteService.listAdmin({
        status: filter !== 'all' ? filter : undefined,
        search: search.trim() || undefined,
        limit: 50,
      });
      setQuotes(list);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar orçamentos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function openDetails(q: ApiQuote) {
    setActive(q);
    setEditValue(q.estimatedValue?.toString() ?? '');
    setEditNotes(q.adminNotes ?? '');
  }

  async function saveEdit() {
    if (!active) return;
    setSaving(true);
    try {
      const payload: { estimatedValue?: number | null; adminNotes?: string | null } = {};
      const trimmedValue = editValue.trim();
      if (trimmedValue === '') payload.estimatedValue = null;
      else {
        const n = Number(trimmedValue.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) throw new Error('Valor estimado precisa ser > 0.');
        payload.estimatedValue = n;
      }
      payload.adminNotes = editNotes.trim() ? editNotes.trim() : null;
      const { quote } = await quoteService.updateAdmin(active.id, payload);
      setActive(quote);
      setQuotes((list) => list.map((q) => (q.id === quote.id ? quote : q)));
      toast.success('Orçamento atualizado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(next: ApiQuoteStatus) {
    if (!active) return;
    try {
      const { quote } = await quoteService.updateStatus(active.id, next);
      setActive(quote);
      setQuotes((list) => list.map((q) => (q.id === quote.id ? quote : q)));
      toast.success(`Status: ${STATUS_LABEL[next]}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao mudar status.');
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operação</p>
          <h1 className="section-title">Orçamentos</h1>
          <p className="mt-1 text-sm text-ink-mute">{quotes.length} orçamento(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <Input
              placeholder="Buscar por nome/e-mail/título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load();
              }}
            />
          </div>
          <Select
            value={filter}
            onChange={(e) => {
              const v = e.target.value as 'all' | ApiQuoteStatus;
              setFilter(v);
              const next = new URLSearchParams(params);
              if (v === 'all') next.delete('status');
              else next.set('status', v);
              setParams(next);
            }}
            className="max-w-[220px]"
          >
            <option value="all">Todos os status</option>
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-[11px] uppercase tracking-[0.14em] text-ink-mute">
            <tr>
              <th className="px-5 py-3">Título</th>
              <th className="px-5 py-3">Cliente</th>
              <th className="px-5 py-3">Data</th>
              <th className="px-5 py-3">Valor estimado</th>
              <th className="px-5 py-3">Arquivos</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {loading && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-ink-mute">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && quotes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-ink-mute">
                  Nenhum orçamento encontrado.
                </td>
              </tr>
            )}
            {quotes.map((q) => (
              <tr key={q.id} {...editOnDoubleClick(() => openDetails(q))} className="transition-colors hover:bg-bg-soft/60">
                <td className="px-5 py-3 font-semibold">{q.title}</td>
                <td className="px-5 py-3 text-ink-soft">
                  {q.customerName}
                  <div className="text-xs text-ink-mute">{q.customerEmail}</div>
                </td>
                <td className="px-5 py-3 text-ink-mute">
                  {new Date(q.createdAt).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-5 py-3 tabular-nums">
                  {q.estimatedValue != null ? formatBRL(q.estimatedValue) : '—'}
                </td>
                <td className="px-5 py-3 text-ink-mute">
                  <span className="inline-flex items-center gap-1">
                    <Paperclip className="h-3.5 w-3.5" /> {q.files.length}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={q.status} />
                </td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => openDetails(q)}
                    className="text-xs font-semibold text-ink hover:underline"
                  >
                    Detalhes →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={!!active} onClose={() => setActive(null)} title={active?.title ?? 'Orçamento'} width="w-full sm:max-w-2xl">
        {active && (
          <div className="space-y-5 p-5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <StatusBadge status={active.status} />
              <Select
                value={active.status}
                onChange={(e) => updateStatus(e.target.value as ApiQuoteStatus)}
                className="max-w-[220px]"
              >
                {QUOTE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="rounded-xl bg-bg-soft p-4">
              <p className="font-semibold">{active.customerName}</p>
              <p className="text-xs text-ink-mute">{active.customerEmail}</p>
              <p className="text-xs text-ink-mute">{active.customerPhone}</p>
              {active.user && (
                <p className="mt-1 text-[11px] text-ink-mute">
                  Conta: {active.user.email}
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-mute">Descrição</p>
              <p className="mt-1 whitespace-pre-wrap">{active.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {active.material && (
                <div className="rounded-lg bg-bg-soft p-3">
                  <span className="text-ink-mute">Material:</span> <strong>{active.material}</strong>
                </div>
              )}
              {active.color && (
                <div className="rounded-lg bg-bg-soft p-3">
                  <span className="text-ink-mute">Cor:</span> <strong>{active.color}</strong>
                </div>
              )}
              <div className="rounded-lg bg-bg-soft p-3">
                <span className="text-ink-mute">Quantidade:</span> <strong>{active.quantity}</strong>
              </div>
              {active.deadline && (
                <div className="rounded-lg bg-bg-soft p-3">
                  <span className="text-ink-mute">Prazo:</span> <strong>{new Date(active.deadline).toLocaleDateString('pt-BR')}</strong>
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-mute">
                Arquivos ({active.files.length})
              </p>
              {active.files.length === 0 ? (
                <p className="mt-2 text-xs text-ink-mute">Nenhum arquivo enviado.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {active.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded-lg bg-bg-soft px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-2 truncate">
                        <FileText className="h-3.5 w-3.5" />
                        <span className="truncate">{f.originalName}</span>
                        <span className="text-ink-mute">· {Math.round(f.size / 1024)}kb</span>
                      </span>
                      <a
                        href={apiAssetUrl(f.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-ink hover:underline"
                      >
                        Abrir →
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-ink-line p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-mute">Análise do admin</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">Valor estimado (R$)</label>
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="Deixe vazio para limpar"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">Notas internas</label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="Observações que só o admin vê..."
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setActive(null)}>
                    <X className="h-3.5 w-3.5" /> Fechar
                  </Button>
                  <Button size="sm" onClick={saveEdit} loading={saving}>
                    <Save className="h-3.5 w-3.5" /> Salvar análise
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
