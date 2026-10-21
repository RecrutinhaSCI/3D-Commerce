import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { categoryPath } from '@/utils/categoryGroups';
import { resolveSeasonalColors } from '@/utils/seasonalTheme';

export function SeasonalBanner() {
  const seasonal = useAdminDataStore((s) =>
    s.categories.find((c) => c.isSeasonal && c.seasonalActive && c.showInHome),
  );
  if (!seasonal) return null;
  const colors = resolveSeasonalColors(seasonal.seasonalColors);

  return (
    <section className="container-x py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        // Cores do admin; sem cor gravada = padrão (o mesmo visual de antes).
        className="relative overflow-hidden rounded-3xl p-8 md:p-12"
        style={{ backgroundImage: `linear-gradient(to right, ${colors.from}, ${colors.to})`, color: colors.text }}
      >
        {seasonal.seasonalBannerImage && (
          <img
            src={seasonal.seasonalBannerImage}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-overlay"
          />
        )}
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative z-10 max-w-2xl">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
            style={{ backgroundColor: `${colors.text}1A` }}
          >
            <Sparkles className="h-3 w-3" /> Edição especial
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">{seasonal.seasonalBanner ?? seasonal.name}</h2>
          {seasonal.description && <p className="mt-3 opacity-80">{seasonal.description}</p>}
          <Link
            to={categoryPath(seasonal.slug)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-bg px-5 py-2.5 text-sm font-bold text-ink hover:bg-bg-soft"
          >
            Ver coleção <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
