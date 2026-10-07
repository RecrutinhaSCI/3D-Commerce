# Configurar dados do cliente — 3DCommerce

Guia único para colocar os dados e contas do cliente no projeto e subir para produção.
Infra: **Vercel** (frontend) + **Render** (backend, Web Service com Root Directory `backend/`) + **Neon** (PostgreSQL) + **Vercel Blob** (uploads).
Todos os pontos de entrada já estão prontos no código; aqui está **o que pedir**, **onde colocar** e **como conferir**.

> Depois de preencher qualquer coisa do backend, rode `cd backend && npm run check:config`.
> Ele confere banco, admin, dados da loja, Mercado Pago e SMTP sem criar nada nem enviar e-mail.
> Para checar produção, rode localmente com um `.env` apontando para o Neon de produção.

---

## 1. O que pedir ao cliente

Mensagem pronta para enviar:

```txt
Olá! Para colocar a loja no ar com pagamento real, preciso de:

1. Mercado Pago (conta da loja): acesso para criarmos a aplicação OU, se preferir,
   a Public Key e o Access Token de PRODUÇÃO (Suas integrações > Credenciais de produção).
2. E-mail que vai enviar as mensagens da loja (pedido, pagamento, senha):
   um Gmail com "senha de app" ou o e-mail do domínio (host, usuário e senha SMTP).
3. Domínio do site (ex.: www.sualoja.com.br) e acesso ao painel onde ele foi registrado.
4. E-mail que será o login do painel administrativo.
5. Conferir: nome da loja, WhatsApp, e-mail de contato, endereço, CNPJ, Instagram e logo.
```

---

## 2. Mapa: cada dado e onde ele entra

"Vercel (front)" é o projeto da raiz do repositório na Vercel. "Render (back)" é o Web Service do diretório `backend/` no Render (Build `npm ci --include=dev && npm run build`, Start `npm start`, Health Check `/health`, Auto-Deploy da `main`).

| Dado | Quem fornece | Onde entra | Obrigatório |
|---|---|---|---|
| Nome, WhatsApp, e-mail de contato, endereço, CNPJ, Instagram, logo, textos da home/sobre/SEO | Cliente | Painel **/admin/configuracoes** (salvo no Neon) | Sim |
| Mesmos dados como fallback da primeira renderização | Cliente | [src/config/site.ts](src/config/site.ts) | Conferir |
| Título/descrição de compartilhamento (Open Graph) | Cliente | [index.html](index.html) (meta `og:*`) | Conferir |
| Public Key do Mercado Pago | Cliente (conta MP) | Vercel (front) → `VITE_MP_PUBLIC_KEY` | Sim |
| Access Token do Mercado Pago | Cliente (conta MP) | Render (back) → `MP_ACCESS_TOKEN` | Sim |
| Segredo do webhook MP | Gerado no painel MP | Render (back) → `MP_WEBHOOK_SECRET` | Sim |
| SMTP (host, porta, usuário, senha, remetente) | Cliente | Render (back) → `SMTP_*` | Sim em produção* |
| Domínio da loja | Cliente | Vercel (front) → `VITE_SITE_URL` · Render (back) → `APP_URL` e `CORS_ORIGINS` | Sim |
| E-mail e senha do admin | Cliente / G-Rec | `.env` local na hora de rodar o seed (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) | Sim |
| Banco de produção | G-Rec (Neon) | Render (back) → `DATABASE_URL` | Sim |
| Chave JWT | G-Rec (gerar) | Render (back) → `JWT_SECRET` | Sim |
| Segredo do cron diário | G-Rec (gerar) | Render (back) → `CRON_SECRET` **e** GitHub → Actions secret `CRON_SECRET` (mesmo valor) | Sim |
| Storage de uploads | G-Rec (Vercel Blob) | Render (back) → `BLOB_READ_WRITE_TOKEN` (copiado do Blob Store da Vercel) | Sim |
| URL do backend | G-Rec (Render) | Vercel (front) → `VITE_API_URL` · GitHub → Actions secret `BACKEND_URL` | Sim |
| Chave SeuRastreio | G-Rec / cliente | Vercel (front) → `VITE_SEURASTREIO_API_KEY` | Opcional |
| Google Analytics 4 (ID `G-...`) | Cliente | Vercel (front) → `VITE_GA_MEASUREMENT_ID` | Opcional (o banner de cookies passa a pedir consentimento) |

\* Sem SMTP o site funciona, mas nenhum e-mail sai (confirmação de pedido, pagamento aprovado, reset de senha).

Onde cadastrar: Vercel (front) em **Settings → Environment Variables**; Render (back) em **Environment** do serviço; GitHub em **Settings → Secrets and variables → Actions**.

Na Vercel:
- Credenciais de **produção** do Mercado Pago só no ambiente *Production*.
- Nos ambientes *Preview* e *Development*, use as de teste.
- Variáveis `VITE_*` entram no build, então é preciso fazer **redeploy** depois de mudar.

Modelos com todos os campos comentados: [.env.example](.env.example) (frontend) e [backend/.env.example](backend/.env.example).

---

## 3. Passo a passo por bloco

### 3.1 Dados da loja (painel)
1. Entrar em `/admin/login` com o admin de produção.
2. **/admin/configuracoes**: preencher nome, WhatsApp (formato `55` + DDD + número, só dígitos), e-mail, endereço, CNPJ, Instagram, logo (PNG/JPG/WEBP, sem SVG), textos e SEO.
3. A **Política de Privacidade** lê nome, e-mail, endereço e CNPJ dessas configurações, então não precisa editar o texto.
4. Conferir também [src/config/site.ts](src/config/site.ts) e as metas `og:*` do [index.html](index.html). Já estão com os dados da 3DCommerce; ajustar só se algo mudou.

> O seed **não sobrescreve** as configurações nem os produtos depois que eles existem em produção.

### 3.2 Mercado Pago (conta do cliente)
1. No painel do desenvolvedor da conta **do cliente** (Suas integrações), criar a aplicação: produto **Pagamentos online / Checkout Transparente**.
2. **Credenciais de produção** → copiar:
   - Public Key → `VITE_MP_PUBLIC_KEY` (Vercel front, ambiente Production)
   - Access Token → `MP_ACCESS_TOKEN` (Render back)
3. **Webhooks → Configurar notificações** (modo produção):
   - URL: `https://<dominio-do-backend>/api/payments/webhook`. Use o domínio de **produção** do projeto backend, nunca uma URL de preview: as previews mudam a cada deploy e podem ter proteção de acesso.
   - Evento: **Order (Mercado Pago)**, o evento da Orders API (não o "Pagamentos" antigo)
   - Copiar a **assinatura secreta** → `MP_WEBHOOK_SECRET` (Render back)
4. Redeploy do backend (Render) e do front (Vercel).
5. `npm run check:config` precisa mostrar **"Token de PRODUÇÃO válido"**. Se mostrar "conta de TESTE", as credenciais ainda são de sandbox.

Observações:
- Com `NODE_ENV=production`, o webhook **recusa notificações sem assinatura** (401). Sem o segredo certo, o Pix e o boleto não confirmam sozinhos.
- O webhook processa tudo **antes** de responder.
- **Render Free** dorme após ~15 min sem acesso e leva ~1 min para acordar: o primeiro webhook pode falhar e o Mercado Pago reenvia (o Pix confirma com atraso). Para loja com movimento, prefira um plano pago.
- **Parcelamento**: a loja anuncia "até 6x sem juros" ([src/config/site.ts](src/config/site.ts) → `installments`), e o formulário de cartão respeita o mesmo limite. O "sem juros" só é verdade se a conta do cliente estiver configurada no Mercado Pago para **absorver os juros do parcelamento**. Se não estiver, mude `interestFree` para `false`, e a loja passa a mostrar "6x no cartão".
- Rede de segurança para webhooks perdidos: `POST /api/admin/payments/reconcile` com o token de admin.
- Detalhes técnicos da integração: [docs/integracoes/mercadopago-orders-api.md](docs/integracoes/mercadopago-orders-api.md).

### 3.3 E-mail (SMTP)
Opção simples, **Gmail da loja**:
1. Ativar verificação em 2 etapas na conta.
2. Gerar uma senha de app em https://myaccount.google.com/apppasswords.
3. Render (back), aba Environment:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=loja@gmail.com
   SMTP_PASS=<senha de app de 16 dígitos>
   SMTP_FROM="3DCommerce <loja@gmail.com>"
   ```
Se for o e-mail do domínio (Hostinger, Zoho, Locaweb...), usar host e porta do provedor: 587 → `SMTP_SECURE=false`.
`npm run check:config` testa o login no SMTP sem enviar nada.

### 3.4 Admin
- O seed roda **na sua máquina**, apontando para o Neon de produção (seção 4). Definir `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 8) nesse `.env` antes de rodar. Com `NODE_ENV=production`, o seed recusa **criar** o admin sem `ADMIN_PASSWORD`.
- `ADMIN_PASSWORD` só vale na **criação inicial** do admin. Se o admin já existe, o seed nunca altera a senha (nem com essa variável). Para trocar a senha depois, use **Esqueci minha senha** (`/esqueci-senha`) com o e-mail do admin — exige o envio de e-mail configurado.
- `check:config` acusa erro se algum admin ainda usar a senha de desenvolvimento `admin123`.

### 3.5 Neon (banco)
O Neon mostra duas strings de conexão em **Connection Details**:
- **Com pooler** (host com `-pooler`): recomendada para a `DATABASE_URL` do backend (Render).
- **Direta** (sem `-pooler`): usar só para rodar migrations e seed da sua máquina.

Antes de qualquer migration em produção, criar uma **branch de backup** no Neon (Branches → Create branch a partir da `main`). É instantâneo e serve de ponto de restauração.

### 3.6 Domínio
- Conectar o domínio no projeto **frontend** da Vercel.
- Vercel (front): `VITE_SITE_URL=https://www.dominio.com.br` (gera o sitemap e o robots com o domínio), depois redeploy.
  - O `robots.txt` aponta também para o **sitemap dinâmico** da API (`/api/public/sitemap.xml`, com todos os produtos ativos). Ele usa o `APP_URL` do backend nos links, que por isso precisa ser **igual** ao `VITE_SITE_URL`.
  - Depois de publicar, cadastrar o domínio no **Google Search Console** e enviar o sitemap.
- Render (back): `APP_URL=https://www.dominio.com.br` (links dos e-mails) e `CORS_ORIGINS=https://www.dominio.com.br,https://dominio.com.br` (as previews `3d-commerce-*-recrutinha-sci-s-projects.vercel.app` já são liberadas sozinhas), depois redeploy.
- **JWT_SECRET**: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

---

## 4. Migrations e seed no Neon (rodar da sua máquina)

Em relação ao `main` de RecrutinhaSCI, esta branch adiciona **até 8 migrations**: `order_tracking_code` (rastreio — pode já existir no Neon), campos do Mercado Pago no pedido, `stock_applied`, verificação de e-mail e reset de senha, `checkout_hardening` (frete, desconto Pix e backfill de estoque), `customer_cpf`, `user_privacy_consent` e `newsletter_subscribers`. **Elas precisam estar aplicadas no Neon antes de o código novo chegar em produção.** Sem elas, até o login quebra, porque o Prisma lê colunas que ainda não existem.

Todas só **adicionam** colunas ou tabelas, com valor padrão ou permitindo nulo, e foram testadas aplicando por cima do estado do `main` (banco final idêntico ao schema). Por isso é seguro aplicá-las antes do merge: o código antigo que está no ar continua funcionando.

```bash
cd backend
# 1) Backup: criar uma branch no painel do Neon (seção 3.5).
# 2) Aplicar as migrations com a URL DIRETA (sem -pooler):
DATABASE_URL="postgresql://...@ep-xxxx.sa-east-1.aws.neon.tech/neondb?sslmode=require" npx prisma migrate deploy
# 3) Só na primeira subida (cria o admin; nunca troca a senha de um admin existente):
NODE_ENV=production DATABASE_URL="<direta>" ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run prisma:seed
```

> Use sempre `migrate deploy`. **Nunca** `migrate dev` ou `migrate reset` contra o Neon de produção: o `reset` apaga o banco.
> No PowerShell, defina as variáveis com `$env:DATABASE_URL="..."` antes do comando.

---

## 5. Ordem para colocar no ar

1. **Neon**: branch de backup → `npx prisma migrate deploy` (seção 4).
2. **Vercel**: criar o **Blob Store** (Storage → Create → Blob) e copiar o `BLOB_READ_WRITE_TOKEN`.
   **Render (back)**: cadastrar as variáveis da seção 2 com `NODE_ENV=production` e o token do Blob. O backend **não sobe** sem `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`: cadastre tudo **antes** do merge (o Auto-Deploy publica a `main`).
   **GitHub**: Actions secrets `CRON_SECRET` e `BACKEND_URL` (cron diário).
3. **Seed**, só na primeira subida, para criar o admin (seção 4).
4. **Vercel (front)**: `VITE_API_URL`, `VITE_MP_PUBLIC_KEY`, `VITE_SITE_URL`, depois redeploy.
5. **Merge na `main`**: dispara o deploy de produção do front (Vercel) e do backend (Render, Auto-Deploy).
6. **Domínio**: conectar e ajustar `APP_URL`/`CORS_ORIGINS` (seção 3.6).
7. **Mercado Pago**: cadastrar o webhook com o domínio de produção do backend, colar o segredo e fazer redeploy do backend.
8. **Conferência**: `npm run check:config` com o `.env` de produção, **0 erros**.
9. **Teste real**: comprar um produto barato via Pix → o pedido deve virar *Confirmado* sozinho e chegar o e-mail de pagamento aprovado → estornar pelo painel do Mercado Pago.
10. Preencher **/admin/configuracoes** com o cliente e treinar o uso do painel ([INSTRUCOES-ADMIN.md](INSTRUCOES-ADMIN.md)).

---

## 6. Pontos de atenção antes de entregar

- **Uploads usam o Vercel Blob em produção**, mesmo com o backend no Render: o SDK usa o token explícito e funciona fora da Vercel. Na Vercel: **Storage → Create → Blob**; copie o `BLOB_READ_WRITE_TOKEN` para o Render (lá ele não é injetado sozinho). Sem o token, o upload grava no disco do Render, que é **apagado a cada deploy/reinício**; o `check:config` acusa. **Primeiro teste após configurar:** subir uma imagem de produto no admin e conferir que a URL salva começa com `https://...blob.vercel-storage.com`.
- **Limite de 4 MB por arquivo** (herdado do limite de 4,5 MB da Vercel; no Render poderia ser maior, melhoria futura). O admin envia uma imagem por requisição. No orçamento, arquivos STL maiores que 4 MB precisam ir pelo WhatsApp; aceitar arquivos grandes exige upload direto do navegador para o Blob (melhoria futura).
- **Prisma Client no build**: o backend roda `prisma generate` no `postinstall`. O host pode reaproveitar o `node_modules` entre deploys, e sem isso um schema novo subiria com o client antigo.
- **Rate limit** (login, pedidos) fica na memória de cada instância. Com mais de uma instância, cada uma conta separado, então o limite real fica mais frouxo. Aceitável para começar; se houver abuso, mover para Redis/Upstash.
- **Frete** segue a regra atual das configurações (frete grátis acima de X). A cotação real por CEP ainda não foi implementada; o estudo está em [docs/integracoes/frete-melhor-envio.md](docs/integracoes/frete-melhor-envio.md).
- **`VITE_SEURASTREIO_API_KEY`** vai para o bundle público. Usar uma chave sem custo/limite crítico, ou mover a consulta para o backend.
- **Cron diário** via **GitHub Actions** ([.github/workflows/expire-orders.yml](.github/workflows/expire-orders.yml), 09:00 UTC = 06:00 BRT): chama `GET /api/cron/expire-orders` com `Authorization: Bearer <CRON_SECRET>`, reconcilia pagamentos que o webhook perdeu e cancela pedidos não pagos após 48h (boleto: 96h), devolvendo estoque e cupom. Tenta até 3 vezes (o Render Free pode estar dormindo). Exige os secrets `CRON_SECRET` e `BACKEND_URL` no GitHub e o mesmo `CRON_SECRET` no Render. Só roda a partir da `main`; execução manual em Actions → Run workflow. O [backend/vercel.json](backend/vercel.json) não é usado no Render.
- **Estoque** só baixa quando o pagamento é aprovado. Pedido pago sem estoque recebe a nota `[REVISAR ESTOQUE]` em /admin/pedidos.
- **CSP** (opcional): se for configurada, precisa liberar os domínios do Mercado Pago, senão o cartão quebra. A lista está comentada em [backend/src/app.ts](backend/src/app.ts).
