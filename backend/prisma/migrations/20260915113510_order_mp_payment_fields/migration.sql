-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "external_reference" TEXT,
ADD COLUMN     "mp_payment_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_mp_payment_id_idx" ON "orders"("mp_payment_id");
