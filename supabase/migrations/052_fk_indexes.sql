-- 052_fk_indexes.sql — covering indexes on the foreign keys flagged by the
-- Supabase performance advisor. Cheap + additive; speeds up the session-keyed
-- joins the floor brain and bill/close paths run.
CREATE INDEX IF NOT EXISTS idx_orders_session_id        ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_payments_session_id       ON payments(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_session_id       ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_waiter_calls_session_id   ON waiter_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_aggregator_orders_order_id ON aggregator_orders(order_id);
