-- v2 "Dining Session" ordering — SCHEMA (tables, columns, RLS, indexes).
-- Guest access to these tables happens ONLY via SECURITY DEFINER RPCs
-- (migration 015). The tables themselves are locked: RLS on, no public policies,
-- so the anon key cannot read/write them directly. The editor uses the
-- service-role key, which bypasses RLS, for management.

-- ── sessions: the open "tab" for a table while guests are seated ───────────
CREATE TABLE IF NOT EXISTS sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('open','closed','pending')),
  auto_approve     BOOLEAN NOT NULL DEFAULT true,
  opened_by        TEXT CHECK (opened_by IN ('waiter','guest')),
  opened_at        TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── session_members: phones in a session; token = the per-phone access pass ─
CREATE TABLE IF NOT EXISTS session_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  phone          TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  name           TEXT,
  token          TEXT UNIQUE NOT NULL,
  role           TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('owner','guest')),
  approved       BOOLEAN NOT NULL DEFAULT false,
  location_ok    BOOLEAN NOT NULL DEFAULT false,
  removed        BOOLEAN NOT NULL DEFAULT false,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── customers: returning-guest recognition + the source of blockable numbers ─
CREATE TABLE IF NOT EXISTS customers (
  phone         TEXT PRIMARY KEY,
  name          TEXT,
  blocked       BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── requests: queue for open/join/access when auto-flow can't decide ───────
CREATE TABLE IF NOT EXISTS requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number TEXT NOT NULL,
  session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  type         TEXT NOT NULL CHECK (type IN ('open','join','access')),
  name         TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── blocklist: block a phone, a table, or a specific member ────────────────
CREATE TABLE IF NOT EXISTS blocklist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT,
  table_number TEXT,
  member_id    UUID,
  reason       TEXT,
  blocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── otp_codes: one-time codes. The real WhatsApp/SMS SEND is external; until
--    it's wired, send_otp just stores a code (and dev-returns it). ──────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  consumed   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── order_items: per-item status. The merged session bill + waiter board read
--    these; the waiter advances each item received -> preparing -> served. ──
CREATE TABLE IF NOT EXISTS order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  qty        INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  options    JSONB,
  removed    TEXT[] NOT NULL DEFAULT '{}',
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','preparing','served')),
  served_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── extend existing tables (additive, backward-compatible) ─────────────────
ALTER TABLE orders       ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE waiter_calls ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE waiter_calls ADD COLUMN IF NOT EXISTS member_id  UUID;

-- settings: master toggles + location geofence — ALL editable from the editor.
-- sessions_enabled OFF by default => the app behaves exactly like today until
-- the owner turns the new system on. geo_* unset => location check is bypassed.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sessions_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_location BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_otp      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS geo_lat          DOUBLE PRECISION;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS geo_lng          DOUBLE PRECISION;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS geo_radius_m     INT NOT NULL DEFAULT 250;

-- ── RLS: lock every new table (no public policies). ───────────────────────
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocklist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items     ENABLE ROW LEVEL SECURITY;

-- ── indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_table_status ON sessions(table_number, status);
CREATE INDEX IF NOT EXISTS idx_members_session       ON session_members(session_id);
CREATE INDEX IF NOT EXISTS idx_members_token         ON session_members(token);
CREATE INDEX IF NOT EXISTS idx_requests_table_status ON requests(table_number, status);
CREATE INDEX IF NOT EXISTS idx_blocklist_phone       ON blocklist(phone);
CREATE INDEX IF NOT EXISTS idx_blocklist_table       ON blocklist(table_number);
CREATE INDEX IF NOT EXISTS idx_otp_phone             ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_order_items_order     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_session   ON order_items(session_id);

NOTIFY pgrst, 'reload schema';
