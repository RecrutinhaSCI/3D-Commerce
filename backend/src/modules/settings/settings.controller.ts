import type { Request, Response } from 'express';
import { ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { safeUnlinkSiteImage, storedFileUrl } from '../../lib/upload';
import { settingsService } from './settings.service';
import { updateSettingsSchema } from './settings.schemas';

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
