// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CourseCard } from '@/components/blog/CourseCard';
import { CoursesManager } from './CoursesManager';
import Blog from '@/pages/public/Blog';
import { courseService } from '@/services/courseService';
import { trackCourseClick } from '@/lib/analytics';
import type { Course } from '@/types/course';

vi.mock('@/services/courseService', () => ({ courseService: { listPublic: vi.fn(), listAdmin: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackCourseClick: vi.fn() }));
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }));
vi.mock('@/components/admin/RemoteImageUploader', () => ({ RemoteImageUploader: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const example: Course = { id: 'c1', slug: 'curso', title: 'Curso verdadeiro', eyebrow: 'Impressão 3D', description: 'Descrição', shortDescription: 'Aprenda na prática', coverImage: null, levelLabel: 'Iniciante', originalPrice: null, price: null, externalUrl: 'https://wa.me/5511999999999', buttonLabel: 'Falar no WhatsApp', ctaType: 'whatsapp', featured: false, active: true, displayOrder: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(courseService.listPublic).mockResolvedValue({ courses: [] });
  vi.mocked(courseService.listAdmin).mockResolvedValue({ courses: [] });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
async function click(label: string) { const el = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!; expect(el).toBeTruthy(); await act(async () => el.click()); }
async function type(id: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`#course-${id}`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it('shows neutral empty courses and three guides, never hardcoded courses', async () => {
  await render(<Blog />);
  expect(host.textContent).toContain('Nenhum curso disponível');
  expect(host.querySelectorAll('a[href^="/blog/"]')).toHaveLength(3);
  expect(host.textContent).not.toContain('Quando usar resina');
  expect(host.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
});
it('filters inactive courses and orders the public cards, with optional price', async () => {
  vi.mocked(courseService.listPublic).mockResolvedValue({ courses: [{ ...example, id: 'late', title: 'Depois', displayOrder: 9 }, { ...example, id: 'hidden', title: 'Oculto', active: false }, example] });
  await render(<Blog />);
  expect([...host.querySelectorAll('article h3')].map((h) => h.textContent)).toEqual(['Curso verdadeiro', 'Depois']);
  expect(host.textContent).not.toContain('Oculto');
  expect(host.textContent).not.toContain('R$');
});
it('API failure shows no fictional courses', async () => {
  vi.mocked(courseService.listPublic).mockRejectedValueOnce(new Error('offline'));
  await render(<Blog />);
  expect(host.textContent).toContain('Não foi possível carregar os cursos');
  expect(host.querySelectorAll('article')).toHaveLength(0);
});
it('uses safe external CTA and existing analytics event without internal checkout', async () => {
  await render(<CourseCard course={example} />);
  const link = host.querySelector('a')!;
  expect(link.getAttribute('href')).toBe(example.externalUrl);
  expect(link.rel).toBe('noopener noreferrer'); expect(link.target).toBe('_blank');
  await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(trackCourseClick).toHaveBeenCalledWith('c1', 'whatsapp');
  await render(<CourseCard course={{ ...example, externalUrl: 'javascript:alert(1)' }} />);
  expect(host.querySelector('a')).toBeNull();
});
it('shows promotional price and keeps preview CTA inert', async () => {
  await render(<CourseCard course={{ ...example, price: 99, originalPrice: 199 }} preview />);
  expect(host.querySelector('del')!.textContent).toContain('199');
  expect(host.textContent).toContain('99'); expect(host.querySelector('a')).toBeNull();
});
it('creates a course with no price and reflects it in the admin list', async () => {
  vi.mocked(courseService.create).mockResolvedValue({ course: example });
  await render(<CoursesManager />); await click('Novo curso');
  await type('title', 'Mentoria avançada'); await type('external-url', 'https://example.com/mentoria');
  vi.mocked(courseService.listAdmin).mockResolvedValue({ courses: [example] });
  await submit();
  expect(courseService.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mentoria avançada', slug: 'mentoria-avancada', price: null, originalPrice: null, active: false, externalUrl: 'https://example.com/mentoria' }));
  expect(host.textContent).toContain('Curso verdadeiro'); expect(host.querySelector('form')).toBeNull();
});
it('updates status, order, CTA and clears a price using the same editor', async () => {
  vi.mocked(courseService.listAdmin).mockResolvedValue({ courses: [{ ...example, price: 100 }] });
  vi.mocked(courseService.update).mockResolvedValue({ course: example });
  await render(<CoursesManager />); await click('Editar');
  await type('price', ''); await type('order', '7'); await type('button-label', 'Conversar');
  const checkbox = host.querySelector<HTMLInputElement>('form input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await submit();
  expect(courseService.update).toHaveBeenCalledWith('c1', expect.objectContaining({ price: null, displayOrder: 7, buttonLabel: 'Conversar', active: false }));
});
it('save failure preserves the editor and blocks unsafe CTA before API calls', async () => {
  vi.mocked(courseService.create).mockRejectedValue(new Error('offline'));
  await render(<CoursesManager />); await click('Novo curso'); await type('title', 'Curso teste');
  await type('external-url', 'javascript:alert(1)'); await submit(); expect(courseService.create).not.toHaveBeenCalled();
  await type('external-url', 'https://example.com'); await submit();
  expect(host.querySelector('form')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('#course-title')!.value).toBe('Curso teste');
});
it('requires explicit delete confirmation and preserves listing after cancel', async () => {
  vi.mocked(courseService.listAdmin).mockResolvedValue({ courses: [example] });
  await render(<CoursesManager />);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Excluir Curso verdadeiro"]')!.click());
  expect(courseService.remove).not.toHaveBeenCalled(); await click('Cancelar');
  expect(host.textContent).toContain('Curso verdadeiro');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Excluir Curso verdadeiro"]')!.click());
  vi.mocked(courseService.remove).mockResolvedValue(undefined);
  vi.mocked(courseService.listAdmin).mockResolvedValue({ courses: [] });
  await click('Excluir curso'); expect(courseService.remove).toHaveBeenCalledWith('c1');
  expect(host.textContent).toContain('Nenhum curso cadastrado');
});
