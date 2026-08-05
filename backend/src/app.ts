import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env, isOriginAllowed } from './config/env';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler } from './middlewares/errorHandler';
import { notFoundHandler } from './middlewares/notFoundHandler';
import { apiRouter } from './routes';

/**
 * Factory do app Express. Separado do `server.ts` para facilitar testes.
 */
export function createApp(): Express {
  const app = express();

  // Confiar em proxy reverso (Vercel/Render/Cloudflare) para IPs reais.
  app.set('trust proxy', 1);

  // Helmet — headers de segurança padrão.
  // CSP desligado: este servidor é uma API pura (JSON + arquivos estáticos em
  // /uploads), não renderiza HTML para o browser, então CSP não se aplica e
  // poderia gerar falso senso de proteção. crossOriginResourcePolicy relaxado
  // para "cross-origin" para o frontend (outra origem/domínio) poder carregar
  // as imagens de /uploads/* normalmente.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS — origens fixas via CORS_ORIGINS (ou CORS_ORIGIN legado, CSV) +
  // regex opcional para previews da Vercel (ver env.ts).
  //
  // Bloqueio: NUNCA lançamos Error dentro do callback. Se lançássemos, o
  // middleware do `cors` chamaria `next(err)`, cairia no errorHandler e
  // devolveria 500 ao browser (mesmo em preflight OPTIONS) — poluindo logs
  // e mascarando o erro real. Em vez disso respondemos `false`: o `cors`
  // apenas omite o `Access-Control-Allow-Origin`, o browser aplica sua
  // política padrão de bloqueio e nós logamos o warn uma única vez.
  app.use(
    cors({
      origin(origin, callback) {
        // Requests sem Origin (curl, server-to-server, health checks do
        // Render, mesma-origem) — sempre permitidos.
        if (!origin) return callback(null, true);
        if (isOriginAllowed(origin)) return callback(null, true);
        // eslint-disable-next-line no-console
        console.warn(`[cors] Origem bloqueada: ${origin}`);
        return callback(null, false);
      },
      credentials: true,
      // Preflight completa: garantimos que Authorization, Content-Type e
      // outros headers comuns passem, e que o método OPTIONS retorne 204.
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Webhook-Signature'],
      optionsSuccessStatus: 204,
      maxAge: 600,
    }),
  );

  // Body parsers com limite explícito (10mb para uploads JSON ainda razoáveis).
  // `verify` guarda o body bruto em req.rawBody — assinaturas HMAC de webhook
  // precisam ser validadas sobre os bytes originais, não sobre o JSON re-serializado.
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logger leve só em dev/test (em produção use pino/winston).
  if (env.NODE_ENV !== 'production') {
    app.use(requestLogger);
  }

  // Arquivos estáticos de upload (Multer servirá nestes paths a partir da R4/R6).
  const uploadsPath = path.resolve(process.cwd(), env.UPLOAD_DIR);
  app.use('/uploads', express.static(uploadsPath, { fallthrough: true, maxAge: '7d' }));

  // Rotas da API
  app.use(apiRouter);

  // 404 → JSON padrão
  app.use(notFoundHandler);

  // Erro global → JSON padrão (DEVE ser o último)
  app.use(errorHandler);

  return app;
}
