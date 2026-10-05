/**
 * Verificação da configuração do cliente — `npm run check:config`.
 *
 * SOMENTE LEITURA: não cria pedido, não envia e-mail, não altera o banco.
 * Confere se os dados do cliente estão no lugar antes do deploy/entrega:
 *   - variáveis de ambiente (o próprio import de `env` já valida e encerra);
 *   - banco: conexão + migrations aplicadas;
 *   - admin: existe e não usa a senha de desenvolvimento;
 *   - dados da loja (SiteSettings) preenchidos;
 *   - Mercado Pago: token válido e se a conta é de TESTE ou PRODUÇÃO;
 *   - SMTP: conexão/autenticação (sem enviar nada).
 *
 * Nunca imprime tokens, senhas ou segredos. Sai com código 1 se houver erro.
 */
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { UserRole } from '@prisma/client';
import { env, corsOrigins, productionConfigWarnings } from '../src/config/env';
import { prisma } from '../src/lib/prisma';

type Level = 'ok' | 'warn' | 'error';
const results: Array<{ level: Level; area: string; msg: string }> = [];
const add = (level: Level, area: string, msg: string) => results.push({ level, area, msg });

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    add('ok', 'Banco', 'Conexão com o banco OK.');
  } catch {
    add('error', 'Banco', 'Não conectou no banco — confira DATABASE_URL.');
    return false;
  }

  const dir = path.join(__dirname, '..', 'prisma', 'migrations');
  const expected = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    const applied = new Set(rows.map((r) => r.migration_name));
    const missing = expected.filter((m) => !applied.has(m));
    if (missing.length) {
      add('error', 'Banco', `Migrations pendentes (${missing.length}): ${missing.join(', ')} — rode \`npx prisma migrate deploy\`.`);
    } else {
      add('ok', 'Banco', `Todas as ${expected.length} migrations aplicadas.`);
    }
  } catch {
    add('error', 'Banco', 'Banco sem tabela de migrations — rode `npx prisma migrate deploy` e depois o seed.');
    return false;
  }
  return true;
}

async function checkAdmin() {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, active: true },
    select: { email: true, passwordHash: true },
  });
  if (admins.length === 0) {
    add('error', 'Admin', 'Nenhum admin ativo — rode o seed com ADMIN_EMAIL/ADMIN_PASSWORD.');
    return;
  }
  for (const a of admins) {
    const usesDevPassword = await bcrypt.compare('admin123', a.passwordHash);
    if (usesDevPassword) {
      add(env.NODE_ENV === 'production' ? 'error' : 'warn', 'Admin', `${a.email} ainda usa a senha de desenvolvimento "admin123".`);
    } else {
      add('ok', 'Admin', `${a.email} com senha própria.`);
    }
  }
}

async function checkStoreSettings() {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'main' } });
  if (!s) {
    add('warn', 'Loja', 'Configurações da loja ainda não criadas — rode o seed ou salve em /admin/configuracoes.');
    return;
  }
  const required: Array<[string, string | null]> = [
    ['Nome da loja', s.storeName],
    ['WhatsApp', s.whatsapp],
    ['E-mail de contato', s.email],
    ['Endereço', s.address],
    ['CNPJ', s.cnpj],
  ];
  const empty = required.filter(([, v]) => !v || !v.trim()).map(([k]) => k);
  if (empty.length) {
    add('warn', 'Loja', `Campos vazios em /admin/configuracoes: ${empty.join(', ')}.`);
  } else {
    add('ok', 'Loja', `Dados da loja preenchidos (${s.storeName} · WhatsApp ${s.whatsapp}).`);
  }
  if (!s.logoUrl) add('warn', 'Loja', 'Sem logo enviada em /admin/configuracoes (usa o logo padrão).');
}

async function checkMercadoPago() {
  try {
    const res = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      add('error', 'Mercado Pago', 'MP_ACCESS_TOKEN inválido ou revogado.');
      return;
    }
    if (!res.ok) {
      add('warn', 'Mercado Pago', `Não foi possível validar o token agora (HTTP ${res.status}).`);
      return;
    }
    const me = (await res.json()) as { nickname?: string; site_id?: string; tags?: string[] };
    const isTest = (me.tags ?? []).includes('test_user') || env.MP_ACCESS_TOKEN.startsWith('TEST-');
    const who = `${me.nickname ?? 'conta'} (${me.site_id ?? '?'})`;
    if (isTest) {
      add(env.NODE_ENV === 'production' ? 'error' : 'warn', 'Mercado Pago', `Token válido, mas é conta de TESTE: ${who}. Em produção use as credenciais de produção do cliente.`);
    } else {
      add('ok', 'Mercado Pago', `Token de PRODUÇÃO válido: ${who}.`);
    }
    if (me.site_id && me.site_id !== 'MLB') {
      add('warn', 'Mercado Pago', `Conta não é do Brasil (site ${me.site_id}) — Pix/boleto não vão funcionar.`);
    }
  } catch {
    add('warn', 'Mercado Pago', 'Sem resposta da API do Mercado Pago (rede/timeout).');
  }
  add('ok', 'Mercado Pago', 'MP_WEBHOOK_SECRET preenchido (só dá para validar recebendo um webhook real).');
}

async function checkSmtp() {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    add(env.NODE_ENV === 'production' ? 'error' : 'warn', 'E-mail', 'SMTP não configurado — e-mails de pedido, pagamento e senha não serão enviados.');
    return;
  }
  const tx = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 8000,
  });
  try {
    await tx.verify();
    add('ok', 'E-mail', `SMTP conectado e autenticado (${env.SMTP_HOST}), remetente ${env.SMTP_FROM}.`);
  } catch {
    add('error', 'E-mail', `SMTP recusou a conexão/login em ${env.SMTP_HOST} — confira usuário, senha de app e porta.`);
  }
}

function checkUrls() {
  add('ok', 'URLs', `APP_URL=${env.APP_URL} · CORS_ORIGIN=${corsOrigins.join(', ')}`);
  for (const w of productionConfigWarnings()) {
    // MP/SMTP já têm checagem própria acima; aqui só o que é de URL.
    if (/APP_URL|CORS_ORIGIN/.test(w)) add('error', 'URLs', w);
  }
}

async function main() {
  console.log(`\nVerificando configuração (NODE_ENV=${env.NODE_ENV})...\n`);
  const dbOk = await checkDatabase();
  if (dbOk) {
    await checkAdmin();
    await checkStoreSettings();
  }
  await checkMercadoPago();
  await checkSmtp();
  checkUrls();

  const icon: Record<Level, string> = { ok: '✔', warn: '⚠', error: '✖' };
  for (const r of results) console.log(`${icon[r.level]} [${r.area}] ${r.msg}`);

  const errors = results.filter((r) => r.level === 'error').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log(`\n${errors} erro(s), ${warns} aviso(s).`);
  console.log('Lembrete: as variáveis do FRONT (VITE_API_URL, VITE_MP_PUBLIC_KEY) ficam na Vercel e não são checadas aqui.\n');
  process.exitCode = errors ? 1 : 0;
}

main()
  .catch((e) => {
    console.error('[check-config] Falha inesperada:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
