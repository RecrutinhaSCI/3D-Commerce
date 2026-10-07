import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Banner } from '@/types';

const AUTOPLAY_MS = 6000;

function BannerContent({ banner }: { banner: Banner }) {
  const hasImage = Boolean(banner.image);
  const inner = (
    <div className="relative h-full w-full">
      {hasImage ? (
        <img
          src={banner.image}
          alt={banner.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${banner.bgFrom ?? '#0F1115'}, ${banner.bgTo ?? '#22D3EE'})`,
          }}
        />
      )}

      {(banner.title || banner.subtitle || banner.ctaLabel) && (
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-ink/70 via-ink/20 to-transparent p-5 md:items-center md:p-10">
          <div className="max-w-xl text-bg">
            {banner.title && (
              <h3 className="font-display text-xl font-bold leading-tight drop-shadow-lg md:text-3xl lg:text-4xl">
                {banner.title}
              </h3>
            )}
            {banner.subtitle && (
              <p className="mt-1 text-xs text-bg/90 drop-shadow md:mt-3 md:text-base">{banner.subtitle}</p>
            )}
            {banner.ctaLabel && (
              <span className="mt-3 inline-flex items-center gap-2 rounded-xl bg-bg px-4 py-2 text-xs font-bold text-ink shadow-lg md:mt-5 md:px-5 md:py-2.5 md:text-sm">
                {banner.ctaLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (banner.ctaLink) {
    const external = /^https?:\/\//i.test(banner.ctaLink);
    if (external) {
      return (
        <a href={banner.ctaLink} target="_blank" rel="noreferrer" className="block h-full w-full">
          {inner}
        </a>
      );
    }
    return (
      <Link to={banner.ctaLink} className="block h-full w-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function PromoCarousel() {
  const banners = useAdminDataStore((s) =>
    s.banners
      .filter((b) => b.position === 'promo' && b.active)
      .sort((a, b) => a.order - b.order),
  );

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const count = banners.length;
  const hasMany = count > 1;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (!hasMany || paused) return;
    timerRef.current = window.setTimeout(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [index, hasMany, paused, count]);

  const current = useMemo(() => banners[index] ?? banners[0], [banners, index]);

  if (count === 0 || !current) return null;

  function prev() {
    setIndex((i) => (i - 1 + count) % count);
  }
  function next() {
    setIndex((i) => (i + 1) % count);
  }

  return (
    <section className="container-x py-6 md:py-10" aria-label="Banners promocionais">
      <div
        className="group relative overflow-hidden rounded-2xl border border-ink-line/60 bg-ink shadow-lg md:rounded-3xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="relative aspect-[16/9] w-full sm:aspect-[21/9] md:aspect-[3/1]">
          <div
            className="flex h-full w-full transition-transform duration-700 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {banners.map((b) => (
              <div key={b.id} className="relative h-full w-full flex-shrink-0">
                <BannerContent banner={b} />
              </div>
            ))}
          </div>

          {hasMany && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Banner anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-ink/40 p-2 text-bg opacity-0 backdrop-blur transition hover:bg-ink/70 focus:opacity-100 group-hover:opacity-100 md:left-4"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Próximo banner"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-ink/40 p-2 text-bg opacity-0 backdrop-blur transition hover:bg-ink/70 focus:opacity-100 group-hover:opacity-100 md:right-4"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 md:bottom-5">
                {banners.map((b, i) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Ir para banner ${i + 1}`}
                    aria-current={i === index}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? 'w-8 bg-bg' : 'w-2.5 bg-bg/50 hover:bg-bg/80'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
