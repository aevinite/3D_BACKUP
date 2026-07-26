-- 210: permanent per-table QR codes (owner 2026-07-26).
--
-- Each table gets a private random code; the guest link becomes /q/<code> and the
-- server resolves the code to (restaurant, table). Because the table number is no
-- longer readable/editable in the link itself, typing a different value in the
-- address bar can only produce an invalid-code page — never another table's menu.
-- The code never changes (printed QR stickers stay valid forever) unless the admin
-- regenerates that one table's code from the restaurant-detail Settings tab.
CREATE TABLE IF NOT EXISTS table_qr_codes (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number  integer NOT NULL CHECK (table_number BETWEEN 1 AND 500),
  code          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, table_number)
);

-- The guest lookup path (/q/<code>) — one indexed single-row read per menu open.
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_qr_codes_code ON table_qr_codes (code);

-- Service-role only: RLS on with no policies. The browser (anon key) can never read
-- the code list; resolution + admin management happen in server route handlers.
ALTER TABLE table_qr_codes ENABLE ROW LEVEL SECURITY;
