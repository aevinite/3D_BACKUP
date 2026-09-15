# SWEEP #9 · TERMINAL 29 — migrations at positions 1–80

**Territory:** positions 1–80 of `ls supabase/migrations/*.sql | sort` — `001_menu_items.sql` …
`078_tenancy_core.sql` (a position is not a number; 057 and 068 are each used twice).
**Branch** `sweep9/t29-migrations-1-80` · **worktree** `../wt-s9-t29` · **port 4429**.
**Ids** `P104401`–`P104450` used, `P104451`–`P104500` left free.

## What this run found

**One fault, in seven places: a migration file can be perfectly idempotent and still be unrunnable
today.** Every existing guard asks a narrower question — `verify:migration-truth` asks "is what this
file promised still present?", `verify:grants` asks "who may run it?", and the 2026-08-21 sweep's
statement scan asked "is each statement syntactically re-runnable?". None of them asks whether a
LATER migration deliberately retired the thing this file creates. Eight ledger rows read green
across that gap.

**Three of the eighty files could not be applied at all.** Not drift — a hard error, on every
database that has reached the migration which retired their object, which is every live one. A full
re-seed hid it, because a re-seed runs the retiring file afterwards. `node scripts/run-migration.mjs
<one file>` — the workflow `CLAUDE.md` actively recommends — did not.

| # | file | what happened | retired by |
|---|---|---|---|
| 1 | `030_real_reviews.sql` | `UPDATE menu_items SET reviews='[]', rating=NULL` → `column "reviews" does not exist`, file aborts | 359 dropped both columns |
| 2 | `032_dish_no.sql` | `CREATE UNIQUE INDEX menu_items_dish_no_key` (global) → `key is duplicated`; ten restaurants share a dish #3 | 082 made it per restaurant |
| 3 | `054_staff_users.sql` | `CREATE UNIQUE INDEX idx_staff_users_username` (global) → `key is duplicated`; four restaurants each have a "manager" | 091, then 245 |
| 4 | `013_realtime_settings.sql` | puts `settings` back on the supabase_realtime publication — every settings write decoded for a listener that does not exist | 304 |
| 5 | `014_sessions_v2_schema.sql` | re-creates `idx_blocklist_phone`, `idx_blocklist_table`, `idx_otp_phone` — 0 scans, paid for on every insert | 267, 296 |
| 6 | `057_realtime_events.sql` | re-creates `realtime_events_topic_idx` on the busiest INSERT table in the product | 267 |
| 7 | `037_billing_feedback_backend_stubs.sql` | re-adds `settings.tax_inclusive` — a column whose name promises a tax answer its value cannot give | 270, then 304 |

Each is its own commit, numbered, so any single one can be vetoed without unpicking the rest.

## The guard left behind

`scripts/verify-migration-run-alone.mjs` — the script whose stated job is exactly this — checked
FUNCTIONS, TRIGGERS and POLICIES only. It now also checks **indexes**, **publication membership**
and **columns**, plus a new assertion that no migration NAMES a dropped column in a statement that
runs at migration time (the shape that makes a file abort rather than drift). Retired objects
checked went **19 → 65**. Proven red on all seven original files and green on the fixed ones.

Three files OUTSIDE this territory surfaced with the index kind — `091_roles_and_permissions.sql`
and `095_orders_analytics_indexes.sql` (twice). They are recorded in that script's `KNOWN_BACKLOG`
with the reason and the checked fact that none of them fails on today's data, per the script's own
convention: green today, red the moment a NEW one appears.

## What was checked and is clean

The rest of this territory is in good shape, and the rows prove it rather than assert it: all 80
files deliver every object they declare; every SECURITY DEFINER function pins its search_path; all
23 tables these files create carry `restaurant_id` and none of them guesses it; the daily KOT/bill
series, the invoice series, dish numbers, ratings, feedback and staff usernames are each per
restaurant; the ×84 money conversion is still double-gated; the nightly log cleanup still never
deletes a bill or a customer; and the guest menu, driven at 1280×800 and at 360×780, renders each
restaurant's own branding, categories and rupee prices with nothing cut off and no leaked code text.

**Improvements were LISTED, not built** (owner's instruction for this run). They are in the
terminal report, not in this file.
