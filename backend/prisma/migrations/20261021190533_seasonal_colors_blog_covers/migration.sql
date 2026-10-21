-- Cores configuráveis do banner sazonal + capas do Blog gerenciáveis.
-- Só adiciona colunas que aceitam NULL; NULL = visual atual (código antigo
-- continua funcionando).
ALTER TABLE "categories" ADD COLUMN "seasonal_color_from" TEXT;
ALTER TABLE "categories" ADD COLUMN "seasonal_color_to" TEXT;
ALTER TABLE "categories" ADD COLUMN "seasonal_text_color" TEXT;
ALTER TABLE "site_settings" ADD COLUMN "blog_covers_json" JSONB;
