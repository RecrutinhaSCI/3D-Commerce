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

/** Valores de exemplo do .env.example que nunca podem chegar ao runtime. */
const isPlaceholder = (v: string) => /^(TEST-)?x{4,}$/i.test(v.trim());

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
  // Segredo do Vercel Cron (expiração de pedidos). Sem ele a rota fica desligada.
  CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16, 'CRON_SECRET precisa ter 16+ caracteres.').optional()),
  // Vercel Blob (uploads em produção). Sem ele, grava em disco (só serve em dev).
  BLOB_READ_WRITE_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),

  // Mercado Pago (pagamentos). Access token nunca vai ao frontend.
  // Os placeholders do .env.example ("TEST-xxxx"/"xxxx") são recusados para
  // não subir com credencial de mentira.
  MP_ACCESS_TOKEN: z
    .string()
    .min(1, 'MP_ACCESS_TOKEN é obrigatória.')
    .refine((v) => !isPlaceholder(v), 'MP_ACCESS_TOKEN ainda está com o valor de exemplo.'),
  MP_WEBHOOK_SECRET: z
    .string()
    .min(1, 'MP_WEBHOOK_SECRET é obrigatória.')
    .refine((v) => !isPlaceholder(v), 'MP_WEBHOOK_SECRET ainda está com o valor de exemplo.'),
  // Só referência: o backend não usa a public key (o front lê VITE_MP_PUBLIC_KEY).
  MP_PUBLIC_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

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

/**
 * Dados do cliente que ainda parecem de desenvolvimento num ambiente de
 * produção. Não derruba o servidor (cada item tem fallback funcional), mas é
 * logado no boot e listado por `npm run check:config`.
 */
export function productionConfigWarnings(): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const warnings: string[] = [];
  if (env.MP_ACCESS_TOKEN.startsWith('TEST-')) {
    warnings.push('MP_ACCESS_TOKEN é de TESTE (sandbox) — pagamentos não serão reais.');
  }
  if (/localhost|127\.0\.0\.1/.test(env.APP_URL)) {
    warnings.push('APP_URL aponta para localhost — links de e-mail (reset/verificação) vão quebrar.');
  }
  if (corsOrigins.some((o) => /localhost|127\.0\.0\.1/.test(o))) {
    warnings.push('CORS_ORIGIN ainda inclui localhost — inclua só o domínio real da loja.');
  }
  if (!env.CRON_SECRET) {
    warnings.push('CRON_SECRET ausente — pedidos não pagos não expiram e webhooks perdidos não são reconciliados.');
  }
  if (!env.BLOB_READ_WRITE_TOKEN) {
    warnings.push('BLOB_READ_WRITE_TOKEN ausente — upload de imagens/arquivos falha na Vercel (disco somente leitura).');
  }
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    warnings.push('SMTP não configurado — nenhum e-mail será enviado (pedido, pagamento, senha).');
  }
  return warnings;
}
