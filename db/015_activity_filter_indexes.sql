-- Support newest-first activity listings and actor-filtered history scans.
CREATE INDEX IF NOT EXISTS stock_movements_occurred_time
  ON stock_movements(occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS stock_movements_actor_time
  ON stock_movements(actor_id, occurred_at DESC, id DESC)
  WHERE actor_id IS NOT NULL;
