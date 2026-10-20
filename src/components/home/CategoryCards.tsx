import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { Carousel } from '@/components/ui/Carousel';

export function CategoryCards() {
  const categories = useAdminDataStore((s) => s.categories).filter((c) => c.showInHome && !c.isSeasonal);

  return (
    <section className="container-x py-20">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <p className="eyebrow">Categorias</p>
          <h2 className="section-title">Comece pela categoria certa</h2>
        </div>
        <Link to="/loja" className="group hidden text-sm font-semibold text-ink-soft transition hover:text-ink md:inline-flex md:items-center md:gap-1">
          Ver tudo
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      </div>

      <Carousel ariaLabel="Categorias" itemClassName="w-[60%] sm:w-[38%] lg:w-[24%]">
        {categories.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ delay: i * 0.04 }}
          >
            <Link
              to={`/categoria/${c.slug}`}
              className="group relative flex h-36 flex-col justify-between overflow-hidden rounded-2xl border border-ink-line/70 bg-bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-ink/20 hover:shadow-[0_18px_40px_-15px_rgba(15,17,21,0.18)]"
            >
              {c.image ? (
                <>
                  <img
                    src={c.image}
                    alt={c.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-transparent" />
                </>
              ) : (
                <>
                  <span
                    className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.13] blur-2xl transition-transform duration-500 group-hover:scale-125"
                    style={{ background: c.color ?? '#22D3EE' }}
                  />
                  <span
                    className="absolute -right-3 -top-3 h-12 w-12 rounded-full opacity-30 ring-1 ring-inset"
                    style={{ background: c.color ?? '#22D3EE', boxShadow: `inset 0 0 0 1px ${c.color ?? '#22D3EE'}40` }}
                  />
                </>
              )}
              <div className={`z-10 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${c.image ? 'text-white/80' : 'text-ink-mute'}`}>
                Explorar
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <h3 className={`z-10 font-display text-xl font-bold leading-tight ${c.image ? 'text-white' : 'text-ink'}`}>{c.name}</h3>
            </Link>
          </motion.div>
        ))}
      </Carousel>
    </section>
  );
}
