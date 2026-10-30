-- Only for pre-existing D1 v2.1 databases. Do not execute after new schema.sql.
CREATE TABLE IF NOT EXISTS recurring_orders (
 id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),driver_id TEXT NOT NULL REFERENCES users(id),
 start_date TEXT NOT NULL,end_date TEXT NOT NULL,weekdays TEXT NOT NULL,
 outbound_time TEXT NOT NULL,return_time TEXT,
 pickup TEXT NOT NULL,destination TEXT NOT NULL,kind TEXT NOT NULL,
 signature_required INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_dates ON recurring_orders(start_date,end_date);
ALTER TABLE rides ADD COLUMN recurring_order_id TEXT REFERENCES recurring_orders(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_dedup ON rides(recurring_order_id,ride_date,direction) WHERE recurring_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS shift_breaks (id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES shifts(id),driver_id TEXT NOT NULL REFERENCES users(id),started_at TEXT NOT NULL,ended_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_break ON shift_breaks(shift_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_break_shift ON shift_breaks(shift_id,started_at);
