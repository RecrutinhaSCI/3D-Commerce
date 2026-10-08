import { Router } from 'express';
import { z } from 'zod';
import { ContactMessageStatus } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { adminMiddleware } from '../../middlewares/adminMiddleware';
import { contactRateLimiter } from '../../middlewares/rateLimiters';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { prisma } from '../../lib/prisma';
import { sendEmail } from '../../lib/email';
import { contactMessageEmail } from '../../lib/emailTemplates';

/**
 * Contato e newsletter.
 * Público (rate limit 10/h por IP):
 *   POST /api/public/contact      → grava a mensagem e avisa a loja por e-mail
 *   POST /api/public/newsletter   → inscreve o e-mail (idempotente)
 * Admin:
 *   GET   /api/admin/contact-messages        → últimas mensagens
 *   PATCH /api/admin/contact-messages/:id    → muda status (lida/respondida/arquivada)
 *   GET   /api/admin/newsletter              → inscritos ativos
 */
export const contactRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  phone: z.string().trim().max(30).optional().nullable(),
  message: z.string().trim().min(10, 'Mensagem muito curta.').max(5000),
});

const newsletterSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  source: z.string().trim().max(60).optional(),
});

contactRouter.post(
  '/public/contact',
  contactRateLimiter,
  asyncHandler(async (req, res) => {
    const input = contactSchema.parse(req.body);
    const msg = await prisma.contactMessage.create({
      data: { name: input.name, email: input.email, phone: input.phone || null, message: input.message },
    });
    // Avisa a loja (e-mail de contato das configurações). Falha de SMTP não
    // perde a mensagem — ela já está salva e aparece em /admin/mensagens.
    try {
      const settings = await prisma.siteSettings.findUnique({ where: { id: 'main' }, select: { email: true } });
      if (settings?.email) {
        const content = contactMessageEmail(input);
        await sendEmail({ to: settings.email, subject: content.subject, html: content.html, text: content.text, replyTo: input.email });
      }
    } catch {
      // eslint-disable-next-line no-console
      console.error(`[contact] Falha ao avisar a loja sobre a mensagem ${msg.id}.`);
    }
    return created(res, { id: msg.id });
  }),
);

contactRouter.post(
  '/public/newsletter',
  contactRateLimiter,
  asyncHandler(async (req, res) => {
    const { email, source } = newsletterSchema.parse(req.body);
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source: source ?? 'home' },
      update: { unsubscribedAt: null },
    });
    // Mesma resposta para novo ou já inscrito (não revela a base).
    return ok(res, { subscribed: true });
  }),
);

// ---------------------------- Admin ----------------------------------------

contactRouter.use('/admin/contact-messages', authMiddleware, adminMiddleware);
contactRouter.use('/admin/newsletter', authMiddleware, adminMiddleware);

contactRouter.get(
  '/admin/contact-messages',
  asyncHandler(async (_req, res) => {
    const messages = await prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return ok(res, {
      messages: messages.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        message: m.message,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }),
);

contactRouter.patch(
  '/admin/contact-messages/:id',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.nativeEnum(ContactMessageStatus) }).parse(req.body);
    const exists = await prisma.contactMessage.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw HttpError.notFound('Mensagem não encontrada.');
    const m = await prisma.contactMessage.update({ where: { id: req.params.id }, data: { status } });
    return ok(res, { id: m.id, status: m.status });
  }),
);

contactRouter.get(
  '/admin/newsletter',
  asyncHandler(async (_req, res) => {
    const subscribers = await prisma.newsletterSubscriber.findMany({
      where: { unsubscribedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, {
      subscribers: subscribers.map((s) => ({ id: s.id, email: s.email, source: s.source, createdAt: s.createdAt.toISOString() })),
    });
  }),
);
