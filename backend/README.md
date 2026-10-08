# 3D Commerce — Backend

API REST do projeto 3D Commerce. Construída com **Express + TypeScript**, arquitetura modular por domínio.

> **Estado atual: R1 — Fundação.**
> Só `GET /health` responde com dados. Os módulos estão estruturados mas vazios e serão preenchidos a partir da R2.

---

## Stack

- Node 18+
- Express 4
- TypeScript 5
- Zod (validação de env e payloads)
- dotenv, cors
- Prisma (R2)
- bcrypt + JSON Web Token (R3)
- Multer (R4/R6)

---

## Estrutura

```
backend/
├── prisma/                  # Schema + migrations (R2)
├── uploads/                 # Multer destino local
│   ├── products/
│   └── quotes/
├── src/
│   ├── app.ts               # Factory do Express
│   ├── server.ts            # Bootstrap + graceful shutdown
│   ├── config/
│   │   └── env.ts           # Validação de env via Zod
│   ├── lib/                 # Clientes (prisma, etc) — R2
│   ├── middlewares/
│   │   ├── errorHandler.ts
│   │   ├── notFoundHandler.ts
│   │   └── requestLogger.ts
│   ├── modules/
│   │   ├── auth/            # R3
│   │   ├── users/           # R3+
│   │   ├── categories/      # R4
│   │   ├── products/        # R4
│   │   ├── cart/            # R5
│   │   ├── orders/          # R5
│   │   ├── quotes/          # R6
│   │   ├── settings/        # R8
│   │   └── dashboard/       # R7
│   ├── routes/
│   │   ├── index.ts         # Router agregador
│   │   └── health.routes.ts
│   └── utils/
│       ├── apiResponse.ts   # ok / created / fail / noContent
│       ├── asyncHandler.ts
│       └── httpError.ts
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Como rodar localmente

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Servidor sobe em `http://localhost:3333`.

Teste o health check:

```bash
curl http://localhost:3333/health
# { "status": "ok", "service": "3D Commerce API" }

curl http://localhost:3333/api/health
# envelope completo com uptime + timestamp
```

---

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | tsx watch — reinicia ao salvar |
| `npm run build` | `tsc` para `dist/` |
| `npm start` | `node dist/server.js` (precisa `build` antes) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:generate` | placeholder até R2 |
| `npm run prisma:migrate` | placeholder até R2 |
| `npm run prisma:studio` | placeholder até R2 |
| `npm run prisma:seed` | placeholder até R2 |

---

## Padrão de resposta

**Sucesso**

```json
{ "ok": true, "data": { /* ... */ } }
```

**Erro**

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { /* opcional */ } } }
```

Lance erros via `HttpError` para serem tratados pelo middleware global. `ZodError`, JSON inválido e payload grande já são reconhecidos automaticamente.

## Backup, limpeza do catálogo e testes de integração

```bash
# Backup completo dos DADOS (todas as tabelas) → ../backups/*.json + *.sql
# (sem pg_dump; o .sql restaura com `psql "$DATABASE_URL" -f arquivo.sql`
#  num banco migrado e vazio). A pasta backups/ está no .gitignore.
node scripts/db-backup.cjs

# Limpeza do catálogo (produtos + mídias). Preserva admin, settings, categorias,
# banners, cupons e migrations. Aborta se houver produto ativo, carrinho ou
# pedido vinculado. SÓ rode depois de um backup validado.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-catalog.sql

# Testes de integração com Postgres real (export → .xlsx → import, exclusão,
# active). Exige banco LOCAL com nome terminando em "_test" — ele é zerado.
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:55432/app_test npx vitest run
```

Regras do catálogo:

- **Excluir** apaga o produto e as fotos de vez (pedidos antigos guardam nome/SKU/preço).
  Para só tirar da loja, desmarque **Ativo** — inativos somem da loja mas continuam no admin e no export.
- **Importar Excel**: célula vazia ou coluna ausente = não altera; `0` e `não` são valores.
  Linhas sem diferença real caem em "Sem alteração" e não reescrevem nada.
- O seed **não** cria produtos demo (use `SEED_DEMO_CATALOG=1`) e **não** troca a senha de um admin existente.
