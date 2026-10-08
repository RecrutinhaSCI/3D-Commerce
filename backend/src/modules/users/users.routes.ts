import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { prisma } from '../../lib/prisma';

/**
 * Users — R9B.
 *   GET /api/me   → perfil (alias de /auth/me)
 *   PUT /api/me   → atualiza nome/telefone (não altera email/role/senha)
 *   GET /api/me/address → endereço padrão do cliente (ou null)
 *   PUT /api/me/address → cria/atualiza o endereço padrão
 */
export const usersRouter = Router();

const updateMeSchema = z.object({
  name: z.string().trim().min(2, 'Nome inválido.').max(120).optional(),
  phone: z.string().trim().min(8, 'Telefone inválido.').max(30).optional(),
}).refine(
  (v) => v.name !== undefined || v.phone !== undefined,
  'Envie ao menos um campo (name ou phone).',
);

function toPublicUser(u: {
  id: string; name: string; email: string; phone: string | null;
  role: 'ADMIN' | 'CUSTOMER'; active: boolean; emailVerified: boolean; createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    active: u.active,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

usersRouter.use('/me', authMiddleware);

usersRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) throw HttpError.unauthorized();
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!u || !u.active) throw HttpError.unauthorized();
    ok(res, { user: toPublicUser(u) });
  }),
);

usersRouter.put(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) throw HttpError.unauthorized();
    const input = updateMeSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
    });
    ok(res, { user: toPublicUser(updated) });
  }),
);

// ---------------------------------------------------------------------------
// Endereço padrão do cliente (model Address, isDefault = true). Um por cliente
// nesta versão — o checkout e "Minha conta" leem/gravam aqui.
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  zipCode: z.string().trim().min(8, 'CEP inválido.').max(9),
  street: z.string().trim().min(2, 'Rua inválida.').max(200),
  number: z.string().trim().min(1, 'Número obrigatório.').max(20),
  complement: z.string().trim().max(120).optional().nullable(),
  district: z.string().trim().min(2, 'Bairro inválido.').max(120),
  city: z.string().trim().min(2, 'Cidade inválida.').max(120),
  state: z.string().trim().length(2, 'UF inválida.').transform((v) => v.toUpperCase()),
  recipientName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
});

function toAddressDTO(a: {
  id: string; zipCode: string; street: string; number: string; complement: string | null;
  district: string; city: string; state: string; recipientName: string; phone: string;
}) {
  return {
    id: a.id,
    zipCode: a.zipCode,
    street: a.street,
    number: a.number,
    complement: a.complement,
    district: a.district,
    city: a.city,
    state: a.state,
    recipientName: a.recipientName,
    phone: a.phone,
  };
}

usersRouter.get(
  '/me/address',
  asyncHandler(async (req, res) => {
    if (!req.user) throw HttpError.unauthorized();
    const address = await prisma.address.findFirst({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    ok(res, { address: address ? toAddressDTO(address) : null });
  }),
);

usersRouter.put(
  '/me/address',
  asyncHandler(async (req, res) => {
    if (!req.user) throw HttpError.unauthorized();
    const input = addressSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, phone: true } });
    const data = {
      zipCode: input.zipCode.replace(/\D/g, ''),
      street: input.street,
      number: input.number,
      complement: input.complement || null,
      district: input.district,
      city: input.city,
      state: input.state,
      recipientName: input.recipientName ?? user?.name ?? '',
      phone: input.phone ?? user?.phone ?? '',
      isDefault: true,
    };
    const current = await prisma.address.findFirst({
      where: { userId: req.user.id, isDefault: true },
      select: { id: true },
    });
    const saved = current
      ? await prisma.address.update({ where: { id: current.id }, data })
      : await prisma.address.create({ data: { ...data, userId: req.user.id } });
    ok(res, { address: toAddressDTO(saved) });
  }),
);
