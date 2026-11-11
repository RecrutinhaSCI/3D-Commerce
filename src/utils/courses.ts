import type { Course } from '@/types/course';

/** Defense in depth for stored links, including data from older deployments. */
export function safeCourseUrl(value: string, type: Course['ctaType']): string | null {
  try {
    if (/[\s\u0000-\u001f\u007f\\]/.test(value) || !/^https?:\/\//i.test(value)) return null;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (type === 'whatsapp' && (url.protocol !== 'https:' || !!url.port || !['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com'].includes(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}
export function sortCourses(courses: Course[]): Course[] {
  return [...courses].sort((a, b) => a.displayOrder - b.displayOrder || Number(b.featured) - Number(a.featured) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
