import {
  Prisma,
  QuoteStatus,
  type Quote,
  type QuoteFile,
  type User,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import { decimalToNumber } from '../../utils/decimal';
import { safeUnlinkQuoteFile, storedFileUrl } from '../../lib/upload';
import type {
  AdminQuotesQuery,
  CreateQuoteInput,
  MeQuotesQuery,
  UpdateQuoteAdminInput,
  UpdateQuoteStatusInput,
} from './quotes.schemas';

type QuoteWithRelations = Quote & {
  files: QuoteFile[];
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
};

export interface QuoteDTO {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  title: string;
  description: string;
  material: string | null;
  color: string | null;
  quantity: number;
  deadline: string | null;
  estimatedValue: number | null;
  adminNotes: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  files: Array<{
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    createdAt: string;
  }>;
  user?: { id: string; name: string; email: string } | null;
}

function toQuoteDTO(q: QuoteWithRelations): QuoteDTO {
  return {
    id: q.id,
    userId: q.userId,
    customerName: q.customerName,
    customerEmail: q.customerEmail,
    customerPhone: q.customerPhone,
    title: q.title,
    description: q.description,
    material: q.material,
    color: q.color,
    quantity: q.quantity,
    deadline: q.deadline,
    estimatedValue: decimalToNumber(q.estimatedValue),
    adminNotes: q.adminNotes,
    status: q.status,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    files: q.files
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => ({
        id: f.id,
        filename: f.filename,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        url: f.url,
        createdAt: f.createdAt.toISOString(),
      })),
    user: q.user ? { id: q.user.id, name: q.user.name, email: q.user.email } : undefined,
  };
}

const includeRelations = {
  files: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export const quotesService = {
  async create(input: CreateQuoteInput, userId?: string): Promise<QuoteDTO> {
    const quote = await prisma.quote.create({
      data: {
        userId: userId ?? null,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        title: input.title,
        description: input.description,
        material: input.material ?? null,
        color: input.color ?? null,
        quantity: input.quantity,
        deadline: input.deadline ?? null,
        status: QuoteStatus.RECEIVED,
      },
      include: includeRelations,
    });
    return toQuoteDTO(quote);
  },

  async listMine(userId: string, query: MeQuotesQuery) {
    const where: Prisma.QuoteWhereInput = { userId };
    if (query.status) where.status = query.status;

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.quote.count({ where }),
      prisma.quote.findMany({
        where,
        include: includeRelations,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
    ]);
    return {
      quotes: rows.map(toQuoteDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async getMine(userId: string, id: string): Promise<QuoteDTO> {
    const q = await prisma.quote.findFirst({
      where: { id, userId },
      include: includeRelations,
    });
    // 404 quando pertence a outro user (não vaza existência).
    if (!q) throw HttpError.notFound('Orçamento não encontrado.');
    return toQuoteDTO(q);
  },

  async listAdmin(query: AdminQuotesQuery) {
    const where: Prisma.QuoteWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { id: { equals: query.search } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerEmail: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.QuoteOrderByWithRelationInput =
      query.sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' };

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.quote.count({ where }),
      prisma.quote.findMany({
        where,
        include: includeRelations,
        orderBy,
        skip,
        take: query.limit,
      }),
    ]);
    return {
      quotes: rows.map(toQuoteDTO),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  },

  async getAdmin(id: string): Promise<QuoteDTO> {
    const q = await prisma.quote.findUnique({ where: { id }, include: includeRelations });
    if (!q) throw HttpError.notFound('Orçamento não encontrado.');
    return toQuoteDTO(q);
  },

  async updateAdmin(id: string, input: UpdateQuoteAdminInput): Promise<QuoteDTO> {
    const exists = await prisma.quote.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw HttpError.notFound('Orçamento não encontrado.');

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        ...(input.estimatedValue !== undefined ? { estimatedValue: input.estimatedValue } : {}),
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      },
      include: includeRelations,
    });
    return toQuoteDTO(updated);
  },

  async updateStatus(id: string, input: UpdateQuoteStatusInput): Promise<QuoteDTO> {
    const exists = await prisma.quote.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw HttpError.notFound('Orçamento não encontrado.');
    const updated = await prisma.quote.update({
      where: { id },
      data: { status: input.status },
      include: includeRelations,
    });
    return toQuoteDTO(updated);
  },

  async addFiles(id: string, files: Express.Multer.File[]): Promise<QuoteDTO> {
    if (files.length === 0) throw HttpError.badRequest('Nenhum arquivo enviado.');
    const quote = await prisma.quote.findUnique({ where: { id }, select: { id: true } });
    if (!quote) {
      // Limpa uploads órfãos se o orçamento não existe.
      files.forEach((f) => safeUnlinkQuoteFile(storedFileUrl(f, 'quotes')));
      throw HttpError.notFound('Orçamento não encontrado.');
    }

    try {
      await prisma.$transaction(
        files.map((file) =>
          prisma.quoteFile.create({
            data: {
              quoteId: id,
              filename: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              url: storedFileUrl(file, 'quotes'),
            },
          }),
        ),
      );
    } catch (err) {
      // Se a transação falhar, remove arquivos do disco.
      files.forEach((f) => safeUnlinkQuoteFile(storedFileUrl(f, 'quotes')));
      throw err;
    }

    const updated = await prisma.quote.findUnique({ where: { id }, include: includeRelations });
    return toQuoteDTO(updated!);
  },
};
