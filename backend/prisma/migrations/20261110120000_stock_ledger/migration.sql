-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ECOMMERCE_SALE', 'POS_SALE', 'INTERNAL_USE', 'MANUAL_ADJUSTMENT', 'RETURN', 'CANCELLATION', 'CORRECTION', 'IMPORT');

-- CreateEnum
CREATE TYPE "StockMovementSource" AS ENUM ('ECOMMERCE', 'POS', 'ADMIN', 'IMPORT');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT;

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_sku" TEXT,
    "type" "StockMovementType" NOT NULL,
    "source" "StockMovementSource" NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT,
    "note" TEXT,
    "order_id" TEXT,
    "reference_label" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_seq_idx" ON "stock_movements"("product_id", "seq");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Última barreira contra estoque negativo. NOT VALID: vale para toda escrita
-- nova sem varrer (nem recusar) linhas já existentes.
ALTER TABLE "products" ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0) NOT VALID;
