import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Copy, Edit, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { scriptService, type ScriptInput } from '@/services/scriptService';
import { couponService } from '@/services/couponService';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { ApiError } from '@/services/api';
import type { ApiCoupon, ApiCouponScript, ApiLinkedCoupon, ApiScriptCategory } from '@/services/types';
import { editOnDoubleClick } from '@/utils/rowEdit';
import {
  SCRIPT_CATEGORY_LABELS,
  SCRIPT_CATEGORY_OPTIONS,
  SCRIPT_VARIABLES,
  buildTemplateVars,
  couponDiscountLabel,
  defaultTemplateForCoupon,
  fillTemplate,
} from '@/utils/scriptTemplate';

interface Draft {
  id?: string;
  title: string;
  description: string;
  messageTemplate: string;
  category: ApiScriptCategory;
  linkedCouponId: string;
  isActive: boolean;
}

const emptyDraft: Draft = {
  title: '',
  description: '',
  messageTemplate: '',
  category: 'COUPON',
  linkedCouponId: '',
  isActive: true,
};

function couponToLinked(c: ApiCoupon): ApiLinkedCoupon {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    discountType: c.discountType,
    discountValue: c.discountValue,
    minOrderValue: c.minOrderValue,
    expiresAt: c.expiresAt,
  };
}

export default function Scripts() {
  useSEO('Admin Scripts');
  const [searchParams, setSearchParams] = useSearchParams();
  const storeName = useAdminDataStore((s) => s.settings.name);

  const [list, setList] = useState<ApiCouponScript[]>([]);
  const [coupons, setCoupons] = useState<ApiCoupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [catFilter, setCatFilter] = useState<ApiScriptCategory | 'ALL'>('ALL');
  const [couponFilter, setCouponFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewName, setPreviewName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pendingCouponId, setPendingCouponId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [{ scripts }, { coupons: cps }] = await Promise.all([
        scriptService.listAdmin(),
        couponService.listAdmin({ status: 'ALL' }),
      ]);
      setList(scripts);
      setCoupons(cps);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar scripts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Atalhos vindos da página de Cupons:
  //   /admin/scripts?novoComCupom=<id>  → abre novo script com o cupom
  //   /admin/scripts?couponId=<id>      → filtra scripts por cupom vinculado
  useEffect(() => {
    const novo = searchParams.get('novoComCupom');
    const filtro = searchParams.get('couponId');
    if (novo) {
      setEditing({ ...emptyDraft, linkedCouponId: novo, category: 'COUPON' });
      setPendingCouponId(novo);
      setSearchParams({}, { replace: true });
    } else if (filtro) {
      setCouponFilter(filtro);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Quando os cupons carregam, preenche o template padrão do cupom pendente.
  useEffect(() => {
    if (!pendingCouponId) return;
    const c = coupons.find((x) => x.id === pendingCouponId);
    if (c) {
      setEditing((e) =>
        e && !e.id && !e.messageTemplate.trim()
          ? { ...e, messageTemplate: defaultTemplateForCoupon(c) }
          : e,
      );
      setPendingCouponId(null);
    }
  }, [coupons, pendingCouponId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((s) => {
      if (catFilter !== 'ALL' && s.category !== catFilter) return false;
      if (couponFilter && s.linkedCouponId !== couponFilter) return false;
      if (q && !s.title.toLowerCase().includes(q) && !(s.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [list, catFilter, couponFilter, search]);

  // Cupom vinculado ao rascunho em edição (para preview).
  const draftLinkedCoupon: ApiLinkedCoupon | null = useMemo(() => {
    if (!editing?.linkedCouponId) return null;
    const c = coupons.find((x) => x.id === editing.linkedCouponId);
    return c ? couponToLinked(c) : null;
  }, [editing?.linkedCouponId, coupons]);

  const previewText = useMemo(() => {
    if (!editing) return '';
    const vars = buildTemplateVars({
      script: { linkedCoupon: draftLinkedCoupon },
      storeName,
      customerName: previewName,
    });
    return fillTemplate(editing.messageTemplate, vars);
  }, [editing, draftLinkedCoupon, storeName, previewName]);

  function openNew() {
    setEditing({ ...emptyDraft });
    setPreviewName('');
  }
  function openEdit(s: ApiCouponScript) {
    setEditing({
      id: s.id,
      title: s.title,
      description: s.description ?? '',
      messageTemplate: s.messageTemplate,
      category: s.category,
      linkedCouponId: s.linkedCouponId ?? '',
      isActive: s.isActive,
    });
    setPreviewName('');
  }

  function insertVariable(v: string) {
    if (!editing) return;
    setEditing({ ...editing, messageTemplate: `${editing.messageTemplate}${v}` });
  }

  async function save() {
    if (!editing) return;
    if (editing.title.trim().length < 2) return toast.error('Informe o título.');
    if (editing.messageTemplate.trim().length < 2) return toast.error('Escreva a mensagem.');
    setSaving(true);
    try {
      const payload: ScriptInput = {
        title: editing.title.trim(),
        description: editing.description.trim() || null,
        messageTemplate: editing.messageTemplate,
        category: editing.category,
        linkedCouponId: editing.linkedCouponId || null,
        isActive: editing.isActive,
      };
      if (editing.id) {
        const { script } = await scriptService.update(editing.id, payload);
        setList((l) => l.map((x) => (x.id === script.id ? script : x)));
        toast.success('Script atualizado.');
      } else {
        const { script } = await scriptService.create(payload);
        setList((l) => [script, ...l]);
        toast.success('Script criado.');
      }
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar script.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: ApiCouponScript) {
    try {
      const { script } = await scriptService.toggle(s.id);
      setList((l) => l.map((x) => (x.id === script.id ? script : x)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao alternar script.');
    }
  }

  async function doRemove(id: string) {
    try {
      await scriptService.remove(id);
      setList((l) => l.filter((x) => x.id !== id));
      toast.success('Script removido.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao remover script.');
    } finally {
      setConfirm(null);
    }
  }

  async function copyText(text: string, successMsg = 'Mensagem copiada com sucesso!') {
    if (!text.trim()) return toast.error('Nada para copiar.');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMsg);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  /** Copia a mensagem final de um card da lista (usa cupom vinculado do próprio script). */
  async function copyCardMessage(s: ApiCouponScript) {
    const vars = buildTemplateVars({ script: s, storeName });
    await copyText(fillTemplate(s.messageTemplate, vars));
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Conteúdo</p>
          <h1 className="section-title">Scripts de WhatsApp</h1>
          <p className="mt-1 text-sm text-ink-mute">
            {list.length} template(s) — mensagens prontas para copiar e enviar manualmente.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo script
        </Button>
      </header>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-3">
          <div>
            <Label>Categoria</Label>
            <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value as ApiScriptCategory | 'ALL')}>
              <option value="ALL">Todas</option>
              {SCRIPT_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Cupom vinculado</Label>
            <Select value={couponFilter} onChange={(e) => setCouponFilter(e.target.value)}>
              <option value="">Todos</option>
              {coupons.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="relative lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input
            className="pl-9"
            placeholder="Buscar título"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-ink-mute">Carregando...</div>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-mute">
          {list.length === 0 ? 'Nenhum script cadastrado ainda.' : 'Nenhum script com esse filtro.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((s) => (
            <div key={s.id} {...editOnDoubleClick(() => openEdit(s))} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.title}</p>
                  <span className="mt-1 inline-flex rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                    {SCRIPT_CATEGORY_LABELS[s.category]}
                  </span>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-ink/5 text-ink-mute'}`}>
                  {s.isActive ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              <p className="mt-3 line-clamp-4 whitespace-pre-wrap rounded-lg bg-bg-soft p-3 text-xs text-ink-soft">
                {s.messageTemplate}
              </p>

              {s.linkedCoupon && (
                <p className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                  <Tag className="h-3 w-3" /> {s.linkedCoupon.code} — {couponDiscountLabel(s.linkedCoupon)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-ink-line pt-3 text-xs">
                <button
                  onClick={() => copyCardMessage(s)}
                  className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 font-medium text-bg hover:bg-ink/90"
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar
                </button>
                <button onClick={() => toggle(s)} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-ink/5">
                  {s.isActive ? 'Desativar' : 'Ativar'}
                </button>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5" title="Editar">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setConfirm(s.id)}
                    className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar script' : 'Novo script'}
        maxWidth="max-w-3xl"
      >
        {editing && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Coluna de edição */}
            <div className="space-y-4">
              <div>
                <Label>Título</Label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value as ApiScriptCategory })}
                  >
                    {SCRIPT_CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Cupom vinculado</Label>
                  <Select
                    value={editing.linkedCouponId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const c = coupons.find((x) => x.id === id);
                      setEditing((prev) =>
                        prev
                          ? {
                              ...prev,
                              linkedCouponId: id,
                              messageTemplate:
                                !prev.messageTemplate.trim() && c
                                  ? defaultTemplateForCoupon(c)
                                  : prev.messageTemplate,
                            }
                          : prev,
                      );
                    }}
                  >
                    <option value="">Nenhum</option>
                    {coupons.map((c) => (
                      <option key={c.id} value={c.id}>{c.code}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea
                  rows={8}
                  value={editing.messageTemplate}
                  onChange={(e) => setEditing({ ...editing, messageTemplate: e.target.value })}
                  placeholder="Olá, {{nome_cliente}}! Use o cupom {{cupom}}..."
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {SCRIPT_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariable(v)}
                      className="rounded-md bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-soft hover:bg-ink/10"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="accent-ink"
                />
                Ativo
              </label>
            </div>

            {/* Coluna de preview */}
            <div className="space-y-3">
              <div>
                <Label>Nome do cliente (preview)</Label>
                <Input
                  value={previewName}
                  onChange={(e) => setPreviewName(e.target.value)}
                  placeholder="Ex: Maria"
                />
              </div>
              <div>
                <Label>Pré-visualização</Label>
                <div className="min-h-[200px] whitespace-pre-wrap rounded-xl border border-ink-line bg-[#e5ddd5] p-3 text-sm text-ink">
                  {previewText || <span className="text-ink-mute">A mensagem aparecerá aqui...</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => copyText(previewText)}>
                  <Copy className="h-4 w-4" /> Copiar mensagem
                </Button>
                <Button
                  variant="whatsapp"
                  disabled={!draftLinkedCoupon}
                  onClick={() => copyText(previewText, `Mensagem com cupom ${draftLinkedCoupon?.code} copiada!`)}
                  title={draftLinkedCoupon ? '' : 'Vincule um cupom para usar esta opção'}
                >
                  <Tag className="h-4 w-4" /> Copiar com cupom
                </Button>
              </div>
              <p className="text-[11px] text-ink-mute">
                Variáveis sem valor (ex.: {'{{nome_produto}}'}) permanecem no texto para você completar antes de enviar.
              </p>
            </div>

            <div className="flex justify-end gap-2 lg:col-span-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save} loading={saving}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover script?">
        <p className="text-sm text-ink-mute">Essa ação é permanente.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && doRemove(confirm)}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
