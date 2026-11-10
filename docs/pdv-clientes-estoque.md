# PDV, Clientes e Estoque Unificado

Módulo de frente de caixa dentro do Admin, ligado ao mesmo estoque do e-commerce.

## Regras que não podem ser quebradas

- `Product.stock` é a única fonte de verdade. **Só** `backend/src/modules/stock/stock.service.ts` altera esse campo.
- Toda alteração grava uma `StockMovement` na mesma transação, com quantidade anterior, movimentada e posterior.
- Novo fluxo que mexe em estoque deve usar `applyStockMoves` (entrada/saída) ou `setStockAbsolute` (valor absoluto).

## Telas

| Rota | Função |
| --- | --- |
| `/admin/pdv` | Abrir caixa, vender, uso interno, fechar caixa |
| `/admin/pdv/historico` | Histórico de caixas |
| `/admin/pdv/historico/:id` | Relatório (parcial se o caixa estiver aberto), cancelamento e devolução |
| `/admin/pdv/movimentacoes` | Histórico de movimentações de estoque |
| `/admin/clientes` | Busca, cadastro e histórico de compras |

Atalhos do PDV: F2 leitura, F3 pesquisar, F4 quantidade, F6 remover, F7 item livre, F8 cancelar compra, F9 pagamento, F10 cliente, Esc fecha modal.

Leitor USB funciona sem integração: ele digita o código e envia Enter no campo de leitura. Para informar quantidade, use `3*código`.

## Como cada coisa funciona

**Concorrência.** A baixa é um único `UPDATE ... WHERE stock >= quantidade`, então duas vendas nunca consomem a mesma unidade. Produtos são travados em ordem fixa para evitar deadlock. Há ainda um `CHECK (stock >= 0)` no banco.

**Janela do relatório.** O caixa guarda a última `StockMovement.seq` na abertura e no fechamento, lidas sob `LOCK TABLE products IN SHARE MODE`. Por isso uma venda em andamento nunca cai no caixa errado.

**Estoque final.** Vem da leitura real do produto e é conferido contra inicial + movimentações. Diferença aparece como divergência no relatório, indicando alteração feita por fora do sistema (SQL manual, por exemplo).

**Edição de produto.** O formulário envia `expectedStock`. Sem alteração no campo, o estoque atual é preservado. Com alteração e valor defasado, a API responde 409 `STOCK_CHANGED`.

**Excel.** Estoque diferente do atual vira movimentação `IMPORT`. Reimportar a mesma planilha não gera nada. Uma planilha antiga ainda sobrescreve o estoque, mas fica registrada com o valor anterior.

**Clientes.** `User` é login e `Customer` é a pessoa compradora. Clientes da loja entram em `customers` automaticamente nas buscas, sem tocar em autenticação ou checkout. Quem comprou no balcão e cria conta depois é vinculado pelo e-mail.

**Cancelamento e devolução.** Cancelamento só com o caixa da venda aberto. Depois do fechamento, use devolução: ela sai do caixa aberto no momento e não altera o relatório já fechado.

## Deploy (migrations)

Aplicar **antes** de publicar o backend, porque o código novo já lê `products.barcode`:

```sql
-- 1. Conferir antes: precisa retornar 0.
SELECT count(*) FROM products WHERE stock < 0;
```

```bash
npm --prefix backend run db:deploy
```

Migrations, ambas só aditivas: `20261110120000_stock_ledger` e `20261110130000_customers_pos`.

## Testes com banco

```bash
TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/app_test npm --prefix backend test
```

O banco precisa ser local e terminar em `_test`, com as migrations aplicadas. Os testes apagam o conteúdo.

## Próximos passos possíveis

- Integração com maquininha/TEF.
- Pagamento dividido em mais de uma forma.
- Tela de ajuste de estoque com motivo, sem passar pelo formulário do produto.
- Permissões por perfil de operador (hoje todo admin tem acesso total).
