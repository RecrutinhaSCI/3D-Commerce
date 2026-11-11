import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/apiResponse';
import { createCourseSchema, updateCourseSchema } from './courses.schemas';
import { coursesService } from './courses.service';

const idParam = z.object({ id: z.string().min(1).max(100) });
export const coursesRouter = Router();
coursesRouter.get('/public/courses', asyncHandler(async (_req, res) => ok(res, { courses: await coursesService.listPublic() })));
coursesRouter.use('/admin/courses', authMiddleware, adminMiddleware);
coursesRouter.get('/admin/courses', asyncHandler(async (_req, res) => ok(res, { courses: await coursesService.listAdmin() })));
coursesRouter.post('/admin/courses', asyncHandler(async (req, res) => created(res, { course: await coursesService.create(createCourseSchema.parse(req.body)) })));
coursesRouter.put('/admin/courses/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return ok(res, { course: await coursesService.update(id, updateCourseSchema.parse(req.body)) });
}));
coursesRouter.delete('/admin/courses/:id', asyncHandler(async (req, res) => {
  await coursesService.remove(idParam.parse(req.params).id);
  return noContent(res);
}));
