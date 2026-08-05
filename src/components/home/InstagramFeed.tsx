import { Instagram } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { site } from '@/config/site';
import { productSvg } from '@/utils/productImage';
import { Carousel } from '@/components/ui/Carousel';

const tiles = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  img: productSvg(['PLA', 'PETG', 'ABS', 'Resin', 'Print', 'Maker'][i] ?? 'P', 'filament', 500 + i * 17),
}));

/**
 * Seção "Acompanhe no Instagram" (R17: editável via Configurações).
 * Oculta quando desativada. URL/handle vêm dos settings com fallback do site.
 */
export function InstagramFeed() {
  const settings = useAdminDataStore((s) => s.settings);
  if (!settings.communityInstagramEnabled) return null;

  const url = settings.instagram || site.instagram;
  const handle = settings.instagramHandle || site.instagramHandle;

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
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block aspect-square overflow-hidden rounded-xl"
          >
            <img src={t.img} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
            <div className="absolute inset-0 flex items-center justify-center bg-ink/0 transition group-hover:bg-ink/40">
              <Instagram className="h-5 w-5 text-bg opacity-0 transition group-hover:opacity-100" />
            </div>
          </a>
        ))}
      </Carousel>
    </section>
  );
}
