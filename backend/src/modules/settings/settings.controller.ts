import type { Request, Response } from 'express';
import { ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, storedFileUrl } from '../../lib/upload';
import { settingsService } from './settings.service';
import { updateSettingsSchema } from './settings.schemas';
import { z } from 'zod';

/** Slug de post do Blog (os posts ficam no código do front). */
const blogSlugParam = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120) });

export const settingsController = {
  async getPublic(_req: Request, res: Response) {
    const settings = await settingsService.getPublic();
    return ok(res, { settings });
  },

  async getAdmin(_req: Request, res: Response) {
    const settings = await settingsService.getAdmin();
    return ok(res, { settings });
  },

  async update(req: Request, res: Response) {
    const input = updateSettingsSchema.parse(req.body);
    const settings = await settingsService.update(input);
    return ok(res, { settings });
  },

  /**
   * Upload de imagem "solta" do site — usada para thumbnails de vídeo do YouTube
   * (o admin cola a URL retornada no campo `youtubeVideos[].thumbnail`). Reusa o
   * mesmo pipeline do logo: JPG/PNG/WEBP, 5MB, SVG bloqueado, extensão↔MIME.
   */
  async uploadImage(req: Request, res: Response) {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw HttpError.badRequest('Envie um arquivo no campo "image".');
    // URL do Vercel Blob em produção; /uploads/site/... em dev.
    return ok(res, { url: storedFileUrl(file, 'site') });
  },

  /** POST /admin/settings/blog-covers/:slug — capa de um post do Blog (Vercel Blob). */
  async uploadBlogCover(req: Request, res: Response) {
    const { slug } = blogSlugParam.parse(req.params);
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw HttpError.badRequest('Envie um arquivo no campo "image".');
    const url = storedFileUrl(file, 'site');
    try {
      const settings = await settingsService.setBlogCover(slug, url);
      return ok(res, { settings });
    } catch (err) {
      safeUnlinkSiteImage(url);
      throw err;
    }
  },

  /** DELETE /admin/settings/blog-covers/:slug */
  async removeBlogCover(req: Request, res: Response) {
    const { slug } = blogSlugParam.parse(req.params);
    const settings = await settingsService.setBlogCover(slug, null);
    return ok(res, { settings });
  },

  async uploadLogo(req: Request, res: Response) {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw HttpError.badRequest('Envie um arquivo no campo "logo".');
    try {
      const settings = await settingsService.setLogo(storedFileUrl(file, 'site'));
      return ok(res, { settings });
    } catch (err) {
      // Se o service falhar, remove o arquivo recém-salvo para não ficar órfão.
      safeUnlinkSiteImage(storedFileUrl(file, 'site'));
      throw err;
    }
  },
};
