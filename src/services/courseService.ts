import { api } from './api';
import type { Course, CourseInput } from '@/types/course';

export const courseService = {
  listPublic: () => api.get<{ courses: Course[] }>('/api/public/courses', { anonymous: true }),
  listAdmin: () => api.get<{ courses: Course[] }>('/api/admin/courses'),
  create: (input: CourseInput) => api.post<{ course: Course }>('/api/admin/courses', input),
  update: (id: string, input: Partial<CourseInput>) => api.put<{ course: Course }>(`/api/admin/courses/${encodeURIComponent(id)}`, input),
  remove: (id: string) => api.del<void>(`/api/admin/courses/${encodeURIComponent(id)}`),
};
