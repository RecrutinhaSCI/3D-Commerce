import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCourseSchema } from './courses.schemas';

const rows = new Map<string, Record<string, unknown>>();
let nextId = 1;
const courseMock = {
  findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => [...rows.values()].find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null),
  findMany: vi.fn(async ({ where }: { where?: { active?: boolean } }) => [...rows.values()].filter((row) => where?.active === undefined || row.active === where.active)),
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `course-${nextId++}`, price: null, originalPrice: null, coverImage: null, createdAt: new Date(), updatedAt: new Date(), ...data };
    rows.set(row.id, row); return row;
  }),
  update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row;
  }),
  delete: vi.fn(async ({ where }: { where: { id: string } }) => { const row = rows.get(where.id); rows.delete(where.id); return row; }),
};
vi.mock('../../lib/prisma', () => ({ prisma: {
  course: courseMock,
  user: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, email: 'test@example.com', name: 'Teste', role: where.id === 'admin' ? 'ADMIN' : 'CUSTOMER' })) },
} }));
const { coursesRouter } = await import('./courses.routes');
const { errorHandler } = await import('../../middlewares/errorHandler');
const { signAuthToken } = await import('../../utils/jwt');
const { coursesService } = await import('./courses.service');
let server: http.Server;
let base = '';
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api', coursesRouter); app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
beforeEach(() => { rows.clear(); nextId = 1; vi.clearAllMocks(); });
const input = { title: 'Mentoria 3D', externalUrl: 'https://wa.me/5554999990000', ctaType: 'whatsapp', buttonLabel: 'Falar no WhatsApp' };
function headers(user = 'admin') {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${signAuthToken({ sub: user, email: 'test@example.com', role: user === 'admin' ? 'ADMIN' : 'CUSTOMER' })}` };
}
async function request(path: string, method = 'GET', body?: unknown, user = 'admin') {
  return fetch(base + path, { method, headers: headers(user), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe('segurança de URL de cursos', () => {
  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'https://user:password@example.com', 'https://example.com/ bad', 'https://example.com\\@evil.com', 'https://', 'not-a-url'])('rejeita %s', (externalUrl) => {
    expect(createCourseSchema.safeParse({ ...input, ctaType: 'external', externalUrl }).success).toBe(false);
  });
  it.each(['https://wa.me.evil.com/1', 'https://evil.com/wa.me', 'http://wa.me/1', 'https://wa.me:8443/1'])('WhatsApp rejeita host/protocolo não oficial %s', (externalUrl) => {
    expect(createCourseSchema.safeParse({ ...input, externalUrl }).success).toBe(false);
  });
  it('permite mentoria sem preço e URLs externas comuns sem exigir checkout', () => {
    const parsed = createCourseSchema.parse(input); expect(parsed.price).toBeUndefined(); expect(parsed.active).toBe(false);
    expect(createCourseSchema.safeParse({ ...input, ctaType: 'external', externalUrl: 'https://hotmart.com/course' }).success).toBe(true);
    expect(createCourseSchema.safeParse({ ...input, price: -1 }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...input, price: 19.999 }).success).toBe(false);
  });
});
describe('CRUD e publicação de cursos', () => {
  it('cria sem preço, edita preços/status/ordem, publica só ativos e exclui pelo admin', async () => {
    const created = await request('/admin/courses', 'POST', input); expect(created.status).toBe(201);
    const course = (await created.json()).data.course;
    expect(course).toMatchObject({ title: input.title, slug: 'mentoria-3d', price: null, active: false });
    expect((await (await fetch(base + '/public/courses')).json()).data.courses).toEqual([]);
    const saved = await request(`/admin/courses/${course.id}`, 'PUT', { active: true, displayOrder: 7, price: 29.90, originalPrice: 49.90 });
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.course).toMatchObject({ price: 29.90, originalPrice: 49.90, displayOrder: 7, active: true });
    await request('/admin/courses', 'POST', { ...input, title: 'Curso inativo' });
    const publicCourses = (await (await fetch(base + '/public/courses')).json()).data.courses;
    expect(publicCourses).toHaveLength(1); expect(publicCourses[0].id).toBe(course.id);
    expect(courseMock.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { active: true }, orderBy: [{ displayOrder: 'asc' }, { featured: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] }));
    expect((await (await request('/admin/courses')).json()).data.courses).toHaveLength(2);
    expect((await request(`/admin/courses/${course.id}`, 'DELETE')).status).toBe(204);
    expect((await request(`/admin/courses/${course.id}`, 'PUT', { active: true })).status).toBe(404);
  });
  it('impede contornar validação de WhatsApp com edição parcial e preserva slug ao renomear', async () => {
    const course = await coursesService.create(createCourseSchema.parse(input));
    expect((await request(`/admin/courses/${course.id}`, 'PUT', { externalUrl: 'https://evil.com' })).status).toBe(422);
    const updated = await coursesService.update(course.id, { title: 'Novo nome' });
    expect(updated.slug).toBe(course.slug);
    expect((await request('/admin/courses', 'POST', { ...input, slug: course.slug })).status).toBe(409);
  });
  it.each([['GET', '/admin/courses'], ['POST', '/admin/courses'], ['PUT', '/admin/courses/x'], ['DELETE', '/admin/courses/x']])('%s %s exige admin', async (method, path) => {
    expect((await fetch(base + path, { method })).status).toBe(401);
    expect((await request(path, method, method === 'GET' || method === 'DELETE' ? undefined : input, 'customer')).status).toBe(403);
    expect(courseMock.create).not.toHaveBeenCalled(); expect(courseMock.update).not.toHaveBeenCalled(); expect(courseMock.delete).not.toHaveBeenCalled();
  });
});
