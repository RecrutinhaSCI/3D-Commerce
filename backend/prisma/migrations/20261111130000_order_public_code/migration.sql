-- Additive: internal IDs and all foreign keys stay unchanged.
-- A single transaction prevents inserts racing the deterministic backfill.
BEGIN;
LOCK TABLE "orders" IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE "order_public_number_seq" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE FUNCTION next_order_public_code() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT '3DCOMMERCE' || CASE WHEN length(n) > 5 THEN n ELSE lpad(n, 5, '0') END
  FROM (SELECT nextval('order_public_number_seq'::regclass)::text AS n) AS sequence_value;
$$;
ALTER TABLE "orders" ADD COLUMN "public_code" TEXT;
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at" ASC, "id" ASC)::text AS n
  FROM "orders"
)
UPDATE "orders" o SET "public_code" = '3DCOMMERCE' || CASE WHEN length(n.n) > 5 THEN n.n ELSE lpad(n.n, 5, '0') END
FROM numbered n WHERE n."id" = o."id";
SELECT setval('order_public_number_seq', GREATEST((SELECT count(*) FROM "orders"), 1), (SELECT count(*) > 0 FROM "orders"));
ALTER TABLE "orders" ALTER COLUMN "public_code" SET DEFAULT next_order_public_code();
ALTER TABLE "orders" ALTER COLUMN "public_code" SET NOT NULL;
ALTER SEQUENCE "order_public_number_seq" OWNED BY "orders"."public_code";
CREATE UNIQUE INDEX "orders_public_code_key" ON "orders"("public_code");
COMMIT;
