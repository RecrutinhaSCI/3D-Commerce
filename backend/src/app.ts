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

  // Helmet — mantém TODOS os demais headers de segurança ativos
  // (HSTS, X-Content-Type-Options, X-Frame-Options/frameguard, X-DNS-Prefetch,
  // Referrer-Policy, etc.). Só a CSP fica desligada, de propósito.
  //
  // Por que CSP desligada AQUI: este servidor é uma API pura (respostas JSON +
  // arquivos estáticos em /uploads); ele não serve o HTML da loja para o
  // browser. Ligar uma CSP no backend não protege a página do usuário (que é
  // servida por outro host) e ainda arrisca poluir/limitar respostas de API sem
  // ganho real. crossOriginResourcePolicy fica "cross-origin" para o frontend
  // (outra origem) carregar as imagens de /uploads/* normalmente.
  //
  // CSP DE PRODUÇÃO É RESPONSABILIDADE DO HOST DO FRONTEND (Vercel/Netlify/etc.),
  // via header ou <meta http-equiv="Content-Security-Policy">. Como o Payment
  // Brick do Mercado Pago roda NO frontend, essa CSP PRECISA liberar os domínios
  // do MP, senão o pagamento quebra. Política mínima recomendada para o front:
  //
  //   default-src 'self';
  //   script-src  'self' https://sdk.mercadopago.com https://*.mercadopago.com;
  //   frame-src   https://*.mercadopago.com https://*.mlstatic.com;
  //   connect-src 'self' https://api.mercadopago.com https://*.mercadopago.com <API_URL>;
  //   img-src     'self' data: https://http2.mlstatic.com https://*.mlstatic.com https://*.mercadopago.com;
  //   style-src   'self' 'unsafe-inline';
  //   font-src    'self' https://http2.mlstatic.com;
  //
  // Domínios do MP que a CSP do front NÃO pode bloquear: https://sdk.mercadopago.com,
  // https://*.mercadopago.com, https://api.mercadopago.com e https://http2.mlstatic.com.
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

  // Arquivos estáticos.
  // - `public/` (ex.: /uploads/seed/*.svg): na Vercel é servido pelo CDN direto
  //   da pasta public/ — o express.static é ignorado lá; aqui cobre o dev local.
  // - `UPLOAD_DIR`: uploads em disco, SÓ em desenvolvimento. Em produção os
  //   uploads vão para o Vercel Blob e o banco guarda a URL absoluta.
  app.use(express.static(path.resolve(process.cwd(), 'public'), { maxAge: '7d' }));
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
