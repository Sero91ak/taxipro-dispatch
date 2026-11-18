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
  PRIMARY KEY(id),
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
