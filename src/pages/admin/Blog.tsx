import { ExternalLink } from 'lucide-react';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { seedBlogPosts } from '@/data/blogPosts';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { settingsService } from '@/services/settingsService';
import { apiSettingsToInternal } from '@/services/adapters';
import { ApiError } from '@/services/api';
import { bannerSvg } from '@/utils/productImage';
import { useSEO } from '@/utils/seo';

/**
 * Capas do Blog. Os posts continuam no código (`src/data/blogPosts.ts`);
 * aqui o admin só gerencia a IMAGEM de cada um (Vercel Blob, gravada nas
 * configurações da loja). Sem capa, o site usa a ilustração gerada de sempre.
 */
export default function AdminBlog() {
  useSEO('Admin Blog');
  const covers = useAdminDataStore((s) => s.settings.blogCovers);

  /** Atualiza o store com o settings devolvido pelo backend (fonte da verdade). */
  function applySettings(s: Parameters<typeof apiSettingsToInternal>[0]) {
    useAdminDataStore.setState({ settings: apiSettingsToInternal(s) });
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Blog</h1>
        <p className="text-sm text-ink-mute">
          Capas dos posts. A imagem é salva na hora do envio e aparece na lista do blog e no topo do post.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {seedBlogPosts.map((p, i) => (
          <article key={p.slug} className="card flex flex-col gap-4 p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">{p.category}</p>
              <h2 className="mt-1 line-clamp-2 font-bold leading-snug">{p.title}</h2>
              <a
                href={`/blog/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-ink-mute hover:text-ink hover:underline"
              >
                /blog/{p.slug} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {!covers?.[p.slug] && (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-ink-mute">Sem capa — o site mostra esta ilustração:</p>
                <img
                  src={bannerSvg(p.title, i, ['#0F1115', i % 2 === 0 ? '#22D3EE' : '#A78BFA'])}
                  alt=""
                  className="aspect-[16/9] w-full rounded-xl object-cover opacity-80"
                />
              </div>
            )}
            <RemoteImageUploader
              label="Capa do post"
              value={covers?.[p.slug] ?? null}
              onUpload={async (file) => {
                try {
                  const { settings } = await settingsService.uploadBlogCover(p.slug, file);
                  applySettings(settings);
                  return apiSettingsToInternal(settings).blogCovers[p.slug] ?? '';
                } catch (err) {
                  throw new Error(err instanceof ApiError ? err.message : 'Falha no upload da capa.');
                }
              }}
              onRemove={async () => {
                try {
                  const { settings } = await settingsService.removeBlogCover(p.slug);
                  applySettings(settings);
                } catch (err) {
                  throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover a capa.');
                }
              }}
              hint="JPG, PNG ou WEBP (16:9 fica melhor). Fotos grandes são reduzidas automaticamente."
            />
          </article>
        ))}
      </div>
    </div>
  );
}
