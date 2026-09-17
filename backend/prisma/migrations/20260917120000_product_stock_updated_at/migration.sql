-- Aditiva. Nullable. Produtos existentes ficam com NULL ("sem histórico").
ALTER TABLE "products" ADD COLUMN "stock_updated_at" TIMESTAMP(3);
