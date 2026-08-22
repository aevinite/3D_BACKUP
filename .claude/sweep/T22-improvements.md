# Sweep #6 · Terminal 22 — improvement ideas
Territory: `supabase/migrations/` positions 121–230.

**STATUS: the owner approved all four on 2026-08-22 ("do all the things you told in the need
decision"), and all four are now BUILT and verified on this branch.** They are kept here with the
reasoning that led to them, and each now ends with what was actually done.

## I1 · Take the leftover public GRANTs off the 23 server-only tables this range creates
`agent_runs`, `app_config`, `banquet_items`, `customer_devices`, `customer_visits`, `expenses`,
`fix_requests`, the eight `inv_*` tables, `khata_customers`, `action_idempotency`, `login_throttle`,
`session_payments`, `staff_payments`, `table_qr_codes`, `table_tags`, `unblock_requests`.
All 23 have row-level security ON with zero policies, so the public menu key gets no rows from them
today — nothing is exposed. But they still carry Supabase's default `anon`/`authenticated` table
GRANTs, which means the ONLY thing standing between them and the public key is the absence of a
policy. Migration 204 — in this very range — set the standard for exactly this case: it enabled RLS
on seven tables AND dropped the stray grants on the two that had them, calling it "defence in depth
— same spirit as the REVOKE staff RPCs from anon rule". Migration 196 did the same for
`owner_analytics_cache`. The other 23 never got that second half.
**Effort:** one migration, ~25 REVOKE lines. **Risk:** low but not zero — a REVOKE on a live table
is the kind of change that breaks a read nobody remembered. Worth checking each table against the
app's anon client first (I found none, but that is a code read, not a run).

## I2 · Give `settings.tablet_take_orders` the CHECK its siblings have
Migration 178 declares it `TEXT NOT NULL DEFAULT 'on'` and then repairs any value outside
('off','on','pin') — so the author clearly meant it to be a tri-state. Its siblings from migration
166, `tablet_table_tags` and `tablet_khata`, both carry
`CHECK (... IN ('off','on','pin'))`. This one does not. A stray value would read as "off" to the
panel, and the tablet would quietly stop taking orders.
**Effort:** two lines in one migration. **Risk:** low, but adding a CHECK to a live column FAILS if
any existing row violates it — so it needs a count first, on both stacks.

## I3 · Prune stale rate-limit counters in the nightly job
`rate_limit_counters` is only ever cleared by a restaurant purge or by pressing "Allow" on one
subject. The `join_session` key is subject-keyed on the guest's DEVICE, so a busy restaurant grows
one dead row per device forever. The dev database holds 140 rows with the oldest three weeks old —
harmless now, unbounded later. `lfh_prune_logs` (migration 162, in this range) already runs nightly
and already trims four tables; adding "counters whose window closed a day ago" is one more line.
**Effort:** one migration redefining `lfh_prune_logs`. **Risk:** low — deleting a closed window is
a no-op for enforcement, but it does mean re-creating a function five migrations have edited, and
that is exactly how a fix gets reverted.

## I4 · Say out loud that a function-level SET does not survive a CREATE OR REPLACE
Finding F3 happened because migration 266 states the opposite in a comment and five later
migrations trusted it. The durable fix is not another ALTER — it is a check that reads
`pg_proc.proconfig` for the eleven analytics functions and fails when one loses its `work_mem`, so
the next `CREATE OR REPLACE` that forgets the SET line is caught the same day.
**Effort:** ~30 lines added to an existing `verify:*` script. **Risk:** none to the product.
**Why it is not built:** `scripts/` is outside this territory. Ledger row P10609 does the check;
this asks for it to live in the repo's own guards.


---

# What was built, 2026-08-22

> **Renumbered 358/359 → 362/363** when terminal 21's pull request (#1078) merged first and took
> 358–361. Same content, applied to the dev database before the rename; the folder is one
> unambiguous sequence again.

* **I1 → migration `362_the_server_only_tables_lose_their_leftover_public_grant.sql`.** 23 REVOKEs,
  derived from the database rather than typed, so the list is exactly the tables that still carried
  a public grant with RLS on and no policy. Checked first that every call site for all 23 lives in
  `app/api/**` or `lib/**` and goes through the service-role client — including the one outlier,
  `app/q/[code]/page.tsx` reading `table_qr_codes`, which uses `supabaseAdmin`. Applied; the list
  re-derived afterwards is empty. Nine database guards re-run green.
* **I2 → migration `363_…` part A.** Two columns lacked the check, not one: `tablet_take_orders`
  (mig 178) and `tablet_parcel` (mig 197), against seven siblings that have it. Repair-then-
  constrain, so it cannot fail on existing data. Proved: a nonsense value is refused by the
  database, all three real values still accepted, the row restored.
* **I3 → migration `363_…` part B.** The nightly prune now forgets rate-limit counters whose window
  is provably closed — the window resolved the same way `lfh_rate_check` resolves it, plus a day.
  Events are untouched. Proved with a seeded 8-day-old counter and a live one: the dead one went,
  the live one stayed. 156 counters → 17 on the dev stack.
  **A bug of my own, caught by running it:** the first version aliased the rules table `r`, which
  PL/pgSQL resolves to the function's existing `DECLARE r RECORD` loop variable — the prune failed
  with `record "r" has no field "window_seconds"`. Aliased `rr`, re-applied, re-proved.
* **I4 → `scripts/verify-db-grants.mjs`.** A check that all eleven owner-analytics functions still
  carry their own `work_mem`, with the whole story in the comment so the next reader knows why a
  passing-looking migration can still lose it. No new script and no `package.json` change, so it
  cannot collide with another terminal.
