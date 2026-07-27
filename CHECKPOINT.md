# CHECKPOINT — 3D Commerce

Data do checkpoint: **2026-07-11 (pós-R19)**
Última rodada concluída: **R19 — Arquitetura de pagamentos (providers MOCK/INTER, Pix simulado, webhook idempotente)**
Próxima rodada sugerida: **R20 — UI de Pix no checkout (QR Code/copia-e-cola) + storage externo de uploads**

> Este arquivo é a **fonte única de verdade** para retomar o projeto. Foi reescrito na R18 consolidando todas as rodadas (R1–R18). Deploy real **não foi executado** (aguarda autorização explícita).

---

## 1. Visão geral e status

E-commerce completo de impressão 3D, **funcional end-to-end**:

- **Loja pública** (catálogo, produto, carrinho, checkout, orçamento por WhatsApp, conteúdos institucionais).
- **Painel admin** real (dashboard, produtos com Excel, categorias, banners, pedidos, orçamentos, cupons, scripts de WhatsApp, depoimentos, configurações editáveis).
- **Backend** Express + Prisma + PostgreSQL (Neon) com auth JWT, carrinho, pedidos com cupom, uploads Multer, hardening de segurança.

Nível de maturidade: **MVP pronto para staging.** Falta, para produção real: gateway de pagamento e storage externo de uploads (disco efêmero em serverless).

**Credenciais admin seedadas:** `admin@3dcommerce.com` / `admin123` (trocar antes de produção).

---

## 2. Stack e integrações

### Frontend
React 18 · Vite 5 · TypeScript strict · Tailwind CSS · **Zustand** (+persist) · React Router 6 (`createBrowserRouter` + `React.lazy`) · React Hook Form + Zod · Framer Motion · Lucide React · react-hot-toast · **xlsx (SheetJS 0.18)** para import/export de produtos.

### Backend
Node 18+ · Express 4 · TypeScript 5 · **Prisma 6.19** · PostgreSQL (Neon) · JWT (`jsonwebtoken`) + bcryptjs · Zod · Multer · cors · **helmet** · **express-rate-limit** · dotenv · tsx.

### Integrações
- **Neon PostgreSQL** (via `DATABASE_URL`).
- **WhatsApp**: apenas links `wa.me` (sem API Meta).
- **YouTube/Instagram**: links configuráveis (sem API).
- Uploads: disco local em `backend/uploads/` servido em `/uploads/*`.

---

## 3. Estrutura do projeto

### Raiz (frontend na raiz, backend em `backend/`)
```
3dCommerce/
├── .env / .env.example        → VITE_API_URL
├── vercel.json                → SPA fallback (R11)
├── src/                       → frontend
├── backend/                   → API Express + Prisma
└── *.md                       → CHECKPOINT, DEPLOY, STAGING-R11, README, etc.
```

### Frontend (`src/`)
```
src/
├── App.tsx                    → boot: init stores + fetchCart + listener auth:expired
├── config/site.ts            → constantes de marca (Instagram fixo como fallback; SEM admin/coupons/youtube — removidos)
├── routes/AppRoutes.tsx      → rotas públicas + admin (lazy)
├── services/                 → camada HTTP
│   ├── api.ts                → cliente central (get/post/put/patch/del, token, apiAssetUrl, ApiError)
│   ├── types.ts              → DTOs do backend (ApiProduct, ApiOrder, ApiCoupon, ApiSettings, ...)
│   ├── adapters.ts           → DTO ↔ tipos internos + CONTENT_DEFAULTS (fallbacks de conteúdo)
│   ├── authService / productService / categoryService / cartService
│   ├── orderService / quoteService / settingsService / bannerService
│   ├── testimonialService / dashboardService / couponService / scriptService
├── store/                    → Zustand
│   ├── useCartStore.ts       → carrinho (itens do backend) + cupom + busyItems (R18)
│   ├── useCustomerAuthStore.ts / useAdminAuthStore.ts
│   ├── useAdminDataStore.ts  → cache admin (products, categories, banners, orders, settings)
│   └── useUIStore.ts         → drawers (cart, mobile menu)
├── pages/
│   ├── public/               → Home, Shop, Category, Product, Cart, Checkout, QuoteWhatsapp,
│   │                            About, Materials, Blog, FAQ, HowToBuy, ReturnsPolicy, PrivacyPolicy,
│   │                            Contact, CustomerLogin/Register/Account/Orders, NotFound
│   └── admin/                → Login, Dashboard, Products, ProductForm, Categories, SeasonalCategory,
│                                Banners, Orders, Quotes, Coupons, Testimonials, Scripts, Settings
├── components/
│   ├── layout/               → Header (dropdown conta), Footer, Topbar, PublicLayout (overflow-x-clip),
│   │                            AdminLayout, AdminSidebar (agrupada), MobileDrawer, WhatsappFloating
│   ├── home/                 → Hero, CategoryCards, ShowcaseSection, SeasonalBanner, MaterialsEducation,
│   │                            WhyBuy, PhysicalStore, Testimonials, InstagramFeed, YouTubeSection, Newsletter
│   ├── product/ProductCard.tsx
│   ├── cart/CartDrawer.tsx
│   ├── admin/                → RemoteImageUploader, ImageUploader (legado), StatusBadge, ProductImportModal
│   └── ui/                   → Button, Input(+Select/Textarea/Label), Modal, Drawer, Badge, Carousel,
│                                Markdown (seguro), Collapsible, EmptyState, Logo, Skeleton, etc.
├── utils/                    → price, whatsapp, seo (useSEO/useJsonLd), scriptTemplate, productExcel,
│                                masks, cn, productImage
├── data/                     → blogPosts, faqs (locais, sem endpoint)
└── types/index.ts            → tipos internos (Product, Order, StoreSettings, YoutubeVideoItem, TrustItemContent...)
```

### Backend (`backend/`)
```
backend/
├── .env / .env.example
├── prisma/
│   ├── schema.prisma
│   ├── migrations/           → 4 migrations (ver §5)
│   └── seed.ts               → idempotente (upsert)
├── uploads/                  → products/ quotes/ site/ seed/ (servidos em /uploads/*)
└── src/
    ├── app.ts                → helmet + cors(CSV) + json + estáticos + rotas + errorHandler
    ├── server.ts
    ├── config/env.ts         → validação Zod das envs (falha no boot se inválido)
    ├── lib/prisma.ts (singleton) · lib/upload.ts (Multer: produtos/quotes/site)
    ├── middlewares/          → authMiddleware, adminMiddleware, optionalAuthMiddleware,
    │                            errorHandler, notFoundHandler, requestLogger, rateLimiters
    ├── modules/              → auth, users, categories, products, cart, orders, quotes,
    │                            settings, banners, testimonials, coupons, scripts, dashboard
    │                            (cada um: schemas.ts + service.ts + controller.ts + routes.ts)
    ├── routes/index.ts       → registra todos os routers sob /api
    └── utils/                → apiResponse, httpError, asyncHandler, jwt, slug, decimal, couponStatus
```

---

## 4. Rotas da API (backend)

Envelope padrão: sucesso `{ ok:true, data }` · erro `{ ok:false, error:{ code, message, details? } }`.

### Health
`GET /health` · `GET /api/health`

### Auth (rate-limited 10/15min)
`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`

### Users
`GET /api/me` · `PUT /api/me` (name/phone; bloqueia email/role/senha)

### Categorias
`GET /api/public/categories` · admin `GET/POST/PUT/DELETE /api/admin/categories[/:id]`

### Produtos
`GET /api/public/products` (filtros+paginação) · `GET /api/public/products/featured` · `GET /api/public/products/:slug`
Admin: `GET/POST/PUT/DELETE /api/admin/products[/:id]` · `POST /api/admin/products/:id/images` (Multer) · `DELETE /api/admin/products/images/:imageId`

### Carrinho (autenticado — carrinho exige login)
`GET /api/cart` · `POST /api/cart/items` · `PUT /api/cart/items/:id` · `DELETE /api/cart/items/:id` · `DELETE /api/cart`

### Pedidos
`POST /api/orders` (autenticado; aceita `couponCode`, ignora desconto do cliente) · `GET /api/me/orders[/:id]`
Admin: `GET /api/admin/orders` (filtros incl. `couponCode`) · `GET /api/admin/orders/:id` · `PUT /api/admin/orders/:id/status`

### Orçamentos (rate-limited)
`POST /api/quotes` (auth opcional) · `POST /api/quotes/:id/files` (Multer 25MB) · `GET /api/me/quotes[/:id]`
Admin: `GET /api/admin/quotes[/:id]` · `PUT /api/admin/quotes/:id` · `PUT /api/admin/quotes/:id/status`

### Cupons (R12–R14)
Público: `POST /api/coupons/validate` (auth opcional + rate-limited; não expõe dados internos)
Admin: `GET /api/admin/coupons` (com métricas) · `GET /api/admin/coupons/:id` · `POST` · `PUT /:id` · `PATCH /:id/toggle` · `DELETE /:id`

### Scripts WhatsApp (R12/R14)
Admin: `GET /api/admin/scripts` (filtros category/couponId/search) · `GET /:id` · `POST` · `PUT /:id` · `PATCH /:id/toggle` · `DELETE /:id`

### Settings (R8/R17)
Público: `GET /api/public/settings` (somente leitura, só campos de apresentação)
Admin: `GET /api/admin/settings` · `PUT /api/admin/settings` · `POST /api/admin/settings/logo` (Multer)

### Banners / Depoimentos (R8) — público read + admin CRUD + upload
`GET /api/public/banners` · `GET /api/public/testimonials` · admin `/api/admin/banners[...]` · `/api/admin/testimonials[...]`

### Pagamentos (R19)
Cliente (autenticado, dono do pedido): `POST /api/orders/:orderId/payments` (cria/reusa cobrança Pix — idempotente) · `GET /api/orders/:orderId/payments` · `GET /api/payments/:id` · `POST /api/payments/:id/simulate` (**só `PAYMENT_PROVIDER=mock` fora de produção**; body `{status: approved|expired|canceled}`)
Admin: `GET /api/admin/payments/:id` (cobrança + trilha de eventos)
Webhook (sem JWT; autenticação por provider): `POST /api/webhooks/payments/:provider` — MOCK valida HMAC-SHA256 do **raw body** no header `x-webhook-signature`; INTER responde 501 (stub)

### Dashboard
`GET /api/admin/dashboard`

---

## 5. Banco de dados (Prisma / Neon)

### Models principais
User, Address, Category, Product, ProductImage, Cart, CartItem, Order, OrderItem, Quote, QuoteFile, SiteSettings, Banner, Testimonial, **Coupon**, **CouponScript**, ContactMessage, **Payment**, **PaymentEvent** (R19).

### Campos-chave adicionados nas rodadas recentes
- **Order** (R13): `couponId`, `couponCode`, `couponDiscountType` (snapshot); relação `Coupon` `onDelete: SetNull`.
- **Coupon** (R12/R14): `code` único, `discountType` (PERCENTAGE/FIXED_AMOUNT/FREE_SHIPPING), `discountValue`, `minOrderValue`, `maxDiscountValue`, `startsAt`, `expiresAt`, `usageLimit`, `usageCount`, `usageLimitPerCustomer`, `isActive`, `isSeasonal`, `seasonalName`.
- **CouponScript** (R12): `title`, `description`, `messageTemplate`, `category` (enum), `linkedCouponId` (`onDelete: SetNull`), `isActive`.
- **SiteSettings** (R17): redes sociais (`instagramHandle`, `youtubeUrl/Handle`, `facebookUrl`, `tiktokUrl`), comunidade IG (`communityInstagram*`), YouTube (`youtubeSection*`, `youtubeVideosJson`), newsletter (`newsletter*`), confiança (`trustBlockEnabled`, `trustItemsJson`), footer (`footerDescription`, `footerShowSocials`). Registro único `id="main"`.

### Migrations (em ordem)
1. `20260701064817_init`
2. `20260706181214_coupons_and_scripts`
3. `20260706193037_order_coupon`
4. `20260707011417_settings_editable_content`
5. `20260711144822_payments_pix` — enums `PaymentProvider` (MOCK/INTER) e `PixChargeStatus` (PENDING/APPROVED/EXPIRED/CANCELED); `Payment` (`orderId`, `provider`, `status`, `amount`, `txid` único, `pixCopyPaste`, `qrCodeText`, `expiresAt`, `paidAt`, `canceledAt`, `providerData`); `PaymentEvent` (log imutável, `@@unique([provider, externalEventId])` = idempotência de webhook).

### Seed (idempotente)
1 admin · 8 categorias · 10 produtos · SiteSettings(main) · 2 banners · 2 depoimentos · **5 cupons** (BLACK10, PRIMEIRACOMPRA, FRETEGRATIS, NATAL3D, VIP5) · **3 scripts**.

---

## 6. Funcionalidades concluídas (por rodada)

| Rodada | Entrega | Status |
|---|---|---|
| R1–R9B | Backend completo + integração frontend (auth, catálogo, carrinho, pedidos, orçamentos, dashboard, settings/banners/depoimentos, uploads reais) | ✅ |
| R10 | Segurança: Helmet, rate-limit (auth/quotes/uploads), CORS CSV, validação JWT_SECRET, auditoria uploads/passwordHash/erros | ✅ |
| R11 | Deploy staging prep: `vercel.json`, `STAGING-R11.md` (checklists Render/Railway/Vercel/Neon + demo) | ✅ |
| R12 | Sidebar admin agrupada (removeu "Novo produto"); CRUD de Cupons; CRUD de Scripts WhatsApp (preview/cópia) | ✅ |
| R13 | Cupom no carrinho/checkout; desconto recalculado 100% no backend; Order guarda cupom; `usageCount` atômico só na criação; admin exibe cupom | ✅ |
| R14 | `usageLimitPerCustomer` (por `userId`, exclui CANCELED); métricas por cupom; pedidos por cupom; integração Cupons→Scripts (template por tipo); remoção de legados (`site.coupons`/`admin.password`) | ✅ |
| R15 | Página de produto refinada: breadcrumb c/ categoria, economia R$, low/out-of-stock, orçamento WhatsApp enriquecido, JSON-LD, mobile | ✅ |
| R16 | Carrinho corrigido (drawer só no sucesso); Excel export/import de produtos (preview/modelo); YouTube no footer + seção comunidade | ✅ |
| R17 | Conteúdos editáveis no admin (redes, comunidade IG/YT+vídeos, newsletter, confiança, footer); validação URL/JSON; overflow horizontal corrigido; legados centralizados | ✅ |
| R18 | Dropdown "Minha conta" corrigido (timer/click/ESC/outside); store do carrinho com guard `busyItems` + `{ok,error}`; CartDrawer/`/carrinho` com loading por item + toasts + revalidação de cupom | ✅ |
| R19 | Arquitetura de pagamentos: módulo `payments` com camada de providers desacoplada (`providers/types.ts` = contrato); provider MOCK funcional (BR Code EMV com CRC16 real, webhook HMAC); provider INTER preparado (stub 501, sem chamadas reais); models Payment/PaymentEvent; webhook idempotente; simulação local de status; pedido → PAID/CONFIRMED automático na aprovação; Vitest (11 testes) + smoke E2E (`backend/scripts/smoke-payments.mjs`, 31 checks) | ✅ |

---

## 7. Bugs corrigidos e decisões técnicas (destaques recentes)

- **R13** (Order Zod): `discountValue` do cliente **ignorado**; desconto vem só do cupom revalidado no backend.
- **R13**: `usageCount` incrementa **atômico** dentro da transação do pedido (`updateMany` com guarda de limite) — evita corrida no último uso.
- **R14**: identidade do limite por cliente vem **só do `req.user.id`** (JWT), nunca do payload; conta pedidos não-CANCELED.
- **R15**: JSON-LD via `script.textContent` (não `innerHTML`); WhatsApp via `encodeURIComponent`.
- **R16**: `addItem` retorna `{ok, requiresAuth}`; drawer abre **só no sucesso**; visitante → login. Excel: arquivo tratado como dado (sem fórmula/eval), grava via endpoints admin validados.
- **R17**: URLs de settings validadas (bloqueia `javascript:`/`data:`); vídeos ≤6, trust ≤8; Json `null` via `Prisma.JsonNull`; editor admin re-sincroniza quando settings carregam.
- **R18**: dropdown fechava por `onMouseLeave` imediato + gap 4px → timer de 180ms. Carrinho: guard `busyItems` por item evita clique duplo/estado inconsistente; erros deixam de ser silenciosos.
- **Markdown** (`components/ui/Markdown.tsx`): escapa HTML antes de formatar; links só http(s) com `rel="noopener noreferrer"`. Único `dangerouslySetInnerHTML` do projeto e é seguro.

### Regras invioláveis (não quebrar)
1. **Backend é autoridade** de preço, estoque, desconto e status de cupom — nunca confiar no frontend.
2. `passwordHash` **nunca** em resposta/log/DTO.
3. Tokens separados: `3dc-token-customer` e `3dc-token-admin` (api.ts prefere admin quando ambos existem).
4. Ordem de rotas Express importa (`/featured` antes de `/:slug`, `/images/:imageId` antes de `/:id`, `/settings/logo` antes do PUT genérico).
5. `usageCount` só incrementa na criação do pedido, atômico.
6. SVG bloqueado no upload de site (XSS); `safeUnlinkSiteImage` com guarda de path traversal.
7. Migrations reversíveis; em prod usar `prisma migrate deploy` (não `migrate dev`).
8. **Pagamentos (R19)**: o serviço só conversa com o contrato `PaymentProviderAdapter` — integração de gateway acontece SÓ dentro de `providers/`. Webhook valida assinatura sobre o **raw body** (`req.rawBody`, capturado no `express.json verify`). Idempotência tripla: reuso de cobrança PENDING, unique `(provider, externalEventId)` em `PaymentEvent`, transições com guarda `status=PENDING`. `paymentsRouter` deve ficar registrado ANTES do `dashboardRouter` (que aplica auth+admin sem path). Nenhum secret/certificado do Inter no repositório.

---

## 8. Variáveis de ambiente

### Backend (`backend/.env`)
```env
PORT=3333
NODE_ENV=development
DATABASE_URL="postgresql://<user>:<senha>@<host>.neon.tech/neondb?sslmode=require"
JWT_SECRET="<mínimo 16 chars, aleatório; não usar change-me>"
JWT_EXPIRES_IN="7d"
CORS_ORIGIN="http://localhost:5173"   # CSV em prod: "http://localhost:5173,https://front.vercel.app"
UPLOAD_DIR="uploads"

# Pagamentos (R19)
PAYMENT_PROVIDER=mock                  # mock | inter (inter ainda não implementado)
PAYMENT_PIX_EXPIRATION_MINUTES=30
PAYMENT_WEBHOOK_SECRET="<mín. 16 chars; obrigatório em produção; em dev cai num default local>"
# INTER_* (futuro): CLIENT_ID, CLIENT_SECRET, CERT_PATH, KEY_PATH, PIX_KEY,
# WEBHOOK_SECRET, BASE_URL — documentadas comentadas no backend/.env.example.
# Certificados do Inter NUNCA vão para o repositório.
```
Gerar secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

### Frontend (`.env`)
```env
VITE_API_URL=http://localhost:3333
```

`.env` está no `.gitignore` (backend e raiz). `.env.example` contém só placeholders. **Nenhum secret real versionado** (verificado nas R10/R11).

---

## 9. O que já foi testado

- **Builds**: frontend (`tsc -b && vite build`) e backend (`tsc`) passam limpos. `npm run typecheck` OK nos dois.
- **Prisma**: `validate`, `generate` e 4 migrations aplicadas no Neon.
- **Smoke tests via curl** (por rodada): auth, público, carrinho, pedidos, orçamentos, admin; cupom (percentual/fixo/frete/mínimo/expirado/esgotado/limite global/por cliente); settings (URL `javascript:`/`data:` → 422, admin sem token → 401).
- **Testes visuais (browser)**: página de produto (desktop+mobile, sem overflow), carrinho (add/+/−/remover/empty state), cupom aplicar/remover, admin Cupons/Scripts/Configurações (persistência), YouTube/comunidade editáveis, dropdown de conta (click/ESC/outside), Excel (export sem erro, import modal + validação round-trip).
- **R19 — testes automatizados**: Vitest no backend (`npm test`) — 11 testes unitários do provider MOCK (CRC16 com vetor conhecido do Bacen, BR Code EMV, txid, expiração, HMAC válida/inválida/adulterada). Smoke E2E `node scripts/smoke-payments.mjs` (backend no ar) — 31 checks: criação/reuso idempotente de cobrança, webhook 401 sem/with assinatura errada, INTER 501, aprovação → pedido PAID+CONFIRMED, replay de webhook duplicado não reaplica, cancelado/expirado, controle de acesso (404 para outro cliente), trilha de eventos no admin.
- **`/security-review`** rodada ao fim de R12–R18: **nenhuma vulnerabilidade ≥ confiança 8** em nenhuma rodada.
- **Deploy real: NÃO executado.** Credencial Neon rotacionada na R11.

---

## 10. Pendências, bugs conhecidos e riscos

### Pendências (produção real)
- **Integração real do Banco Inter** no provider `INTER` (stub pronto em `backend/src/modules/payments/providers/inter.provider.ts`; roteiro documentado no próprio arquivo). **Só com autorização explícita.**
- **UI de Pix no checkout** (frontend): após criar o pedido, chamar `POST /api/orders/:id/payments` e exibir QR Code/copia-e-cola + polling de status. Hoje o frontend ainda não consome a API de pagamentos.
- Cupom é consumido na **criação** do pedido (não no pagamento) — mover para aprovação quando a UI de Pix entrar.
- **Storage externo de uploads** (S3/R2/Supabase) — disco local **não persiste** em serverless/free tier.
- Trocar senha do admin seedado (`admin123`).

### Riscos conhecidos
1. Uploads em disco efêmero somem entre restarts (Render/Railway free).
2. JWT em `localStorage` (vetor XSS teórico; mitigado por CSP/Helmet e ausência de sinks inseguros).
3. `usageLimitPerCustomer` tem janela teórica de corrida sob requests simultâneos do mesmo cliente (o `usageLimit` **global** é atômico).
4. Cold start em free tier (primeira request lenta).

### Itens menores / pós-MVP
- `SeasonalCategory` ainda usa `ImageUploader` (Base64) — único legado de upload; migrar para `RemoteImageUploader` e remover o legado.
- Instagram do footer usa a URL geral `settings.instagram` (falta campo dedicado).
- `blogPosts`/`faqs` locais (sem endpoint); `Coupon` público de checkout só valida (não persiste uso por cliente fora do pedido).
- Importação Excel: 1 request por linha (avaliar endpoint em lote para catálogos grandes).
- SEO é client-side (JSON-LD/meta via JS); para indexação máxima considerar SSR/prerender.

---

## 11. Próxima etapa recomendada (prioridade)

1. **Deploy staging** (seguir `STAGING-R11.md`): backend Render/Railway + frontend Vercel + Neon (branch de staging). Rotacionar credencial e `JWT_SECRET`.
2. **Storage externo de uploads** (antes de produção real).
3. **UI de Pix no checkout** (consumir a API de pagamentos R19) + mover consumo do cupom para `paymentStatus = PAID`; depois, integração real do Banco Inter no provider `INTER` (mediante autorização).
4. Migrar `SeasonalCategory` para upload real e remover `ImageUploader` legado.
5. E-mail transacional (confirmação de pedido/orçamento) + trocar senha admin.

---

## 12. Como retomar (comandos)

### Backend
```bash
cd backend
npm install
cp .env.example .env          # preencher DATABASE_URL e JWT_SECRET
npm run prisma:generate
npm run prisma:migrate        # dev; em prod: prisma migrate deploy
npm run prisma:seed           # popula dados demo (idempotente)
npm run dev                   # tsx watch → http://localhost:3333
# build/prod:
npm run build && npm start
npm run typecheck
```

### Frontend (raiz)
```bash
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:3333
npm run dev                   # → http://localhost:5173
npm run build                 # tsc -b && vite build → dist/
```

### Limpeza de porta (Windows / Git Bash)
```bash
netstat -ano | grep ":3333" | grep LISTENING     # achar PID
taskkill //PID <PID> //F
```

**URLs padrão:** backend `http://localhost:3333` · frontend `http://localhost:5173` · Prisma Studio `http://localhost:5555`.
**Admin:** `/admin/login` → `admin@3dcommerce.com` / `admin123`.

---

## 13. Arquivos a ler antes de continuar

**Documentação:** este `CHECKPOINT.md` · `STAGING-R11.md` (deploy) · `DEPLOY.md` · `INSTRUCOES-ADMIN.md`.

**Backend (padrões):**
- `backend/src/app.ts` · `backend/src/routes/index.ts` · `backend/src/config/env.ts`
- `backend/src/utils/apiResponse.ts` · `httpError.ts` · `asyncHandler.ts`
- `backend/src/middlewares/` (auth/admin/optionalAuth/errorHandler/rateLimiters)
- `backend/prisma/schema.prisma` · `backend/prisma/seed.ts`
- Módulo de referência recente: `backend/src/modules/coupons/*` e `settings/*`

**Frontend (padrões):**
- `src/services/api.ts` · `src/services/types.ts` · `src/services/adapters.ts`
- `src/store/useCartStore.ts` · `useAdminDataStore.ts` · `useCustomerAuthStore.ts`
- `src/routes/AppRoutes.tsx` · `src/config/site.ts`
- Páginas-chave: `src/pages/public/{Product,Cart,Checkout}.tsx` · `src/pages/admin/{Products,Coupons,Scripts,Settings,Orders}.tsx`
- Componentes: `src/components/layout/{Header,Footer,PublicLayout,AdminSidebar}.tsx` · `src/components/cart/CartDrawer.tsx`
- Utils: `src/utils/{price,whatsapp,seo,scriptTemplate,productExcel}.ts`

---

**Fim do checkpoint. Use este arquivo como referência única para retomar o projeto sem perder contexto.**
