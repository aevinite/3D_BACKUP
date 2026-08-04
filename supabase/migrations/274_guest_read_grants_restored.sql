-- 274_guest_read_grants_restored.sql
--
-- THE GUEST MENU WAS RETURNING 500 ON THE BACKUP SITE, for every restaurant, before this.
-- Found 2026-08-04 while verifying an unrelated deploy; the fault is older than that deploy
-- and is NOT caused by it (the throw is the original `if (error) throw new Error("Failed to
-- load settings: …")` in lib/menu.ts, unchanged since the first commit).
--
-- THE FAULT: `settings` and `restaurants` each have a public SELECT **policy**
-- (`public_read_settings`, mig 003, and the equivalent on restaurants) but the anon role had
-- lost its SELECT **grant** on both. A row-level policy and a table grant are two different
-- gates and BOTH must pass — so a policy without the grant is a no-op, and PostgREST answers
-- `42501 permission denied for table settings` no matter what the policy says. The guest menu
-- reads both tables with the anon key, so it could not render at all.
--
-- Restoring exactly the read those policies were written to allow. Nothing else changes: RLS
-- stays ON, and the policies keep deciding WHICH rows are visible.
GRANT SELECT ON TABLE public.settings    TO anon, authenticated;
GRANT SELECT ON TABLE public.restaurants TO anon, authenticated;

-- ── DELIBERATELY NOT DONE HERE ───────────────────────────────────────────────────────────
-- The same audit turned up that anon also holds INSERT / UPDATE / DELETE / TRUNCATE on
-- `settings`, which is plainly backwards for a table the guest only needs to read. Those
-- grants are INERT today — RLS is enabled and the only policy on the table is the SELECT one,
-- so a write is refused by the policy check regardless of the grant. Because they change no
-- behaviour either way, tidying them is a separate, deliberate change for the owner to
-- approve rather than something to slip into a fix for a different problem.
--
-- Guarded from here on by scripts/verify-guest-read.mjs, which fails when a table carrying a
-- public read policy cannot actually be read — the exact shape of this fault.

NOTIFY pgrst, 'reload schema';
