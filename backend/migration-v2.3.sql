-- Für bestehende D1-Datenbank auf v2.2: einmalig ausführen. Nicht für neu initialisierte schema.sql verwenden.

-- Version 2.3: authenticated staff community, documented traffic observations,
-- controlled shift swaps and encrypted-at-rest private object storage metadata.
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
