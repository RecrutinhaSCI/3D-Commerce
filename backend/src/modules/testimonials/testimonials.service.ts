import type { Testimonial } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage } from '../../lib/upload';
import type { CreateTestimonialInput, UpdateTestimonialInput } from './testimonials.schemas';

export interface TestimonialDTO {
  id: string;
  name: string;
  role: string | null;
  content: string;
  rating: number;
  avatarUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDTO(t: Testimonial): TestimonialDTO {
  return {
    id: t.id,
    name: t.name,
    role: t.role,
    content: t.content,
    rating: t.rating,
    avatarUrl: t.avatarUrl,
    active: t.active,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export const testimonialsService = {
  async listPublic(): Promise<TestimonialDTO[]> {
    const rows = await prisma.testimonial.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDTO);
  },

  async listAdmin(): Promise<TestimonialDTO[]> {
    const rows = await prisma.testimonial.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toDTO);
  },

  async create(input: CreateTestimonialInput): Promise<TestimonialDTO> {
    const t = await prisma.testimonial.create({
      data: {
        name: input.name,
        role: input.role ?? null,
        content: input.content,
        rating: input.rating,
        avatarUrl: input.avatarUrl ?? null,
        active: input.active ?? true,
      },
    });
    return toDTO(t);
  },

  async update(id: string, input: UpdateTestimonialInput): Promise<TestimonialDTO> {
    const exists = await prisma.testimonial.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw HttpError.notFound('Depoimento não encontrado.');
    const updated = await prisma.testimonial.update({ where: { id }, data: input });
    return toDTO(updated);
  },

  async remove(id: string): Promise<void> {
    const current = await prisma.testimonial.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Depoimento não encontrado.');
    await prisma.testimonial.delete({ where: { id } });
    if (current.avatarUrl) safeUnlinkSiteImage(current.avatarUrl);
  },

  async setAvatar(id: string, url: string): Promise<TestimonialDTO> {
    const current = await prisma.testimonial.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Depoimento não encontrado.');
    if (current.avatarUrl) safeUnlinkSiteImage(current.avatarUrl);
    const updated = await prisma.testimonial.update({
      where: { id },
      data: { avatarUrl: url },
    });
    return toDTO(updated);
  },
};
