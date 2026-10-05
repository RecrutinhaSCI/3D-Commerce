# DEPLOY.md — 3D Commerce

Guia de preparação para deploy em staging/produção. **Este documento não executa deploy real** — é o checklist e a referência de variáveis para quando o time decidir subir.

> **Dados e contas do cliente (Mercado Pago, SMTP, domínio, admin):** o passo a passo completo e a ordem de go-live estão em [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md). Conferência automática: `cd backend && npm run check:config`.

---

## 1. Backend

### Onde hospedar
Render ou Railway (Node.js) são as opções mais simples para um Express + Prisma. Uma VPS também funciona se preferir controle total.

### Comandos
```bash
npm install
npm run build      # tsc -p tsconfig.json → dist/
npm start           # node dist/server.js
```

Rodar as migrations em produção **antes** do primeiro start:
```bash
npx prisma migrate deploy   # NUNCA `migrate dev` em produção
npx prisma generate
```

### Variáveis de ambiente (produção)
```env
PORT=3333
NODE_ENV=production
DATABASE_URL="postgresql://usuario:senha@host-de-producao.neon.tech/neondb?sslmode=require&channel_binding=require"
JWT_SECRET="gere-uma-chave-forte-com-openssl-ou-node-crypto-32-mais-caracteres"
JWT_EXPIRES_IN="7d"
CORS_ORIGIN="https://seu-dominio-frontend.vercel.app"
APP_URL="https://seu-dominio-frontend.vercel.app"
UPLOAD_DIR="uploads"

ADMIN_EMAIL="admin@dominio-do-cliente.com.br"
ADMIN_PASSWORD="senha-forte-do-admin"

MP_ACCESS_TOKEN="APP_USR-...credencial-de-producao-do-cliente"
MP_WEBHOOK_SECRET="assinatura-secreta-do-webhook"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER="loja@gmail.com"
SMTP_PASS="senha-de-app"
SMTP_FROM="3DCommerce <loja@gmail.com>"
```
Descrição de cada variável: [backend/.env.example](backend/.env.example).

Gerar `JWT_SECRET` seguro:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`CORS_ORIGIN` aceita lista separada por vírgula se houver mais de um domínio de frontend (ex.: produção + preview da Vercel):
```env
CORS_ORIGIN="https://loja.exemplo.com,https://loja-preview.vercel.app"
```

### ⚠️ Uploads em disco — risco conhecido
Os uploads de produtos, banners, logo, avatares e arquivos de orçamento são gravados em `backend/uploads/*` no disco local. **Em plataformas com filesystem efêmero (Render free tier, Railway free tier, containers sem volume persistente), esses arquivos somem a cada novo deploy ou restart.**

Antes de um deploy de produção real:
- Migrar os quatro uploaders (`productImagesUpload`, `quoteFilesUpload`, `siteImageUpload`) para um storage externo — S3, Cloudflare R2 ou Supabase Storage.
- Ou usar um plano com disco persistente (volume montado) se a plataforma escolhida oferecer.
- Manter o modo `disk` atual como opção de desenvolvimento local.

### Segurança já aplicada (R10)
- Helmet habilitado (CSP desligado por ser API pura; `crossOriginResourcePolicy: cross-origin` para o frontend carregar `/uploads/*`).
- Rate limiting: login/registro (10/15min), orçamentos (20/hora), uploads (30/hora) — todos por IP, respondendo `{ok:false, error:{code:"RATE_LIMITED"}}`.
- CORS restrito à lista de `CORS_ORIGIN`.
- `JWT_SECRET` validado no boot (mínimo 16 caracteres, rejeita `"change-me"`).
- `passwordHash` nunca sai em nenhuma resposta.

---

## 2. Frontend

### Onde hospedar
Vercel ou Netlify.

### Variáveis de ambiente
```env
VITE_API_URL=https://url-do-backend-em-producao.com
VITE_SITE_URL=https://www.dominio-do-cliente.com.br
VITE_MP_PUBLIC_KEY=APP_USR-...public-key-de-producao
```

### Build
```bash
npm run build   # tsc -b && vite build → dist/
```

### SPA fallback
O projeto usa `createBrowserRouter`, então a hospedagem precisa redirecionar todas as rotas para `index.html`. Configuração conforme a plataforma:

**Vercel** (`vercel.json` na raiz do frontend):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Netlify** (`public/_redirects`):
```
/*  /index.html  200
```

---

## 3. Banco de dados (Neon)

- Usar um projeto/branch Neon **separado** do banco de desenvolvimento — não apontar produção para o mesmo banco usado em testes locais.
- Rodar `npx prisma migrate deploy` (nunca `migrate dev`) contra o banco de produção.
- Rodar o seed **com cuidado** — só na primeira vez, ou revisar `prisma/seed.ts` para não duplicar/sobrescrever dados reais de clientes.
- Fazer backup do banco antes de qualquer migration.

---

## 4. Checklist pós-deploy

- [ ] `GET /health` do backend responde `{"status":"ok"}`.
- [ ] CORS: frontend consegue chamar a API sem erro de origem bloqueada.
- [ ] Login admin funciona (`/admin/login`).
- [ ] Home carrega settings, banners, categorias e produtos reais.
- [ ] Upload de imagem funciona (produto, banner ou logo) e a URL responde.
- [ ] Criar um pedido de teste end-to-end (carrinho → checkout).
- [ ] Criar um orçamento de teste (anônimo, com upload de arquivo).
- [ ] Dashboard admin carrega métricas.
- [ ] Confirmar que `.env` de produção não foi commitado no repositório.

---

## 5. Pendências antes de um deploy de produção real (não bloqueiam staging)

- ~~Gateway de pagamento~~ — Mercado Pago (Orders API: cartão, Pix, boleto) integrado; falta só cadastrar as credenciais de produção do cliente (ver `CONFIGURAR-CLIENTE.md`).
- Migrar uploads para storage externo (S3/R2/Supabase Storage) — ver seção 1.
- Cookies httpOnly para o JWT em vez de `localStorage` (mitigação adicional contra XSS; hoje aceitável para MVP).
- `npm audit` do frontend aponta uma vulnerabilidade moderada/alta em `esbuild`/`vite`, restrita ao dev server (não afeta o build de produção). Corrigir exige `vite@8` com breaking changes — avaliar antes de aplicar.
- Endpoint `POST /api/quotes/:id/files` aceita upload sem autenticação (por design, para permitir orçamento anônimo). O `id` é um CUID praticamente impossível de adivinhar, e agora está sob rate limit — risco residual baixo, mas documentado.
