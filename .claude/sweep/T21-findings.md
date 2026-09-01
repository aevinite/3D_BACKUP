# T21 findings — sweep #7 · the database, migrations 001 to 118

**Re-run 2026-08-28 against `origin/main` c005b3d3. Branch `sweep7/t21-migrations-a`.**

## The headline: 0 regressions in the product, 1 real hole in the scaffolding

All 500 existing rows (`P10001`–`P10500`) were re-run. **Nothing that was green is red.** Two
long-standing `⏭` handoffs are now CLOSED by work that landed after sweep #6 (migrations 359 and the
`verify:rpc-scoped` guard). 500 new rows (`P25101`–`P25600`) were planned, written and executed, all
green.

### Item 1 — 120 permanent checks pointed at a script that was never committed

Rows `P10001`–`P10120`, **24% of this whole territory**, all read
`node scripts/verify-migration-truth.mjs --only <file>`. That file exists in **no commit in this
repository's history** — `git log --all --diff-filter=A -- '*migration-truth*'` is empty, and the only
mention of the name anywhere on disk is the ledger row itself. It was written in sweep #6's throw-away
worktree, used once, and thrown away with it.

So the single largest group of checks on the database could not be re-run, which is the exact failure
the ledger exists to prevent.

**Fixed:** rebuilt as a permanent guard, `npm run verify:migration-truth`. It asserts, per migration
file, that every object the file declares (table, added column, function, view, trigger, index, read
policy) is either present in the database or retired **later in the sequence** — positionally later,
meaning a later file OR later in the same file's own text, which is what migration 040 does with
`lfh_check_verification`.

Nothing else in the repo asked this: `verify:db-parity` compares the two databases to each other so
both can be wrong together, and `verify:db-grants` is keyed by function NAME so an absence looks like
an allowed name.

**Green:** 1,104 declared objects across all 375 files, 27 deliberately retired later, none missing.
340 objects in this territory's own 120 files.

Registered in `docs/GUARD-MAP.md` §9.

## Ten rows I first read as RED and then cleared — every one was my own detector

Recorded so the next sweep does not re-file them. Each is written into its own ledger row.

| what I read as broken | what was actually wrong |
|---|---|
| 20 function bodies "drifted" from their migrations | my extractor only understood `$$ … $$`; half this repo's functions use `$function$ … $function$` |
| `lfh_owner_payment_breakdown`'s body still differed | ONE LEADING SPACE. Diffed character by character: divergence at position 0, then 3,036 identical characters |
| 38 indexes "absent" | off-by-one in my capture groups — I was looking up table names as index names |
| `rt_emit_settings` "lost its UPDATE event" | migration 328 deliberately split it: INSERT/DELETE stays, UPDATE moved to a sibling with a WHEN clause that ignores the bill-counter tick. Compare against the LAST declaration, not the first |
| 267 duplicate KOT numbers | I grouped on the CALENDAR day. The counter keys on the BUSINESS day (5am IST, migration 044). Zero duplicates on the right key |
| 203 duplicate bill numbers | grouped on `opened_at`, which is null on the control restaurant's sessions, collapsing 203 rows into one null bucket. Zero on `created_at`'s business day |
| 702 orders "in an unknown state" | the product says `received`; my list said `new` |
| 5 tables with "a read policy and no grant" | `information_schema.role_table_grants` under-reports. `has_table_privilege` is the authoritative instrument, and all five carry the grant |
| a "sixth" wide-open read policy | two `USING (true)` policies are granted to `service_role` only — which is exactly why the repo's own guard filters on roles |
| migration 036 "not re-runnable" | its bare `CREATE FUNCTION` is preceded by `DROP FUNCTION IF EXISTS` on the line above, on purpose, because the return shape changes and `OR REPLACE` cannot change that |

## Four red rows that were test residue, not the product

Named because they will come back every sweep.

- **445 sessions carry a bill number with no order.** Every writer of `sessions.bill_no` is a trigger
  on an ORDER arriving, so migration 040's lazy rule holds. 165 of the 445 are dated the sweep-#6 day
  alone, three sessions one second apart on consecutive tables, and not one carries a printed bill —
  their order rows were hard-deleted by the cleanup the sweep's own rules require.
- **13 soft-deleted sessions have orders and no bill number.** Their `delete_reason` says it in words:
  *"sweep6 T3 self-test row — retired by the run that created it"*. Nothing blanked a number; these
  never had one, because the orders were inserted straight into the table past the trigger.
- **1 order marked paid with no time of payment**, on a table named `T9-erase`, dated 2026-08-05.
- **A "32 vs 30" disagreement between the manager floor and the tablet floor.** Two readings a minute
  apart. Read in ONE run they agreed every time — another terminal was removing its fixture tables.

## What is genuinely clean, and how it was proved

- **Object shape, not just presence** — 73 function bodies, 90 columns, 38 indexes, 24 triggers,
  9 policies, 32 grants, 8 constraints, all still what the migrations declare.
- **The numbers** — zero duplicate KOT, bill or invoice numbers, per restaurant, per business day,
  across all 53 restaurants.
- **The data** — 40 referential checks (orphans, restaurant mismatches, impossible states) all zero.
- **Re-runnability** — all 120 files land in the same state applied twice.
- **Per-tenant branding** — four tenants' own menu doors, rendered: each shows its own wordmark, hero
  and categories, and none of the three non-#1 tenants carries any French House wording. Each menu's
  section counts add up to that restaurant's own dish count exactly (59, 10, 10, 72).
- **No database key reaches the browser** — 2.5–3.9 MB of every HTML/JS/JSON response on all three
  guest doors, scanned for the service-role key, the access token and the session secret. None
  present, and not even the public key: the rows arrive already rendered by the server.
