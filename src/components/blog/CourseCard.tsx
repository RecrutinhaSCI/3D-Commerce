import { ArrowUpRight, GraduationCap } from 'lucide-react';
import type { Course } from '@/types/course';
import { apiAssetUrl } from '@/services/api';
import { formatBRL } from '@/utils/price';
import { safeCourseUrl } from '@/utils/courses';
import { trackCourseClick } from '@/lib/analytics';

export function CourseCard({ course, preview = false }: { course: Course; preview?: boolean }) {
  const href = safeCourseUrl(course.externalUrl, course.ctaType);
  return (
    <article className="card flex min-w-0 flex-col overflow-hidden">
      {course.coverImage ? <img src={apiAssetUrl(course.coverImage)} alt="" loading="lazy" className="aspect-[16/9] w-full bg-bg-soft object-contain" /> :
        <div className="flex aspect-[16/9] items-center justify-center bg-bg-soft text-ink-mute"><GraduationCap className="h-12 w-12" aria-hidden="true" /></div>}
      <div className="flex flex-1 flex-col p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
          {course.eyebrow && <span>{course.eyebrow}</span>}
          {course.levelLabel && <span className="rounded-full bg-ink/5 px-2 py-1">{course.levelLabel}</span>}
          {course.featured && <span className="rounded-full bg-ink px-2 py-1 text-white">Destaque</span>}
        </div>
        <h3 className="mt-3 line-clamp-2 break-words font-display text-xl font-bold leading-snug">{course.title}</h3>
        <p className="mt-3 line-clamp-3 whitespace-pre-line break-words text-sm leading-relaxed text-ink-mute">{course.shortDescription || course.description}</p>
        <div className="mt-auto pt-6">
          {course.price !== null && <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {course.originalPrice !== null && course.originalPrice > course.price && <del className="text-sm text-ink-mute">{formatBRL(course.originalPrice)}</del>}
            <span className="text-2xl font-bold">{course.price === 0 ? 'Gratuito' : formatBRL(course.price)}</span>
          </div>}
          {preview ? <span className="btn-primary flex w-full justify-center break-words text-center">{course.buttonLabel || 'Acessar curso'} <ArrowUpRight className="h-4 w-4 shrink-0" /></span> : href ?
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => trackCourseClick(course.id, course.ctaType)} className="btn-primary flex w-full justify-center break-words text-center">
              {course.buttonLabel} <ArrowUpRight className="h-4 w-4 shrink-0" />
            </a> : <p className="text-sm text-ink-mute">Informações em breve.</p>}
        </div>
      </div>
    </article>
  );
}
