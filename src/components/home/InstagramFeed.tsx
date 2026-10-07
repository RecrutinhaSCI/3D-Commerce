import { Instagram } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { site } from '@/config/site';
import { productSvg } from '@/utils/productImage';
import { Carousel } from '@/components/ui/Carousel';
import { apiAssetUrl } from '@/services/api';

const placeholderTiles = Array.from({ length: 6 }, (_, i) => ({
  id: `ph-${i}`,
  img: productSvg(['PLA', 'PETG', 'ABS', 'Resin', 'Print', 'Maker'][i] ?? 'P', 'filament', 500 + i * 17),
}));

/**
 * Seção "Acompanhe no Instagram".
 * - Posts curados no admin (`instagramItems`) têm prioridade e cada tile linka
 *   para o post original.
 * - Sem posts cadastrados, cai em placeholders neutros para não deixar buraco;
 *   os placeholders levam ao perfil oficial.
 */
export function InstagramFeed() {
  const settings = useAdminDataStore((s) => s.settings);
  if (!settings.communityInstagramEnabled) return null;

  const url = settings.instagram || site.instagram;
  const handle = settings.instagramHandle || site.instagramHandle;

  const items = settings.instagramItems
    .filter((it) => it.enabled !== false && it.image && it.url)
    .map((it, idx) => ({
      id: `ig-${idx}`,
      img: it.image.startsWith('http') ? it.image : apiAssetUrl(it.image),
      href: it.url,
      alt: it.caption || 'Post no Instagram',
    }));

  const hasCurated = items.length > 0;
  const tiles = hasCurated
    ? items
    : placeholderTiles.map((t) => ({ id: t.id, img: t.img, href: url, alt: '' }));

  return (
    <section className="container-x pb-8 pt-16">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Instagram</p>
          <h2 className="mt-1 text-3xl font-bold">{settings.communityInstagramTitle}</h2>
          {settings.communityInstagramSubtitle && (
            <p className="mt-1 text-sm text-ink-mute">{settings.communityInstagramSubtitle}</p>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-sm font-semibold text-ink-soft hover:text-ink md:inline-flex"
          >
            {handle} →
          </a>
        )}
      </div>

      <Carousel ariaLabel="Instagram" itemClassName="w-[40%] sm:w-[28%] md:w-[16%]" gapClassName="gap-2">
        {tiles.map((t) => (
          <a
            key={t.id}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.alt || `Abrir Instagram ${handle || ''}`.trim()}
            className="group relative block aspect-square overflow-hidden rounded-xl"
          >
            <img
              src={t.img}
              alt={t.alt}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-ink/0 transition group-hover:bg-ink/40">
              <Instagram className="h-5 w-5 text-bg opacity-0 transition group-hover:opacity-100" />
            </div>
          </a>
        ))}
      </Carousel>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink md:hidden"
        >
          <Instagram className="h-4 w-4" /> {handle} →
        </a>
      )}
    </section>
  );
}
