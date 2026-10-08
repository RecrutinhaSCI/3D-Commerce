import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, noContent, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, storedFileUrl } from '../../lib/upload';
import { testimonialsService } from './testimonials.service';
import { createTestimonialSchema, updateTestimonialSchema } from './testimonials.schemas';

const idParam = z.object({ id: z.string().min(1) });

export const testimonialsController = {
  async listPublic(_req: Request, res: Response) {
    const testimonials = await testimonialsService.listPublic();
    return ok(res, { testimonials });
  },

  async listAdmin(_req: Request, res: Response) {
    const testimonials = await testimonialsService.listAdmin();
    return ok(res, { testimonials });
  },

  async create(req: Request, res: Response) {
    const input = createTestimonialSchema.parse(req.body);
    const testimonial = await testimonialsService.create(input);
    return created(res, { testimonial });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateTestimonialSchema.parse(req.body);
    const testimonial = await testimonialsService.update(id, input);
    return ok(res, { testimonial });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await testimonialsService.remove(id);
    return noContent(res);
  },

  async uploadAvatar(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw HttpError.badRequest('Envie um arquivo no campo "avatar".');
    try {
      const testimonial = await testimonialsService.setAvatar(id, storedFileUrl(file, 'site'));
      return ok(res, { testimonial });
    } catch (err) {
      safeUnlinkSiteImage(storedFileUrl(file, 'site'));
      throw err;
    }
  },
};
