import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Copy, Edit, MessageSquarePlus, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { couponService, type CouponStatusFilter, type CouponInput } from '@/services/couponService';
import { ApiError } from '@/services/api';
import type { ApiCoupon, ApiCouponDiscountType, ApiCouponStatus } from '@/services/types';
import { editOnDoubleClick } from '@/utils/rowEdit';

const STATUS_META: Record<ApiCouponStatus, { label: string; cls: string }> = {
  ACTIVE: { label: 'Ativo', cls: 'bg-emerald-50 text-emerald-700' },
  INACTIVE: { label: 'Inativo', cls: 'bg-ink/5 text-ink-mute' },
  EXPIRED: { label: 'Expirado', cls: 'bg-rose-50 text-rose-600' },
  EXHAUSTED: { label: 'Esgotado', cls: 'bg-amber-50 text-amber-700' },
  SCHEDULED: { label: 'Agendado', cls: 'bg-sky-50 text-sky-700' },
};

const DISCOUNT_LABELS: Record<ApiCouponDiscountType, string> = {
  PERCENTAGE: 'Percentual',
  FIXED_AMOUNT: 'Valor fixo',
  FREE_SHIPPING: 'Frete grátis',
};

const FILTERS: { value: CouponStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INACTIVE', label: 'Inativos' },
  { value: 'EXPIRED', label: 'Expirados' },
  { value: 'EXHAUSTED', label: 'Esgotados' },
  { value: 'SCHEDULED', label: 'Agendados' },
  { value: 'SEASONAL', label: 'Sazonais' },
];

interface Draft {
  id?: string;
  code: string;
  name: string;
  description: string;
  discountType: ApiCouponDiscountType;
  discountValue: string;
  minOrderValue: string;
  maxDiscountValue: string;
  startsAt: string;
  expiresAt: string;
  usageLimit: string;
  usageLimitPerCustomer: string;
  isActive: boolean;
  isSeasonal: boolean;
  seasonalName: string;
}

const emptyDraft: Draft = {
  code: '',
  name: '',
  description: '',
  discountType: 'PERCENTAGE',
  discountValue: '',
  minOrderValue: '',
  maxDiscountValue: '',
  startsAt: '',
  expiresAt: '',
  usageLimit: '',
  usageLimitPerCustomer: '',
  isActive: true,
  isSeasonal: false,
  seasonalName: '',
};

/** ISO → valor para input datetime-local (horário local, sem segundos). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function discountValueLabel(c: ApiCoupon): string {
  if (c.discountType === 'PERCENTAGE') return `${c.discountValue}%`;
  if (c.discountType === 'FIXED_AMOUNT') return formatBRL(c.discountValue);
  return '—';
}

export default function Coupons() {
  useSEO('Admin Cupons');
  const navigate = useNavigate();
  const [list, setList] = useState<ApiCoupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<CouponStatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { coupons } = await couponService.listAdmin({ status: filter });
      setList(coupons);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar cupons.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [list, search]);

  function openNew() {
    setEditing({ ...emptyDraft });
  }
  function openEdit(c: ApiCoupon) {
    setEditing({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      discountType: c.discountType,
      discountValue: c.discountType === 'FREE_SHIPPING' ? '' : String(c.discountValue),
      minOrderValue: c.minOrderValue != null ? String(c.minOrderValue) : '',
      maxDiscountValue: c.maxDiscountValue != null ? String(c.maxDiscountValue) : '',
      startsAt: isoToLocalInput(c.startsAt),
      expiresAt: isoToLocalInput(c.expiresAt),
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      usageLimitPerCustomer: c.usageLimitPerCustomer != null ? String(c.usageLimitPerCustomer) : '',
      isActive: c.isActive,
      isSeasonal: c.isSeasonal,
      seasonalName: c.seasonalName ?? '',
    });
  }

  function draftToInput(d: Draft): CouponInput {
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    return {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      description: d.description.trim() || null,
      discountType: d.discountType,
      discountValue: d.discountType === 'FREE_SHIPPING' ? 0 : Number(d.discountValue || 0),
      minOrderValue: num(d.minOrderValue),
      maxDiscountValue: d.discountType === 'PERCENTAGE' ? num(d.maxDiscountValue) : null,
      startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : null,
      expiresAt: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
      usageLimit: num(d.usageLimit),
      usageLimitPerCustomer: num(d.usageLimitPerCustomer),
      isActive: d.isActive,
      isSeasonal: d.isSeasonal,
      seasonalName: d.isSeasonal ? d.seasonalName.trim() || null : null,
    };
  }

  async function save() {
    if (!editing) return;
    if (editing.code.trim().length < 2) return toast.error('Informe o código do cupom.');
    if (editing.name.trim().length < 2) return toast.error('Informe o nome do cupom.');
    if (editing.discountType === 'PERCENTAGE') {
      const v = Number(editing.discountValue);
      if (!(v > 0 && v <= 100)) return toast.error('Percentual deve ser entre 1 e 100.');
    }
    if (editing.discountType === 'FIXED_AMOUNT' && !(Number(editing.discountValue) > 0)) {
      return toast.error('Informe o valor do desconto.');
    }
    setSaving(true);
    try {
      const payload = draftToInput(editing);
      if (editing.id) {
        const { coupon } = await couponService.update(editing.id, payload);
        setList((l) => l.map((x) => (x.id === coupon.id ? coupon : x)));
        toast.success('Cupom atualizado.');
      } else {
        const { coupon } = await couponService.create(payload);
        setList((l) => [coupon, ...l]);
        toast.success('Cupom criado.');
      }
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar cupom.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: ApiCoupon) {
    try {
      const { coupon } = await couponService.toggle(c.id);
      setList((l) => l.map((x) => (x.id === coupon.id ? coupon : x)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao alternar cupom.');
    }
  }

  async function doRemove(id: string) {
    try {
      await couponService.remove(id);
      setList((l) => l.filter((x) => x.id !== id));
      toast.success('Cupom removido.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao remover cupom.');
    } finally {
      setConfirm(null);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Código ${code} copiado.`);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Vendas</p>
          <h1 className="section-title">Cupons</h1>
          <p className="mt-1 text-sm text-ink-mute">{list.length} cupom(ns)</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo cupom
        </Button>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === f.value ? 'bg-ink text-bg' : 'text-ink-soft hover:bg-ink/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input
            className="pl-9"
            placeholder="Buscar código ou nome"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-ink-mute">Carregando...</div>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-mute">
          {search || filter !== 'ALL' ? 'Nenhum cupom encontrado com esse filtro.' : 'Nenhum cupom cadastrado ainda.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => {
            const meta = STATUS_META[c.status];
            return (
              <div key={c.id} {...editOnDoubleClick(() => openEdit(c))} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-base font-bold tracking-wide">{c.code}</span>
                      <button
                        onClick={() => copyCode(c.code)}
                        title="Copiar código"
                        className="rounded p-1 text-ink-mute hover:bg-ink/5 hover:text-ink"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-soft">{c.name}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
                    {meta.label}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-mute">Desconto</p>
                    <p className="font-semibold">
                      {DISCOUNT_LABELS[c.discountType]}
                      {c.discountType !== 'FREE_SHIPPING' && (
                        <span className="ml-1 text-ink-soft">({discountValueLabel(c)})</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-mute">Usos</p>
                    <p className="font-semibold">
                      {c.usageCount}
                      {c.usageLimit != null ? ` / ${c.usageLimit}` : ' / ∞'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-mute">Pedido mín.</p>
                    <p className="font-semibold">{c.minOrderValue != null ? formatBRL(c.minOrderValue) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-mute">Validade</p>
                    <p className="font-semibold">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('pt-BR') : 'Sem prazo'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-mute">Limite/cliente</p>
                    <p className="font-semibold">{c.usageLimitPerCustomer != null ? c.usageLimitPerCustomer : '∞'}</p>
                  </div>
                </div>

                {c.isSeasonal && (
                  <p className="mt-3 inline-flex w-fit rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                    Sazonal{c.seasonalName ? `: ${c.seasonalName}` : ''}
                  </p>
                )}

                {/* Métricas de uso (R14) */}
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-bg-soft p-2.5 text-center">
                  <div>
                    <p className="text-sm font-bold">{c.ordersCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-mute">Pedidos</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold">{formatBRL(c.revenue)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-mute">Receita</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-600">{formatBRL(c.discountGiven)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-mute">Desconto</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1 text-xs">
                  <button
                    onClick={() => navigate(`/admin/pedidos?cupom=${encodeURIComponent(c.code)}`)}
                    className="rounded-lg bg-ink/5 px-2.5 py-1.5 font-medium text-ink-soft hover:bg-ink/10"
                  >
                    Ver pedidos
                  </button>
                  <button
                    onClick={() => navigate(`/admin/scripts?couponId=${c.id}`)}
                    className="rounded-lg bg-ink/5 px-2.5 py-1.5 font-medium text-ink-soft hover:bg-ink/10"
                  >
                    Ver scripts
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-ink-line pt-3 text-xs">
                  <button onClick={() => toggle(c)} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-ink/5">
                    {c.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={() => navigate(`/admin/scripts?novoComCupom=${c.id}`)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-ink-soft hover:bg-ink/5"
                    title="Criar script de WhatsApp com este cupom"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" /> Criar script
                  </button>
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => openEdit(c)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5" title="Editar">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirm(c.id)}
                      className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                      title="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar cupom' : 'Novo cupom'}
        maxWidth="max-w-2xl"
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Código</Label>
                <Input
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                  placeholder="EX: BLACK10"
                  className="font-mono uppercase"
                />
              </div>
              <div>
                <Label>Nome interno</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Black Friday 10% OFF"
                />
              </div>
            </div>

            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea
                rows={2}
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label>Tipo de desconto</Label>
                <Select
                  value={editing.discountType}
                  onChange={(e) =>
                    setEditing({ ...editing, discountType: e.target.value as ApiCouponDiscountType })
                  }
                >
                  <option value="PERCENTAGE">Percentual (%)</option>
                  <option value="FIXED_AMOUNT">Valor fixo (R$)</option>
                  <option value="FREE_SHIPPING">Frete grátis</option>
                </Select>
              </div>
              {editing.discountType !== 'FREE_SHIPPING' && (
                <div>
                  <Label>{editing.discountType === 'PERCENTAGE' ? 'Percentual' : 'Valor (R$)'}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editing.discountValue}
                    onChange={(e) => setEditing({ ...editing, discountValue: e.target.value })}
                  />
                </div>
              )}
              {editing.discountType === 'PERCENTAGE' && (
                <div>
                  <Label>Teto de desconto (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editing.maxDiscountValue}
                    onChange={(e) => setEditing({ ...editing, maxDiscountValue: e.target.value })}
                    placeholder="opcional"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label>Pedido mínimo (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.minOrderValue}
                  onChange={(e) => setEditing({ ...editing, minOrderValue: e.target.value })}
                  placeholder="opcional"
                />
              </div>
              <div>
                <Label>Limite total de usos</Label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={editing.usageLimit}
                  onChange={(e) => setEditing({ ...editing, usageLimit: e.target.value })}
                  placeholder="ilimitado"
                />
              </div>
              <div>
                <Label>Limite por cliente</Label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={editing.usageLimitPerCustomer}
                  onChange={(e) => setEditing({ ...editing, usageLimitPerCustomer: e.target.value })}
                  placeholder="opcional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Início (opcional)</Label>
                <Input
                  type="datetime-local"
                  value={editing.startsAt}
                  onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })}
                />
              </div>
              <div>
                <Label>Expiração (opcional)</Label>
                <Input
                  type="datetime-local"
                  value={editing.expiresAt}
                  onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="accent-ink"
                />
                Ativo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.isSeasonal}
                  onChange={(e) => setEditing({ ...editing, isSeasonal: e.target.checked })}
                  className="accent-ink"
                />
                Sazonal
              </label>
              {editing.isSeasonal && (
                <div className="flex-1 min-w-[160px]">
                  <Input
                    value={editing.seasonalName}
                    onChange={(e) => setEditing({ ...editing, seasonalName: e.target.value })}
                    placeholder="Nome da temporada (ex: Natal)"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save} loading={saving}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover cupom?">
        <p className="text-sm text-ink-mute">
          Essa ação é permanente. Scripts vinculados a este cupom apenas serão desvinculados.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && doRemove(confirm)}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
