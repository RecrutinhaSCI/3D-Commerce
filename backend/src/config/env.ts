import 'dotenv/config';
import { z } from 'zod';

/**
 * Schema único de variáveis de ambiente.
 * Falha cedo (boot) se algo essencial estiver faltando.
 *
 * Campos sensíveis (JWT, DATABASE_URL) ainda não são exigidos na R1.
 * Serão obrigatórios a partir da R2 (Prisma) e R3 (Auth).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória (R2).'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET precisa ter no mínimo 16 caracteres.')
    .refine((v) => v !== 'change-me', 'Defina um JWT_SECRET real (não use "change-me").'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Origens fixas — aceita `CORS_ORIGINS` (novo, plural) ou `CORS_ORIGIN`
  // (legado, mantido por compat). CSV separado por vírgula. Vazio é OK: dá
  // para autorizar tudo via `VERCEL_PREVIEW_REGEX` sem listar origem fixa.
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /**
   * Regex OPCIONAL para autorizar previews da Vercel (ou similares) sem
   * precisar listar cada URL. Em produção defaultamos ao padrão do projeto
   * 3d-commerce da conta recrutinha-sci-s-projects para autorizar previews
   * automáticos gerados a cada PR. NUNCA use `.*\.vercel\.app$` aqui — isso
   * abriria o backend para qualquer projeto Vercel de qualquer conta.
   */
  VERCEL_PREVIEW_REGEX: z.string().optional(),
  UPLOAD_DIR: z.string().default('uploads'),

  // --- Pagamentos (R19) ---
  // Provider ativo: "mock" (simulado, para dev/testes) ou "inter" (Banco Inter,
  // ainda não implementado — preparado para integração futura).
  PAYMENT_PROVIDER: z.enum(['mock', 'inter']).default('mock'),
  // Validade da cobrança Pix, em minutos.
  PAYMENT_PIX_EXPIRATION_MINUTES: z.coerce.number().int().positive().default(30),
  // Secret usado para assinar/validar webhooks do provider MOCK (HMAC-SHA256).
  // Obrigatório em produção; em dev cai num default explícito de desenvolvimento.
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),

  // --- Banco Inter (futuro — NÃO usados ainda; documentados no .env.example) ---
  INTER_CLIENT_ID: z.string().optional(),
  INTER_CLIENT_SECRET: z.string().optional(),
  INTER_CERT_PATH: z.string().optional(),
  INTER_KEY_PATH: z.string().optional(),
  INTER_PIX_KEY: z.string().optional(),
  INTER_WEBHOOK_SECRET: z.string().optional(),
  INTER_BASE_URL: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === 'production' && v.PAYMENT_PROVIDER === 'mock' && !v.PAYMENT_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PAYMENT_WEBHOOK_SECRET'],
      message: 'PAYMENT_WEBHOOK_SECRET é obrigatório em produção com PAYMENT_PROVIDER=mock.',
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Log estruturado e encerra o processo: configuração inválida
  // não deve permitir o servidor subir.
  // eslint-disable-next-line no-console
  console.error('[env] Configuração inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Normaliza uma origem: minúscula + sem barra final (o header Origin nunca traz path). */
function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Lista de origens fixas permitidas no CORS.
 * Aceita `CORS_ORIGINS` (novo, preferido) ou cai no legado `CORS_ORIGIN`.
 * Cada valor é normalizado uma única vez aqui — o comparador não precisa
 * repetir a lógica em cada request.
 */
export const corsOrigins: string[] = (env.CORS_ORIGINS ?? env.CORS_ORIGIN)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

/**
 * Regex de previews permitidos. Em produção, sem override explícito, usamos
 * o padrão do projeto 3d-commerce da conta recrutinha-sci-s-projects — cada
 * PR gera uma URL única do tipo:
 *   https://3d-commerce-<hash>-recrutinha-sci-s-projects.vercel.app
 * Fora de produção, previews não são liberados automaticamente para não
 * mascarar erros de configuração local.
 */
const DEFAULT_VERCEL_PREVIEW_REGEX =
  /^https:\/\/3d-commerce-[a-z0-9-]+-recrutinha-sci-s-projects\.vercel\.app$/;

export const corsPreviewRegex: RegExp | null = env.VERCEL_PREVIEW_REGEX
  ? new RegExp(env.VERCEL_PREVIEW_REGEX)
  : env.NODE_ENV === 'production'
  ? DEFAULT_VERCEL_PREVIEW_REGEX
  : null;

/**
 * Decide se uma origem passa no CORS. Puramente síncrono — o `origin`
 * callback nunca lança para não cair no errorHandler como 500; em vez disso
 * responde `false` e o browser aplica o bloqueio padrão.
 */
export function isOriginAllowed(origin: string): boolean {
  const o = normalizeOrigin(origin);
  if (corsOrigins.includes(o)) return true;
  if (corsPreviewRegex && corsPreviewRegex.test(o)) return true;
  return false;
}

/**
 * Secret do webhook do provider MOCK. Em dev/test, se não configurado,
 * usa um default explícito (o superRefine acima impede isso em produção).
 */
export const paymentWebhookSecret =
  env.PAYMENT_WEBHOOK_SECRET ?? 'dev-mock-webhook-secret-local-only';
