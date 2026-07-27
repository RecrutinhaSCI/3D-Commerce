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

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
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

/** Lista de origens permitidas no CORS, separadas por vírgula no .env. */
export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Secret do webhook do provider MOCK. Em dev/test, se não configurado,
 * usa um default explícito (o superRefine acima impede isso em produção).
 */
export const paymentWebhookSecret =
  env.PAYMENT_WEBHOOK_SECRET ?? 'dev-mock-webhook-secret-local-only';
