# 3D Commerce — Backend

API REST do 3DCommerce: **Express 4 + TypeScript + Prisma 6 + PostgreSQL (Neon)**, arquitetura modular por domínio. Em produção roda no **Render** (Web Service, Root Directory `backend/`).

Visão geral do projeto e estado atual: [../README.md](../README.md).

---

## Stack

Node 18+ · Express 4 · TypeScript 5 · Prisma 6 · Zod (env e payloads) · JWT + bcryptjs · Multer + **@vercel/blob** (uploads) · **mercadopago** (Orders API via `fetch`) · nodemailer (SMTP) / Brevo (API HTTP) · helmet · express-rate-limit · Vitest.

---

## Estrutura

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/          # 22 migrations (aplicar com migrate deploy em produção)
│   └── seed.ts              # admin + configurações (não sobrescreve dados existentes)
├── public/uploads/seed/     # SVGs do catálogo demo (só com SEED_DEMO_CATALOG=1)
├── uploads/                 # destino de upload em DESENVOLVIMENTO (sem Blob)
├── scripts/                 # check-config, check-blob, auditoria/migração de uploads, backup, smoke tests
└── src/
    ├── app.ts / server.ts   # Express + bootstrap (avisos de config de produção no boot)
    ├── config/env.ts        # validação de env (Zod) — falha no boot se faltar algo essencial
    ├── lib/                 # prisma, upload (Blob/disco), email + templates
    ├── middlewares/         # auth, admin, rate limit, erros, logger
    ├── modules/             # auth, users, categories, products, cart, orders, payments,
    │                        # shipping, quotes, contact, seo, settings (inclui blog),
    │                        # banners, testimonials, coupons, scripts, dashboard
    │                        # pix-inter: DESLIGADO (sem rotas montadas) — ver o README do módulo
    ├── routes/              # router raiz, /health, diagnóstico
    └── utils/
```

---

## Como rodar localmente

```bash
cd backend
cp .env.example .env     # DATABASE_URL, JWT_SECRET e credenciais de TESTE do Mercado Pago
npm install              # postinstall roda prisma generate
npx prisma migrate dev   # só em banco de desenvolvimento
npm run prisma:seed
npm run dev              # http://localhost:3333
```

```bash
curl http://localhost:3333/health
```

---

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | `tsx watch src/server.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (testes de integração com banco exigem `TEST_DATABASE_URL`, ver abaixo) |
| `npm run prisma:generate` / `prisma:studio` / `prisma:format` | Comandos do Prisma |
| `npm run prisma:migrate` | `prisma migrate dev` — **só desenvolvimento** |
| `npm run db:deploy` | `prisma migrate deploy` — produção |
| `npm run prisma:seed` | Seed (admin + configurações; catálogo demo só com `SEED_DEMO_CATALOG=1`) |
| `npm run check:config` | Confere banco, admin, loja, Mercado Pago, Blob, e-mail e cron (não altera nada) |
| `npm run check:blob` | Envia e apaga um arquivo de teste no Vercel Blob (diagnóstico do token) |
| `npm run uploads:audit` | Auditoria só leitura das URLs de imagem/arquivo do banco (origem e status HTTP) |
| `npm run uploads:migrate` | Ferramenta de manutenção: migra URLs antigas `/uploads/...` para o Blob (simulação por padrão; `-- --apply`) |

> `db:setup` e `prisma:migrate:reset` existem para desenvolvimento. **Nunca** rode `migrate dev`, `migrate reset` ou `db push` contra o Neon de produção.

---

## Integrações

- **Mercado Pago — Orders API:** `POST /api/orders/:orderId/payments`, `GET /api/orders/:orderId/payments/status`, webhook `POST /api/payments/webhook` (evento *Order*, assinatura `x-signature` obrigatória em produção), cancelamento/estorno `POST /api/admin/orders/:orderId/cancel`, reconciliação `POST /api/admin/payments/reconcile`. Referência: [../docs/integracoes/mercadopago-orders-api.md](../docs/integracoes/mercadopago-orders-api.md).
- **Uploads:** com `BLOB_READ_WRITE_TOKEN`, tudo vai para o Vercel Blob e o banco guarda a URL absoluta (`https://...blob.vercel-storage.com`). Sem token: disco em desenvolvimento, **upload recusado em produção**. Limite de 4 MB por imagem.
- **E-mail:** `BREVO_API_KEY` tem prioridade; senão SMTP (`SMTP_*`). Sem nenhum, o envio só é logado.
- **Frete:** regra única em `modules/shipping/shipping.service.ts` (`quoteForItems`), usada pelo checkout (`POST /api/shipping/quote`) e pela criação do pedido. Com Melhor Envio configurado: PAC/Sedex reais por CEP; se a cotação falhar, só retirada (status `unavailable`, sem tabela fixa silenciosa). Sem configuração: tabela fixa (PAC R$ 24,90; Sedex = PAC + R$ 18). Frete grátis: PAC grátis, Sedex paga a diferença. Ver [../docs/integracoes/frete-melhor-envio.md](../docs/integracoes/frete-melhor-envio.md).
- **Cron:** `GET /api/cron/expire-orders` com `Authorization: Bearer <CRON_SECRET>`, chamado diariamente pelo GitHub Actions. O `backend/vercel.json` (Vercel Cron) não é usado no Render.

---

## Padrão de resposta

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { } } }
```

Lance erros via `HttpError`; `ZodError`, JSON inválido e payload grande são tratados pelo middleware global.

---

## Backup, limpeza do catálogo e testes de integração

```bash
# Backup dos DADOS (todas as tabelas) → ../backups/*.json + *.sql (pasta no .gitignore)
node scripts/db-backup.cjs

# Limpeza do catálogo (produtos + mídias). Aborta se houver produto ativo,
# carrinho ou pedido vinculado. SÓ rode depois de um backup validado.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-catalog.sql

# Testes de integração com Postgres real. Exige banco LOCAL com nome
# terminando em "_test" — ele é zerado.
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:55432/app_test npx vitest run
```

Regras do catálogo:

- **Excluir** apaga o produto e as fotos (pedidos antigos guardam nome/SKU/preço). Para só tirar da loja, desmarque **Ativo**.
- **Importar Excel**: célula vazia ou coluna ausente = não altera; `0` e `não` são valores. Linhas sem diferença caem em "Sem alteração".
- O seed **não** troca a senha de um admin existente.
