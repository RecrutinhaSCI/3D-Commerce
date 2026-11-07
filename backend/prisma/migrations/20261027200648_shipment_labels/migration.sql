-- Etiquetas do Melhor Envio (Etapa 1). Migration ADITIVA: só tabelas/enums
-- NOVOS + uma coluna opcional em site_settings. Nada existente é alterado.
-- Nenhum token, resposta bruta ou dado de cartão é gravado aqui.
-- CreateEnum
CREATE TYPE "ShipmentLabelStatus" AS ENUM ('PREPARED', 'AWAITING_CONFIRMATION', 'PURCHASING', 'PURCHASED', 'GENERATING', 'LABEL_READY', 'POSTED', 'DELIVERED', 'NEEDS_RECONCILIATION', 'ERROR', 'CANCELED');

-- CreateEnum
CREATE TYPE "ShipmentFiscalMode" AS ENUM ('DECLARATION', 'NFE');

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "shipping_sender_json" JSONB;

-- CreateTable
CREATE TABLE "shipment_labels" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "active_order_id" TEXT,
    "environment" TEXT NOT NULL,
    "status" "ShipmentLabelStatus" NOT NULL DEFAULT 'PREPARED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "me_order_id" TEXT,
    "me_protocol" TEXT,
    "me_purchase_id" TEXT,
    "service_id" INTEGER NOT NULL,
    "service_name" TEXT,
    "carrier" TEXT,
    "fiscal_mode" "ShipmentFiscalMode" NOT NULL,
    "nfe_key" TEXT,
    "package_json" JSONB NOT NULL,
    "declared_value" DECIMAL(12,2) NOT NULL,
    "customer_shipping_value" DECIMAL(12,2) NOT NULL,
    "quoted_price" DECIMAL(12,2),
    "paid_price" DECIMAL(12,2),
    "payload_hash" TEXT,
    "confirmation_hash" TEXT,
    "confirmation_expires_at" TIMESTAMP(3),
    "confirmation_price" DECIMAL(12,2),
    "tracking_code" TEXT,
    "self_tracking" TEXT,
    "prepared_at" TIMESTAMP(3),
    "purchased_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_by_user_id" TEXT,
    "purchased_by_user_id" TEXT,
    "canceled_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_label_events" (
    "id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "ShipmentLabelStatus",
    "to_status" "ShipmentLabelStatus",
    "user_id" TEXT,
    "details_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_label_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_labels_active_order_id_key" ON "shipment_labels"("active_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_labels_me_order_id_key" ON "shipment_labels"("me_order_id");

-- CreateIndex
CREATE INDEX "shipment_labels_order_id_idx" ON "shipment_labels"("order_id");

-- CreateIndex
CREATE INDEX "shipment_labels_status_idx" ON "shipment_labels"("status");

-- CreateIndex
CREATE INDEX "shipment_label_events_label_id_idx" ON "shipment_label_events"("label_id");

-- CreateIndex
CREATE INDEX "shipment_label_events_order_id_idx" ON "shipment_label_events"("order_id");

-- AddForeignKey
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_label_events" ADD CONSTRAINT "shipment_label_events_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "shipment_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Garantias extras (Prisma não modela CHECK; ficam só no SQL):
-- active_order_id só pode ser o próprio pedido (ou NULL = inativa).
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_active_order_check"
  CHECK ("active_order_id" IS NULL OR "active_order_id" = "order_id");
-- Chave de NF-e: 44 dígitos; obrigatória no modo NFE (IS NOT NULL explícito:
-- NULL ~ regex dá NULL, e CHECK com NULL passaria).
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_nfe_key_check"
  CHECK (("fiscal_mode" = 'DECLARATION' AND "nfe_key" IS NULL) OR ("fiscal_mode" = 'NFE' AND "nfe_key" IS NOT NULL AND "nfe_key" ~ '^[0-9]{44}$'));
-- Etiqueta cancelada nunca fica ativa.
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_canceled_inactive_check"
  CHECK ("status" <> 'CANCELED' OR "active_order_id" IS NULL);
