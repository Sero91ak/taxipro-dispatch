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

-- Version 2.3: team and evidence data (new installations).
CREATE TABLE IF NOT EXISTS traffic_reports (
 id TEXT PRIMARY KEY,
 reporter_id TEXT NOT NULL REFERENCES users(id),
 category TEXT NOT NULL CHECK(category IN ('jam','accident','roadworks','closure','hazard')),
 road TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL,
 latitude REAL NOT NULL,
 longitude REAL NOT NULL,
 accuracy REAL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','withdrawn')),
 observed_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_active ON traffic_reports(status,expires_at,created_at);
CREATE INDEX IF NOT EXISTS idx_traffic_reporter ON traffic_reports(reporter_id,created_at);

CREATE TABLE IF NOT EXISTS shift_swap_requests (
 id TEXT PRIMARY KEY,
 ride_id TEXT NOT NULL REFERENCES rides(id),
 requester_id TEXT NOT NULL REFERENCES users(id),
 target_driver_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','declined','approved','rejected','cancelled')),
 created_at TEXT NOT NULL,
 responded_at TEXT,
 approved_at TEXT,
 approved_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_swap_status ON shift_swap_requests(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_open_per_ride ON shift_swap_requests(ride_id) WHERE status IN ('requested','accepted');

CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 recipient_id TEXT NOT NULL REFERENCES users(id),
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_recipients ON attachments(recipient_id,created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_owners ON attachments(owner_id,created_at);

CREATE TABLE IF NOT EXISTS ride_signatures (
 id TEXT PRIMARY KEY,
 driver_id TEXT NOT NULL REFERENCES users(id),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 signer_name TEXT NOT NULL,
 consent_text TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ride_signature_links (
 signature_id TEXT NOT NULL REFERENCES ride_signatures(id),
 ride_id TEXT NOT NULL UNIQUE REFERENCES rides(id),
 PRIMARY KEY(signature_id,ride_id)
);
CREATE INDEX IF NOT EXISTS idx_signatures_customer ON ride_signatures(customer_id,created_at);

CREATE TABLE IF NOT EXISTS attachment_pins (
 user_id TEXT NOT NULL REFERENCES users(id),
 attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
 pinned_at TEXT NOT NULL,
 PRIMARY KEY(user_id,attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_attachment_pin_order ON attachment_pins(user_id,pinned_at);
