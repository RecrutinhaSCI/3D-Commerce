import type { Banner, BannerSlot } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, siteImageUrl } from '../../lib/upload';
import type { CreateBannerInput, UpdateBannerInput } from './banners.schemas';

export interface BannerDTO {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonLink: string | null;
  active: boolean;
  position: number;
  slot: BannerSlot;
  createdAt: string;
  updatedAt: string;
}

function toDTO(b: Banner): BannerDTO {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    imageUrl: b.imageUrl,
    buttonText: b.buttonText,
    buttonLink: b.buttonLink,
    active: b.active,
    position: b.position,
    slot: b.slot,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export const bannersService = {
  async listPublic(): Promise<BannerDTO[]> {
    const rows = await prisma.banner.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDTO);
  },

  async listAdmin(): Promise<BannerDTO[]> {
    const rows = await prisma.banner.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDTO);
  },

  async create(input: CreateBannerInput): Promise<BannerDTO> {
    const b = await prisma.banner.create({
      data: {
        title: input.title,
        subtitle: input.subtitle ?? null,
        imageUrl: input.imageUrl ?? null,
        buttonText: input.buttonText ?? null,
        buttonLink: input.buttonLink ?? null,
        active: input.active ?? true,
        position: input.position ?? 0,
        slot: input.slot ?? 'HERO',
      },
    });
    return toDTO(b);
  },

  async update(id: string, input: UpdateBannerInput): Promise<BannerDTO> {
    const exists = await prisma.banner.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw HttpError.notFound('Banner não encontrado.');
    const updated = await prisma.banner.update({ where: { id }, data: input });
    return toDTO(updated);
  },

  async remove(id: string): Promise<void> {
    const current = await prisma.banner.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Banner não encontrado.');
    await prisma.banner.delete({ where: { id } });
    if (current.imageUrl) safeUnlinkSiteImage(current.imageUrl);
  },

  async setImage(id: string, filename: string): Promise<BannerDTO> {
    const current = await prisma.banner.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Banner não encontrado.');
    if (current.imageUrl) safeUnlinkSiteImage(current.imageUrl);
    const updated = await prisma.banner.update({
      where: { id },
      data: { imageUrl: siteImageUrl(filename) },
    });
    return toDTO(updated);
  },
};
