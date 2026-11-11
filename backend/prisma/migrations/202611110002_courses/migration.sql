BEGIN;
-- Aditiva: não modifica produtos, pedidos, guias ou integrações existentes.
CREATE TABLE "courses" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "eyebrow" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "short_description" TEXT NOT NULL DEFAULT '',
  "cover_image" TEXT,
  "level_label" TEXT NOT NULL DEFAULT '',
  "original_price" DECIMAL(10,2),
  "price" DECIMAL(10,2),
  "external_url" TEXT NOT NULL,
  "button_label" TEXT NOT NULL DEFAULT 'Conhecer curso',
  "cta_type" TEXT NOT NULL DEFAULT 'external',
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "courses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "courses_price_nonnegative" CHECK ("price" IS NULL OR "price" >= 0),
  CONSTRAINT "courses_original_price_nonnegative" CHECK ("original_price" IS NULL OR "original_price" >= 0),
  CONSTRAINT "courses_cta_type" CHECK ("cta_type" IN ('external', 'whatsapp'))
);
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");
CREATE INDEX "courses_active_display_order_idx" ON "courses"("active", "display_order");

-- Preserva integralmente texto/capa do guia; altera apenas a visibilidade.
UPDATE "site_settings"
SET "blog_content_json" = COALESCE(NULLIF("blog_content_json", 'null'::jsonb), '{}'::jsonb) || jsonb_build_object(
  'quando-usar-resina-impressao-3d',
  (CASE WHEN jsonb_typeof("blog_content_json" -> 'quando-usar-resina-impressao-3d') = 'object'
    THEN "blog_content_json" -> 'quando-usar-resina-impressao-3d' ELSE '{}'::jsonb END) || '{"active":false}'::jsonb
)
WHERE "id" = 'main' AND ("blog_content_json" IS NULL OR jsonb_typeof("blog_content_json") IN ('null', 'object'));

COMMIT;
