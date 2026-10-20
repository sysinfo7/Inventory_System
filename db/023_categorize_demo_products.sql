-- Give the fictional employer-demo products normalized, reusable catalog categories.
-- The seed is idempotent by normalized category name and uses the audited product
-- update function so the catalog change remains visible in the audit trail.
BEGIN;

INSERT INTO categories(name)
SELECT requested.name
FROM (VALUES ('Coffee & Tea'), ('Snacks'), ('Drinkware')) AS requested(name)
WHERE NOT EXISTS (
  SELECT 1 FROM categories AS category
  WHERE lower(trim(category.name)) = lower(trim(requested.name))
);

DO $$
DECLARE
  v_coffee_category bigint;
  v_snacks_category bigint;
  v_drinkware_category bigint;
  v_product record;
BEGIN
  SELECT id INTO v_coffee_category FROM categories WHERE lower(trim(name)) = lower('Coffee & Tea');
  SELECT id INTO v_snacks_category FROM categories WHERE lower(trim(name)) = lower('Snacks');
  SELECT id INTO v_drinkware_category FROM categories WHERE lower(trim(name)) = lower('Drinkware');

  IF v_coffee_category IS NULL OR v_snacks_category IS NULL OR v_drinkware_category IS NULL THEN
    RAISE EXCEPTION 'Could not resolve all employer-demo product categories';
  END IF;

  FOR v_product IN
    SELECT id, sku, name, sale_price, reorder_point, active,
      CASE sku
        WHEN 'DEMO-COFFEE-001' THEN v_coffee_category
        WHEN 'DEMO-SNACK-001' THEN v_snacks_category
        WHEN 'DEMO-BOTTLE-001' THEN v_drinkware_category
      END AS category_id
    FROM products
    WHERE sku IN ('DEMO-COFFEE-001', 'DEMO-SNACK-001', 'DEMO-BOTTLE-001')
  LOOP
    PERFORM save_product(
      v_product.id, v_product.sku, v_product.name, v_product.category_id,
      v_product.sale_price, v_product.reorder_point, v_product.active, NULL::uuid
    );
  END LOOP;

  IF (SELECT count(*) FROM products WHERE sku IN (
      'DEMO-COFFEE-001', 'DEMO-SNACK-001', 'DEMO-BOTTLE-001'
    )) <> 3 THEN
    RAISE EXCEPTION 'Expected all three employer-demo products before applying categories';
  END IF;
END $$;

COMMIT;
