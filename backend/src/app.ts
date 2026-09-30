import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { env, corsOrigins } from './config/env';
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

  // CORS — lista vinda do .env (CORS_ORIGIN, separado por vírgula).
  app.use(
    cors({
      origin(origin, callback) {
        // Permite requests sem Origin (curl, server-to-server, health check).
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
      },
      credentials: true,
    }),
  );

  // Body parsers com limite explícito (10mb para uploads JSON ainda razoáveis).
  app.use(express.json({ limit: '10mb' }));
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
