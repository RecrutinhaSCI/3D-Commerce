import { useState } from 'react';
import slugify from 'slugify';
import toast from 'react-hot-toast';
import { Edit, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { ApiError } from '@/services/api';
import { categoryPath } from '@/utils/categoryGroups';
import type { Category } from '@/types';
import { useSEO } from '@/utils/seo';
import { editOnDoubleClick } from '@/utils/rowEdit';

export default function Categories() {
  useSEO('Admin Categorias');
  const { categories, addCategory, updateCategory, removeCategory, uploadCategoryImage, removeCategoryImage } =
    useAdminDataStore();
  const [editing, setEditing] = useState<Category | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = !!editing && !categories.some((c) => c.id === editing.id);

  function openNew() {
    setEditing({
      id: 'cat-' + Date.now(),
      slug: '',
      name: '',
      description: '',
      active: true,
      showInMenu: true,
      showInHome: true,
      order: categories.length + 1,
    });
  }

  // Toast de sucesso SÓ depois que o backend confirmou — antes aparecia
  // "Categoria atualizada" mesmo quando nada era gravado.
  async function save() {
    if (!editing) return;
    if (!editing.name) {
      toast.error('Informe o nome');
      return;
    }
    const payload = { ...editing, slug: editing.slug || slugify(editing.name, { lower: true, strict: true }) };
    setSaving(true);
    try {
      if (!isNew) {
        if (!(await updateCategory(payload.id, payload))) {
          toast.error('Não foi possível salvar a categoria.');
          return;
        }
        toast.success('Categoria atualizada');
        setEditing(useAdminDataStore.getState().categories.find((c) => c.id === payload.id) ?? payload);
      } else {
        const created = await addCategory(payload);
        if (!created) {
          toast.error('Não foi possível criar a categoria (slug repetido?).');
          return;
        }
        toast.success('Categoria criada — agora você pode enviar a imagem.');
        // Mantém o modal aberto, já com o id real, para permitir o upload.
        setEditing(created);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Category, patch: Partial<Category>) {
    if (!(await updateCategory(c.id, patch))) toast.error(`Não foi possível atualizar "${c.name}".`);
  }

  function remove(id: string) {
    removeCategory(id);
    toast.success('Categoria removida');
    setConfirm(null);
  }

  return (
    <div>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorias</h1>
          <p className="text-sm text-ink-mute">{categories.length} categoria(s)</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Nova categoria
        </Button>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Ativa</th>
              <th className="px-4 py-3">Menu</th>
              <th className="px-4 py-3">Home</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {categories.map((c) => (
              <tr key={c.id} {...editOnDoubleClick(() => setEditing(c))} className="hover:bg-bg-soft/50">
                <td className="px-4 py-3 font-semibold">
                  {c.name}
                  {c.isSeasonal && <span className="ml-2 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">SAZONAL</span>}
                </td>
                <td className="px-4 py-3 text-ink-mute">
                  {/* URL pública REAL (antes exibia só "/slug", que não é rota). */}
                  <a
                    href={categoryPath(c.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-ink hover:underline"
                  >
                    {categoryPath(c.slug)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={c.active !== false}
                    onChange={(e) => toggle(c, { active: e.target.checked })}
                    className="accent-ink"
                    aria-label={`Categoria ${c.name} ativa`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={c.showInMenu}
                    onChange={(e) => toggle(c, { showInMenu: e.target.checked })}
                    className="accent-ink"
                    aria-label={`Mostrar ${c.name} no menu`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={c.showInHome}
                    onChange={(e) => toggle(c, { showInHome: e.target.checked })}
                    className="accent-ink"
                    aria-label={`Mostrar ${c.name} na home`}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditing(c)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5 hover:text-ink"><Edit className="h-4 w-4" /></button>
                    <button onClick={() => setConfirm(c.id)} className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id && categories.find((c) => c.id === editing.id) ? 'Editar categoria' : 'Nova categoria'} maxWidth="max-w-lg">
        {editing && (
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <Label>Slug (opcional)</Label>
              <Input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="auto" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} />
            </div>
            <div>
              <Label>Imagem da categoria (opcional)</Label>
              <RemoteImageUploader
                value={editing.image ?? null}
                onUpload={async (file) => {
                  if (isNew) throw new Error('Salve a categoria antes de enviar a imagem.');
                  try {
                    const updated = await uploadCategoryImage(editing.id, file);
                    setEditing((cur) => (cur ? { ...cur, image: updated.image } : cur));
                    return updated.image ?? '';
                  } catch (err) {
                    throw new Error(err instanceof ApiError ? err.message : 'Falha no upload da imagem.');
                  }
                }}
                onRemove={async () => {
                  if (isNew) return;
                  try {
                    await removeCategoryImage(editing.id);
                    setEditing((cur) => (cur ? { ...cur, image: undefined } : cur));
                  } catch (err) {
                    throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover a imagem.');
                  }
                }}
                hint={
                  isNew
                    ? 'Salve a categoria primeiro; depois envie a imagem.'
                    : 'Salva na hora (não precisa clicar em Salvar). Aparece no card da Home e, nas categorias de material, em Materiais.'
                }
              />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-ink" />
                Ativa
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editing.showInMenu} onChange={(e) => setEditing({ ...editing, showInMenu: e.target.checked })} className="accent-ink" />
                Mostrar no menu
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editing.showInHome} onChange={(e) => setEditing({ ...editing, showInHome: e.target.checked })} className="accent-ink" />
                Mostrar na home
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Fechar</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover categoria?">
        <p className="text-sm text-ink-mute">Os produtos associados não serão removidos.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && remove(confirm)}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
