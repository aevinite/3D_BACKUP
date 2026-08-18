-- 336: WHICH SCREEN PRINTS THE KITCHEN TICKET — an ADMIN choice, confirmed once per device
-- (owner, 2026-08-17: "add autoprint in the manager panel — when you turn that on the ticket prints
--  there instead of the kitchen", because the kitchen has no room for a PC and the printer lives at
--  the counter, where the staff also need the MANAGER panel on screen for billing.)
--
-- mig 335 made a ticket a ROW that any screen can claim. This says WHO is allowed to claim it.
--
-- WHY IT IS AN ADMIN SETTING AND NOT A CONTROL IN THE MANAGER PANEL. The first build put a
-- three-way switch in the manager panel's Settings → Kitchen printing. That section is hidden from
-- EVERYONE in that panel on purpose — owner and admin included (owner, 2026-07-31, looking at the
-- greyed rows: *"there shouldn't be grayed out option also"*); billing, KOT printing and dining
-- sessions are edited in the admin console. So the switch was unreachable, which is how it was
-- found. It belongs where its two siblings already live: /aevinite → the restaurant → 🖨 KOT
-- printing, next to the entitlement that turns auto-print on at all (mig 107).
--
--   'kitchen'  (default) — only a kitchen screen prints. Nothing changes for anyone.
--   'counter'  — only a manager/counter screen prints. For a kitchen with no computer in it.
--   'both'     — the kitchen prints, and a counter screen prints anything the kitchen has not
--                printed within 30 seconds (the backup printer; the 30s is enforced at the claim in
--                lib/printQueue.ts, never trusted to a browser).
--
-- A SECOND GATE LIVES ON THE DEVICE, and it is not optional: the manager panel is also opened on
-- PHONES. A phone that claimed a ticket would "print" it into a dialog nobody sees and report it
-- done — a lost ticket, caused by the feature meant to save it. So a counter-printing restaurant
-- asks each manager device once, on its floor screen, and only a device that has answered YES ever
-- claims (public/panels/editor/app.js → the print-station strip). Default: no.
--
-- NOT a ladder column (no _allowed/_owner_control/_enabled/tablet_ suffix), so it does not widen the
-- module shape verify:settings-columns guards — it is one text answer belonging to an existing
-- feature, the same way tax_label or invoice_prefix belong to billing.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS kot_print_target text NOT NULL DEFAULT 'kitchen';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_kot_print_target_chk'
  ) THEN
    ALTER TABLE settings
      ADD CONSTRAINT settings_kot_print_target_chk
      CHECK (kot_print_target IN ('kitchen', 'counter', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN settings.kot_print_target IS
  'Which screen may claim a KOT print job (mig 336): kitchen | counter | both. Set in the admin console; a counter device must also confirm once on its own floor screen.';
