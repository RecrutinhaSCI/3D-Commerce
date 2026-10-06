import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, noContent, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, storedFileUrl } from '../../lib/upload';
import { bannersService } from './banners.service';
import { createBannerSchema, updateBannerSchema } from './banners.schemas';

const idParam = z.object({ id: z.string().min(1) });

export const bannersController = {
  async listPublic(_req: Request, res: Response) {
    const banners = await bannersService.listPublic();
    return ok(res, { banners });
  },

  async listAdmin(_req: Request, res: Response) {
    const banners = await bannersService.listAdmin();
    return ok(res, { banners });
  },

  async create(req: Request, res: Response) {
    const input = createBannerSchema.parse(req.body);
    const banner = await bannersService.create(input);
    return created(res, { banner });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateBannerSchema.parse(req.body);
    const banner = await bannersService.update(id, input);
    return ok(res, { banner });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await bannersService.remove(id);
    return noContent(res);
  },

  async uploadImage(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw HttpError.badRequest('Envie um arquivo no campo "image".');
    try {
      const banner = await bannersService.setImage(id, storedFileUrl(file, 'site'));
      return ok(res, { banner });
    } catch (err) {
      safeUnlinkSiteImage(storedFileUrl(file, 'site'));
      throw err;
    }
  },
};
