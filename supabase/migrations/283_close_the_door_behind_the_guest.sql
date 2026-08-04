-- 283_close_the_door_behind_the_guest.sql
--
-- STAGE 2 of 2. Mig 282 built the doors (lfh_guest_settings / lfh_guest_restaurant) and the code
-- that walks through them shipped and was verified live: all nine active restaurants' menus render
-- 200, a binned one still 404s, and no file holding the anon key reads either table any more
-- (scripts/verify-guest-read.mjs asserts that statically).
--
-- So the table read the guest no longer uses can go. This is what actually closes sweep F9: until
-- now the anon key in every guest's browser could read EVERY restaurant's `settings` and
-- `restaurants` row WHOLE — gstin, phone, address, invoice prefix, and the entire Access &
-- permissions tree (measured: access_config came back as 5,140 bytes).
--
-- ── WHY THIS IS A SEPARATE MIGRATION, APPLIED AFTER THE DEPLOY ───────────────────────────────
-- Because the opposite order is exactly the outage. On 2026-08-04 a first attempt narrowed this
-- read by COLUMN while the deployed code still read the table directly, and every guest menu
-- answered 500. Migrations and code do not deploy together, so anything that takes a read AWAY
-- has to land after the code that stopped needing it — never in the same breath.
--
-- ── PROVEN BEFORE BEING APPLIED ─────────────────────────────────────────────────────────────
-- GRANT/REVOKE are transactional in Postgres, so exactly this pair of statements was run inside a
-- transaction that then became the `anon` role, confirmed both doors still open and both still
-- withhold the staff-only fields, and ROLLED BACK — with a follow-up read proving the grants were
-- left untouched. That is the check the first attempt never had.
--
-- ── AND THE POLICIES GO WITH THE GRANT ──────────────────────────────────────────────────────
-- A row-level policy and a table grant are two separate gates and BOTH must pass, so a policy
-- whose grant is gone does nothing at all — it is the dead switch this project deletes on sight,
-- and scripts/verify-guest-read.mjs fails on exactly that shape ("a read policy that cannot take
-- effect"). Dropping them keeps the state coherent: no grant, no policy, RLS still on, and
-- service_role still bypasses RLS so every staff and owner path is untouched.
--
-- ⚠️ ONE HONEST CONSEQUENCE. A guest tab opened BEFORE the deploy still holds the old JavaScript
-- and will try the direct read. It does not crash: lib/features.ts already treats an unreachable
-- settings read as "use the last-known switches, else the defaults", so such a tab degrades to
-- defaults and heals completely on its next reload. Every fresh page load uses the doors.

REVOKE SELECT ON TABLE public.settings    FROM anon, authenticated;
REVOKE SELECT ON TABLE public.restaurants FROM anon, authenticated;

DROP POLICY IF EXISTS public_read_settings    ON public.settings;
DROP POLICY IF EXISTS public_read_restaurants ON public.restaurants;

NOTIFY pgrst, 'reload schema';
