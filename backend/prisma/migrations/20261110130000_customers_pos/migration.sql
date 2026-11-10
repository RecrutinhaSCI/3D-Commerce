-- CreateEnum
CREATE TYPE "CustomerOrigin" AS ENUM ('ECOMMERCE', 'POS');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phone_digits" TEXT,
    "document" TEXT,
    "notes" TEXT,
    "origin" "CustomerOrigin" NOT NULL DEFAULT 'POS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "open_operator_id" TEXT,
    "opened_by_id" TEXT,
    "opened_by_name" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "opening_note" TEXT,
    "opening_movement_seq" INTEGER NOT NULL,
    "opening_stock_json" JSONB NOT NULL,
    "closed_by_id" TEXT,
    "closed_by_name" TEXT,
    "closed_at" TIMESTAMP(3),
    "closing_note" TEXT,
    "closing_movement_seq" INTEGER,
    "counted_cash" DECIMAL(12,2),
    "sales_count" INTEGER NOT NULL DEFAULT 0,
    "total_sold" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "report_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sales" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "cash_session_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "operator_id" TEXT,
    "operator_name" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "payment_method" "PosPaymentMethod" NOT NULL,
    "amount_received" DECIMAL(12,2),
    "change_amount" DECIMAL(12,2),
    "notes" TEXT,
    "status" "PosSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "canceled_at" TIMESTAMP(3),
    "canceled_by_id" TEXT,
    "canceled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT,
    "is_free_item" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "product_sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "net_total" DECIMAL(12,2) NOT NULL,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_returns" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "cash_session_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "operator_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_amount" DECIMAL(12,2) NOT NULL,
    "refund_method" "PosPaymentMethod" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "sale_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refund_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "pos_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_document_key" ON "customers"("document");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_phone_digits_idx" ON "customers"("phone_digits");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_number_key" ON "cash_sessions"("number");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_open_operator_id_key" ON "cash_sessions"("open_operator_id");

-- CreateIndex
CREATE INDEX "cash_sessions_status_idx" ON "cash_sessions"("status");

-- CreateIndex
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_number_key" ON "pos_sales"("number");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sales_idempotency_key_key" ON "pos_sales"("idempotency_key");

-- CreateIndex
CREATE INDEX "pos_sales_cash_session_id_idx" ON "pos_sales"("cash_session_id");

-- CreateIndex
CREATE INDEX "pos_sales_customer_id_idx" ON "pos_sales"("customer_id");

-- CreateIndex
CREATE INDEX "pos_sales_created_at_idx" ON "pos_sales"("created_at");

-- CreateIndex
CREATE INDEX "pos_sales_status_idx" ON "pos_sales"("status");

-- CreateIndex
CREATE INDEX "pos_sale_items_sale_id_idx" ON "pos_sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "pos_sale_items_product_id_idx" ON "pos_sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_returns_number_key" ON "pos_returns"("number");

-- CreateIndex
CREATE UNIQUE INDEX "pos_returns_idempotency_key_key" ON "pos_returns"("idempotency_key");

-- CreateIndex
CREATE INDEX "pos_returns_sale_id_idx" ON "pos_returns"("sale_id");

-- CreateIndex
CREATE INDEX "pos_returns_cash_session_id_idx" ON "pos_returns"("cash_session_id");

-- CreateIndex
CREATE INDEX "pos_return_items_return_id_idx" ON "pos_return_items"("return_id");

-- CreateIndex
CREATE INDEX "pos_return_items_sale_item_id_idx" ON "pos_return_items"("sale_item_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_return_items" ADD CONSTRAINT "pos_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "pos_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_return_items" ADD CONSTRAINT "pos_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "pos_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Barreiras no banco: quantidades coerentes e devolução nunca acima do vendido.
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "pos_sale_items" ADD CONSTRAINT "pos_sale_items_returned_within_sold" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity");
