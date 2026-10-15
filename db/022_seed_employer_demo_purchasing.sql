-- Give a clean employer-demo database useful, entirely fictional purchasing
-- examples. The inactive service identity exists only to satisfy actor FKs;
-- it cannot sign in or perform application actions.
DO $$
DECLARE
  v_demo_actor uuid := '73000000-0000-4000-8000-000000000001';
  v_supplier_id bigint;
  v_store_id bigint;
  v_outlet_id bigint;
  v_bottle_id bigint;
  v_coffee_id bigint;
  v_received_order_id bigint;
  v_received_line_id bigint;
  v_open_order_id bigint;
  v_receipt_id bigint;
  v_movement_id bigint;
BEGIN
  INSERT INTO app_users(id,email,display_name,password_hash,role,active,password_change_required)
  VALUES (v_demo_actor,'demo-system@inventory-demo.invalid','Demo system (inactive)',
    'scrypt$00000000000000000000000000000000$' || repeat('00',64),'viewer',false,true)
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_supplier_id FROM suppliers
  WHERE lower(trim(name))=lower('Northstar Wholesale Supply');
  IF v_supplier_id IS NULL THEN
    INSERT INTO suppliers(name,created_by)
    VALUES ('Northstar Wholesale Supply',v_demo_actor)
    RETURNING id INTO v_supplier_id;
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,after_data)
    VALUES ('supplier',v_supplier_id,'insert',v_demo_actor,
      jsonb_build_object('name','Northstar Wholesale Supply','active',true));
  END IF;

  SELECT id INTO v_store_id FROM locations WHERE lower(trim(name))=lower('Demo Store');
  SELECT id INTO v_outlet_id FROM locations WHERE lower(trim(name))=lower('Demo Outlet');
  SELECT id INTO v_bottle_id FROM products WHERE lower(trim(sku))=lower('DEMO-BOTTLE-001');
  SELECT id INTO v_coffee_id FROM products WHERE lower(trim(sku))=lower('DEMO-COFFEE-001');
  IF v_store_id IS NULL OR v_outlet_id IS NULL OR v_bottle_id IS NULL OR v_coffee_id IS NULL THEN
    RAISE EXCEPTION 'Employer demo locations and products must be seeded before purchasing examples';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE notes='Employer demo fixture: completed bottle delivery') THEN
    INSERT INTO purchase_orders(supplier_id,location_id,expected_delivery_on,notes,created_by)
    VALUES (v_supplier_id,v_store_id,current_date,'Employer demo fixture: completed bottle delivery',v_demo_actor)
    RETURNING id INTO v_received_order_id;

    INSERT INTO purchase_order_lines(purchase_order_id,product_id,sku_snapshot,product_name_snapshot,ordered_quantity)
    SELECT v_received_order_id,id,sku,name,3 FROM products WHERE id=v_bottle_id
    RETURNING id INTO v_received_line_id;

    UPDATE purchase_orders SET status='submitted',supplier_name_snapshot='Northstar Wholesale Supply',
      location_name_snapshot='Demo Store',submitted_at=now()
    WHERE id=v_received_order_id;
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,after_data)
    VALUES ('purchase_order',v_received_order_id,'insert',v_demo_actor,
      jsonb_build_object('status','draft','supplierId',v_supplier_id,'locationId',v_store_id));
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
    VALUES ('purchase_order',v_received_order_id,'submit',v_demo_actor,jsonb_build_object('status','draft'),
      jsonb_build_object('status','submitted','supplierId',v_supplier_id,'locationId',v_store_id,
        'lines',jsonb_build_array(jsonb_build_object('productId',v_bottle_id,'quantity',3))));

    INSERT INTO purchase_receipts(purchase_order_id,request_id,actor_id,received_at,reference,note)
    VALUES (v_received_order_id,'73000000-0000-4000-8000-000000000002',v_demo_actor,
      now(),'DEMO-PACKING-SLIP-001','Fictional employer-demo receipt')
    RETURNING id INTO v_receipt_id;

    v_movement_id := public.record_stock_movement(v_bottle_id,v_store_id,3,'receiving',
      'Purchase order demo receipt',v_demo_actor,'73000000-0000-4000-8000-000000000003',NULL);

    INSERT INTO purchase_receipt_lines(purchase_order_id,receipt_id,purchase_order_line_id,quantity,stock_movement_id)
    VALUES (v_received_order_id,v_receipt_id,v_received_line_id,3,v_movement_id);
    UPDATE purchase_orders SET status='received',updated_at=now() WHERE id=v_received_order_id;
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,request_id,before_data,after_data)
    VALUES ('purchase_receipt',v_receipt_id,'receive',v_demo_actor,'73000000-0000-4000-8000-000000000002',
      jsonb_build_object('status','submitted'),
      jsonb_build_object('status','received','receiptId',v_receipt_id,
        'lines',jsonb_build_array(jsonb_build_object('lineId',v_received_line_id,'quantity',3))));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE notes='Employer demo fixture: open coffee replenishment') THEN
    INSERT INTO purchase_orders(supplier_id,location_id,expected_delivery_on,notes,created_by)
    VALUES (v_supplier_id,v_outlet_id,current_date+14,'Employer demo fixture: open coffee replenishment',v_demo_actor)
    RETURNING id INTO v_open_order_id;

    INSERT INTO purchase_order_lines(purchase_order_id,product_id,sku_snapshot,product_name_snapshot,ordered_quantity)
    SELECT v_open_order_id,id,sku,name,6 FROM products WHERE id=v_coffee_id;
    UPDATE purchase_orders SET status='submitted',supplier_name_snapshot='Northstar Wholesale Supply',
      location_name_snapshot='Demo Outlet',submitted_at=now() WHERE id=v_open_order_id;
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,after_data)
    VALUES ('purchase_order',v_open_order_id,'insert',v_demo_actor,
      jsonb_build_object('status','draft','supplierId',v_supplier_id,'locationId',v_outlet_id));
    INSERT INTO purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
    VALUES ('purchase_order',v_open_order_id,'submit',v_demo_actor,jsonb_build_object('status','draft'),
      jsonb_build_object('status','submitted','supplierId',v_supplier_id,'locationId',v_outlet_id,
        'lines',jsonb_build_array(jsonb_build_object('productId',v_coffee_id,'quantity',6))));
  END IF;
END $$;
