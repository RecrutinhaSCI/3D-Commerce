import { useState } from 'react';
import toast from 'react-hot-toast';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { bannerService } from '@/services/bannerService';
import { apiBannerToInternal } from '@/services/adapters';
import { ApiError } from '@/services/api';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Banner, HeroBadge } from '@/types';
import { useSEO } from '@/utils/seo';

export default function Banners() {
  useSEO('Admin Banners');
  const { banners, addBanner, updateBanner, removeBanner } = useAdminDataStore();
  const [editing, setEditing] = useState<Banner | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  function openNew() {
    setEditing({
      id: 'ban-' + Date.now(),
      title: '',
      subtitle: '',
      ctaLabel: '',
      ctaLink: '',
      image: '',
      position: 'promo',
      active: true,
      order: banners.length + 1,
      bgFrom: '#0F1115',
      bgTo: '#22D3EE',
    });
  }

  const emptyBadge: HeroBadge = { enabled: true, tag: '', title: '', info: '' };

  function updateBadge(side: 'badgeLeft' | 'badgeRight', patch: Partial<HeroBadge>) {
    if (!editing) return;
    const current = editing[side] ?? emptyBadge;
    setEditing({ ...editing, [side]: { ...current, ...patch } });
  }

  function save() {
    if (!editing) return;
    if (banners.find((b) => b.id === editing.id)) {
      updateBanner(editing.id, editing);
      toast.success('Banner atualizado');
    } else {
      addBanner(editing);
      toast.success('Banner criado');
    }
    // Mantém o modal aberto após salvar; o usuário fecha em "Fechar".
  }

  return (
    <div>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banners</h1>
          <p className="text-sm text-ink-mute">{banners.length} banner(s)</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo banner
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {banners.map((b) => (
          <div key={b.id} className="card overflow-hidden">
            <div className="relative aspect-[2.5/1] overflow-hidden bg-ink text-bg">
              {b.image ? (
                <img src={b.image} alt={b.title} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(135deg, ${b.bgFrom ?? '#0F1115'}, ${b.bgTo ?? '#22D3EE'})` }}
                />
              )}
              <div className="relative z-10 p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-bg/80 drop-shadow">
                  {b.position === 'promo' ? 'Carrossel Home' : 'Hero'} · #{b.order}
                </p>
                <h3 className="mt-2 text-lg font-bold drop-shadow">{b.title}</h3>
                {b.subtitle && <p className="mt-1 text-xs text-bg/90 drop-shadow">{b.subtitle}</p>}
                {b.ctaLabel && <p className="mt-3 inline-block rounded-md bg-bg px-2 py-1 text-[10px] font-bold text-ink">{b.ctaLabel}</p>}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 text-xs">
              <span className={`inline-flex items-center gap-1 ${b.active ? 'text-emerald-600' : 'text-ink-mute'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${b.active ? 'bg-emerald-500' : 'bg-ink-mute'}`} />
                {b.active ? 'Ativo' : 'Inativo'}
              </span>
              <div className="flex gap-1">
                <button onClick={() => updateBanner(b.id, { active: !b.active })} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-ink/5">
                  {b.active ? 'Desativar' : 'Ativar'}
                </button>
                <button onClick={() => setEditing(b)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5"><Edit className="h-4 w-4" /></button>
                <button onClick={() => setConfirm(b.id)} className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Banner" maxWidth="max-w-xl">
        {editing && (
          <div className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div>
              <Label>Subtítulo</Label>
              <Textarea value={editing.subtitle ?? ''} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CTA Label</Label>
                <Input value={editing.ctaLabel ?? ''} onChange={(e) => setEditing({ ...editing, ctaLabel: e.target.value })} />
              </div>
              <div>
                <Label>CTA Link</Label>
                <Input value={editing.ctaLink ?? ''} onChange={(e) => setEditing({ ...editing, ctaLink: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Posição</Label>
                <Select
                  value={editing.position === 'promo' ? 'promo' : 'hero'}
                  onChange={(e) => setEditing({ ...editing, position: e.target.value as Banner['position'] })}
                >
                  <option value="promo">Carrossel promocional (Home)</option>
                  <option value="hero">Hero principal</option>
                </Select>
                <p className="mt-1 text-[11px] text-ink-mute">
                  {editing.position === 'promo'
                    ? 'Aparece no carrossel de banners logo abaixo do Hero. Suporta múltiplos banners com autoplay.'
                    : 'Substitui a imagem principal do Hero. Apenas o primeiro banner ativo aparece.'}
                </p>
              </div>
              <div>
                <Label>Ordem</Label>
                <Input
                  type="number"
                  min={0}
                  value={editing.order}
                  onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) || 0 })}
                />
                <p className="mt-1 text-[11px] text-ink-mute">Menor valor aparece primeiro.</p>
              </div>
            </div>
            <div className="rounded-xl border border-ink-line p-3">
              <RemoteImageUploader
                label="Imagem do banner (opcional)"
                value={editing.image || null}
                onUpload={async (file) => {
                  // Precisa que o banner exista no backend. Se ainda não foi salvo,
                  // salvamos antes com os campos atuais e usamos o id retornado.
                  let bannerId: string | undefined;
                  const isNew = !banners.find((b) => b.id === editing.id);
                  if (isNew) {
                    try {
                      const created = await addBanner(editing);
                      bannerId = created?.id;
                      if (created) setEditing({ ...editing, id: created.id });
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Falha ao salvar banner antes do upload.');
                    }
                  } else {
                    bannerId = editing.id;
                  }
                  if (!bannerId) throw new Error('ID do banner indisponível.');
                  try {
                    const { banner } = await bannerService.uploadImage(bannerId, file);
                    const internal = apiBannerToInternal(banner);
                    setEditing({ ...editing, id: banner.id, image: internal.image });
                    return internal.image;
                  } catch (err) {
                    throw new Error(err instanceof ApiError ? err.message : 'Falha no upload.');
                  }
                }}
                onRemove={() => {
                  setEditing({ ...editing, image: '' });
                }}
                hint="JPG/PNG/WEBP até 5MB. Sobrepõe o gradiente."
              />
            </div>
            {editing.position === 'hero' && (
              <div className="space-y-3 rounded-xl border border-ink-line p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Selos sobre a imagem (Hero)</p>
                {(['badgeLeft', 'badgeRight'] as const).map((side) => {
                  const badge = editing[side] ?? emptyBadge;
                  return (
                    <div key={side} className="rounded-lg bg-bg-soft p-3">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={badge.enabled}
                          onChange={(e) => updateBadge(side, { enabled: e.target.checked })}
                          className="accent-ink"
                        />
                        {side === 'badgeLeft' ? 'Selo esquerdo' : 'Selo direito'}
                      </label>
                      {badge.enabled && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <Input placeholder="Tag (ex.: + Vendido)" value={badge.tag} onChange={(e) => updateBadge(side, { tag: e.target.value })} />
                          <Input placeholder="Título (ex.: PLA Preto 1kg)" value={badge.title} onChange={(e) => updateBadge(side, { title: e.target.value })} />
                          <Input placeholder="Info (ex.: R$ 109,90)" value={badge.info} onChange={(e) => updateBadge(side, { info: e.target.value })} />
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-[11px] text-ink-mute">Deixe um selo desmarcado para removê-lo da home.</p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-ink" />
              Ativo
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Fechar</Button>
              <Button onClick={save}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover banner?">
        <p className="text-sm text-ink-mute">Essa ação é permanente.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { if (confirm) { removeBanner(confirm); toast.success('Banner removido'); setConfirm(null); } }}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
