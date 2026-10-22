-- Etapa 3 do frete (Melhor Envio): detalhes da cotação usada no pedido.
-- Só colunas NOVAS e opcionais: pedidos antigos ficam com NULL; nada é
-- apagado nem reescrito. O valor do frete continua em "shipping_value".
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_carrier" TEXT,
ADD COLUMN     "shipping_deadline_days" INTEGER,
ADD COLUMN     "shipping_quote_source" TEXT,
ADD COLUMN     "shipping_service_id" INTEGER,
ADD COLUMN     "shipping_service_name" TEXT;

