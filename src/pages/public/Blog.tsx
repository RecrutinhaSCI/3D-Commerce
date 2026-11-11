import { useEffect, useState } from 'react';
import { courseService } from '@/services/courseService';
import type { Course } from '@/types/course';
import { sortCourses } from '@/utils/courses';
import { CourseCard } from '@/components/blog/CourseCard';
import { Link } from 'react-router-dom';
import { seedBlogPosts } from '@/data/blogPosts';
import { Clock } from 'lucide-react';
import { useSEO } from '@/utils/seo';
import { bannerSvg } from '@/utils/productImage';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { resolveBlogPosts } from '@/utils/blog';

export default function Blog() {
  useSEO('Cursos e Guias');
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseState, setCourseState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    courseService.listPublic().then(({ courses: data }) => {
      if (!cancelled) { setCourses(sortCourses(data.filter((c) => c.active))); setCourseState('ready'); }
    }).catch(() => { if (!cancelled) setCourseState('error'); });
    return () => { cancelled = true; };
  }, []);
  const covers = useAdminDataStore((s) => s.settings.blogCovers);
  const overrides = useAdminDataStore((s) => s.settings.blogContent);
  // Texto padrão do código + versão salva no admin + capa.
  const posts = resolveBlogPosts(seedBlogPosts, overrides, covers).filter((p) => p.active);
  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Conteúdo</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Cursos e Guias</h1>
        <p className="mt-3 text-ink-mute">
          Aprenda mais sobre impressão 3D com cursos para evoluir na prática e guias para consultar no dia a dia.
        </p>
      </header>

      <section className="mt-10 rounded-3xl border border-ink-line bg-bg-soft p-4 md:p-8" aria-labelledby="courses-title">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Conhecimento na prática</p>
        <h2 id="courses-title" className="mt-2 font-display text-3xl font-bold">Cursos</h2>
        {courseState === 'loading' ? <p className="mt-6 text-sm text-ink-mute" role="status">Carregando cursos...</p> : courseState === 'error' ?
          <p className="mt-6 text-sm text-ink-mute" role="status">Não foi possível carregar os cursos agora. Tente novamente mais tarde.</p> : courses.length ?
          <div className={`mt-6 grid grid-cols-1 gap-6 ${courses.length === 1 ? 'mx-auto max-w-xl' : courses.length === 2 ? 'mx-auto max-w-4xl md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>{courses.map((course) => <CourseCard key={course.id} course={course} />)}</div> :
          <p className="mt-6 text-sm text-ink-mute">Nenhum curso disponível no momento.</p>}
      </section>
      <section className="mt-12" aria-labelledby="guides-title">
      <h2 id="guides-title" className="font-display text-2xl font-bold">Guias</h2>
      <p className="mt-2 text-sm text-ink-mute">Leituras rápidas para apoiar suas escolhas.</p>
      <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((p, i) => (
          <Link
            key={p.id}
            to={`/blog/${p.slug}`}
            className="card overflow-hidden transition motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none hover:shadow-card"
          >
            {/* Capa do admin (Vercel Blob); sem capa = ilustração gerada de sempre. */}
            <img
              src={p.cover || bannerSvg(p.title, i, ['#0F1115', i % 2 === 0 ? '#22D3EE' : '#A78BFA'])}
              alt=""
              loading="lazy"
              className="aspect-[2/1] w-full object-cover"
            />
            <div className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">{p.category}</p>
              <h2 className="mt-1 line-clamp-2 text-base font-bold leading-snug">{p.title}</h2>
              <p className="mt-2 line-clamp-2 text-sm text-ink-mute">{p.excerpt}</p>
              <p className="mt-3 inline-flex items-center gap-1 text-xs text-ink-mute">
                <Clock className="h-3 w-3" /> {p.readTime}
              </p>
            </div>
          </Link>
        ))}
      </div>
      </section>
    </div>
  );
}
