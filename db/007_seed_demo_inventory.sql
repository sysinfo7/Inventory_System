-- Seed fictional retail products and sample ledger events for local demos.
-- The catalog and movement functions keep these writes on the audited paths.
-- Existing products and equivalent demo events are preserved on upgrade.
DO $$
DECLARE
  v_demo_store bigint;
  v_demo_outlet bigint;
  v_coffee bigint;
  v_trail_mix bigint;
  v_bottle bigint;
BEGIN
  SELECT id INTO v_demo_store FROM locations WHERE name = 'Demo Store';
  SELECT id INTO v_demo_outlet FROM locations WHERE lower(trim(name)) = 'demo outlet';
  IF v_demo_store IS NULL OR v_demo_outlet IS NULL THEN
    RAISE EXCEPTION 'Demo locations must exist before seeding demo inventory';
  END IF;

  SELECT id INTO v_coffee FROM products WHERE lower(trim(sku)) = lower('DEMO-COFFEE-001');
  IF v_coffee IS NULL THEN
    v_coffee := save_product(NULL, 'DEMO-COFFEE-001', 'Northstar Coffee Beans, 12 oz', NULL, 14.99, 5, TRUE,
      '71000000-0000-4000-8000-000000000001');
  END IF;

  SELECT id INTO v_trail_mix FROM products WHERE lower(trim(sku)) = lower('DEMO-SNACK-001');
  IF v_trail_mix IS NULL THEN
    v_trail_mix := save_product(NULL, 'DEMO-SNACK-001', 'Crisp Orchard Trail Mix, 8 oz', NULL, 6.49, 8, TRUE,
      '71000000-0000-4000-8000-000000000002');
  END IF;

  SELECT id INTO v_bottle FROM products WHERE lower(trim(sku)) = lower('DEMO-BOTTLE-001');
  IF v_bottle IS NULL THEN
    v_bottle := save_product(NULL, 'DEMO-BOTTLE-001', 'Summit Steel Water Bottle, 24 oz', NULL, 18.00, 3, TRUE,
      '71000000-0000-4000-8000-000000000003');
  END IF;

  -- Demo Outlet: coffee 12 received, 2 sold; trail mix 16 received, 3 sold.
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_coffee AND location_id = v_demo_outlet
    AND movement_type = 'receiving' AND reason = 'Demo setup - initial receiving') THEN
    PERFORM record_stock_movement(v_coffee, v_demo_outlet, 12, 'receiving', 'Demo setup - initial receiving', NULL,
      '72000000-0000-4000-8000-000000000001', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_coffee AND location_id = v_demo_outlet
    AND movement_type = 'sale' AND reason = 'Demo setup - sample sale') THEN
    PERFORM record_stock_movement(v_coffee, v_demo_outlet, -2, 'sale', 'Demo setup - sample sale', NULL,
      '72000000-0000-4000-8000-000000000002', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_trail_mix AND location_id = v_demo_outlet
    AND movement_type = 'receiving' AND reason = 'Demo setup - initial receiving') THEN
    PERFORM record_stock_movement(v_trail_mix, v_demo_outlet, 16, 'receiving', 'Demo setup - initial receiving', NULL,
      '72000000-0000-4000-8000-000000000003', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_trail_mix AND location_id = v_demo_outlet
    AND movement_type = 'sale' AND reason = 'Demo setup - sample sale') THEN
    PERFORM record_stock_movement(v_trail_mix, v_demo_outlet, -3, 'sale', 'Demo setup - sample sale', NULL,
      '72000000-0000-4000-8000-000000000004', NULL);
  END IF;

  -- Demo Store: coffee 8 received, 1 sold; bottles 10 received, 2 sold.
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_coffee AND location_id = v_demo_store
    AND movement_type = 'receiving' AND reason = 'Demo setup - initial receiving') THEN
    PERFORM record_stock_movement(v_coffee, v_demo_store, 8, 'receiving', 'Demo setup - initial receiving', NULL,
      '72000000-0000-4000-8000-000000000005', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_coffee AND location_id = v_demo_store
    AND movement_type = 'sale' AND reason = 'Demo setup - sample sale') THEN
    PERFORM record_stock_movement(v_coffee, v_demo_store, -1, 'sale', 'Demo setup - sample sale', NULL,
      '72000000-0000-4000-8000-000000000006', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_bottle AND location_id = v_demo_store
    AND movement_type = 'receiving' AND reason = 'Demo setup - initial receiving') THEN
    PERFORM record_stock_movement(v_bottle, v_demo_store, 10, 'receiving', 'Demo setup - initial receiving', NULL,
      '72000000-0000-4000-8000-000000000007', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id = v_bottle AND location_id = v_demo_store
    AND movement_type = 'sale' AND reason = 'Demo setup - sample sale') THEN
    PERFORM record_stock_movement(v_bottle, v_demo_store, -2, 'sale', 'Demo setup - sample sale', NULL,
      '72000000-0000-4000-8000-000000000008', NULL);
  END IF;
END $$;
