import { Link } from 'react-router-dom';
import { seedBlogPosts } from '@/data/blogPosts';
import { Clock } from 'lucide-react';
import { useSEO } from '@/utils/seo';
import { bannerSvg } from '@/utils/productImage';
import { useAdminDataStore } from '@/store/useAdminDataStore';

export default function Blog() {
  useSEO('Blog e Guias');
  const covers = useAdminDataStore((s) => s.settings.blogCovers);
  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Conteúdo</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Blog e Guias</h1>
        <p className="mt-3 text-ink-mute">
          Tudo o que você precisa saber sobre impressão 3D, filamentos, resinas e equipamentos.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {seedBlogPosts.map((p, i) => (
          <Link
            key={p.id}
            to={`/blog/${p.slug}`}
            className="card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-card"
          >
            {/* Capa do admin (Vercel Blob); sem capa = ilustração gerada de sempre. */}
            <img
              src={covers?.[p.slug] || p.cover || bannerSvg(p.title, i, ['#0F1115', i % 2 === 0 ? '#22D3EE' : '#A78BFA'])}
              alt=""
              loading="lazy"
              className="aspect-[16/9] w-full object-cover"
            />
            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">{p.category}</p>
              <h2 className="mt-1 line-clamp-2 text-lg font-bold leading-snug">{p.title}</h2>
              <p className="mt-2 line-clamp-2 text-sm text-ink-mute">{p.excerpt}</p>
              <p className="mt-3 inline-flex items-center gap-1 text-xs text-ink-mute">
                <Clock className="h-3 w-3" /> {p.readTime}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
