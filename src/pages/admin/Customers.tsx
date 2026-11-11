import { orderReference } from '@/utils/orderReference';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Edit, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { formatBRL } from '@/utils/price';
import { ApiError } from '@/services/api';
import { customerService, type CustomerAddress, type CustomerDetail, type CustomerRow } from '@/services/customerService';
import { PAYMENT_LABELS } from '@/services/posService';

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function formatDocument(d: string | null): string {
  if (!d) return '—';
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

function formatAddress(a: CustomerAddress | null): string {
  if (!a || !a.street) return '—';
  return [`${a.street}, ${a.number ?? 's/n'}`, a.complement, a.district, a.city && a.state ? `${a.city}/${a.state}` : a.city, a.zipCode].filter(Boolean).join(' · ');
}

interface Draft { id?: string; name: string; phone: string; email: string; document: string; notes: string }
const EMPTY: Draft = { name: '', phone: '', email: '', document: '', notes: '' };

export default function Customers() {
  useSEO('Admin Clientes');
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await customerService.list({ search: query || undefined, page, limit: 20 });
      setRows(r.customers);
      setTotalPages(r.pagination.totalPages);
      setTotal(r.pagination.total);
    } catch (err) {
      toast.error(errorMessage(err, 'Erro ao carregar clientes.'));
    } finally {
      setLoading(false);
    }
  }, [query, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="mt-1 text-sm text-ink-mute">{total} {total === 1 ? 'cliente' : 'clientes'} da loja e do balcão.</p>
        </div>
        <Button onClick={() => setDraft({ ...EMPTY })}><Plus className="h-4 w-4" /> Novo cliente</Button>
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, e-mail, telefone ou CPF" className="pl-9" aria-label="Buscar cliente" />
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-[11px] uppercase tracking-wide text-ink-mute">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Contato</th>
              <th className="px-4 py-2">Origem</th>
              <th className="px-4 py-2 text-right">Compras</th>
              <th className="px-4 py-2 text-right">Total gasto</th>
              <th className="px-4 py-2">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => setDetailId(c.id)} className="cursor-pointer border-t border-ink-line hover:bg-ink/[0.03]">
                <td className="px-4 py-2.5 font-semibold">{c.name}</td>
                <td className="px-4 py-2.5 text-xs text-ink-soft">{c.phone ?? '—'}<span className="block text-ink-mute">{c.email ?? ''}</span></td>
                <td className="px-4 py-2.5 text-xs">{c.origin === 'POS' ? 'Balcão' : 'Site'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.purchaseCount}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatBRL(c.totalSpent)}</td>
                <td className="px-4 py-2.5 text-xs text-ink-mute">{dateOf(c.lastPurchaseAt)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-ink-mute">Nenhum cliente encontrado.</td></tr>}
            {loading && rows.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-ink-mute">Carregando...</td></tr>}
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

      <DetailModal id={detailId} onClose={() => setDetailId(null)} onEdit={(d) => { setDetailId(null); setDraft(d); }} />
      <EditModal draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load(); }} />
    </div>
  );
}

function DetailModal({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (d: Draft) => void }) {
  const [data, setData] = useState<CustomerDetail | null>(null);

  useEffect(() => {
    setData(null);
    if (!id) return;
    customerService.get(id).then(setData).catch((err) => toast.error(errorMessage(err, 'Erro ao carregar o cliente.')));
  }, [id]);

  const c = data?.customer;
  return (
    <Modal open={id !== null} onClose={onClose} title={c?.name ?? 'Cliente'} maxWidth="max-w-3xl">
      {!data || !c ? <p className="py-8 text-center text-sm text-ink-mute">Carregando...</p> : (
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <p><span className="text-ink-mute">E-mail: </span>{c.email ?? '—'}</p>
            <p><span className="text-ink-mute">Telefone: </span>{c.phone ?? '—'}</p>
            <p><span className="text-ink-mute">Documento: </span>{formatDocument(c.document)}</p>
            <p><span className="text-ink-mute">Login no site: </span>{c.hasLogin ? 'Sim' : 'Não'}</p>
            <p className="sm:col-span-2"><span className="text-ink-mute">Endereço: </span>{formatAddress(c.address)}</p>
            {c.notes && <p className="sm:col-span-2"><span className="text-ink-mute">Observações: </span>{c.notes}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total gasto" value={formatBRL(data.stats.totalSpent)} />
            <Stat label="Compras" value={String(data.stats.purchaseCount)} />
            <Stat label="Última compra" value={dateOf(data.stats.lastPurchaseAt)} />
            <Stat label="Online / PDV" value={`${formatBRL(data.stats.totalOnline)} / ${formatBRL(data.stats.totalPos)}`} small />
          </div>

          <History title="Compras no PDV" empty="Nenhuma compra no balcão.">
            {data.posSales.map((s) => (
              <Entry key={s.id} title={`PDV-${s.number}`} date={s.createdAt} total={s.total} canceled={s.status === 'CANCELED'} detail={`${PAYMENT_LABELS[s.paymentMethod]} · ${summarize(s.items)}`} />
            ))}
          </History>
          <History title="Compras online" empty="Nenhum pedido no site.">
            {data.orders.map((o) => (
              <Entry key={o.id} title={`Pedido ${orderReference(o)}`} date={o.createdAt} total={o.total} canceled={o.status === 'CANCELED'} detail={summarize(o.items)} />
            ))}
          </History>

          <Button variant="secondary" onClick={() => onEdit({ id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', document: c.document ?? '', notes: c.notes ?? '' })}>
            <Edit className="h-4 w-4" /> Editar cadastro
          </Button>
        </div>
      )}
    </Modal>
  );
}

const summarize = (items: Array<{ productName: string; quantity: number }>) => items.map((i) => `${i.quantity}× ${i.productName}`).join(', ');

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-bg-soft p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-mute">{label}</p>
      <p className={`mt-0.5 font-bold ${small ? 'text-xs' : 'text-base'}`}>{value}</p>
    </div>
  );
}

function History({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h3 className="text-sm font-bold">{title}</h3>
      {children.length === 0 ? <p className="mt-1 text-xs text-ink-mute">{empty}</p> : (
        <ul className="mt-2 divide-y divide-ink-line rounded-xl border border-ink-line">{children}</ul>
      )}
    </section>
  );
}

function Entry({ title, date, total, canceled, detail }: { title: string; date: string; total: number; canceled: boolean; detail: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="font-semibold">{title}</span> <span className="text-xs text-ink-mute">{dateOf(date)}{canceled ? ' · Cancelado' : ''}</span>
        <span className="block truncate text-xs text-ink-mute">{detail}</span>
      </span>
      <span className={`shrink-0 font-semibold tabular-nums ${canceled ? 'text-rose-600 line-through' : ''}`}>{formatBRL(total)}</span>
    </li>
  );
}

function EditModal({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (draft) setForm(draft); }, [draft]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = { name: form.name, phone: form.phone || null, email: form.email || null, document: form.document || null, notes: form.notes || null };
    try {
      if (form.id) await customerService.update(form.id, payload);
      else await customerService.create(payload);
      toast.success('Cliente salvo.');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível salvar o cliente.'));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Draft) => ({
    value: form[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <Modal open={draft !== null} onClose={onClose} title={form.id ? 'Editar cliente' : 'Novo cliente'}>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>Nome *</Label><Input required minLength={2} autoFocus {...field('name')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Telefone</Label><Input {...field('phone')} /></div>
          <div><Label>CPF/CNPJ</Label><Input {...field('document')} /></div>
        </div>
        <div><Label>E-mail</Label><Input type="email" {...field('email')} /></div>
        <div><Label>Observações</Label><Input maxLength={500} {...field('notes')} /></div>
        <Button type="submit" fullWidth loading={saving}>Salvar</Button>
      </form>
    </Modal>
  );
}
