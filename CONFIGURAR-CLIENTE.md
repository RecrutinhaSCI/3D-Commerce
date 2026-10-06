# Configurar dados do cliente — 3DCommerce

Guia único para colocar os dados e contas do cliente no projeto e subir para produção.
Infra: **Vercel** (frontend e backend) + **Neon** (PostgreSQL).
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

"Vercel (front)" e "Vercel (back)" são os dois projetos na Vercel: o da raiz do repositório e o do diretório `backend/`.

| Dado | Quem fornece | Onde entra | Obrigatório |
|---|---|---|---|
| Nome, WhatsApp, e-mail de contato, endereço, CNPJ, Instagram, logo, textos da home/sobre/SEO | Cliente | Painel **/admin/configuracoes** (salvo no Neon) | Sim |
| Mesmos dados como fallback da primeira renderização | Cliente | [src/config/site.ts](src/config/site.ts) | Conferir |
| Título/descrição de compartilhamento (Open Graph) | Cliente | [index.html](index.html) (meta `og:*`) | Conferir |
| Public Key do Mercado Pago | Cliente (conta MP) | Vercel (front) → `VITE_MP_PUBLIC_KEY` | Sim |
| Access Token do Mercado Pago | Cliente (conta MP) | Vercel (back) → `MP_ACCESS_TOKEN` | Sim |
| Segredo do webhook MP | Gerado no painel MP | Vercel (back) → `MP_WEBHOOK_SECRET` | Sim |
| SMTP (host, porta, usuário, senha, remetente) | Cliente | Vercel (back) → `SMTP_*` | Sim em produção* |
| Domínio da loja | Cliente | Vercel (front) → `VITE_SITE_URL` · Vercel (back) → `APP_URL` e `CORS_ORIGIN` | Sim |
| E-mail e senha do admin | Cliente / G-Rec | `.env` local na hora de rodar o seed (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) | Sim |
| Banco de produção | G-Rec (Neon) | Vercel (back) → `DATABASE_URL` (URL **com pooler**) | Sim |
| Chave JWT | G-Rec (gerar) | Vercel (back) → `JWT_SECRET` | Sim |
| Segredo do cron diário | G-Rec (gerar) | Vercel (back) → `CRON_SECRET` (Production) | Sim |
| Storage de uploads | G-Rec (Vercel Blob) | Vercel (back) → `BLOB_READ_WRITE_TOKEN` (criado ao conectar o Blob Store) | Sim |
| URL do backend | G-Rec (Vercel back) | Vercel (front) → `VITE_API_URL` | Sim |
| Chave SeuRastreio | G-Rec / cliente | Vercel (front) → `VITE_SEURASTREIO_API_KEY` | Opcional |

\* Sem SMTP o site funciona, mas nenhum e-mail sai (confirmação de pedido, pagamento aprovado, reset de senha).

Na Vercel, cadastre as variáveis em **Settings → Environment Variables**:
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
   - Access Token → `MP_ACCESS_TOKEN` (Vercel back, ambiente Production)
3. **Webhooks → Configurar notificações** (modo produção):
   - URL: `https://<dominio-do-backend>/api/payments/webhook`. Use o domínio de **produção** do projeto backend, nunca uma URL de preview: as previews mudam a cada deploy e podem ter proteção de acesso.
   - Evento: **Order (Mercado Pago)**, o evento da Orders API (não o "Pagamentos" antigo)
   - Copiar a **assinatura secreta** → `MP_WEBHOOK_SECRET` (Vercel back)
4. Redeploy dos dois projetos.
5. `npm run check:config` precisa mostrar **"Token de PRODUÇÃO válido"**. Se mostrar "conta de TESTE", as credenciais ainda são de sandbox.

Observações:
- Com `NODE_ENV=production`, o webhook **recusa notificações sem assinatura** (401). Sem o segredo certo, o Pix e o boleto não confirmam sozinhos.
- O webhook processa tudo **antes** de responder. Na Vercel isso é obrigatório: a função é congelada depois da resposta.
- **Parcelamento**: a loja anuncia "até 6x sem juros" ([src/config/site.ts](src/config/site.ts) → `installments`), e o formulário de cartão respeita o mesmo limite. O "sem juros" só é verdade se a conta do cliente estiver configurada no Mercado Pago para **absorver os juros do parcelamento**. Se não estiver, mude `interestFree` para `false`, e a loja passa a mostrar "6x no cartão".
- Rede de segurança para webhooks perdidos: `POST /api/admin/payments/reconcile` com o token de admin.
- Detalhes técnicos da integração: [docs/integracoes/mercadopago-orders-api.md](docs/integracoes/mercadopago-orders-api.md).

### 3.3 E-mail (SMTP)
Opção simples, **Gmail da loja**:
1. Ativar verificação em 2 etapas na conta.
2. Gerar uma senha de app em https://myaccount.google.com/apppasswords.
3. Vercel (back):
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
- O seed roda **na sua máquina**, apontando para o Neon de produção (seção 4). Definir `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 8) nesse `.env` antes de rodar. Com `NODE_ENV=production`, o seed recusa rodar sem `ADMIN_PASSWORD`.
- Para trocar a senha do admin depois: rodar o seed de novo com o novo `ADMIN_PASSWORD`. Sem essa variável, o seed não mexe na senha.
- `check:config` acusa erro se algum admin ainda usar a senha de desenvolvimento `admin123`.

### 3.5 Neon (banco)
O Neon mostra duas strings de conexão em **Connection Details**:
- **Com pooler** (host com `-pooler`): é a que vai em `DATABASE_URL` na Vercel. Em ambiente serverless, a conexão direta esgota o limite de conexões.
- **Direta** (sem `-pooler`): usar só para rodar migrations e seed da sua máquina.

Antes de qualquer migration em produção, criar uma **branch de backup** no Neon (Branches → Create branch a partir da `main`). É instantâneo e serve de ponto de restauração.

### 3.6 Domínio
- Conectar o domínio no projeto **frontend** da Vercel.
- Vercel (front): `VITE_SITE_URL=https://www.dominio.com.br` (gera o sitemap e o robots com o domínio), depois redeploy.
- Vercel (back): `APP_URL=https://www.dominio.com.br` (links dos e-mails) e `CORS_ORIGIN=https://www.dominio.com.br,https://dominio.com.br`, depois redeploy.
- **JWT_SECRET**: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

---

## 4. Migrations e seed no Neon (rodar da sua máquina)

Esta branch adiciona **5 migrations**: campos do Mercado Pago no pedido, `stock_applied`, verificação de e-mail e reset de senha, `checkout_hardening` (frete, desconto Pix e backfill de estoque) e `customer_cpf`. **Elas precisam estar aplicadas no Neon antes de o código novo chegar em produção.** Sem elas, até o login quebra, porque o Prisma lê colunas que ainda não existem.

As 5 só **adicionam** colunas, com valor padrão ou permitindo nulo. Por isso é seguro aplicá-las antes do merge: o código antigo que está no ar continua funcionando.

```bash
cd backend
# 1) Backup: criar uma branch no painel do Neon (seção 3.5).
# 2) Aplicar as migrations com a URL DIRETA (sem -pooler):
DATABASE_URL="postgresql://...@ep-xxxx.sa-east-1.aws.neon.tech/neondb?sslmode=require" npx prisma migrate deploy
# 3) Só na primeira subida (ou para trocar a senha do admin):
NODE_ENV=production DATABASE_URL="<direta>" ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run prisma:seed
```

> Use sempre `migrate deploy`. **Nunca** `migrate dev` ou `migrate reset` contra o Neon de produção: o `reset` apaga o banco.
> No PowerShell, defina as variáveis com `$env:DATABASE_URL="..."` antes do comando.

---

## 5. Ordem para colocar no ar

1. **Neon**: branch de backup → `npx prisma migrate deploy` (seção 4).
2. **Vercel (back)**: criar e conectar o **Blob Store** (Storage → Blob), depois cadastrar as variáveis da seção 2 (Production) com `NODE_ENV=production`.
   O backend **não sobe** sem `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`. Cadastre as duas também nos ambientes Preview e Development, com as credenciais de teste.
3. **Seed**, se for a primeira subida ou para definir a senha do admin (seção 4).
4. **Vercel (front)**: `VITE_API_URL`, `VITE_MP_PUBLIC_KEY`, `VITE_SITE_URL`, depois redeploy.
5. **Merge na `main`**: dispara o deploy de produção dos dois projetos.
6. **Domínio**: conectar e ajustar `APP_URL`/`CORS_ORIGIN` (seção 3.6).
7. **Mercado Pago**: cadastrar o webhook com o domínio de produção do backend, colar o segredo e fazer redeploy do backend.
8. **Conferência**: `npm run check:config` com o `.env` de produção, **0 erros**.
9. **Teste real**: comprar um produto barato via Pix → o pedido deve virar *Confirmado* sozinho e chegar o e-mail de pagamento aprovado → estornar pelo painel do Mercado Pago.
10. Preencher **/admin/configuracoes** com o cliente e treinar o uso do painel ([INSTRUCOES-ADMIN.md](INSTRUCOES-ADMIN.md)).

---

## 6. Pontos de atenção antes de entregar

- **Uploads usam o Vercel Blob em produção.** No projeto backend da Vercel: **Storage → Create → Blob → Connect** (ambientes Production e Preview). A Vercel injeta `BLOB_READ_WRITE_TOKEN` sozinha; depois, redeploy. Sem o token, o upload tenta gravar em disco e falha na Vercel; o `check:config` acusa. **Primeiro teste após configurar:** subir uma imagem de produto pela preview e conferir que a URL salva começa com `https://...blob.vercel-storage.com`.
- **Limite de 4 MB por arquivo**, por causa do corpo de 4,5 MB por requisição na Vercel. O admin envia uma imagem por requisição. No orçamento, arquivos STL maiores que 4 MB precisam ir pelo WhatsApp; aceitar arquivos grandes exige upload direto do navegador para o Blob (melhoria futura).
- **Prisma Client no build**: o backend roda `prisma generate` no `postinstall`. A Vercel reaproveita o `node_modules` entre deploys, e sem isso um schema novo subiria com o client antigo.
- **Rate limit** (login, pedidos) fica na memória de cada instância. Na Vercel, cada instância conta separado, então o limite real é mais frouxo. Aceitável para começar; se houver abuso, mover para Redis/Upstash.
- **Frete** segue a regra atual das configurações (frete grátis acima de X). A cotação real por CEP ainda não foi implementada; o estudo está em [docs/integracoes/frete-melhor-envio.md](docs/integracoes/frete-melhor-envio.md).
- **`VITE_SEURASTREIO_API_KEY`** vai para o bundle público. Usar uma chave sem custo/limite crítico, ou mover a consulta para o backend.
- **Cron diário** ([backend/vercel.json](backend/vercel.json), 9h UTC): reconcilia pagamentos que o webhook perdeu e cancela pedidos não pagos após 48h (boleto: 96h), devolvendo estoque e cupom e avisando o cliente. Só roda no deploy de produção e exige `CRON_SECRET`. No plano Hobby, a Vercel limita o cron a 1x/dia.
- **Estoque** só baixa quando o pagamento é aprovado. Pedido pago sem estoque recebe a nota `[REVISAR ESTOQUE]` em /admin/pedidos.
- **CSP** (opcional): se for configurada na Vercel, precisa liberar os domínios do Mercado Pago, senão o cartão quebra. A lista está comentada em [backend/src/app.ts](backend/src/app.ts).
