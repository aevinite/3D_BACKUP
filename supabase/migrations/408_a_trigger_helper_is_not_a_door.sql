-- 408 — A TRIGGER HELPER HOLDS A GRANT IT CANNOT USE (2026-09-25)
--
-- Found by comparing the two databases' schema fingerprints after the 2026-09-25 release, which
-- is the first time that comparison has actually been RUN rather than left for later:
--
--     BACKUP   207/8c65bffc T77/c9957006 C989/b0ef8f38 open44 norls0
--     AV LIVE  207/8c65bffc T77/c9957006 C989/b0ef8f38 open43 norls0
--
-- Functions, tables and columns matched exactly. One thing did not: `open`, the count of lfh_
-- functions that `anon` or `authenticated` may EXECUTE. The difference was one function —
-- `lfh_session_delete_cleanup` — and the CLIENT database was the correct one.
--
-- ── WHY IT DRIFTED, AND WHY NOTHING SAW IT ──────────────────────────────────────────────────
-- It is a `RETURNS trigger` function. A trigger fires as part of the operation on its table;
-- PostgreSQL does not check EXECUTE on the trigger function when it runs, so the grant buys the
-- trigger nothing and only leaves the helper callable directly with the key that ships in every
-- guest's browser. Migration 374 revoked it — correctly — but FOUR migrations replace this
-- function (024, 146, 232, 267) and only 374 revokes, and a replaced function is PUBLIC-
-- executable again by default (the mig 038/267 lesson). Any run that re-applied an earlier one
-- after 374 re-opened it. AV live receives migrations once, in order, so it stayed correct;
-- backup, which has been re-seeded, did not.
--
-- `verify-db-grants.mjs` did not catch it because its allow-list HAS an entry for this function
-- ("trigger: the delete cleanup"), so the drift was permitted by the very check written to find
-- drift. Four more allow-list entries contradicted a migration the same way — all five are
-- trigger helpers, and the other four are already closed on both stacks, so the list was simply
-- stale. That file now refuses to allow anything the migrations end by revoking, which is the
-- durable half of this fix; this migration is the state half.
--
-- ── WHY THIS IS LAST-IN-ORDER AND NOT AN EDIT TO 374 ────────────────────────────────────────
-- Re-seeding replays every migration in filename order with no ledger. A revoke added to 024 or
-- 267 would be undone by the next file that replaces the function; a revoke in the NEWEST file
-- runs after all of them. Idempotent, so it costs nothing where the state is already correct.
--
-- ── HOW MUCH THIS ACTUALLY MATTERED, MEASURED RATHER THAN ASSUMED ───────────────────────────
-- Not much, and it is worth writing down so nobody re-tells this as something it was not. Every
-- function below is `RETURNS trigger`, and PostgreSQL refuses to invoke one of those by name.
-- Driven against the database, read-only:
--
--     SELECT lfh_set_topic_rid();
--     ERROR: 0A000: trigger functions can only be called as triggers
--
-- So the EXECUTE grant permitted calling something that cannot be called: real drift between the
-- two stacks, genuinely worth removing under least privilege, and no way in. The reason to fix
-- it is that a check which tolerates a grant nobody can explain will tolerate the next one too —
-- and the same allow-list entry hid a REAL difference between the databases for weeks.
--
-- All eleven are revoked here, not just the one that differed: the other ten sit in the same
-- allow-list under the same "trigger:" note, six of them open on BOTH stacks, and leaving those
-- would mean verify-db-grants.mjs stays red for a reason nobody intends to fix.

REVOKE ALL ON FUNCTION public.lfh_assign_kot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_assign_bill_on_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_rt_emit_cart() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_rt_emit_platform() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_set_topic_rid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_session_close_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_session_delete_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_sections_follow_table_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_clear_table_tag_on_close() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_dish_no() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fix_request_resolve_error() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
