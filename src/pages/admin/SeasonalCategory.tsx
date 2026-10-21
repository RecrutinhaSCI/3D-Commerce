import { useState } from 'react';
import toast from 'react-hot-toast';
import slugify from 'slugify';
import { Sparkles, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { ApiError } from '@/services/api';
import type { Category } from '@/types';
import { useSEO } from '@/utils/seo';

export default function SeasonalCategory() {
  useSEO('Admin Categoria Sazonal');
  const { categories, updateCategory, addCategory, products, uploadCategoryImage, removeCategoryImage } =
    useAdminDataStore();
  const seasonal = categories.find((c) => c.isSeasonal);
  const [draft, setDraft] = useState<Category>(
    seasonal ?? {
      id: 'cat-sazonal-' + Date.now(),
      slug: '',
      name: '',
      description: '',
      showInMenu: true,
      showInHome: true,
      order: 99,
      isSeasonal: true,
      seasonalActive: true,
      seasonalBanner: '',
      productIds: [],
    },
  );

  const isNew = !categories.some((c) => c.id === draft.id);

  // Sucesso só depois da confirmação do backend.
  async function save() {
    if (!draft.name) {
      toast.error('Informe o nome');
      return;
    }
    const payload = { ...draft, slug: draft.slug || slugify(draft.name, { lower: true, strict: true }) };
    if (!isNew) {
      if (!(await updateCategory(payload.id, payload))) return void toast.error('Não foi possível salvar.');
    } else {
      const created = await addCategory(payload);
      if (!created) return void toast.error('Não foi possível criar a categoria sazonal.');
      setDraft({ ...payload, id: created.id, slug: created.slug });
    }
    toast.success('Categoria sazonal salva');
  }

  function toggleProduct(id: string) {
    const set = new Set(draft.productIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setDraft({ ...draft, productIds: Array.from(set) });
  }

  return (
    <div>
      <header className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          <Sparkles className="h-3 w-3" /> Categoria sazonal
        </div>
        <h1 className="mt-2 text-2xl font-bold">Configurar categoria sazonal</h1>
        <p className="text-sm text-ink-mute">Ative coleções temporárias e edite tudo sem mexer no código.</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section className="card p-5">
            <h2 className="text-base font-bold">Identidade</h2>
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={!!draft.seasonalActive}
                  onChange={(e) => setDraft({ ...draft, seasonalActive: e.target.checked })}
                  className="accent-ink"
                />
                Ativar campanha sazonal
              </label>
              <div>
                <Label>Nome (ex: Copa do Mundo)</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <Label>Slug (opcional)</Label>
                <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="auto" />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} />
              </div>
              <div>
                <Label>Texto do banner</Label>
                <Input value={draft.seasonalBanner ?? ''} onChange={(e) => setDraft({ ...draft, seasonalBanner: e.target.value })} />
              </div>
              <div className="rounded-xl border border-ink-line p-3">
                <RemoteImageUploader
                  label="Imagem do banner (opcional)"
                  value={draft.seasonalBannerImage ?? null}
                  onUpload={async (file) => {
                    if (isNew) throw new Error('Salve a categoria sazonal antes de enviar a imagem.');
                    try {
                      const updated = await uploadCategoryImage(draft.id, file, 'seasonal');
                      setDraft((cur) => ({ ...cur, seasonalBannerImage: updated.seasonalBannerImage }));
                      return updated.seasonalBannerImage ?? '';
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Falha no upload da imagem.');
                    }
                  }}
                  onRemove={async () => {
                    if (isNew) return;
                    try {
                      await removeCategoryImage(draft.id, 'seasonal');
                      setDraft((cur) => ({ ...cur, seasonalBannerImage: undefined }));
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover a imagem.');
                    }
                  }}
                  hint="Salva na hora no armazenamento da loja. Aparece atrás do gradiente quando preenchida."
                />
              </div>
              <div className="flex gap-5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.showInMenu} onChange={(e) => setDraft({ ...draft, showInMenu: e.target.checked })} className="accent-ink" />
                  Mostrar no menu
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.showInHome} onChange={(e) => setDraft({ ...draft, showInHome: e.target.checked })} className="accent-ink" />
                  Mostrar na home
                </label>
              </div>
            </div>
          </section>

          <section className="card mt-6 p-5">
            <h2 className="text-base font-bold">Produtos associados</h2>
            <p className="text-xs text-ink-mute">Selecione os produtos que farão parte da campanha.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.map((p) => {
                const sel = draft.productIds?.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProduct(p.id)}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-left text-xs ${
                      sel ? 'border-ink bg-bg-soft' : 'border-ink-line'
                    }`}
                  >
                    <img src={p.images[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    <span className="line-clamp-2 font-semibold">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside>
          <div className="card p-5">
            <h3 className="text-sm font-bold">Preview</h3>
            <div className="mt-3 rounded-xl bg-gradient-to-r from-emerald-600 to-ink p-5 text-bg">
              <p className="text-[10px] font-bold uppercase tracking-widest">Edição especial</p>
              <h4 className="mt-2 text-xl font-bold">{draft.seasonalBanner || draft.name || 'Nova campanha'}</h4>
              <p className="mt-1 text-xs text-bg/80">{draft.description}</p>
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              {draft.seasonalActive ? 'A campanha está ativa e aparecerá no menu e/ou na home.' : 'Campanha desativada.'}
            </p>
          </div>
          <Button onClick={save} className="mt-4" fullWidth size="lg">
            <Save className="h-4 w-4" /> Salvar campanha
          </Button>
        </aside>
      </div>
    </div>
  );
}
