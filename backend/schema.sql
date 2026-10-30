-- TaxiPro Dispatch 2.0: Cloudflare D1 schema (SQLite dialect)
-- No patient documents, scanned prescriptions, signatures or raw passwords stored.
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','driver')),
 salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (
 id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, until_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 pickup TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL DEFAULT 'Rechnungsfahrt', signature_required INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rides (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 driver_id TEXT NOT NULL REFERENCES users(id),
 ride_date TEXT NOT NULL, ride_time TEXT NOT NULL,
 pickup TEXT NOT NULL, destination TEXT NOT NULL,
 kind TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('hin','rueck')),
 signature_required INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','accepted','done','cancelled')),
 assigned_at TEXT NOT NULL, accepted_at TEXT, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id,ride_date);
CREATE INDEX IF NOT EXISTS idx_rides_customer_day ON rides(customer_id,ride_date);
CREATE TABLE IF NOT EXISTS shifts (
 id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES users(id),
 started_at TEXT NOT NULL, ended_at TEXT,
 original_started_at TEXT, original_ended_at TEXT,
 adjusted_by TEXT, adjusted_at TEXT, adjustment_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_driver ON shifts(driver_id,started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift ON shifts(driver_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS positions (
 driver_id TEXT PRIMARY KEY REFERENCES users(id),
 latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL, reported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id),
 recipient_id TEXT REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(created_at);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL,
 event TEXT NOT NULL, entity_id TEXT, details TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit(created_at);

-- Version 2.1: revisions are append-only; the original shift is retained separately.
CREATE TABLE IF NOT EXISTS shift_adjustments (
 id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 previous_start TEXT NOT NULL, previous_end TEXT NOT NULL,
 new_start TEXT NOT NULL, new_end TEXT NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adjustments_shift ON shift_adjustments(shift_id,created_at);

-- Version 2.2: recurring service appointments and auditable working breaks.
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
CREATE TABLE IF NOT EXISTS shift_breaks (
 id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES shifts(id),
 driver_id TEXT NOT NULL REFERENCES users(id),
 started_at TEXT NOT NULL,ended_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_break ON shift_breaks(shift_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_break_shift ON shift_breaks(shift_id,started_at);
