import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, noContent, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { productsService } from './products.service';
import {
  adminListQuerySchema,
  bulkDeleteSchema,
  bulkImportSchema,
  createProductSchema,
  featuredQuerySchema,
  publicListQuerySchema,
  updateProductSchema,
} from './products.schemas';

const idParam = z.object({ id: z.string().min(1) });
const imageIdParam = z.object({ imageId: z.string().min(1) });
const slugParam = z.object({ slug: z.string().min(1) });

export const productsController = {
  async listPublic(req: Request, res: Response) {
    const query = publicListQuerySchema.parse(req.query);
    const result = await productsService.listPublic(query);
    return ok(res, result);
  },

  async listFeatured(req: Request, res: Response) {
    const query = featuredQuerySchema.parse(req.query);
    const result = await productsService.listFeatured(query);
    return ok(res, result);
  },

  async getPublicBySlug(req: Request, res: Response) {
    const { slug } = slugParam.parse(req.params);
    const product = await productsService.getPublicBySlug(slug);
    return ok(res, { product });
  },

  async listAdmin(req: Request, res: Response) {
    const query = adminListQuerySchema.parse(req.query);
    const result = await productsService.listAdmin(query);
    return ok(res, result);
  },

  async create(req: Request, res: Response) {
    const input = createProductSchema.parse(req.body);
    const product = await productsService.create(input);
    return created(res, { product });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const input = updateProductSchema.parse(req.body);
    const product = await productsService.update(id, input);
    return ok(res, { product });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const result = await productsService.remove(id);
    return ok(res, result);
  },

  async addImages(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw HttpError.badRequest('Envie ao menos uma imagem no campo "images".');
    const product = await productsService.addImages(id, files);
    return created(res, { product });
  },

  async removeImage(req: Request, res: Response) {
    const { imageId } = imageIdParam.parse(req.params);
    await productsService.removeImage(imageId);
    return noContent(res);
  },

  /** R19-A — bulk import de produtos vindo de planilha Excel (parseada no frontend). */
  async bulkImport(req: Request, res: Response) {
    const input = bulkImportSchema.parse(req.body);
    const report = await productsService.bulkImport(input);
    return ok(res, report);
  },

  /** R19-E — Desativação em massa (soft delete) — protegida por auth+admin. */
  async bulkDelete(req: Request, res: Response) {
    const input = bulkDeleteSchema.parse(req.body);
    const report = await productsService.bulkDelete(input.ids);
    return ok(res, report);
  },
};
