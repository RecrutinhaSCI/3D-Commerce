-- Carrossel do hero: selos por banner (antes não eram gravados) e tempo de troca.
-- Só adiciona colunas; o código antigo continua funcionando com elas.
ALTER TABLE "banners" ADD COLUMN "badge_left_json" JSONB;
ALTER TABLE "banners" ADD COLUMN "badge_right_json" JSONB;
ALTER TABLE "site_settings" ADD COLUMN "hero_interval_seconds" INTEGER NOT NULL DEFAULT 6;
