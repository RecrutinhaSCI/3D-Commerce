# Checklist de deploy — 3DCommerce

Infra atual: **Vercel** (frontend, raiz do repo) · **Render** (backend, `backend/`) · **Neon** (PostgreSQL) · **Vercel Blob** (uploads) · **GitHub Actions** (cron diário).
Onde obter cada credencial: [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md). Modelos de env: [.env.example](.env.example) e [backend/.env.example](backend/.env.example).

> Este guia substitui os antigos `DEPLOY.md` e `STAGING-R11.md` (deploy estático, uploads em disco e backend na Vercel não se aplicam mais).

---

## 1. Frontend — Vercel

- Projeto apontando para a **raiz** do repositório, preset **Vite**, build `npm run build`, output `dist`.
- SPA: o [vercel.json](vercel.json) já faz o rewrite de todas as rotas (exceto `/assets/`) para `index.html`.
- Variáveis (Settings → Environment Variables). `VITE_*` entram no build: **redeploy** após alterar.

| Variável | Produção |
|---|---|
| `VITE_API_URL` | URL do backend no Render, sem barra final |
| `VITE_SITE_URL` | `https://www.3dcommerce.com.br` |
| `VITE_MP_PUBLIC_KEY` | Public Key de **produção** (`APP_USR-...`) — em Preview, a de teste |
| `VITE_GA_MEASUREMENT_ID` | Opcional |
| `VITE_SEURASTREIO_API_KEY` | Opcional (exposta no bundle) |

- Domínio `www.3dcommerce.com.br` (e o apex redirecionando) conectado no projeto do frontend.

## 2. Backend — Render

- Web Service, **Root Directory** `backend/`, Auto-Deploy da `main`.
- Build: `npm ci --include=dev && npm run build` (o `postinstall` roda `prisma generate`).
- Start: `npm start` · Health Check: `/health`.
- Variáveis (Environment):

| Variável | Observação |
|---|---|
| `NODE_ENV` | `production` (exige assinatura no webhook do MP) |
| `DATABASE_URL` | Neon, string **com pooler** |
| `JWT_SECRET` | 16+ caracteres aleatórios (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `CORS_ORIGINS` | `https://www.3dcommerce.com.br,https://3dcommerce.com.br` (previews `3d-commerce-*-recrutinha-sci-s-projects.vercel.app` liberadas automaticamente) |
| `APP_URL` | `https://www.3dcommerce.com.br` (igual ao `VITE_SITE_URL`) |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Credenciais de produção do cliente — **sem elas o backend não sobe** |
| `BLOB_READ_WRITE_TOKEN` | Copiado do Blob Store da Vercel (no Render não é injetado sozinho) |
| `CRON_SECRET` | Mesmo valor do secret do GitHub |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Google Workspace (ou `BREVO_API_KEY` + `SMTP_FROM`) |

- `backend/vercel.json` é resquício do backend na Vercel e **não é usado** no Render.

## 3. Banco — Neon

Antes de publicar código com migration nova:

1. Criar uma **branch de backup** no Neon (Branches → Create branch a partir da `main`).
2. Rodar da sua máquina, com a string **direta** (sem `-pooler`):
   ```bash
   cd backend
   npx prisma migrate status    # só leitura: confira o que está pendente
   npx prisma migrate deploy    # aplica
   ```
   No PowerShell, defina antes `$env:DATABASE_URL="..."`.
3. Só depois fazer o merge/deploy do código.

> Nunca `migrate dev`, `migrate reset` ou `db push` contra produção. As migrations atuais são aditivas: em caso de rollback de código, **não** desfaça migrations.

Seed: só na primeira subida (cria o admin; nunca troca a senha de um admin existente) — ver seção 4 do [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md).

## 4. Cron — GitHub Actions

- Workflow [.github/workflows/expire-orders.yml](.github/workflows/expire-orders.yml), diário às 09:00 UTC, só da `main`.
- Secrets do repositório: `CRON_SECRET` (igual ao do Render) e `BACKEND_URL` (sem barra final).
- Execução manual: Actions → *Expirar pedidos não pagos* → Run workflow.

## 5. Mercado Pago

- Webhook em modo produção: `https://<backend>/api/payments/webhook`, evento **Order (Mercado Pago)**.
- Assinatura secreta → `MP_WEBHOOK_SECRET` no Render → redeploy.

---

## Verificação pós-deploy

- [ ] `GET https://<backend>/health` responde ok
- [ ] `npm run check:config` (localmente, com `.env` de produção fora do git) → 0 erros
- [ ] Loja carrega configurações, banners, categorias e produtos reais sem erro de CORS
- [ ] Rota direta (ex.: `/loja`, `/produto/<slug>`) abre sem 404
- [ ] Login admin em `/admin/login`
- [ ] Upload de imagem no admin gera URL `https://...blob.vercel-storage.com`
- [ ] Checkout gera Pix; pagamento aprovado muda o pedido para *Confirmado* e envia e-mail
- [ ] Estorno pelo admin devolve estoque
- [ ] `https://www.3dcommerce.com.br/robots.txt` lista o sitemap e `https://<backend>/api/public/sitemap.xml` lista produtos
- [ ] Última execução do workflow de cron com sucesso
- [ ] Nenhum `.env` versionado (`git ls-files | grep .env` só mostra os `.env.example`)

## Rollback

- **Vercel:** Deployments → versão anterior → *Promote to Production* / Instant Rollback.
- **Render:** Events/Deploys → *Rollback* para o deploy anterior.
- **Banco:** restaurar a partir da branch de backup do Neon (decisão do responsável técnico).
