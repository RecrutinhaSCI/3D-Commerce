import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Clock } from 'lucide-react';
import { seedBlogPosts } from '@/data/blogPosts';
import { useSEO } from '@/utils/seo';
import { bannerSvg } from '@/utils/productImage';
import { useAdminDataStore } from '@/store/useAdminDataStore';

export default function BlogPost() {
  const { slug } = useParams();
  const post = seedBlogPosts.find((p) => p.slug === slug);
  const covers = useAdminDataStore((s) => s.settings.blogCovers);
  useSEO(post?.title ?? 'Post');
  if (!post) {
    return (
      <div className="container-x py-20 text-center">
        <h1 className="text-2xl font-bold">Post não encontrado</h1>
        <Link to="/blog" className="mt-4 inline-block underline">Voltar ao blog</Link>
      </div>
    );
  }
  const index = seedBlogPosts.findIndex((p) => p.slug === slug);
  return (
    <div className="container-x py-10">
      <Link to="/blog" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink">
        <ChevronLeft className="h-3 w-3" /> Voltar ao blog
      </Link>
      <article className="mx-auto mt-5 max-w-3xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">{post.category}</p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight">{post.title}</h1>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-ink-mute">
          <Clock className="h-3 w-3" /> {post.readTime} · por {post.author}
        </p>
        <img
          src={covers?.[post.slug] || post.cover || bannerSvg(post.title, index, ['#0F1115', '#22D3EE'])}
          alt=""
          className="mt-6 aspect-[16/9] w-full rounded-2xl object-cover"
        />
        <div className="prose prose-sm mt-6 max-w-none text-ink-soft whitespace-pre-line">{post.content}</div>
      </article>
    </div>
  );
}
