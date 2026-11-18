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

-- TaxiPro 2.4: canonical customer file, reliable calendar staging, sync and persistent UI.
-- IMPORTANT: Apply ONLY to an existing v2.3 database AFTER a backup.
-- A fresh install uses backend/schema.sql, which includes these tables.
CREATE TABLE IF NOT EXISTS customer_source_links (
  source TEXT NOT NULL CHECK(source IN ('master_sheet','google_contacts','manual')),
  source_account TEXT NOT NULL DEFAULT '',
  external_key TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(source,source_account,external_key)
);
CREATE INDEX IF NOT EXISTS idx_customer_source_customer ON customer_source_links(customer_id);

CREATE TABLE IF NOT EXISTS customer_case_status (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  billing_class TEXT NOT NULL DEFAULT 'unknown'
    CHECK(billing_class IN ('KTS','RE','private','unknown')),
  prescription_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(prescription_status IN ('unknown','present','missing','expired','not_required')),
  approval_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(approval_status IN ('unknown','pending','approved','rejected','expired','not_required')),
  copayment_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(copayment_status IN ('unknown','exempt','not_exempt')),
  approval_valid_until TEXT,
  prescription_valid_until TEXT,
  phone TEXT NOT NULL DEFAULT '',
  external_document_reference TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_routes (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 label TEXT NOT NULL,
 pickup TEXT NOT NULL DEFAULT '',
 destination TEXT NOT NULL DEFAULT '',
 billing_class TEXT NOT NULL DEFAULT 'unknown'
   CHECK(billing_class IN ('KTS','RE','private','unknown')),
 is_primary INTEGER NOT NULL DEFAULT 0,
 source TEXT NOT NULL DEFAULT 'manual',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_routes ON customer_routes(customer_id,active);

CREATE TABLE IF NOT EXISTS calendar_imports (
  id TEXT PRIMARY KEY,
  source_account TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  event_title TEXT NOT NULL,
  description_excerpt TEXT NOT NULL DEFAULT '',
  location_excerpt TEXT NOT NULL DEFAULT '',
  event_url TEXT NOT NULL DEFAULT '',
  source_color TEXT,
  source_updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
     CHECK(status IN ('confirmed','tentative','cancelled')),
  match_state TEXT NOT NULL DEFAULT 'review'
     CHECK(match_state IN ('review','matched','ignored')),
  customer_id TEXT REFERENCES customers(id),
  match_reason TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  UNIQUE(source_account,calendar_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_imports_time ON calendar_imports(start_at,status);
CREATE INDEX IF NOT EXISTS idx_calendar_imports_customer ON calendar_imports(customer_id,start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_imports_review ON calendar_imports(match_state,start_at);

CREATE TABLE IF NOT EXISTS journey_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  calendar_import_id TEXT UNIQUE REFERENCES calendar_imports(id),
  customer_route_id TEXT REFERENCES customer_routes(id),
  service_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'unknown'
    CHECK(direction IN ('hin','rueck','unknown')),
  billing_class TEXT NOT NULL DEFAULT 'unknown'
    CHECK(billing_class IN ('KTS','RE','private','unknown')),
  ride_status TEXT NOT NULL DEFAULT 'planned'
    CHECK(ride_status IN ('planned','reported','confirmed','cancelled')),
  operator_note TEXT NOT NULL DEFAULT '',
  driver_id TEXT REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer_date ON journey_ledger(customer_id,service_date);
CREATE INDEX IF NOT EXISTS idx_ledger_date_status ON journey_ledger(service_date,ride_status);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  source TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'unconfigured'
    CHECK(status IN ('unconfigured','running','ok','error')),
  last_error TEXT NOT NULL DEFAULT '',
  items_seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_display_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_source_evidence (
  source TEXT NOT NULL CHECK(source IN ('master_approval','master_prescription','master_copayment')),
  external_key TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  source_status TEXT NOT NULL DEFAULT '',
  valid_from TEXT,
  valid_until TEXT,
  document_in_drive INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(source,external_key)
);
CREATE INDEX IF NOT EXISTS idx_customer_source_evidence ON customer_source_evidence(customer_id,source);
