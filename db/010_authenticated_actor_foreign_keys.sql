-- Tie authenticated actor UUIDs to real application users while retaining NULL for
-- historical migration-seeded rows that predate sign-in.
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_actor_user_fk
  FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE RESTRICT;

ALTER TABLE inventory_audit_log
  ADD CONSTRAINT inventory_audit_actor_user_fk
  FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE RESTRICT;
