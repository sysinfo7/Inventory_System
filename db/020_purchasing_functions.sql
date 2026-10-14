-- Draft line writes are allowed only while their owning order is a draft.
CREATE OR REPLACE FUNCTION guard_purchase_order_line_draft()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_order_id bigint;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_order_id := OLD.purchase_order_id; ELSE v_order_id := NEW.purchase_order_id; END IF;
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_order_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Purchase-order lines can be changed only while the order is a draft';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
    RAISE EXCEPTION 'A purchase-order line cannot be moved to a different order';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER purchase_order_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION guard_purchase_order_line_draft();

CREATE OR REPLACE FUNCTION reject_purchasing_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Purchasing receipt and audit history is append-only';
END;
$$;
CREATE TRIGGER purchase_receipts_immutable BEFORE UPDATE OR DELETE ON purchase_receipts
FOR EACH ROW EXECUTE FUNCTION reject_purchasing_history_mutation();
CREATE TRIGGER purchase_receipt_lines_immutable BEFORE UPDATE OR DELETE ON purchase_receipt_lines
FOR EACH ROW EXECUTE FUNCTION reject_purchasing_history_mutation();
CREATE TRIGGER purchasing_audit_immutable BEFORE UPDATE OR DELETE ON purchasing_audit_log
FOR EACH ROW EXECUTE FUNCTION reject_purchasing_history_mutation();
CREATE TRIGGER purchase_receipts_no_truncate BEFORE TRUNCATE ON purchase_receipts
FOR EACH STATEMENT EXECUTE FUNCTION reject_purchasing_history_mutation();
CREATE TRIGGER purchase_receipt_lines_no_truncate BEFORE TRUNCATE ON purchase_receipt_lines
FOR EACH STATEMENT EXECUTE FUNCTION reject_purchasing_history_mutation();
CREATE TRIGGER purchasing_audit_no_truncate BEFORE TRUNCATE ON purchasing_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION reject_purchasing_history_mutation();

CREATE OR REPLACE FUNCTION assert_purchasing_actor(p_actor_id uuid, p_capability text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_role text;
BEGIN
  IF p_capability IS NULL OR p_capability NOT IN ('write','manage','receive') THEN
    RAISE EXCEPTION 'Unknown purchasing capability';
  END IF;
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'A signed-in actor is required'; END IF;
  SELECT role INTO v_role FROM public.app_users WHERE id = p_actor_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'The signed-in actor is inactive or unavailable'; END IF;
  IF (p_capability = 'write' AND v_role NOT IN ('admin','manager'))
     OR (p_capability = 'manage' AND v_role <> 'admin')
     OR (p_capability = 'receive' AND v_role NOT IN ('admin','manager','clerk')) THEN
    RAISE EXCEPTION 'The signed-in role is not permitted to perform this purchasing action';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION save_supplier(
  p_supplier_id bigint,
  p_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_actor_id uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_name text;
  v_contact text;
  v_email text;
  v_phone text;
  v_notes text;
  v_id bigint;
  v_before jsonb;
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id, 'write');
  v_name := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_contact := nullif(regexp_replace(btrim(coalesce(p_contact_name,'')), '\s+', ' ', 'g'), '');
  v_email := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_phone := nullif(btrim(coalesce(p_phone,'')), '');
  v_notes := nullif(btrim(coalesce(p_notes,'')), '');
  IF length(v_name) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Supplier name must contain 1 to 160 characters'; END IF;
  IF v_contact IS NOT NULL AND length(v_contact) > 120 THEN RAISE EXCEPTION 'Contact name must be at most 120 characters'; END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Enter a valid supplier email address';
  END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 40 THEN RAISE EXCEPTION 'Phone must be at most 40 characters'; END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 500 THEN RAISE EXCEPTION 'Supplier notes must be at most 500 characters'; END IF;

  IF p_supplier_id IS NULL THEN
    INSERT INTO public.suppliers(name,contact_name,email,phone,notes,created_by)
    VALUES (v_name,v_contact,v_email,v_phone,v_notes,p_actor_id) RETURNING id INTO v_id;
    INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,after_data)
    VALUES ('supplier',v_id,'insert',p_actor_id,jsonb_build_object('name',v_name,'active',true));
  ELSE
    SELECT jsonb_build_object('name',name,'active',active) INTO v_before
    FROM public.suppliers WHERE id=p_supplier_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier was not found'; END IF;
    UPDATE public.suppliers SET name=v_name,contact_name=v_contact,email=v_email,phone=v_phone,notes=v_notes,updated_at=clock_timestamp()
    WHERE id=p_supplier_id RETURNING id INTO v_id;
    INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
    VALUES ('supplier',v_id,'update',p_actor_id,v_before,jsonb_build_object('name',v_name,'active',(v_before->>'active')::boolean));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_supplier_active(p_supplier_id bigint,p_active boolean,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_before jsonb; v_name text;
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id,'manage');
  IF p_active IS NULL THEN RAISE EXCEPTION 'Supplier status is required'; END IF;
  SELECT jsonb_build_object('name',name,'active',active),name INTO v_before,v_name
  FROM public.suppliers WHERE id=p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier was not found'; END IF;
  IF (v_before->>'active')::boolean IS DISTINCT FROM p_active THEN
    UPDATE public.suppliers SET active=p_active,updated_at=clock_timestamp() WHERE id=p_supplier_id;
    INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
    VALUES ('supplier',p_supplier_id,CASE WHEN p_active THEN 'reactivate' ELSE 'deactivate' END,p_actor_id,v_before,
      jsonb_build_object('name',v_name,'active',p_active));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION save_purchase_order(
  p_order_id bigint,
  p_supplier_id bigint,
  p_location_id bigint,
  p_expected_delivery_on date,
  p_notes text,
  p_lines jsonb,
  p_actor_id uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_order_id bigint;
  v_status text;
  v_supplier_active boolean;
  v_before jsonb;
  v_line jsonb;
  v_product_id bigint;
  v_quantity bigint;
  v_product_sku text;
  v_product_name text;
  v_seen bigint[] := ARRAY[]::bigint[];
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id,'write');
  IF p_supplier_id IS NULL OR p_supplier_id <= 0 OR p_location_id IS NULL OR p_location_id <= 0 THEN
    RAISE EXCEPTION 'Choose a supplier and delivery location';
  END IF;
  IF p_expected_delivery_on IS NOT NULL AND p_expected_delivery_on < current_date THEN
    RAISE EXCEPTION 'Expected delivery date cannot be in the past';
  END IF;
  IF p_notes IS NOT NULL AND length(btrim(p_notes)) > 500 THEN RAISE EXCEPTION 'Order notes must be at most 500 characters'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Order lines must be supplied as a JSON array';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'An order needs between 1 and 100 product lines';
  END IF;

  -- Lock supplier before checking status so deactivation cannot race order save.
  SELECT active INTO v_supplier_active FROM public.suppliers WHERE id=p_supplier_id FOR SHARE;
  IF NOT FOUND OR NOT v_supplier_active THEN RAISE EXCEPTION 'Choose an active supplier'; END IF;
  PERFORM 1 FROM public.locations WHERE id=p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an available delivery location'; END IF;

  IF p_order_id IS NULL THEN
    INSERT INTO public.purchase_orders(supplier_id,location_id,expected_delivery_on,notes,created_by)
    VALUES (p_supplier_id,p_location_id,p_expected_delivery_on,nullif(btrim(coalesce(p_notes,'')),''),p_actor_id)
    RETURNING id INTO v_order_id;
  ELSE
    SELECT status,jsonb_build_object('supplierId',supplier_id,'locationId',location_id,'expectedDeliveryOn',expected_delivery_on,'status',status)
    INTO v_status,v_before FROM public.purchase_orders WHERE id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order was not found'; END IF;
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'Only a draft purchase order can be edited'; END IF;
    UPDATE public.purchase_orders SET supplier_id=p_supplier_id,location_id=p_location_id,
      expected_delivery_on=p_expected_delivery_on,notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=clock_timestamp()
    WHERE id=p_order_id;
    v_order_id := p_order_id;
    DELETE FROM public.purchase_order_lines WHERE purchase_order_id=v_order_id;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) AS lines(value) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'Each order line must be a JSON object';
    END IF;
    IF jsonb_object_length(v_line) <> 2
       OR NOT (v_line ? 'productId') OR NOT (v_line ? 'quantity')
       OR coalesce(v_line->>'productId','') !~ '^[1-9][0-9]{0,18}$'
       OR coalesce(v_line->>'quantity','') !~ '^[1-9][0-9]{0,18}$' THEN
      RAISE EXCEPTION 'Each line needs a valid productId and positive whole-unit quantity';
    END IF;
    IF length(v_line->>'productId')=19 AND (v_line->>'productId') > '9223372036854775807' THEN RAISE EXCEPTION 'Product id is out of range'; END IF;
    IF length(v_line->>'quantity')=19 AND (v_line->>'quantity') > '9223372036854775807' THEN RAISE EXCEPTION 'Line quantity is out of range'; END IF;
    v_product_id := (v_line->>'productId')::bigint;
    v_quantity := (v_line->>'quantity')::bigint;
    IF v_product_id=ANY(v_seen) THEN RAISE EXCEPTION 'A product can appear only once on an order'; END IF;
    v_seen := array_append(v_seen,v_product_id);
    SELECT sku,name INTO v_product_sku,v_product_name FROM public.products WHERE id=v_product_id AND active=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Every order product must be active and available'; END IF;
    INSERT INTO public.purchase_order_lines(purchase_order_id,product_id,sku_snapshot,product_name_snapshot,ordered_quantity)
    VALUES (v_order_id,v_product_id,v_product_sku,v_product_name,v_quantity);
  END LOOP;

  INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
  VALUES ('purchase_order',v_order_id,CASE WHEN p_order_id IS NULL THEN 'insert' ELSE 'update' END,p_actor_id,v_before,
    jsonb_build_object('supplierId',p_supplier_id,'locationId',p_location_id,'status','draft',
      'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'quantity',ordered_quantity) ORDER BY product_id),'[]'::jsonb)
               FROM public.purchase_order_lines WHERE purchase_order_id=v_order_id)));
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION submit_purchase_order(p_order_id bigint,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_before jsonb;
  v_supplier_id bigint;
  v_active boolean;
  v_product_id bigint;
  v_product_sku text;
  v_product_name text;
  v_supplier_name text;
  v_location_name text;
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id,'write');
  SELECT jsonb_build_object('status',status),supplier_id INTO v_before,v_supplier_id
  FROM public.purchase_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order was not found'; END IF;
  IF v_before->>'status' <> 'draft' THEN RAISE EXCEPTION 'Only a draft purchase order can be submitted'; END IF;
  SELECT active,name INTO v_active,v_supplier_name FROM public.suppliers WHERE id=v_supplier_id FOR SHARE;
  IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'The supplier is inactive; choose an active supplier before submission'; END IF;
  SELECT name INTO v_location_name FROM public.locations
  WHERE id=(SELECT location_id FROM public.purchase_orders WHERE id=p_order_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'The delivery location is unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE purchase_order_id=p_order_id) THEN
    RAISE EXCEPTION 'An order needs at least one product line';
  END IF;
  FOR v_product_id IN SELECT product_id FROM public.purchase_order_lines WHERE purchase_order_id=p_order_id ORDER BY product_id LOOP
    SELECT sku,name INTO v_product_sku,v_product_name FROM public.products WHERE id=v_product_id AND active=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Every submitted product must still be active'; END IF;
    UPDATE public.purchase_order_lines SET sku_snapshot=v_product_sku,product_name_snapshot=v_product_name
    WHERE purchase_order_id=p_order_id AND product_id=v_product_id;
  END LOOP;
  UPDATE public.purchase_orders SET status='submitted',submitted_at=clock_timestamp(),updated_at=clock_timestamp(),
    supplier_name_snapshot=v_supplier_name,location_name_snapshot=v_location_name WHERE id=p_order_id;
  INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
  VALUES ('purchase_order',p_order_id,'submit',p_actor_id,v_before,jsonb_build_object('status','submitted',
    'supplierName',v_supplier_name,'locationName',v_location_name,
    'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku_snapshot,'name',product_name_snapshot,'quantity',ordered_quantity) ORDER BY product_id),'[]'::jsonb)
      FROM public.purchase_order_lines WHERE purchase_order_id=p_order_id)));
END;
$$;

CREATE OR REPLACE FUNCTION cancel_purchase_order(p_order_id bigint,p_reason text,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_status text; v_remaining bigint; v_before jsonb;
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id,'write');
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'A cancellation reason of 1 to 300 characters is required'; END IF;
  SELECT status,jsonb_build_object('status',status) INTO v_status,v_before
  FROM public.purchase_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order was not found'; END IF;
  IF v_status NOT IN ('draft','submitted','partially_received') THEN RAISE EXCEPTION 'This purchase order cannot be cancelled'; END IF;
  SELECT coalesce(sum(lines.ordered_quantity - coalesce(received.quantity,0)),0)::bigint INTO v_remaining
  FROM public.purchase_order_lines AS lines
  LEFT JOIN LATERAL (SELECT sum(quantity)::bigint AS quantity FROM public.purchase_receipt_lines WHERE purchase_order_line_id=lines.id) AS received ON true
  WHERE lines.purchase_order_id=p_order_id;
  UPDATE public.purchase_orders SET status='cancelled',cancelled_at=clock_timestamp(),cancel_reason=btrim(p_reason),updated_at=clock_timestamp()
  WHERE id=p_order_id;
  INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,before_data,after_data)
  VALUES ('purchase_order',p_order_id,'cancel',p_actor_id,v_before,jsonb_build_object('status','cancelled','cancelReason',btrim(p_reason),'remainingUnitsCancelled',v_remaining));
END;
$$;

CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_order_id bigint,
  p_lines jsonb,
  p_reference text,
  p_note text,
  p_request_id uuid,
  p_actor_id uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_receipt_id bigint;
  v_order_status text;
  v_order_number text;
  v_location_id bigint;
  v_line jsonb;
  v_line_id bigint;
  v_quantity bigint;
  v_ordered bigint;
  v_received bigint;
  v_product_id bigint;
  v_product_active boolean;
  v_existing_order bigint;
  v_existing_actor uuid;
  v_existing_reference text;
  v_existing_note text;
  v_movement_id bigint;
  v_movement_request uuid;
  v_receipt_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_receipt_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_canonical jsonb := '[]'::jsonb;
  v_existing_lines jsonb;
  v_seen bigint[] := ARRAY[]::bigint[];
  v_before jsonb;
  v_after jsonb;
  v_all_received boolean;
BEGIN
  PERFORM public.assert_purchasing_actor(p_actor_id,'receive');
  IF p_order_id IS NULL OR p_order_id <= 0 THEN RAISE EXCEPTION 'Choose a valid purchase order'; END IF;
  IF p_request_id IS NULL OR p_request_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'A version-4 receipt request id is required'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Receipt lines must be supplied as a JSON array';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A receipt needs between 1 and 100 product lines';
  END IF;
  IF v_receipt_reference IS NOT NULL AND length(v_receipt_reference)>80 THEN RAISE EXCEPTION 'Receipt reference must be at most 80 characters'; END IF;
  IF v_receipt_note IS NOT NULL AND length(v_receipt_note)>300 THEN RAISE EXCEPTION 'Receipt note must be at most 300 characters'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) AS lines(value) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'Each receipt line must be a JSON object';
    END IF;
    IF jsonb_object_length(v_line) <> 2
       OR NOT (v_line ? 'lineId') OR NOT (v_line ? 'quantity')
       OR coalesce(v_line->>'lineId','') !~ '^[1-9][0-9]{0,18}$'
       OR coalesce(v_line->>'quantity','') !~ '^[1-9][0-9]{0,18}$' THEN
      RAISE EXCEPTION 'Each receipt line needs a valid lineId and positive whole-unit quantity';
    END IF;
    IF length(v_line->>'lineId')=19 AND (v_line->>'lineId') > '9223372036854775807' THEN RAISE EXCEPTION 'Order-line id is out of range'; END IF;
    IF length(v_line->>'quantity')=19 AND (v_line->>'quantity') > '9223372036854775807' THEN RAISE EXCEPTION 'Receipt quantity is out of range'; END IF;
    v_line_id := (v_line->>'lineId')::bigint;
    v_quantity := (v_line->>'quantity')::bigint;
    IF v_line_id=ANY(v_seen) THEN RAISE EXCEPTION 'A receipt may list each order line only once'; END IF;
    v_seen := array_append(v_seen,v_line_id);
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_object('lineId',v_line_id,'quantity',v_quantity));
  END LOOP;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'lineId')::bigint),'[]'::jsonb) INTO v_canonical
  FROM jsonb_array_elements(v_canonical) AS items(item);

  -- Serialize retries of one logical receipt before reading its prior outcome.
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receipt:' || p_request_id::text, 0));
  SELECT id,purchase_order_id,actor_id,reference,note INTO v_receipt_id,v_existing_order,v_existing_actor,v_existing_reference,v_existing_note
  FROM public.purchase_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',purchase_order_line_id,'quantity',quantity) ORDER BY purchase_order_line_id),'[]'::jsonb)
    INTO v_existing_lines FROM public.purchase_receipt_lines WHERE receipt_id=v_receipt_id;
    IF v_existing_order IS DISTINCT FROM p_order_id OR v_existing_actor IS DISTINCT FROM p_actor_id
       OR v_existing_reference IS DISTINCT FROM nullif(btrim(coalesce(p_reference,'')),'')
       OR v_existing_note IS DISTINCT FROM nullif(btrim(coalesce(p_note,'')),'')
       OR v_existing_lines IS DISTINCT FROM v_canonical THEN
      RAISE EXCEPTION 'Receipt request id was already used for different details';
    END IF;
    RETURN v_receipt_id;
  END IF;
  SELECT status,order_number,location_id INTO v_order_status,v_order_number,v_location_id
  FROM public.purchase_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order was not found'; END IF;
  IF v_order_status NOT IN ('submitted','partially_received') THEN RAISE EXCEPTION 'This purchase order is not open for receiving'; END IF;

  -- Parent order lock serializes all receipt transactions for this order.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_canonical) AS lines(value) ORDER BY (value->>'lineId')::bigint LOOP
    v_line_id := (v_line->>'lineId')::bigint;
    v_quantity := (v_line->>'quantity')::bigint;
    SELECT ordered_quantity,product_id INTO v_ordered,v_product_id
    FROM public.purchase_order_lines WHERE id=v_line_id AND purchase_order_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A receipt line does not belong to this purchase order'; END IF;
    SELECT coalesce(sum(quantity),0)::bigint INTO v_received FROM public.purchase_receipt_lines WHERE purchase_order_line_id=v_line_id;
    IF v_quantity > v_ordered-v_received THEN RAISE EXCEPTION 'Receipt quantity exceeds the remaining order quantity'; END IF;
    SELECT active INTO v_product_active FROM public.products WHERE id=v_product_id FOR SHARE;
    IF NOT FOUND OR NOT v_product_active THEN RAISE EXCEPTION 'An inactive product cannot be received'; END IF;
  END LOOP;

  v_before := jsonb_build_object('status',v_order_status);
  INSERT INTO public.purchase_receipts(purchase_order_id,request_id,actor_id,reference,note)
  VALUES (p_order_id,p_request_id,p_actor_id,v_receipt_reference,v_receipt_note) RETURNING id INTO v_receipt_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_canonical) AS lines(value) ORDER BY (value->>'lineId')::bigint LOOP
    v_line_id := (v_line->>'lineId')::bigint;
    v_quantity := (v_line->>'quantity')::bigint;
    SELECT product_id INTO v_product_id FROM public.purchase_order_lines WHERE id=v_line_id AND purchase_order_id=p_order_id;
    v_movement_request := gen_random_uuid();
    v_movement_id := public.record_stock_movement(v_product_id,v_location_id,v_quantity,'receiving',
      'Purchase order ' || v_order_number || ' receipt ' || v_receipt_id,p_actor_id,v_movement_request,NULL);
    INSERT INTO public.purchase_receipt_lines(purchase_order_id,receipt_id,purchase_order_line_id,quantity,stock_movement_id)
    VALUES (p_order_id,v_receipt_id,v_line_id,v_quantity,v_movement_id);
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_lines AS lines
    WHERE lines.purchase_order_id=p_order_id
      AND lines.ordered_quantity > coalesce((SELECT sum(receipt_lines.quantity) FROM public.purchase_receipt_lines AS receipt_lines
        WHERE receipt_lines.purchase_order_line_id=lines.id),0)
  ) INTO v_all_received;
  UPDATE public.purchase_orders SET status=CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END,
    updated_at=clock_timestamp() WHERE id=p_order_id;
  v_after := jsonb_build_object('status',CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END,
    'receiptId',v_receipt_id,'lines',v_canonical);
  INSERT INTO public.purchasing_audit_log(entity_type,entity_id,action,actor_id,request_id,before_data,after_data)
  VALUES ('purchase_receipt',v_receipt_id,'receive',p_actor_id,p_request_id,v_before,v_after);
  RETURN v_receipt_id;
END;
$$;

-- All new routines run under the narrowly privileged function owner. The runtime
-- role reads records but cannot directly mutate supplier/order/receipt tables.
GRANT SELECT,INSERT,UPDATE ON suppliers,purchase_orders TO inventory_function_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON purchase_order_lines TO inventory_function_owner;
GRANT SELECT,INSERT ON purchase_receipts,purchase_receipt_lines TO inventory_function_owner;
GRANT DELETE ON purchase_order_lines TO inventory_function_owner;
GRANT INSERT ON purchasing_audit_log TO inventory_function_owner;
GRANT SELECT (id,role,active) ON app_users TO inventory_function_owner;
GRANT SELECT ON locations TO inventory_function_owner;
GRANT USAGE,SELECT ON SEQUENCE purchase_order_number_seq,suppliers_id_seq,purchase_orders_id_seq,
  purchase_order_lines_id_seq,purchase_receipts_id_seq,purchase_receipt_lines_id_seq,purchasing_audit_log_id_seq
  TO inventory_function_owner;
REVOKE ALL ON SEQUENCE purchase_order_number_seq,suppliers_id_seq,purchase_orders_id_seq,
  purchase_order_lines_id_seq,purchase_receipts_id_seq,purchase_receipt_lines_id_seq,purchasing_audit_log_id_seq
  FROM PUBLIC,inventory_app;
REVOKE ALL ON suppliers,purchase_orders,purchase_order_lines,purchase_receipts,purchase_receipt_lines,purchasing_audit_log FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION guard_purchase_order_line_draft() FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION reject_purchasing_history_mutation() FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION assert_purchasing_actor(uuid,text) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION save_supplier(bigint,text,text,text,text,text,uuid) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION set_supplier_active(bigint,boolean,uuid) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION save_purchase_order(bigint,bigint,bigint,date,text,jsonb,uuid) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION submit_purchase_order(bigint,uuid) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION cancel_purchase_order(bigint,text,uuid) FROM PUBLIC,inventory_app;
REVOKE ALL ON FUNCTION receive_purchase_order(bigint,jsonb,text,text,uuid,uuid) FROM PUBLIC,inventory_app;
ALTER FUNCTION assert_purchasing_actor(uuid,text) OWNER TO inventory_function_owner;
ALTER FUNCTION save_supplier(bigint,text,text,text,text,text,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION set_supplier_active(bigint,boolean,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION save_purchase_order(bigint,bigint,bigint,date,text,jsonb,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION submit_purchase_order(bigint,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION cancel_purchase_order(bigint,text,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION receive_purchase_order(bigint,jsonb,text,text,uuid,uuid) OWNER TO inventory_function_owner;
ALTER FUNCTION assert_purchasing_actor(uuid,text) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION save_supplier(bigint,text,text,text,text,text,uuid) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION set_supplier_active(bigint,boolean,uuid) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION save_purchase_order(bigint,bigint,bigint,date,text,jsonb,uuid) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION submit_purchase_order(bigint,uuid) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION cancel_purchase_order(bigint,text,uuid) SET search_path = pg_catalog,public,pg_temp;
ALTER FUNCTION receive_purchase_order(bigint,jsonb,text,text,uuid,uuid) SET search_path = pg_catalog,public,pg_temp;
GRANT EXECUTE ON FUNCTION save_supplier(bigint,text,text,text,text,text,uuid) TO inventory_app;
GRANT EXECUTE ON FUNCTION set_supplier_active(bigint,boolean,uuid) TO inventory_app;
GRANT EXECUTE ON FUNCTION save_purchase_order(bigint,bigint,bigint,date,text,jsonb,uuid) TO inventory_app;
GRANT EXECUTE ON FUNCTION submit_purchase_order(bigint,uuid) TO inventory_app;
GRANT EXECUTE ON FUNCTION cancel_purchase_order(bigint,text,uuid) TO inventory_app;
GRANT EXECUTE ON FUNCTION receive_purchase_order(bigint,jsonb,text,text,uuid,uuid) TO inventory_app;
GRANT SELECT ON suppliers,purchase_orders,purchase_order_lines,purchase_receipts,purchase_receipt_lines,purchasing_audit_log TO inventory_app;
