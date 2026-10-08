# Migration: código de rastreio nos pedidos

Esta feature adiciona a coluna `tracking_code` na tabela `orders`, usada para
guardar o código de rastreio da transportadora (consultado na API SeuRastreio
pelo frontend).

## O que foi adicionado
- `backend/prisma/schema.prisma` — campo `trackingCode String? @map("tracking_code")` no model `Order`.
- `backend/prisma/migrations/20260721000000_order_tracking_code/migration.sql` — a migration.
- Endpoint `PUT /api/admin/orders/:id/tracking` (admin) para gravar/limpar o código.

## O que rodar no ambiente com acesso ao banco

```bash
cd backend
npm install                 # se ainda não tiver node_modules
npx prisma migrate deploy   # aplica a migration em produção/staging
# — ou, em desenvolvimento —
npx prisma migrate dev      # aplica e regenera o client
npx prisma generate         # garante o Prisma Client atualizado
```

> A migration é aditiva e segura: apenas adiciona uma coluna `TEXT` nullable
> (`ALTER TABLE "orders" ADD COLUMN "tracking_code" TEXT;`). Não altera nem
> remove dados existentes.

## Variável de ambiente (frontend)
A chave da API de rastreio fica em `VITE_SEURASTREIO_API_KEY` (ver `.env.example`).
No deploy (Vercel), adicionar em Settings → Environment Variables.
