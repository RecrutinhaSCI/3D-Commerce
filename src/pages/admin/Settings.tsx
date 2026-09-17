import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { settingsService } from '@/services/settingsService';
import { apiSettingsToInternal } from '@/services/adapters';
import { ApiError } from '@/services/api';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { InstagramItemContent, StoreSettings, TrustItemContent, YoutubeVideoItem } from '@/types';
import { apiAssetUrl } from '@/services/api';
import { useSEO } from '@/utils/seo';

const schema = z.object({
  name: z.string().min(2),
  whatsapp: z.string().min(8),
  instagram: z.string().url().optional().or(z.literal('')),
  email: z.string().email(),
  address: z.string().min(5),
  cnpj: z.string().min(5),
  about: z.string().min(20),
  shippingNote: z.string().min(5),
  freeShippingThreshold: z.coerce.number().min(0),
  pixDiscountPercent: z.coerce.number().min(0).max(100),
});
type Data = z.infer<typeof schema>;

/** URL válida vazia ou http/https (validação visual leve; backend revalida). */
function isSafeUrlOrEmpty(v: string): boolean {
  return v === '' || /^https?:\/\/[^\s]+$/i.test(v.trim());
}

/** Monta o estado do editor de conteúdo a partir das settings do store. */
function contentFromSettings(s: StoreSettings) {
  return {
    instagramHandle: s.instagramHandle,
    youtubeUrl: s.youtubeUrl,
    youtubeHandle: s.youtubeHandle,
    communityInstagramEnabled: s.communityInstagramEnabled,
    communityInstagramTitle: s.communityInstagramTitle,
    communityInstagramSubtitle: s.communityInstagramSubtitle,
    instagramItems: s.instagramItems.map((it) => ({ ...it })) as InstagramItemContent[],
    youtubeSectionEnabled: s.youtubeSectionEnabled,
    youtubeSectionTitle: s.youtubeSectionTitle,
    youtubeSectionSubtitle: s.youtubeSectionSubtitle,
    youtubeChannelUrl: s.youtubeChannelUrl,
    youtubeChannelLabel: s.youtubeChannelLabel,
    youtubeVideos: s.youtubeVideos.map((v) => ({ ...v })) as YoutubeVideoItem[],
    newsletterEnabled: s.newsletterEnabled,
    newsletterEyebrow: s.newsletterEyebrow,
    newsletterTitle: s.newsletterTitle,
    newsletterDescription: s.newsletterDescription,
    newsletterButtonText: s.newsletterButtonText,
    newsletterPlaceholder: s.newsletterPlaceholder,
    newsletterSuccessMessage: s.newsletterSuccessMessage,
    trustBlockEnabled: s.trustBlockEnabled,
    trustItems: s.trustItems.map((t) => ({ ...t })) as TrustItemContent[],
    footerDescription: s.footerDescription,
    footerShowSocials: s.footerShowSocials,
  };
}

export default function Settings() {
  useSEO('Admin Configurações');
  const { settings, updateSettings } = useAdminDataStore();
  const [logo, setLogo] = useState<string>(settings.logo ?? '');
  const { register, handleSubmit, formState: { errors } } = useForm<Data>({
    resolver: zodResolver(schema),
    defaultValues: settings,
  });

  // Estado do editor de CONTEÚDO (R17) — separado do form base.
  const [content, setContent] = useState(() => contentFromSettings(settings));
  const [savingContent, setSavingContent] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-sincroniza quando as settings chegam da API (evita editor vazio se o
  // componente montou antes do carregamento). Não sobrescreve edições em curso.
  useEffect(() => {
    if (!dirty) setContent(contentFromSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  function setC<K extends keyof typeof content>(key: K, value: (typeof content)[K]) {
    setDirty(true);
    setContent((c) => ({ ...c, [key]: value }));
  }

  async function onSubmit(d: Data) {
    const res = await updateSettings({ ...(d as Partial<StoreSettings>), logo: logo || undefined });
    if (res.ok) toast.success('Configurações salvas');
    else toast.error(res.error ?? 'Erro ao salvar.');
  }

  function validateContentUrls(): string | null {
    const urls: [string, string][] = [
      ['YouTube (rede social)', content.youtubeUrl],
      ['Link do canal', content.youtubeChannelUrl],
    ];
    for (const [label, u] of urls) {
      if (!isSafeUrlOrEmpty(u)) return `${label}: URL inválida (use http:// ou https://).`;
    }
    for (const v of content.youtubeVideos) {
      if (v.title.trim() && !isSafeUrlOrEmpty(v.url)) return `Vídeo "${v.title}": URL inválida.`;
      if (v.thumbnail && !isSafeUrlOrEmpty(v.thumbnail)) return `Vídeo "${v.title}": thumbnail inválida.`;
    }
    for (const it of content.instagramItems) {
      if (it.image && !isSafeUrlOrEmpty(it.url)) return `Post do Instagram: link inválido (use http:// ou https://).`;
    }
    return null;
  }

  async function saveContent() {
    const urlErr = validateContentUrls();
    if (urlErr) {
      toast.error(urlErr);
      return;
    }
    setSavingContent(true);
    const patch: Partial<StoreSettings> = {
      ...content,
      // Só envia vídeos com título e URL preenchidos.
      youtubeVideos: content.youtubeVideos
        .filter((v) => v.title.trim() && v.url.trim())
        .slice(0, 6),
      trustItems: content.trustItems.filter((t) => t.title.trim()),
      instagramItems: content.instagramItems
        .filter((it) => it.image.trim() && it.url.trim())
        .slice(0, 12),
    };
    const res = await updateSettings(patch);
    setSavingContent(false);
    if (res.ok) {
      setDirty(false); // permite re-sincronizar com o estado salvo
      toast.success('Conteúdos salvos');
    } else {
      toast.error(res.error ?? 'Erro ao salvar conteúdos.');
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Configurações da loja</h1>
        <p className="text-sm text-ink-mute">Edite informações e conteúdos que aparecem no site público.</p>
      </header>

      {/* ---------------- Form base ---------------- */}
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-5 lg:col-span-2">
          <h2 className="text-base font-bold">Identidade</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label>Nome da loja</Label><Input {...register('name')} error={errors.name?.message} /></div>
            <div><Label>CNPJ</Label><Input {...register('cnpj')} error={errors.cnpj?.message} /></div>
          </div>
          <div className="rounded-xl border border-ink-line p-3">
            <RemoteImageUploader
              label="Logo da loja (opcional)"
              value={logo || null}
              onUpload={async (file) => {
                try {
                  const { settings: s } = await settingsService.uploadLogo(file);
                  const internal = apiSettingsToInternal(s);
                  const url = internal.logo ?? '';
                  setLogo(url);
                  return url;
                } catch (err) {
                  throw new Error(err instanceof ApiError ? err.message : 'Falha no upload.');
                }
              }}
              onRemove={async () => {
                try {
                  const { settings: s } = await settingsService.update({ logoUrl: null });
                  const internal = apiSettingsToInternal(s);
                  setLogo(internal.logo ?? '');
                } catch (err) {
                  throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover logo.');
                }
              }}
              hint="JPG/PNG/WEBP até 5MB. Sobrepõe o logo padrão no header e footer."
            />
          </div>
          <div>
            <Label>Sobre a empresa</Label>
            <Textarea {...register('about')} rows={4} error={errors.about?.message} />
          </div>
        </div>

        <div className="card space-y-4 p-5">
          <h2 className="text-base font-bold">Contato</h2>
          <div><Label>WhatsApp (somente números, com DDD)</Label><Input {...register('whatsapp')} error={errors.whatsapp?.message} /></div>
          <div><Label>E-mail</Label><Input {...register('email')} error={errors.email?.message} /></div>
          <div><Label>Instagram (URL)</Label><Input {...register('instagram')} error={errors.instagram?.message} /></div>
          <div><Label>Endereço</Label><Input {...register('address')} error={errors.address?.message} /></div>
        </div>

        <div className="card space-y-4 p-5">
          <h2 className="text-base font-bold">Frete e pagamentos</h2>
          <div><Label>Mensagem de envio (topbar)</Label><Input {...register('shippingNote')} error={errors.shippingNote?.message} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Frete grátis a partir de (R$)</Label><Input type="number" {...register('freeShippingThreshold')} error={errors.freeShippingThreshold?.message} /></div>
            <div><Label>Desconto Pix (%)</Label><Input type="number" {...register('pixDiscountPercent')} error={errors.pixDiscountPercent?.message} /></div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <Button type="submit" size="lg"><Save className="h-4 w-4" /> Salvar identidade e contato</Button>
        </div>
      </form>

      {/* ---------------- Conteúdo editável (R17) ---------------- */}
      <div className="space-y-5">
        <h2 className="text-lg font-bold">Conteúdo do site</h2>

        {/* Redes sociais */}
        <div className="card space-y-4 p-5">
          <h3 className="text-base font-bold">Redes sociais</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Instagram — handle (ex: @loja)</Label>
              <Input value={content.instagramHandle} onChange={(e) => setC('instagramHandle', e.target.value)} />
            </div>
            <div>
              <Label>YouTube — handle (ex: @canal)</Label>
              <Input value={content.youtubeHandle} onChange={(e) => setC('youtubeHandle', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>YouTube — URL do canal</Label>
              <Input
                value={content.youtubeUrl}
                onChange={(e) => setC('youtubeUrl', e.target.value)}
                placeholder="https://www.youtube.com/@seucanal"
                error={!isSafeUrlOrEmpty(content.youtubeUrl) ? 'URL inválida.' : undefined}
              />
              <p className="mt-1 text-[11px] text-ink-mute">Aparece como ícone no rodapé.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={content.footerShowSocials} onChange={(e) => setC('footerShowSocials', e.target.checked)} className="accent-ink" />
            Mostrar ícones sociais no rodapé
          </label>
          <div>
            <Label>Descrição do rodapé (opcional)</Label>
            <Textarea rows={2} value={content.footerDescription} onChange={(e) => setC('footerDescription', e.target.value)} />
          </div>
        </div>

        {/* Comunidade Instagram */}
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Seção Instagram</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={content.communityInstagramEnabled} onChange={(e) => setC('communityInstagramEnabled', e.target.checked)} className="accent-ink" />
              Ativa
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label>Título</Label><Input value={content.communityInstagramTitle} onChange={(e) => setC('communityInstagramTitle', e.target.value)} /></div>
            <div><Label>Subtítulo</Label><Input value={content.communityInstagramSubtitle} onChange={(e) => setC('communityInstagramSubtitle', e.target.value)} /></div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Posts (máx. 12)</p>
              {content.instagramItems.length < 12 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setC('instagramItems', [...content.instagramItems, { image: '', url: '', caption: '', enabled: true }])}
                >
                  <Plus className="h-4 w-4" /> Adicionar post
                </Button>
              )}
            </div>
            {content.instagramItems.length === 0 && (
              <p className="rounded-lg bg-bg-soft p-3 text-xs text-ink-mute">
                Nenhum post cadastrado. Adicione as imagens e links dos posts reais do perfil da 3DCommerce.
              </p>
            )}
            {content.instagramItems.map((it, i) => (
              <div key={i} className="rounded-xl border border-ink-line p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink-mute">Post {i + 1}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (i === 0) return;
                        const arr = [...content.instagramItems];
                        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                        setC('instagramItems', arr);
                      }}
                      disabled={i === 0}
                      className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-ink/5 disabled:opacity-30"
                      aria-label="Subir ordem"
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (i === content.instagramItems.length - 1) return;
                        const arr = [...content.instagramItems];
                        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                        setC('instagramItems', arr);
                      }}
                      disabled={i === content.instagramItems.length - 1}
                      className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-ink/5 disabled:opacity-30"
                      aria-label="Descer ordem"
                    >↓</button>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={it.enabled !== false}
                        onChange={(e) => {
                          const arr = [...content.instagramItems];
                          arr[i] = { ...it, enabled: e.target.checked };
                          setC('instagramItems', arr);
                        }}
                        className="accent-ink"
                      />
                      Ativo
                    </label>
                    <button
                      type="button"
                      onClick={() => setC('instagramItems', content.instagramItems.filter((_, j) => j !== i))}
                      className="rounded-lg p-1 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remover post"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Link do post no Instagram (https://instagram.com/p/...)"
                    value={it.url}
                    onChange={(e) => {
                      const arr = [...content.instagramItems];
                      arr[i] = { ...it, url: e.target.value };
                      setC('instagramItems', arr);
                    }}
                    error={it.image && !isSafeUrlOrEmpty(it.url) ? 'URL inválida' : undefined}
                  />
                  <Input
                    placeholder="Legenda curta (opcional)"
                    value={it.caption ?? ''}
                    onChange={(e) => {
                      const arr = [...content.instagramItems];
                      arr[i] = { ...it, caption: e.target.value };
                      setC('instagramItems', arr);
                    }}
                  />
                </div>
                <div className="mt-3 border-t border-ink-line pt-3">
                  <RemoteImageUploader
                    label="Imagem do post"
                    hint="JPG/PNG/WEBP até 5MB. Recomendado 1080x1080 (quadrado)."
                    value={it.image ? (it.image.startsWith('http') ? it.image : apiAssetUrl(it.image)) : null}
                    onUpload={async (file) => {
                      const { url } = await settingsService.uploadImage(file);
                      const arr = [...content.instagramItems];
                      arr[i] = { ...it, image: url };
                      setC('instagramItems', arr);
                      return url;
                    }}
                    onRemove={() => {
                      const arr = [...content.instagramItems];
                      arr[i] = { ...it, image: '' };
                      setC('instagramItems', arr);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Comunidade YouTube + vídeos */}
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Seção YouTube</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={content.youtubeSectionEnabled} onChange={(e) => setC('youtubeSectionEnabled', e.target.checked)} className="accent-ink" />
              Ativa
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label>Título</Label><Input value={content.youtubeSectionTitle} onChange={(e) => setC('youtubeSectionTitle', e.target.value)} /></div>
            <div><Label>Subtítulo</Label><Input value={content.youtubeSectionSubtitle} onChange={(e) => setC('youtubeSectionSubtitle', e.target.value)} /></div>
            <div>
              <Label>URL do canal</Label>
              <Input value={content.youtubeChannelUrl} onChange={(e) => setC('youtubeChannelUrl', e.target.value)} error={!isSafeUrlOrEmpty(content.youtubeChannelUrl) ? 'URL inválida.' : undefined} />
            </div>
            <div><Label>Rótulo do link do canal</Label><Input value={content.youtubeChannelLabel} onChange={(e) => setC('youtubeChannelLabel', e.target.value)} /></div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Vídeos (máx. 3 na home)</p>
              {content.youtubeVideos.length < 6 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setC('youtubeVideos', [...content.youtubeVideos, { title: '', url: '', thumbnail: '', description: '', enabled: true }])}
                >
                  <Plus className="h-4 w-4" /> Adicionar vídeo
                </Button>
              )}
            </div>
            {content.youtubeVideos.length === 0 && (
              <p className="rounded-lg bg-bg-soft p-3 text-xs text-ink-mute">Nenhum vídeo. A seção fica oculta na home.</p>
            )}
            {content.youtubeVideos.map((v, i) => (
              <div key={i} className="rounded-xl border border-ink-line p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink-mute">Vídeo {i + 1}</p>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={v.enabled !== false} onChange={(e) => { const arr = [...content.youtubeVideos]; arr[i] = { ...v, enabled: e.target.checked }; setC('youtubeVideos', arr); }} className="accent-ink" />
                      Ativo
                    </label>
                    <button type="button" onClick={() => setC('youtubeVideos', content.youtubeVideos.filter((_, j) => j !== i))} className="rounded-lg p-1 text-ink-mute hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input placeholder="Título" value={v.title} onChange={(e) => { const arr = [...content.youtubeVideos]; arr[i] = { ...v, title: e.target.value }; setC('youtubeVideos', arr); }} />
                  <Input placeholder="URL do vídeo" value={v.url} onChange={(e) => { const arr = [...content.youtubeVideos]; arr[i] = { ...v, url: e.target.value }; setC('youtubeVideos', arr); }} error={v.title.trim() && !isSafeUrlOrEmpty(v.url) ? 'URL inválida' : undefined} />
                  <Input placeholder="Descrição curta (opcional)" value={v.description ?? ''} onChange={(e) => { const arr = [...content.youtubeVideos]; arr[i] = { ...v, description: e.target.value }; setC('youtubeVideos', arr); }} />
                  <Input placeholder="Thumbnail (URL, opcional — se preferir colar direto)" value={v.thumbnail ?? ''} onChange={(e) => { const arr = [...content.youtubeVideos]; arr[i] = { ...v, thumbnail: e.target.value }; setC('youtubeVideos', arr); }} />
                </div>
                <div className="mt-3 border-t border-ink-line pt-3">
                  <RemoteImageUploader
                    label="Thumbnail (upload)"
                    hint="JPG/PNG/WEBP até 5MB. Se vazio, usamos a thumbnail automática do YouTube."
                    value={v.thumbnail ? (v.thumbnail.startsWith('http') ? v.thumbnail : v.thumbnail) : null}
                    onUpload={async (file) => {
                      const { url } = await settingsService.uploadImage(file);
                      const arr = [...content.youtubeVideos];
                      arr[i] = { ...v, thumbnail: url };
                      setC('youtubeVideos', arr);
                      return url;
                    }}
                    onRemove={() => {
                      const arr = [...content.youtubeVideos];
                      arr[i] = { ...v, thumbnail: '' };
                      setC('youtubeVideos', arr);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Newsletter */}
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Newsletter</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={content.newsletterEnabled} onChange={(e) => setC('newsletterEnabled', e.target.checked)} className="accent-ink" />
              Ativa
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label>Eyebrow</Label><Input value={content.newsletterEyebrow} onChange={(e) => setC('newsletterEyebrow', e.target.value)} /></div>
            <div><Label>Título</Label><Input value={content.newsletterTitle} onChange={(e) => setC('newsletterTitle', e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Descrição</Label><Input value={content.newsletterDescription} onChange={(e) => setC('newsletterDescription', e.target.value)} /></div>
            <div><Label>Texto do botão</Label><Input value={content.newsletterButtonText} onChange={(e) => setC('newsletterButtonText', e.target.value)} /></div>
            <div><Label>Placeholder do campo</Label><Input value={content.newsletterPlaceholder} onChange={(e) => setC('newsletterPlaceholder', e.target.value)} /></div>
            <div className="md:col-span-2"><Label>Mensagem de sucesso</Label><Input value={content.newsletterSuccessMessage} onChange={(e) => setC('newsletterSuccessMessage', e.target.value)} /></div>
          </div>
        </div>

        {/* Blocos de confiança */}
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Blocos de confiança (página de produto)</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={content.trustBlockEnabled} onChange={(e) => setC('trustBlockEnabled', e.target.checked)} className="accent-ink" />
              Ativo
            </label>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-mute">Se vazio, usa os itens padrão (envio, compra segura, suporte, atendimento).</p>
            {content.trustItems.length < 8 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setC('trustItems', [...content.trustItems, { title: '', description: '', enabled: true }])}>
                <Plus className="h-4 w-4" /> Adicionar item
              </Button>
            )}
          </div>
          {content.trustItems.map((t, i) => (
            <div key={i} className="rounded-xl border border-ink-line p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-ink-mute">Item {i + 1}</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={t.enabled !== false} onChange={(e) => { const arr = [...content.trustItems]; arr[i] = { ...t, enabled: e.target.checked }; setC('trustItems', arr); }} className="accent-ink" />
                    Ativo
                  </label>
                  <button type="button" onClick={() => setC('trustItems', content.trustItems.filter((_, j) => j !== i))} className="rounded-lg p-1 text-ink-mute hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input placeholder="Título" value={t.title} onChange={(e) => { const arr = [...content.trustItems]; arr[i] = { ...t, title: e.target.value }; setC('trustItems', arr); }} />
                <Input placeholder="Descrição (opcional)" value={t.description ?? ''} onChange={(e) => { const arr = [...content.trustItems]; arr[i] = { ...t, description: e.target.value }; setC('trustItems', arr); }} />
              </div>
            </div>
          ))}
        </div>

        <Button size="lg" onClick={saveContent} loading={savingContent}>
          <Save className="h-4 w-4" /> Salvar conteúdos do site
        </Button>
      </div>
    </div>
  );
}
