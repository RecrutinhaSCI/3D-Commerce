import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, noContent, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, storedFileUrl } from '../../lib/upload';
import { categoriesService } from './categories.service';
import { createCategorySchema, updateCategorySchema } from './categories.schemas';

const idParam = z.object({ id: z.string().min(1) });

export const categoriesController = {
  async listPublic(_req: Request, res: Response) {
    const categories = await categoriesService.listPublic();
    return ok(res, { categories });
  },

  async listAdmin(_req: Request, res: Response) {
    const categories = await categoriesService.listAdmin();
    return ok(res, { categories });
  },

  async create(req: Request, res: Response) {
    const input = createCategorySchema.parse(req.body);
    const category = await categoriesService.create(input);
    return created(res, { category });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateCategorySchema.parse(req.body);
    const category = await categoriesService.update(id, input);
    return ok(res, { category });
  },

  /** POST /admin/categories/:id/image (card da Home) e /:id/seasonal-image. */
  uploadImage(field: 'imageUrl' | 'seasonalBannerImage') {
    return async (req: Request, res: Response) => {
      const { id } = idParam.parse(req.params);
      const file = req.file as Express.Multer.File | undefined;
      if (!file) throw HttpError.badRequest('Envie um arquivo no campo "image".');
      const url = storedFileUrl(file, 'site');
      try {
        const category = await categoriesService.setImage(id, field, url);
        return ok(res, { category });
      } catch (err) {
        safeUnlinkSiteImage(url); // não deixa arquivo órfão no Blob
        throw err;
      }
    };
  },

  /** DELETE /admin/categories/:id/image e /:id/seasonal-image. */
  removeImage(field: 'imageUrl' | 'seasonalBannerImage') {
    return async (req: Request, res: Response) => {
      const { id } = idParam.parse(req.params);
      const category = await categoriesService.setImage(id, field, null);
      return ok(res, { category });
    };
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const result = await categoriesService.remove(id);
    if (result.hardDeleted) return noContent(res);
    return ok(res, result);
  },
};
