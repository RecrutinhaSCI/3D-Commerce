import { useState } from 'react';
import { ExternalLink, PenLine } from 'lucide-react';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { seedBlogPosts } from '@/data/blogPosts';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { settingsService } from '@/services/settingsService';
import { apiSettingsToInternal } from '@/services/adapters';
import { ApiError } from '@/services/api';
import { bannerSvg } from '@/utils/productImage';
import { useSEO } from '@/utils/seo';
import { resolveBlogPosts } from '@/utils/blog';
import { editOnDoubleClick } from '@/utils/rowEdit';
import { BlogPostEditor } from '@/components/admin/BlogPostEditor';
import { Button } from '@/components/ui/Button';

/**
 * Blog no admin: texto (título, categoria, resumo, tempo de leitura e
 * Markdown) e capa de cada post. O slug é fixo; o texto padrão vem de
 * `src/data/blogPosts.ts` e a versão salva aqui o sobrescreve
 * (site_settings.blog_content_json). Capas no Vercel Blob (blog_covers_json).
 */
export default function AdminBlog() {
  useSEO('Admin Blog');
  const covers = useAdminDataStore((s) => s.settings.blogCovers);
  const overrides = useAdminDataStore((s) => s.settings.blogContent);
  const posts = resolveBlogPosts(seedBlogPosts, overrides, covers);
  const [editing, setEditing] = useState<string | null>(null);
  const editingPost = posts.find((p) => p.slug === editing);
  const editingBase = seedBlogPosts.find((p) => p.slug === editing);

  /** Atualiza o store com o settings devolvido pelo backend (fonte da verdade). */
  function applySettings(s: Parameters<typeof apiSettingsToInternal>[0]) {
    useAdminDataStore.setState({ settings: apiSettingsToInternal(s) });
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Blog</h1>
        <p className="text-sm text-ink-mute">
          Edite o texto (Markdown) e a capa de cada post. A capa é salva na hora do envio; o texto, ao clicar em “Salvar post”.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {posts.map((p, i) => (
          <article key={p.slug} {...editOnDoubleClick(() => setEditing(p.slug))} className="card flex flex-col gap-4 p-5">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-mute">
                {p.category}
                <span className={`rounded px-1.5 py-0.5 ${p.customized ? 'bg-emerald-50 text-emerald-700' : 'bg-bg-soft text-ink-mute'}`}>
                  {p.customized ? 'Editado' : 'Texto padrão'}
                </span>
              </p>
              <h2 className="mt-1 line-clamp-2 font-bold leading-snug">{p.title}</h2>
              <a
                href={`/blog/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-ink-mute hover:text-ink hover:underline"
              >
                /blog/{p.slug} <ExternalLink className="h-3 w-3" />
              </a>
              <p className="mt-2 line-clamp-2 text-xs text-ink-mute">{p.excerpt}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setEditing(p.slug)}>
                <PenLine className="h-4 w-4" /> Editar texto
              </Button>
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
      {editingPost && editingBase && (
        <BlogPostEditor key={editingPost.slug} post={editingPost} base={editingBase} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
