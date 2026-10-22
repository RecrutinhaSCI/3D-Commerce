# 3DCommerce

E-commerce e painel administrativo da **3DCommerce** — loja especializada em impressão 3D (filamentos, resinas, impressoras e acessórios), com loja física em **Bento Gonçalves/RS** e envio para todo o Brasil.

Projeto desenvolvido pela **G-Rec Company**. Domínio oficial: **https://www.3dcommerce.com.br**

---

## Estado atual do projeto

| Item | Situação |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript (raiz do repositório) — deploy na **Vercel** |
| Backend | Node + Express + TypeScript + Prisma (`backend/`) — deploy no **Render** |
| Banco | PostgreSQL no **Neon** (22 migrations em `backend/prisma/migrations/`) |
| Uploads | **Vercel Blob** (público). O disco do Render é efêmero: em produção, sem `BLOB_READ_WRITE_TOKEN` o upload é recusado |
| Pagamentos | **Mercado Pago — Orders API** (`/v1/orders`): cartão, Pix e boleto via Payment Brick, webhook assinado, estorno pelo admin |
| E-mail | SMTP (em uso: **Google Workspace**) ou Brevo (API HTTP) — cadastro, pedido, pagamento, envio, senha |
| Frete | **Tabela fixa** no backend: PAC, Sedex e retirada na loja (frete grátis acima do valor do admin). Sem cotação por CEP |
| Cron | GitHub Actions diário (`.github/workflows/expire-orders.yml`) → expira pedidos não pagos e reconcilia pagamentos |
| NF-e | **Não existe** emissão automática de nota fiscal |

Pendências reais: [CHECKLIST-PRODUCAO.md](CHECKLIST-PRODUCAO.md).

---

## Funcionalidades

### Loja pública
- Home editável: hero em carrossel, vitrines, cards de categoria com imagem, banner sazonal com cores próprias, depoimentos, Instagram, YouTube, newsletter e bloco de confiança.
- Catálogo com filtros, ordenação e busca; página de categoria; página de produto com galeria (imagens e vídeo), preço Pix e parcelamento.
- Modo de compra por produto: **direto**, **orçamento** (WhatsApp) ou **ambos**.
- Carrinho (visitante e logado), cupons, checkout com CEP automático (ViaCEP), CPF validado, frete calculado no backend e pagamento transparente do Mercado Pago.
- Área do cliente: cadastro com verificação de e-mail e consentimento LGPD, login, recuperação de senha, endereço salvo, **Meus pedidos** com rastreio e botão "Pagar agora" (`/pagar/:orderId`).
- Orçamento com envio de arquivos, contato e newsletter salvos no backend.
- **Blog** com conteúdo e capas editáveis no admin (Markdown com GFM).
- Páginas institucionais (Sobre, Materiais, FAQ, Como comprar, Trocas e devoluções, Privacidade).
- SEO: metas por página, Open Graph, `robots.txt`, sitemap estático + sitemap dinâmico da API (`/api/public/sitemap.xml`), GA4 opcional só com consentimento de cookies.

### Painel admin (`/admin`)
Dashboard (faturamento real de pedidos pagos), Produtos (CRUD, mídias, importação/exportação Excel, exclusão em lote), Categorias (imagem, flags de menu/home), Categoria Sazonal (banner, textos e cores), Banners, Pedidos (status, rastreio, estorno/cancelamento), Orçamentos, Mensagens, Cupons, Depoimentos, Scripts de WhatsApp, Blog e Configurações (dados da loja, textos, SEO, redes sociais, frete grátis, desconto Pix). Manual: [INSTRUCOES-ADMIN.md](INSTRUCOES-ADMIN.md).

---

## Como rodar localmente

Pré-requisitos: **Node 18+**, npm e um PostgreSQL (Neon ou local).

```bash
# Backend (porta 3333)
cd backend
cp .env.example .env        # preencha DATABASE_URL, JWT_SECRET e credenciais de TESTE do Mercado Pago
npm install                 # roda prisma generate no postinstall
npx prisma migrate dev      # aplica as migrations no banco de desenvolvimento
npm run prisma:seed         # cria o admin (dev: admin@3dcommerce.com / admin123) e configurações
npm run dev

# Frontend (porta 5173), em outro terminal, na raiz
cp .env.example .env        # VITE_API_URL=http://localhost:3333 e VITE_MP_PUBLIC_KEY de teste
npm install
npm run dev
```

> O backend **não sobe** sem `DATABASE_URL`, `JWT_SECRET` (16+ caracteres), `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` (os valores de exemplo do `.env.example` são recusados). Em desenvolvimento, sem `BLOB_READ_WRITE_TOKEN` os uploads vão para `backend/uploads/`.

---

## Scripts

**Frontend (raiz)**

| Script | O que faz |
|---|---|
| `npm run dev` | Vite em modo desenvolvimento |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve o build localmente |

**Backend (`backend/`)** — lista completa em [backend/README.md](backend/README.md)

| Script | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Desenvolvimento, compilação e execução |
| `npm test` | Testes (Vitest) |
| `npm run db:deploy` | `prisma migrate deploy` (único comando de migration para produção) |
| `npm run prisma:seed` | Seed (admin + configurações; não sobrescreve dados existentes) |
| `npm run check:config` | Confere banco, admin, Mercado Pago, Blob, e-mail e cron sem alterar nada |

---

## Variáveis de ambiente

Modelos comentados: [.env.example](.env.example) (frontend, Vercel) e [backend/.env.example](backend/.env.example) (backend, Render). Onde obter cada valor: [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md).

- **Frontend (Vercel):** `VITE_API_URL`, `VITE_SITE_URL`, `VITE_MP_PUBLIC_KEY`, `VITE_GA_MEASUREMENT_ID` (opcional), `VITE_SEURASTREIO_API_KEY` (opcional).
- **Backend (Render):** `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGINS`, `APP_URL`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `SMTP_*` ou `BREVO_API_KEY` + `SMTP_FROM`.
- **GitHub Actions:** secrets `CRON_SECRET` e `BACKEND_URL`.

Nunca versione `.env` nem cole valores reais em documentação.

---

## Deploy

Resumo: frontend na Vercel (raiz, `vercel.json` com rewrite de SPA), backend no Render (Root Directory `backend/`, build `npm ci --include=dev && npm run build`, start `npm start`, health check `/health`), banco no Neon. Passo a passo e checklist pós-deploy: [CHECKLIST-DEPLOY.md](CHECKLIST-DEPLOY.md).

---

## Documentação

| Arquivo | Para que serve |
|---|---|
| [README.md](README.md) | Visão geral e estado atual (este arquivo) |
| [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md) | Contas e dados do cliente: Mercado Pago, e-mail, domínio, admin, Neon, Blob |
| [CHECKLIST-DEPLOY.md](CHECKLIST-DEPLOY.md) | Deploy (Vercel + Render + Neon), migrations e verificação pós-deploy |
| [CHECKLIST-PRODUCAO.md](CHECKLIST-PRODUCAO.md) | O que já está pronto e o que ainda falta para operar |
| [CHECKLIST-ENTREGA.md](CHECKLIST-ENTREGA.md) | Checklist de entrega ao cliente |
| [INSTRUCOES-ADMIN.md](INSTRUCOES-ADMIN.md) | Manual do painel administrativo |
| [backend/README.md](backend/README.md) | Estrutura, scripts e rotinas do backend |
| [docs/integracoes/mercadopago-orders-api.md](docs/integracoes/mercadopago-orders-api.md) | Referência técnica da integração Mercado Pago |
| [docs/integracoes/frete-melhor-envio.md](docs/integracoes/frete-melhor-envio.md) | Estudo para frete real por CEP (não implementado) |

---

**3DCommerce** — Tudo para impressão 3D em um só lugar.
Desenvolvido pela **G-Rec Company**.
