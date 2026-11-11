DO $$ DECLARE current_snapshot jsonb; BEGIN
SELECT jsonb_build_object(
'orders',(SELECT jsonb_agg(to_jsonb(o) - 'public_code' ORDER BY id) FROM orders o),
'items',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM order_items o),
'payments',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM payments o),
'labels',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM shipment_labels o)
) INTO current_snapshot;
IF current_snapshot IS DISTINCT FROM (SELECT value FROM numbering_fixture_snapshot) THEN RAISE EXCEPTION 'migration changed existing order ids, data or relations'; END IF;
IF (SELECT public_code FROM orders WHERE id='old-first') <> '3DCOMMERCE00001' THEN RAISE EXCEPTION 'chronological order failed'; END IF;
IF (SELECT public_code FROM orders WHERE id='old-tie-a') <> '3DCOMMERCE00002' THEN RAISE EXCEPTION 'tie-break A failed'; END IF;
IF (SELECT public_code FROM orders WHERE id='old-tie-b') <> '3DCOMMERCE00003' THEN RAISE EXCEPTION 'tie-break B failed'; END IF;
END $$;
INSERT INTO orders (id,customer_name,customer_email,customer_phone,address_snapshot,subtotal,total,payment_method,updated_at)
VALUES ('new-after-backfill','Teste novo','novo@example.test','0','{}',10,10,'PIX',CURRENT_TIMESTAMP);
DO $$ BEGIN
IF (SELECT public_code FROM orders WHERE id='new-after-backfill') <> '3DCOMMERCE00004' THEN RAISE EXCEPTION 'sequence not continued after largest backfill'; END IF;
BEGIN UPDATE orders SET public_code='3DCOMMERCE00001' WHERE id='new-after-backfill'; RAISE EXCEPTION 'unique constraint missing'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
