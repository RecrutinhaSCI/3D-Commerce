INSERT INTO orders (id,customer_name,customer_email,customer_phone,address_snapshot,subtotal,total,payment_method,created_at,updated_at,external_reference,mp_payment_id,notes)
VALUES ('old-tie-b','Teste B','b@example.test','0','{}',20,20,'PIX','2026-01-02','2026-01-02','old-tie-b','mp-test-b','Nota B'),
('old-first','Teste Primeiro','first@example.test','0','{}',10,10,'PIX','2026-01-01','2026-01-01','old-first','mp-test-first','Nota Primeiro'),
('old-tie-a','Teste A','a@example.test','0','{}',15,15,'PIX','2026-01-02','2026-01-02','old-tie-a','mp-test-a','Nota A');
INSERT INTO order_items (id,order_id,product_name,quantity,unit_price,total) VALUES ('old-item','old-tie-b','Produto histórico',1,20,20);
INSERT INTO payments (id,order_id,provider,amount,txid,pix_copy_paste,qr_code_text,expires_at,updated_at)
VALUES ('old-payment','old-first','MOCK',10,'test-tx','test-pix','test-qr','2099-01-01',CURRENT_TIMESTAMP);
INSERT INTO shipment_labels (id,order_id,active_order_id,environment,service_id,fiscal_mode,package_json,declared_value,customer_shipping_value,updated_at,me_order_id,tracking_code)
VALUES ('old-label','old-tie-a','old-tie-a','sandbox',1,'DECLARATION','{}',15,0,CURRENT_TIMESTAMP,'test-me-order-id','test-tracking-code');
CREATE TABLE numbering_fixture_snapshot AS SELECT jsonb_build_object(
'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o),
'items',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM order_items o),
'payments',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM payments o),
'labels',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM shipment_labels o)
) AS value;
