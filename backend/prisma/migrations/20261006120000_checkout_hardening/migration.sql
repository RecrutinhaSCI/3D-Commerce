-- Checkout hardening (frete no backend, desconto Pix, backfill de estoque).
-- Só adiciona colunas/tipo e corrige dados — seguro aplicar antes do deploy do
-- código novo (o código antigo ignora as colunas novas).

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('PAC', 'SEDEX', 'PICKUP');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shipping_method" "ShippingMethod";

-- Backfill de estoque: antes desta versão o estoque era baixado na CRIAÇÃO do
-- pedido. Esses pedidos antigos (nunca passaram pelo Mercado Pago, logo sem
-- mp_payment_id) já tiveram o estoque baixado — marcá-los evita baixa dupla
-- num pagamento futuro e permite que o cancelamento reponha o estoque.
UPDATE "orders" SET "stock_applied" = true
WHERE "stock_applied" = false AND "mp_payment_id" IS NULL;
