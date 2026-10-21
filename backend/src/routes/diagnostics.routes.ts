import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { adminMiddleware } from '../middlewares/adminMiddleware';
import { ok } from '../utils/apiResponse';

export const diagnosticsRouter = Router();

/**
 * GET /api/admin/diagnostics/client-ip — SOMENTE admin, somente leitura.
 *
 * Mostra como o app enxerga o IP do cliente atrás dos proxies (Cloudflare +
 * Render), para decidir o valor correto de `trust proxy` antes de mudá-lo.
 * Não grava nada nem loga nada; responde só para o próprio admin que chamou.
 */
diagnosticsRouter.get('/admin/diagnostics/client-ip', authMiddleware, adminMiddleware, (req, res) => {
  const header = (name: string) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(', ') : v ?? null;
  };
  const xff = header('x-forwarded-for');
  ok(res, {
    trustProxy: req.app.get('trust proxy'),
    reqIp: req.ip ?? null,
    reqIps: req.ips,
    remoteAddress: req.socket.remoteAddress ?? null,
    xForwardedFor: xff,
    xForwardedForHops: xff ? xff.split(',').map((s) => s.trim()) : [],
    cfConnectingIp: header('cf-connecting-ip'),
    trueClientIp: header('true-client-ip'),
    xRealIp: header('x-real-ip'),
    cfRay: header('cf-ray'),
  });
});
