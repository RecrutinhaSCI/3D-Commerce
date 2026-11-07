-- Etiquetas (Etapa 4): cancelamento e descarte. Migration ADITIVA: dois
-- valores novos no enum e duas colunas opcionais. Nada existente é alterado.

-- AlterEnum
ALTER TYPE "ShipmentLabelStatus" ADD VALUE 'CANCELING';
ALTER TYPE "ShipmentLabelStatus" ADD VALUE 'DISCARDED';

-- AlterTable
ALTER TABLE "shipment_labels" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "generation_requested_at" TIMESTAMP(3);

-- Cancelada OU descartada nunca fica ativa. Comparação em texto: o valor novo
-- do enum não pode ser usado na mesma transação em que foi criado.
ALTER TABLE "shipment_labels" DROP CONSTRAINT "shipment_labels_canceled_inactive_check";
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_canceled_inactive_check"
  CHECK ("status"::text NOT IN ('CANCELED', 'DISCARDED') OR "active_order_id" IS NULL);
