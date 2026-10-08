import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { created, ok } from '../../utils/apiResponse';
import { HttpError } from '../../utils/httpError';
import { env } from '../../config/env';
import { paymentsService } from './payments.service';
import { createPaymentSchema } from './payments.schemas';

const orderIdParam = z.object({ orderId: z.string().min(1) });

function requireUser(req: Request): string {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

/** Header pode vir como string ou string[] (proxies); pega o primeiro. */
function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Valor de query string normalizado para string (ignora arrays/objetos). */
function firstQueryValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/**
 * Valida a assinatura `x-signature` do webhook do Mercado Pago.
 *
 * Manifest oficial: `id:{data.id};request-id:{x-request-id};ts:{ts};`, com
 * `data.id` em minúsculas. HMAC-SHA256 do `MP_WEBHOOK_SECRET` comparado a `v1`
 * em tempo constante. Só usa query + headers — NÃO precisa do corpo cru, então
 * o `express.json()` global não atrapalha. Campo ausente é removido do manifest
 * (aqui, `request-id`, que a MP pode omitir).
 */
function verifyMpSignature(params: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  const { xSignature, xRequestId, dataId } = params;
  if (!xSignature || !dataId) return false;

  const parts: Record<string, string> = {};
  for (const kv of xSignature.split(',')) {
    const idx = kv.indexOf('=');
    if (idx === -1) continue;
    parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest =
    `id:${dataId.toLowerCase()};` +
    (xRequestId ? `request-id:${xRequestId};` : '') +
    `ts:${ts};`;

  const computed = crypto
    .createHmac('sha256', env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  const a = Buffer.from(computed);
  const b = Buffer.from(v1);
  // timingSafeEqual exige mesmo tamanho; tamanhos diferentes já são inválidos.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const paymentsController = {
  async create(req: Request, res: Response) {
    const userId = requireUser(req);
    const { orderId } = orderIdParam.parse(req.params);
    const input = createPaymentSchema.parse(req.body);
    const payment = await paymentsService.createPayment(userId, orderId, input);
    // `data` é o próprio objeto do pagamento (campos planos): o front (T6)
    // consome `res.status` / `res.qr_code` / `res.external_resource_url`.
    return created(res, payment);
  },

  async status(req: Request, res: Response) {
    const userId = requireUser(req);
    const { orderId } = orderIdParam.parse(req.params);
    const payment = await paymentsService.getPaymentStatus(userId, orderId);
    return ok(res, payment);
  },

  /**
   * Reconciliação em lote dos pagamentos PENDING (admin). Rede de segurança para
   * webhooks perdidos: consulta o MP e avança status/baixa estoque de forma
   * idempotente. Não agenda nada — o líder decide o cron/agendamento.
   */
  /** Cancelar/estornar pedido (admin). Estorna no MP quando já foi pago. */
  async cancelOrder(req: Request, res: Response) {
    const { orderId } = orderIdParam.parse(req.params);
    const result = await paymentsService.cancelOrRefund(orderId);
    return ok(res, result);
  },

  /**
   * Cron (Vercel Cron → GET /api/cron/expire-orders). A Vercel envia
   * `Authorization: Bearer <CRON_SECRET>` quando a env existe. Sem CRON_SECRET
   * configurado a rota fica DESLIGADA (503) — nunca aberta ao público.
   */
  async cronExpireOrders(req: Request, res: Response) {
    if (!env.CRON_SECRET) return res.sendStatus(503);
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const got = Buffer.from(firstHeader(req.headers.authorization) ?? '');
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
      return res.sendStatus(401);
    }
    const result = await paymentsService.expireUnpaidOrders();
    // eslint-disable-next-line no-console
    console.log(`[cron] expire-orders: ${JSON.stringify(result)}`);
    return ok(res, result);
  },

  async reconcile(_req: Request, res: Response) {
    const result = await paymentsService.reconcilePendingPayments();
    return ok(res, result);
  },

  /**
   * Webhook do Mercado Pago (público — a MP chama sem auth). Orders API (T11):
   * valida assinatura → confirma que é notificação de Order (`type=order`) →
   * pega o `data.id` (id da Order do MP) da query/corpo → delega a reconciliação
   * ao service, que reconsulta `GET /v1/orders/{id}` (fonte de verdade).
   *
   * HTTP:
   * - 401  assinatura ausente (em produção) ou inválida — não processa.
   * - 200  ack: outro `type`, sem `data.id`, Order/pedido irrelevante,
   *        ou reconciliação concluída (updated/unchanged/ignored).
   * - 5xx  falha de infra/MP (lançada pelo service) → a MP reenvia.
   *
   * Processa antes de responder (em vez do "responde 200 e processa depois"):
   * é o que permite sinalizar 5xx para o reenvio quando algo falha de verdade.
   * O `GET /v1/orders/{id}` tem timeout de 8s, dentro da janela (~22s) da MP.
   */
  async webhook(req: Request, res: Response) {
    const xSignature = firstHeader(req.headers['x-signature']);
    const xRequestId = firstHeader(req.headers['x-request-id']);
    // Orders API: query traz `?data.id=ORD...&type=order`; o corpo repete em
    // `data.id`. `data.id` é o id da Order do MP (ULID) — o `{id}` do GET.
    const dataId =
      firstQueryValue(req.query['data.id']) ??
      (req.body?.data?.id != null ? String(req.body.data.id) : undefined);

    // 1) Autenticidade. Sem assinatura só passa fora de produção (modo teste),
    //    com aviso explícito. Em produção, exige e recusa com 401.
    if (!xSignature) {
      if (env.NODE_ENV === 'production') {
        return res.sendStatus(401);
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[payments:webhook] Notificação sem x-signature aceita (NODE_ENV != production). Em produção seria 401.',
      );
    } else if (!verifyMpSignature({ xSignature, xRequestId, dataId })) {
      return res.sendStatus(401);
    }

    // 2) Orders API notifica com `type=order` (topic Orders). Só tratamos esse;
    //    qualquer outro (ex.: `payment` da API antiga) → ack 200, sem reenvio.
    //    `type` ausente segue o fluxo (fallback tolerante a variações da MP).
    const type =
      (typeof req.body?.type === 'string' ? req.body.type : undefined) ??
      firstQueryValue(req.query.type) ??
      firstQueryValue(req.query.topic);
    if (type && type !== 'order') {
      return res.sendStatus(200);
    }

    // 3) Sem id da Order não há o que reconciliar → ack 200.
    if (!dataId) {
      return res.sendStatus(200);
    }

    // 4) Reconcilia via GET /v1/orders/{id} (fonte de verdade). Idempotência e
    //    não-regressão de status ficam no service (canAdvancePaymentStatus):
    //    a MESMA notificação 2x = no-op, e um status atrasado nunca rebaixa.
    //    Sucesso/irrelevante → 200; erro de infra/MP sobe → 5xx (MP reenvia).
    await paymentsService.processPaymentWebhook(dataId);
    return res.sendStatus(200);
  },
};
