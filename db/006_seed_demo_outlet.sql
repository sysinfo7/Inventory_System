-- Ensure both fictional locations exist, including when migration 004 skipped
-- Demo Store because an operator had already configured a different location.
-- Keep this idempotent and preserve every operator-configured location.
INSERT INTO locations (name)
SELECT 'Demo Store'
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE lower(trim(name)) = lower('Demo Store')
);

INSERT INTO locations (name)
SELECT 'Demo Outlet'
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE lower(trim(name)) = lower('Demo Outlet')
);
