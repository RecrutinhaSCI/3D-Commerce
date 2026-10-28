import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ok } from '../../../utils/apiResponse';
import { authMiddleware } from '../../../middlewares/authMiddleware';
import { adminMiddleware } from '../../../middlewares/adminMiddleware';
import { createAdminActionRateLimiter, LABEL_RATE_LIMITS, type AdminActionLimit } from '../../../middlewares/rateLimiters';
import { labelsService } from './labels.service';
import { senderSchema } from './sender';
import { createLabelWorkflow, type LabelWorkflow, type WorkflowResult } from './labelWorkflow';

/**
 * Etiquetas do Melhor Envio — SÓ admin.
 *
 *   GET  /api/admin/shipping-labels/config   → travas + prontidão do remetente
 *   GET  /api/admin/shipping-labels/sender   → remetente salvo (ou sugestão)
 *   PUT  /api/admin/shipping-labels/sender   → grava o remetente (validado)
 *
 * Por pedido (`/api/admin/shipping-labels/orders/:orderId/label…`):
 *   GET  …/label               → visão do painel (DTO + availableActions)
 *   GET  …/label/events        → auditoria
 *   POST …/label/prepare       { package, fiscal, recipientDocument? }
 *   POST …/label/confirmation  → nova confirmação de preço (token de uso único)
 *   POST …/label/purchase      { labelId, token }  ← NADA de preço/ids/status
 *   POST …/label/reconcile     { reason? }
 *   POST …/label/generate
 *   POST …/label/sync          → consulta status no ME (só avança)
 *   GET  …/label/cancellable   → o ME permite cancelar?
 *   POST …/label/cancel        { labelId, reason }
 *   POST …/label/discard       { labelId, reason }   (só não paga, provado no ME)
 *   POST …/label/notes         { labelId, reason, evidence? } (só auditoria)
 *
 * Toda resposta de ação devolve a visão atualizada (+ `confirmation` quando
 * uma foi criada, + `error` sanitizado quando o ME falhou). Não existe rota
 * para escolher status livremente.
 */

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'id inválido');
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'token inválido');
const reasonSchema = z.string().trim().min(5).max(300);

// .strict(): campo extra (preço, me_order_id, status, payload…) → 422.
const emptySchema = z.object({}).strict();
const prepareSchema = z
  .object({ package: z.unknown(), fiscal: z.unknown(), recipientDocument: z.string().max(20).nullish() })
  .strict();
const purchaseSchema = z.object({ labelId: idSchema, token: tokenSchema }).strict();
const reconcileSchema = z.object({ reason: reasonSchema.optional() }).strict();
const reasonBodySchema = z.object({ labelId: idSchema, reason: reasonSchema }).strict();
const noteSchema = z.object({ labelId: idSchema, reason: reasonSchema, evidence: z.string().trim().max(300).nullish() }).strict();

export interface LabelsRouterDeps {
  workflow?: LabelWorkflow;
  limits?: Partial<Record<keyof typeof LABEL_RATE_LIMITS, AdminActionLimit>>;
}

export function createLabelsRouter(deps: LabelsRouterDeps = {}) {
  const router = Router();
  let defaultWorkflow: LabelWorkflow | undefined;
  const wf = () => deps.workflow ?? (defaultWorkflow ??= createLabelWorkflow());
  const limits = { ...LABEL_RATE_LIMITS, ...deps.limits };
  const limiter = (name: keyof typeof LABEL_RATE_LIMITS) => createAdminActionRateLimiter(`labels-${name}`, limits[name]);
  const read = limiter('read');
  const query = limiter('query');
  const write = limiter('write');
  const financial: RequestHandler[] = [limiter('financialTotal'), limiter('financial')];

  router.use('/admin/shipping-labels', authMiddleware, adminMiddleware);

  router.get('/admin/shipping-labels/config', asyncHandler(async (_req, res) => ok(res, await labelsService.getConfig())));
  router.get('/admin/shipping-labels/sender', asyncHandler(async (_req, res) => ok(res, await labelsService.getSender())));
  router.put(
    '/admin/shipping-labels/sender',
    asyncHandler(async (req, res) => ok(res, await labelsService.updateSender(senderSchema.parse(req.body ?? {})))),
  );

  const base = '/admin/shipping-labels/orders/:orderId/label';
  const orderIdOf = (req: Request) => idSchema.parse(req.params.orderId);
  const userOf = (req: Request) => req.user!.id;
  const body = (req: Request) => req.body ?? {};

  /** Visão atualizada + o que a ação devolveu de efêmero (token, erro do ME). */
  async function respond(orderId: string, userId: string, result?: WorkflowResult, extra?: Record<string, unknown>) {
    const view = await wf().overview(orderId, userId);
    return {
      ...view,
      ...(result?.confirmation ? { confirmation: result.confirmation } : {}),
      ...(result?.error ? { error: result.error } : {}),
      ...extra,
    };
  }

  router.get(
    base,
    read,
    asyncHandler(async (req, res) => ok(res, await respond(orderIdOf(req), userOf(req)))),
  );
  router.get(
    `${base}/events`,
    read,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      await wf().overview(orderId, userOf(req)); // 404 se o pedido não existe
      ok(res, await wf().events(orderId));
    }),
  );

  router.post(
    `${base}/prepare`,
    write,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = prepareSchema.parse(body(req));
      const r = await wf().prepare(orderId, { package: input.package, fiscal: input.fiscal, recipientDocument: input.recipientDocument ?? null }, userOf(req));
      ok(res, await respond(orderId, userOf(req), r));
    }),
  );
  router.post(
    `${base}/confirmation`,
    write,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      emptySchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().requestConfirmation(orderId, userOf(req))));
    }),
  );
  router.post(
    `${base}/purchase`,
    ...financial,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = purchaseSchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().purchase(orderId, input.token, userOf(req), input.labelId)));
    }),
  );
  router.post(
    `${base}/reconcile`,
    query,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = reconcileSchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().reconcile(orderId, userOf(req), input.reason ?? null)));
    }),
  );
  router.post(
    `${base}/generate`,
    write,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      emptySchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().generate(orderId, userOf(req))));
    }),
  );
  router.post(
    `${base}/sync`,
    query,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      emptySchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().sync(orderId, userOf(req))));
    }),
  );
  router.get(
    `${base}/cancellable`,
    query,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const r = await wf().checkCancellable(orderId, userOf(req));
      ok(res, await respond(orderId, userOf(req), r, { cancellable: r.cancellable }));
    }),
  );
  router.post(
    `${base}/cancel`,
    ...financial,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = reasonBodySchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().cancel(orderId, input, userOf(req))));
    }),
  );
  router.post(
    `${base}/discard`,
    ...financial,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = reasonBodySchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().discard(orderId, input, userOf(req))));
    }),
  );
  router.post(
    `${base}/notes`,
    write,
    asyncHandler(async (req, res) => {
      const orderId = orderIdOf(req);
      const input = noteSchema.parse(body(req));
      ok(res, await respond(orderId, userOf(req), await wf().addNote(orderId, input, userOf(req))));
    }),
  );

  return router;
}

export const labelsRouter = createLabelsRouter();
