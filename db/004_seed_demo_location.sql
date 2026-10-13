-- Give a fresh local demo database a location for its first stock movement.
-- Existing operator-configured locations are left untouched.
INSERT INTO locations (name)
SELECT 'Demo Store'
WHERE NOT EXISTS (SELECT 1 FROM locations);
