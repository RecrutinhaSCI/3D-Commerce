import { useAdminDataStore } from '@/store/useAdminDataStore';
import { SeasonalHero } from '@/components/seasonal/SeasonalHero';

/** Banner da campanha sazonal na Home — usa o mesmo SeasonalHero da página da campanha. */
export function SeasonalBanner() {
  const seasonal = useAdminDataStore((s) =>
    s.categories.find((c) => c.isSeasonal && c.seasonalActive && c.showInHome),
  );
  if (!seasonal) return null;

  return (
    <section className="container-x py-8">
      <SeasonalHero category={seasonal} variant="banner" />
    </section>
  );
}
