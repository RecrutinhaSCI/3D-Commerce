-- Limpeza controlada do CATÁLOGO (produtos + mídias de produto).
--
-- PRÉ-REQUISITO: backup validado (node scripts/db-backup.cjs).
-- Preserva: users, site_settings, categories, banners, coupons,
-- coupon_scripts, testimonials, _prisma_migrations e o schema inteiro.
--
-- Travas: aborta (ROLLBACK) se existir produto ATIVO, item de carrinho ou
-- item de pedido apontando para produto — nesses casos a limpeza apagaria
-- dado de cliente/histórico e precisa ser reavaliada antes.
--
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-catalog.sql
BEGIN;

DO $$
DECLARE
  n_active int; n_cart int; n_order int;
BEGIN
  SELECT count(*) INTO n_active FROM products WHERE active;
  SELECT count(*) INTO n_cart FROM cart_items;
  SELECT count(*) INTO n_order FROM order_items WHERE product_id IS NOT NULL;
  IF n_active > 0 OR n_cart > 0 OR n_order > 0 THEN
    RAISE EXCEPTION 'Abortado: % produto(s) ativo(s), % item(ns) de carrinho, % item(ns) de pedido vinculados.',
      n_active, n_cart, n_order;
  END IF;
END $$;

-- Ordem respeitando FKs: filhos primeiro.
DELETE FROM product_images;
DELETE FROM products;

SELECT
  (SELECT count(*) FROM products)       AS products,
  (SELECT count(*) FROM product_images) AS product_images,
  (SELECT count(*) FROM users)          AS users,
  (SELECT count(*) FROM categories)     AS categories,
  (SELECT count(*) FROM site_settings)  AS site_settings,
  (SELECT count(*) FROM _prisma_migrations) AS migrations;

COMMIT;
