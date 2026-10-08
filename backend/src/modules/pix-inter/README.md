# pix-inter — Pix via Banco Inter (R19) — DESLIGADO

Módulo criado na `main` (R19) com uma estrutura de cobrança Pix por provider:
`MOCK` (simulado, usado nos testes) e `INTER` (Banco Inter — **stub, sem
integração real**: responde 501).

Na integração com a branch `api-mercado-pago`, a forma de pagamento em uso
passou a ser o **Mercado Pago** (`modules/payments`: cartão, Pix e boleto,
estorno, webhook assinado, cron de expiração). Como os dois módulos usavam a
mesma rota (`POST /api/orders/:orderId/payments`), este foi movido para cá e
**não é montado** em `routes/index.ts`:

- nenhuma rota deste módulo responde em produção (evita, por exemplo, marcar
  pedido como pago pelo webhook do provider MOCK);
- as tabelas `payments` e `payment_events` (migration
  `20260711144822_payments_pix`) continuam no banco, sem uso;
- os testes (`providers/mock.provider.test.ts`) seguem rodando com `npm test`.

## Para reativar no futuro (integração Inter autorizada)
1. Implementar `providers/inter.provider.ts` (roteiro no próprio arquivo).
2. Trocar os caminhos das rotas em `payments.routes.ts` para não colidir com o
   Mercado Pago (ex.: `/orders/:orderId/pix-inter`) e montar o router em
   `routes/index.ts` **antes** do `dashboardRouter`.
3. Definir `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` e as variáveis `INTER_*`
   (ver `backend/.env.example`).
