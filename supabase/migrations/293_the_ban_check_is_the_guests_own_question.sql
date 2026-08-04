-- 293 — THE BAN CHECK IS THE GUEST'S OWN QUESTION (integrating migs 290 and 291)
--
-- TWO MIGRATIONS DISAGREED ABOUT ONE FUNCTION, AND THE LATER NUMBER WON.
--
-- Mig 290 (guest sweep) restored `lfh_check_ban` and granted it to anon, because
-- `components/BanGate.tsx` → `lib/session.ts:203` calls it from the GUEST's browser on every
-- menu load: it is how a blocked diner is shown the "You've been blocked" card, and with it the
-- "leave your number and ask a member of staff" appeal box.
--
-- Mig 291:88-96 then revoked it from anon, in a block that says so plainly:
--     "a ban-checking function is staff-only — a guest browser has no business calling it"
--     "It is not my change and it deserves its own migration"
-- That reasoning was sound from where they stood: `verify:grants` was RED on main for this
-- function, and mig 038's gotcha ("a new Postgres function is PUBLIC-executable by default") is
-- exactly the trap they were closing. What their checkout could not see was the ANON_ALLOWED
-- entry landing in the same window, which is what turns this from an unexplained grant into a
-- written-down one.
--
-- The premise is the part that was wrong: a guest browser IS the only caller. Because 291 sorts
-- after 290, a full reseed leaves the guest's ban check un-callable, the RPC answers 401, and the
-- wall silently never appears again — the very fault mig 290 existed to fix.
--
-- BOTH INTENTIONS SURVIVE HERE:
--   · theirs — nothing sits anon-callable on main without a reason anyone can read. The reason is
--     in scripts/verify-db-grants.mjs (ANON_ALLOWED) and in this file, so the guard is GREEN
--     because the grant is DECLARED, not because the grant is gone.
--   · mine — the guest's own browser can ask the one question it is entitled to ask.
--
-- WHY anon IS CORRECT AND NARROW HERE, unlike the staff functions mig 267/038/287 locked down:
-- it is SECURITY DEFINER but answers ONLY about the calling device's own device id / phone; it
-- returns no other guest's data, nothing about the restaurant, and it cannot write. The panels do
-- not use it at all (they read `blocklist` with the service role), so service_role keeps EXECUTE
-- as well and nothing staff-side changes.
--
-- IF YOU ARE ABOUT TO REVOKE THIS AGAIN: delete components/BanGate.tsx in the same commit, or the
-- product will promise a wall it can never show. `npm run verify:grants` now fails BOTH ways —
-- see the "every allow-listed function is actually callable" check added alongside this migration.

REVOKE ALL     ON FUNCTION lfh_check_ban(text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_check_ban(text, text, uuid) TO anon, service_role;

NOTIFY pgrst, 'reload schema';
