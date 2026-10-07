import { Play, Youtube } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { productSvg } from '@/utils/productImage';
import { youtubeAutoThumb } from '@/utils/youtube';
import { apiAssetUrl } from '@/services/api';

/**
 * Seção "Assista no YouTube" (R16/R17). Conteúdo editável via Configurações.
 * - Oculta se a seção estiver desativada ou sem vídeos ativos (sem buraco).
 * - Links externos abrem em nova aba com rel="noopener noreferrer".
 * - Thumbnail cai para um placeholder SVG quando não informada.
 */
export function YouTubeSection() {
  const settings = useAdminDataStore((s) => s.settings);
  const { youtubeSectionEnabled, youtubeSectionTitle, youtubeSectionSubtitle, youtubeChannelUrl, youtubeChannelLabel } = settings;

  const videos = settings.youtubeVideos.filter((v) => v.enabled !== false && v.url).slice(0, 3);
  if (!youtubeSectionEnabled || videos.length === 0) return null;

  return (
    <section className="container-x pb-16">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">YouTube</p>
          <h2 className="mt-1 text-3xl font-bold">{youtubeSectionTitle}</h2>
          {youtubeSectionSubtitle && <p className="mt-1 text-sm text-ink-mute">{youtubeSectionSubtitle}</p>}
        </div>
        {youtubeChannelUrl && (
          <a
            href={youtubeChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink md:inline-flex"
          >
            <Youtube className="h-4 w-4 text-rose-600" /> {youtubeChannelLabel} →
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {videos.map((v, i) => {
          // Prioridade da thumbnail:
          //   1. Cadastrada pelo admin (upload → /uploads/site ou URL externa);
          //   2. Thumbnail automática do YouTube (i.ytimg.com/vi/<id>/hqdefault.jpg);
          //   3. Placeholder SVG local (evita imagem quebrada em qualquer caso).
          const uploaded = v.thumbnail ? apiAssetUrl(v.thumbnail) || v.thumbnail : '';
          const auto = youtubeAutoThumb(v.url);
          const fallback = productSvg(v.title, 'filament', v.title.length + i);
          const primary = uploaded || auto || fallback;
          return (
          <a
            key={i}
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group overflow-hidden rounded-2xl border border-ink-line bg-bg-card transition hover:border-ink/20 hover:shadow-soft"
          >
            <div className="relative aspect-video overflow-hidden bg-bg-soft">
              <img
                src={primary}
                alt={v.title}
                loading="lazy"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement;
                  // 1º erro tenta thumb do YouTube; 2º cai no placeholder.
                  if (auto && el.src !== auto) el.src = auto;
                  else if (el.src !== fallback) el.src = fallback;
                }}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-ink/10 transition group-hover:bg-ink/30">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg">
                  <Play className="h-5 w-5 translate-x-0.5" fill="currentColor" />
                </span>
              </div>
            </div>
            <div className="p-4">
              <h3 className="line-clamp-2 text-sm font-semibold text-ink group-hover:text-rose-600">{v.title}</h3>
              {v.description && <p className="mt-1 line-clamp-2 text-xs text-ink-mute">{v.description}</p>}
            </div>
          </a>
          );
        })}
      </div>

      {youtubeChannelUrl && (
        <a
          href={youtubeChannelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-rose-600 hover:underline md:hidden"
        >
          <Youtube className="h-4 w-4" /> {youtubeChannelLabel} →
        </a>
      )}
    </section>
  );
}
