import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Edit, Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { useSEO } from '@/utils/seo';
import { testimonialService } from '@/services/testimonialService';
import { ApiError, apiAssetUrl } from '@/services/api';
import type { ApiTestimonial } from '@/services/types';

interface Draft {
  id?: string;
  name: string;
  role: string;
  content: string;
  rating: number;
  avatarUrl: string;
  active: boolean;
}

const emptyDraft: Draft = {
  name: '',
  role: '',
  content: '',
  rating: 5,
  avatarUrl: '',
  active: true,
};

export default function Testimonials() {
  useSEO('Admin Depoimentos');
  const [list, setList] = useState<ApiTestimonial[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { testimonials } = await testimonialService.listAdmin();
      setList(testimonials);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar depoimentos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing({ ...emptyDraft });
  }
  function openEdit(t: ApiTestimonial) {
    setEditing({
      id: t.id,
      name: t.name,
      role: t.role ?? '',
      content: t.content,
      rating: t.rating,
      avatarUrl: t.avatarUrl ?? '',
      active: t.active,
    });
  }

  async function save() {
    if (!editing) return;
    if (editing.name.trim().length < 2) {
      toast.error('Nome muito curto.');
      return;
    }
    if (editing.content.trim().length < 2) {
      toast.error('Depoimento muito curto.');
      return;
    }
    try {
      if (editing.id) {
        const { testimonial } = await testimonialService.update(editing.id, {
          name: editing.name.trim(),
          role: editing.role.trim() || null,
          content: editing.content.trim(),
          rating: editing.rating,
          avatarUrl: editing.avatarUrl || null,
          active: editing.active,
        });
        setList((l) => l.map((x) => (x.id === testimonial.id ? testimonial : x)));
        toast.success('Depoimento atualizado.');
      } else {
        const { testimonial } = await testimonialService.create({
          name: editing.name.trim(),
          role: editing.role.trim() || null,
          content: editing.content.trim(),
          rating: editing.rating,
          avatarUrl: editing.avatarUrl || null,
          active: editing.active,
        });
        setList((l) => [testimonial, ...l]);
        toast.success('Depoimento criado.');
      }
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar.');
    }
  }

  async function toggleActive(t: ApiTestimonial) {
    try {
      const { testimonial } = await testimonialService.update(t.id, { active: !t.active });
      setList((l) => l.map((x) => (x.id === testimonial.id ? testimonial : x)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao alternar.');
    }
  }

  async function doRemove(id: string) {
    try {
      await testimonialService.remove(id);
      setList((l) => l.filter((x) => x.id !== id));
      toast.success('Depoimento removido.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao remover.');
    } finally {
      setConfirm(null);
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Conteúdo</p>
          <h1 className="section-title">Depoimentos</h1>
          <p className="mt-1 text-sm text-ink-mute">{list.length} depoimento(s)</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo depoimento
        </Button>
      </header>

      {loading ? (
        <div className="card p-10 text-center text-sm text-ink-mute">Carregando...</div>
      ) : list.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-mute">Nenhum depoimento cadastrado.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <div key={t.id} className="card p-5">
              <div className="flex items-center gap-3">
                {t.avatarUrl ? (
                  <img src={apiAssetUrl(t.avatarUrl)} alt={t.name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-soft text-sm font-bold text-ink-mute">
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-semibold">{t.name}</p>
                  {t.role && <p className="text-xs text-ink-mute">{t.role}</p>}
                </div>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${i < t.rating ? 'fill-amber-400 text-amber-400' : 'text-ink-line'}`}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-3 line-clamp-4 text-sm text-ink-soft">{t.content}</p>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className={`inline-flex items-center gap-1 ${t.active ? 'text-emerald-600' : 'text-ink-mute'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${t.active ? 'bg-emerald-500' : 'bg-ink-mute'}`} />
                  {t.active ? 'Ativo' : 'Inativo'}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => toggleActive(t)} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-ink/5">
                    {t.active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button onClick={() => openEdit(t)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button onClick={() => setConfirm(t.id)} className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar depoimento' : 'Novo depoimento'} maxWidth="max-w-xl">
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Cargo/Empresa (opcional)</Label>
                <Input value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Depoimento</Label>
              <Textarea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                rows={4}
              />
            </div>
            <div>
              <Label>Rating</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setEditing({ ...editing, rating: n })}
                    aria-label={`${n} estrelas`}
                  >
                    <Star
                      className={`h-6 w-6 transition ${
                        n <= editing.rating ? 'fill-amber-400 text-amber-400' : 'text-ink-line'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            {editing.id && (
              <div className="rounded-xl border border-ink-line p-3">
                <RemoteImageUploader
                  label="Avatar (opcional)"
                  value={editing.avatarUrl || null}
                  onUpload={async (file) => {
                    try {
                      const { testimonial } = await testimonialService.uploadAvatar(editing.id!, file);
                      const url = testimonial.avatarUrl ?? '';
                      setEditing({ ...editing, avatarUrl: url });
                      setList((l) => l.map((x) => (x.id === testimonial.id ? testimonial : x)));
                      return url;
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Falha no upload.');
                    }
                  }}
                  onRemove={async () => {
                    // Remove na hora, como o upload (que também grava na hora).
                    try {
                      const { testimonial } = await testimonialService.update(editing.id!, { avatarUrl: null });
                      setList((l) => l.map((x) => (x.id === testimonial.id ? testimonial : x)));
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover o avatar.');
                    }
                    setEditing({ ...editing, avatarUrl: '' });
                  }}
                  hint="JPG, PNG ou WEBP (fotos grandes são reduzidas automaticamente)."
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                className="accent-ink"
              />
              Ativo (exibido no site público)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={save}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover depoimento?">
        <p className="text-sm text-ink-mute">Essa ação é permanente.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && doRemove(confirm)}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
