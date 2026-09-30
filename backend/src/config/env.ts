import 'dotenv/config';
import { z } from 'zod';

/**
 * Schema único de variáveis de ambiente.
 * Falha cedo (boot) se algo essencial estiver faltando.
 *
 * Campos sensíveis (JWT, DATABASE_URL) ainda não são exigidos na R1.
 * Serão obrigatórios a partir da R2 (Prisma) e R3 (Auth).
 */
/**
 * Placeholders vazios no .env ("") chegam como string vazia, não `undefined`.
 * Para as vars SMTP opcionais, tratamos "" como "não configurado".
 */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/** Parser de boolean tolerante: "true"/"1" => true, "false"/"0"/"" => false. */
const toOptionalBoolean = (v: unknown): boolean | undefined => {
  if (v === '' || v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
};

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

  // Mercado Pago (pagamentos). Access token nunca vai ao frontend.
  MP_ACCESS_TOKEN: z.string().min(1, 'MP_ACCESS_TOKEN é obrigatória.'),
  MP_PUBLIC_KEY: z.string().min(1, 'MP_PUBLIC_KEY é obrigatória.'),
  MP_WEBHOOK_SECRET: z.string().min(1, 'MP_WEBHOOK_SECRET é obrigatória.'),

  // SMTP (e-mail transacional). TODAS opcionais: sem elas, o servidor sobe
  // e o envio entra em "modo dev" (loga aviso, não envia). Ver src/lib/email.ts.
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_SECURE: z.preprocess(toOptionalBoolean, z.boolean().optional()),

  // Base do frontend, usada para montar links (reset de senha, verificação).
  APP_URL: z.string().default('http://localhost:5173'),
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
