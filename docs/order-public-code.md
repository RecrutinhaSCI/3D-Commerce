# Identificação comercial dos pedidos

`Order.id` permanece a chave técnica em todas as relações e chamadas. `Order.publicCode` é apenas a identificação comercial (`3DCOMMERCE00001` etc.).

## Persistência e compatibilidade

- Migration aditiva: `20261111130000_order_public_code`.
- Backfill: `created_at ASC, id ASC`, dentro de transação e com lock exclusivo em `orders`.
- Sequence PostgreSQL bigint, default no banco e índice único. Não usa `count + 1` na aplicação.
- Códigos acima de 99999 não são truncados. Rollbacks podem deixar lacunas; números consumidos não são reutilizados.
- IDs, PKs, FKs, itens, pagamentos, etiquetas e referências dos provedores não são reescritos.
- Mercado Pago mantém `external_reference` e idempotência com o ID técnico; Melhor Envio mantém `pedido-ID` e `orderId`; webhooks, estornos e tracking mantêm seus identificadores técnicos.
- E-mails, Admin, cliente, confirmação, busca, nome do PDF e referências online em estoque/relatórios exibem o código comercial.
- Relatórios de caixas já fechados recebem apenas a referência de apresentação na leitura. O JSON financeiro/estoque salvo não é regravado nem recalculado.
- O frontend aceita respostas antigas sem `publicCode` e usa o ID como fallback; nunca inventa numeração.

## Evidências de teste

`orderPublicCode.db.test.ts` usa apenas PostgreSQL local com nome terminado em `_test`, em schemas isolados. Testa histórico completo de migrations, cópia com pedidos/itens/pagamentos/etiquetas e comparação integral de snapshots (exceto a nova coluna), ordem cronológica, desempate, novo pedido, restrição única, 32 inserções concorrentes, valores acima de 99999, rollback e falha atômica.

Regressões de pagamentos, webhook, cancelamento/estorno, frete, estoque, relatórios, tracking e interfaces acompanham a alteração. Credenciais e dados dos testes são fictícios.

## Antes de uma publicação futura autorizada

Não aplicar esta migration sem backup, pre-check e `prisma migrate status`. Ela adquire lock exclusivo em `orders`: planejar janela e observar duração conforme o volume real. A ordem de publicação deve disponibilizar a migration antes do backend que usa a coluna; o backend antigo continua aceitando o campo adicional com default. Não resetar a sequence nem fazer rollback destrutivo.

Nenhuma migration ou alteração de dados foi executada em produção nesta etapa.
