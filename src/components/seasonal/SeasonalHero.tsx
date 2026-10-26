import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Category } from '@/types';
import { categoryPath } from '@/utils/categoryGroups';
import { seasonalTheme, withAlpha } from '@/utils/seasonalTheme';

interface Props {
  category: Pick<Category, 'slug' | 'name' | 'description' | 'seasonalBanner' | 'seasonalBannerImage' | 'seasonalColors'>;
  /**
   * `banner`: bloco da Home com botão "Ver coleção" (visual de sempre).
   * `page`: hero da própria página da campanha (título como h1, mais alto,
   * imagem do admin mais presente sob um véu com as cores da campanha).
   */
  variant?: 'banner' | 'page';
  /** Só no `page`: quantidade de produtos da coleção. */
  productCount?: number;
}

/**
 * Identidade visual da campanha sazonal — fonte única para Home e página da
 * categoria. Tudo vem do Admin → Categoria sazonal (imagem, texto, descrição,
 * cores); nenhum nome de campanha fixo no código.
 */
export function SeasonalHero({ category, variant = 'banner', productCount }: Props) {
  const theme = seasonalTheme(category.seasonalColors);
  const title = category.seasonalBanner || category.name;
  const image = category.seasonalBannerImage;
  const isPage = variant === 'page';
  const Heading = isPage ? 'h1' : 'h2';

  return (
    <motion.div
      data-seasonal-hero={variant}
      initial={{ opacity: 0, y: isPage ? 12 : 20 }}
      animate={isPage ? { opacity: 1, y: 0 } : undefined}
      whileInView={isPage ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={`relative isolate overflow-hidden rounded-3xl ${isPage ? 'px-6 py-12 md:px-12 md:py-20' : 'p-8 md:p-12'}`}
      style={{ backgroundImage: theme.gradient, color: theme.text }}
    >
      {image &&
        (isPage ? (
          <>
            {/* Página: a imagem da campanha é o fundo; véu nas cores da campanha garante leitura. */}
            <img src={image} alt="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover" />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{ backgroundImage: `linear-gradient(to right, ${withAlpha(theme.from, 0.92)}, ${withAlpha(theme.to, 0.55)})` }}
            />
          </>
        ) : (
          // Home: mesmo tratamento de antes (imagem mesclada sob o gradiente).
          <img
            src={image}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-overlay"
          />
        ))}
      {!isPage && <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />}

      <div className={`relative z-10 ${isPage ? 'max-w-3xl' : 'max-w-2xl'}`}>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
          style={{ backgroundColor: withAlpha(theme.text, 0.1) }}
        >
          <Sparkles className="h-3 w-3" /> Edição especial
        </span>
        <Heading className={`mt-3 font-display font-bold leading-tight ${isPage ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl'}`}>
          {title}
        </Heading>
        {category.description && (
          <p className={`mt-3 ${isPage ? 'max-w-2xl text-base opacity-90 md:text-lg' : 'opacity-80'}`}>{category.description}</p>
        )}
        {isPage && productCount !== undefined && (
          <p className="mt-5 text-xs font-bold uppercase tracking-widest opacity-80">
            {productCount} {productCount === 1 ? 'produto' : 'produtos'} na coleção
          </p>
        )}
        {!isPage && (
          <Link
            to={categoryPath(category.slug)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-bg px-5 py-2.5 text-sm font-bold text-ink hover:bg-bg-soft"
          >
            Ver coleção <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </motion.div>
  );
}
