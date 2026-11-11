import { Prisma, type Course } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { generateUniqueSlug } from '../../utils/slug';
import { decimalToNumber } from '../../utils/decimal';
import { courseFieldNames, createCourseSchema, type CreateCourseInput, type UpdateCourseInput } from './courses.schemas';

function toDTO(course: Course) {
  return { ...course, price: decimalToNumber(course.price), originalPrice: decimalToNumber(course.originalPrice) };
}
const orderBy: Prisma.CourseOrderByWithRelationInput[] = [
  { displayOrder: 'asc' }, { featured: 'desc' }, { createdAt: 'asc' }, { id: 'asc' },
];
async function slugFor(input: CreateCourseInput, currentSlug?: string) {
  const exists = async (slug: string) => !!(await prisma.course.findUnique({ where: { slug }, select: { id: true } }));
  if (input.slug) {
    if (input.slug !== currentSlug && await exists(input.slug)) throw HttpError.conflict('Slug já em uso.');
    return input.slug;
  }
  return generateUniqueSlug(input.title, exists, currentSlug);
}
function handleUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw HttpError.conflict('Slug já em uso.');
  throw error;
}
export const coursesService = {
  async listPublic() {
    const courses = await prisma.course.findMany({ where: { active: true }, orderBy });
    return courses.map(toDTO);
  },
  async listAdmin() {
    return (await prisma.course.findMany({ orderBy })).map(toDTO);
  },
  async create(input: CreateCourseInput) {
    const slug = await slugFor(input);
    try { return toDTO(await prisma.course.create({ data: { ...input, slug } })); }
    catch (error) { return handleUnique(error); }
  },
  async update(id: string, input: UpdateCourseInput) {
    const current = await prisma.course.findUnique({ where: { id } });
    if (!current) throw HttpError.notFound('Curso não encontrado.');
    // Validar também combinações parciais: mudar só a URL não pode contornar ctaType.
    const currentDTO = toDTO(current);
    const merged = createCourseSchema.parse(Object.fromEntries(courseFieldNames.map((key) => [key,
      input[key as keyof UpdateCourseInput] === undefined ? currentDTO[key as keyof typeof currentDTO] : input[key as keyof UpdateCourseInput],
    ])));
    const slug = input.slug === undefined ? current.slug : await slugFor(merged, current.slug);
    try { return toDTO(await prisma.course.update({ where: { id }, data: { ...merged, slug } })); }
    catch (error) { return handleUnique(error); }
  },
  async remove(id: string) {
    if (!await prisma.course.findUnique({ where: { id }, select: { id: true } })) throw HttpError.notFound('Curso não encontrado.');
    await prisma.course.delete({ where: { id } });
    // Não remover o arquivo: o uploader compartilhado permite a mesma capa em outros conteúdos.
  },
};
