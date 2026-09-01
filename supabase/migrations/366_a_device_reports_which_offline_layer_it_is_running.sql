-- 366 — A DEVICE REPORTS WHICH OFFLINE LAYER IT IS RUNNING.
--
-- WHY (owner asked for it, 2026-08-26; sweep #7 / T4 item 13).
--
-- Every phone and tablet keeps its own saved copy of the app (public/sw.js) so staff can keep
-- working with no internet. When a new copy ships, a device that has not picked it up keeps the
-- OLD one — and until now there was no way to see that from anywhere. A tablet quietly a version
-- behind can behave differently from the one next to it, and the only way to find out was for
-- somebody to notice odd behaviour mid-service.
--
-- HOW IT COSTS NOTHING. No new request and no new table. The offline layer already intercepts
-- every request the panels make, and it knows its own version, so it stamps `X-LFH-SW` on the
-- reads that are already happening. The server records it on the SAME throttled write that
-- already updates last_seen_at (lib/userAuth.ts, ~45s), so this is one extra column on a write
-- that was happening anyway — no extra round trip, no extra egress.
--
-- ADDITIVE and nullable on purpose: a device on a browser with no service-worker support, or one
-- whose very first visit is not yet controlled, simply has no version to report. NULL means
-- "hasn't told us", which is a different and honest thing from "behind".
alter table public.staff_users
  add column if not exists sw_version text;

comment on column public.staff_users.sw_version is
  'The offline-layer version (public/sw.js VERSION, e.g. "v12") this person''s device last reported, stamped by the service worker on requests it already makes and written by the same throttled heartbeat as last_seen_at. NULL = never reported (no service-worker support, or not yet controlled). Read by /api/admin/health for the "Offline layer" check on the admin System health screen.';

-- No index. This is read ONLY by the admin health screen, which already scans the same small
-- staff_users slice for last_seen_at and reuses that one read — so there is no filtered query on
-- this column to index, and an index nobody queries is pure write cost on a hot heartbeat.
