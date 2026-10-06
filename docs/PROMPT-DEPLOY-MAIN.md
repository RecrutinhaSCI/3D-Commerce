# Prompt de deploy para a `main` (Neon + Vercel)

**Para quem:** o Recruta que vai subir a branch `api-mercado-pago` para a `main` usando o Claude Code.

## Como usar
1. Abra o Claude Code **na raiz do projeto 3D-Commerce**, com a branch `api-mercado-pago` atualizada (`git pull`).
2. Tenha à mão, **sem colar no chat**:
   - acesso ao painel do **Neon** do projeto;
   - acesso ao painel da **Vercel** (os dois projetos: front e back);
   - as credenciais que o líder vai passar (Mercado Pago, SMTP, admin).
3. Copie **o bloco inteiro** da seção abaixo e cole como primeira mensagem para o Claude.
4. O Claude vai parar em cada etapa e pedir que você faça algo no painel ou confirme. **Não pule confirmações.**

> Nunca cole senha, token ou URL de banco no chat. Quando o Claude pedir, faça você mesmo no painel ou no terminal. O repositório é **público**.

---

## Prompt (copiar a partir daqui)

```txt
Você vai me ajudar a colocar a branch `api-mercado-pago` em produção no projeto 3D-Commerce (e-commerce da G-Rec Company). Leia tudo antes de agir e siga a ordem exata. Eu sou o executor humano: você me guia, roda comandos locais e verifica; ações em painel (Neon/Vercel/Mercado Pago) quem faz sou eu.

## Contexto
- Stack: frontend React/Vite e backend Express + Prisma, os dois na Vercel em projetos separados (front = raiz do repo; back = Root Directory `backend/`). Banco: Neon (PostgreSQL). Pagamentos: Mercado Pago (Orders API).
- Guias do projeto que você DEVE ler antes de começar: `CONFIGURAR-CLIENTE.md`, `CHECKLIST-PRODUCAO.md`, `backend/.env.example`, `.env.example`, `backend/vercel.json`.
- A branch adiciona 7 migrations Prisma que ainda NÃO existem no Neon de produção:
  1. 20260915113510_order_mp_payment_fields
  2. 20260915194135_order_stock_applied
  3. 20260915195100_auth_reset_verify
  4. 20261006120000_checkout_hardening
  5. 20261006150000_order_customer_cpf
  6. 20261006170000_user_privacy_consent
  7. 20261006190000_newsletter_subscribers
  Todas só ADICIONAM colunas/tabelas (+ um UPDATE de backfill em `orders.stock_applied`). Por isso devem ser aplicadas ANTES do merge: o código antigo continua funcionando com elas, mas o código novo quebra sem elas (até o login).
- O backend novo NÃO sobe sem `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` (o env.ts encerra o processo). Por isso as variáveis também vão ANTES do merge.

## Regras inegociáveis
1. NUNCA rode `prisma migrate dev`, `prisma migrate reset`, `prisma db push` ou qualquer DROP/TRUNCATE/DELETE contra o Neon de produção. Só `prisma migrate deploy`.
2. NUNCA rode migration sem eu confirmar que criei a branch de backup no Neon.
3. NUNCA peça, imprima, grave em arquivo versionado ou repita no chat: tokens, senhas, connection strings. Se precisar de um valor secreto num comando, use variável de ambiente que EU defino no meu terminal, ou o `.env` local que está no .gitignore. Antes de qualquer commit, rode `git status` e confirme que nenhum `.env` aparece.
4. NUNCA dê push direto na `main`, force push, nem pule hooks. O merge é por Pull Request.
5. Antes de cada etapa, diga em 1-2 frases o que vai fazer e ESPERE meu "ok". Depois de cada etapa, mostre a evidência (saída do comando) e marque como concluída.
6. Se algo der errado ou divergir deste roteiro, PARE, explique e proponha opções. Não improvise em produção.
7. Rodando no Windows: comandos com variável de ambiente devem ter versão para PowerShell (`$env:NOME="..."`) e Git Bash.

## Roteiro

### Etapa 0 — Conferência local (sem tocar em produção)
- `git status` limpo e branch `api-mercado-pago` atualizada com o remoto.
- Confirme que as 7 pastas de migration acima existem em `backend/prisma/migrations/`.
- Rode o build do front (`npm run build` na raiz) e o typecheck do back (`cd backend && npx tsc --noEmit`). Os dois precisam passar.
- Me mostre um resumo do que muda (`git log --oneline main..HEAD`).

### Etapa 1 — Backup no Neon (EU faço)
- Me peça para criar no painel do Neon uma branch de backup da `main` de produção chamada `backup-pre-api-mercado-pago-<data>`.
- Só avance quando eu disser que criei.

### Etapa 2 — Migrations no Neon de produção
- Me peça a connection string DIRETA (sem `-pooler` no host) do Neon de produção, mas para eu definir no MEU terminal como `DATABASE_URL`. Você não recebe o valor.
- Primeiro rode só leitura: `cd backend && npx prisma migrate status` e me mostre quais migrations estão pendentes. Devem ser exatamente as 7 acima (ou um subconjunto, se alguma já tiver sido aplicada). Se aparecer qualquer outra coisa (drift, migration desconhecida, "failed"), PARE.
- Com meu ok: `npx prisma migrate deploy`.
- Rode `npx prisma migrate status` de novo e confirme "Database schema is up to date".
- Me lembre de fechar/limpar a variável `DATABASE_URL` do terminal depois.

### Etapa 3 — Seed (só se for a primeira subida OU para trocar a senha do admin)
- Me pergunte se é necessário. Se não for, pule.
- Se for: com `DATABASE_URL` (direta) definida por mim, `NODE_ENV=production`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mín. 8) definidos por mim no terminal, rode `npm run prisma:seed`. O seed não sobrescreve produtos nem configurações que já existem, e sem ADMIN_PASSWORD não mexe na senha.

### Etapa 4 — Variáveis na Vercel (EU faço no painel)
Me dê a lista para eu conferir/cadastrar, por projeto e ambiente, sem você ver os valores:
- Projeto BACKEND (Production): DATABASE_URL (a URL COM pooler), JWT_SECRET, NODE_ENV=production, CORS_ORIGIN (domínio(s) da loja), APP_URL (domínio da loja, igual ao VITE_SITE_URL), MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET (credenciais de PRODUÇÃO do cliente), CRON_SECRET (gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS/SMTP_FROM.
- Projeto BACKEND: criar e conectar um Blob Store (Storage → Blob → Connect) em Production e Preview. Isso cria BLOB_READ_WRITE_TOKEN sozinho.
- Projeto BACKEND (Preview e Development): MP_ACCESS_TOKEN/MP_WEBHOOK_SECRET de TESTE (sem elas a preview não sobe). DATABASE_URL de preview NÃO deve ser o banco de produção.
- Projeto FRONT (Production): VITE_API_URL (domínio do backend), VITE_SITE_URL (domínio da loja), VITE_MP_PUBLIC_KEY (public key de PRODUÇÃO). Opcional: VITE_GA_MEASUREMENT_ID.
- Me peça para confirmar item por item. Use `backend/.env.example` e `.env.example` como fonte da lista.

### Etapa 5 — Conferência da configuração de produção
- Me oriente a criar LOCALMENTE um arquivo `backend/.env.production.local` (não versionado; confirme com `git check-ignore -v backend/.env.production.local`) com os mesmos valores do backend de produção, e rode a conferência apontando para ele — dentro de `backend/`: Git Bash `DOTENV_CONFIG_PATH=.env.production.local npm run check:config` | PowerShell `$env:DOTENV_CONFIG_PATH=".env.production.local"; npm run check:config`. Precisa terminar com 0 erros. Em especial: "Token de PRODUÇÃO válido" no Mercado Pago, Blob configurado, CRON_SECRET definido, admin sem senha "admin123".
- Depois, me peça para apagar esse arquivo.

### Etapa 6 — Push e preview
- Com meu ok: `git push origin api-mercado-pago`.
- Abra o PR para a `main` com `gh pr create` (título e descrição em português resumindo as mudanças a partir do `git log`, e listando: migrations já aplicadas no Neon, variáveis já configuradas).
- Me peça para abrir a URL de PREVIEW da Vercel e testar: login, carrinho, checkout até gerar um Pix de teste, upload de uma imagem de produto no admin (a URL salva deve começar com `https://...blob.vercel-storage.com`), página /admin/mensagens.

### Etapa 7 — Merge e produção
- Com meu ok: merge do PR (`gh pr merge --merge`, sem apagar a branch).
- Me peça para acompanhar o deploy de produção dos DOIS projetos na Vercel e me avisar quando ficarem "Ready".
- Verifique: `curl -s https://<dominio-do-backend>/health` responde ok; `https://<dominio-da-loja>/robots.txt` lista o sitemap da API; `https://<dominio-do-backend>/api/public/sitemap.xml` lista os produtos.

### Etapa 8 — Mercado Pago (EU faço no painel do cliente)
- Me guie para cadastrar o webhook em modo produção: URL `https://<dominio-do-backend>/api/payments/webhook`, evento "Order (Mercado Pago)". Se a assinatura secreta mudar, eu atualizo MP_WEBHOOK_SECRET na Vercel e faço redeploy do backend.

### Etapa 9 — Teste real
- Me guie numa compra real e barata via Pix: o pedido deve virar "Confirmado" sozinho e o e-mail de pagamento aprovado deve chegar. Depois, estornar pelo admin ("Estornar e cancelar") e conferir que o pedido fica Cancelado/Reembolsado e o estoque volta.
- Atualize o `CHECKLIST-PRODUCAO.md` marcando os itens de go-live concluídos e faça um commit/PR pequeno só com isso.

## Plano de volta (se a produção quebrar)
- Front ou back com erro após o merge: na Vercel, "Instant Rollback" para o deploy anterior. As migrations são aditivas, então o código antigo funciona com o banco novo — NÃO desfaça migrations.
- Dados corrompidos (improvável): restaurar a partir da branch de backup do Neon. Isso é decisão do líder; só me oriente, não execute.

## Relatório final
Ao terminar, me entregue: o que foi feito em cada etapa (com evidência), o que ficou pendente, URLs de produção verificadas, e qualquer alerta que apareceu no `check:config` ou nos logs da Vercel.
```

---

## Quando chamar o líder
- `prisma migrate status` mostrou algo diferente das 7 migrations.
- O `check:config` não fecha com 0 erros.
- O deploy da Vercel falhou ou a API não responde no `/health`.
- O pagamento de teste não confirmou sozinho em alguns minutos.
