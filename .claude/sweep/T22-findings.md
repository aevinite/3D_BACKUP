# Sweep #7 · Terminal 22 — findings
Territory: `supabase/migrations/` positions 121–230 of `ls | sort` (110 files,
`119_tax_rate_consistency.sql` → `222_waiter_table_sections.sql`).
Ledger: `.claude/sweep/LEDGER/T22.md` · block re-run `P10501`–`P11000` · new block `P25601`–`P26100`.

## Re-run of the existing 500 rows — NO REGRESSION

| | before this run | after |
|---|---|---|
| ✅ | 364 | **386** |
| ⏭ | 135 | 114 |
| malformed rows | 1 | **0** |

21 previously-unexecuted rows were closed with real evidence. The remaining 114 need a driven
journey through a screen this terminal does not own (Bills / khata / part-payment / parcel /
banquet / inventory / offline); each now carries that instruction instead of "not executed".

**Two rows looked like regressions and neither was.** Both were this run's own checks being wrong:

1. `P10645`–`P10647` (migration 164's auto-accept) failed when driven through
   `lfh_staff_place_order`. Migration 164's header is explicit that it changes **guest** orders;
   re-driven through `lfh_place_order` / `lfh_place_order_public`, every rule holds.
2. `P10511`, `P10517`, `P10590` failed a first-pass assertion whose regex was too narrow (the
   clamp is written as `IF` statements, not `GREATEST`/`LEAST`). Each body was then read by hand
   and is correct.

Recorded here rather than quietly corrected, because "the check was wrong" is the most common way
a sweep manufactures a finding.

## F1 · The purge guard promised to keep the money and never checked it — FIXED (item 1)

`scripts/verify-purge-classified.mjs` asked one question: is any tenant table missing from both
its lists? It never asked the opposite and far more expensive one — **is the purge DELETING
something the KEEP list says must survive?** That is the compliance direction
(`docs/COMPLIANCE-GUARDRAILS.md` §3.0, "a sale can never disappear"), and it was unguarded, so the
file could sit green while `admin_purge_restaurant()` erased `orders`.

Three entries had already drifted into exactly that contradiction: `expenses`, `inv_purchases` and
`inv_purchase_lines` were written down as kept ("money out — a financial record, same reasoning as
a sale") while migrations 321 and 345 have deleted all three since 2026-08-16. Migration 345's own
header names `expenses` among the things a permanent removal must clear, and the rule it protects
is about a **sale** — so the migrations are the decision and the list was the stale half.

Separately, 19 of the 22 names on its not-yet-decided list are cleared by the purge today, so every
run printed "22 tables are LEFT BEHIND and not yet decided" when the true number was **3**.

**Guard:** two new assertions in the same file, both proved able to fail before the commit landed
(a simulated purge of `orders` raises the first; a done to-do left on the list raises the second).

## F2 · A table's VIP mark outlived its party and sat on a Free table — FIXED (item 2)

**Where:** Manager panel → Tables floor. A table can be marked 👑 VIP / 🏠 Family / 🤝 Owner's
guest (migration 166).

`sessions` carries two cleanup triggers meant to mirror each other — `trg_session_close`
(BEFORE UPDATE) and `trg_session_delete` (BEFORE DELETE). The delete side clears
`session_members`, `waiter_calls`, `requests`, the party's orders and, since migration 249,
`table_merges`. It never cleared `table_tags`. And migration 166's own trigger cannot help: it is
declared `AFTER UPDATE OF status ON sessions`, so a DELETE never fires it.

**Measured, not theorised:** `table_tags` held exactly two rows on the dev stack and **both were
orphans** — Pizza Palace table 12 marked VIP and Demo Bistro table 2 marked Owner's guest, both
dated 2026-07-23, both on tables with no session row at all.

Why it is not cosmetic: the mark travels onto the **kitchen ticket** (ledger row `P10811`), so the
next party at that table gets someone else's VIP printed on their food; and an 🏠/🤝 mark is what
the on-the-house settle looks for, so a stale one offers a free-of-charge bill to a party that was
never promised it. That is party state leaking to the next party.

**Fix:** migration `369_a_mark_must_not_outlive_its_party_on_the_delete_path.sql` mirrors the clear
into `lfh_session_delete_cleanup`, keeping the close path's own "no other open party on this table"
guard and staying inside one restaurant. The two already-orphaned marks are repaired once, wrapped
in `lfh_already_applied`. The function body was read out of the database with
`pg_get_functiondef` rather than copied from migration 146, so the five earlier fixes to it are
carried forward verbatim (the migration-342 accident).

**Proved on the dev stack:** the repair cleared both orphans; deleting a party's row now clears its
mark; another table's mark and another restaurant's mark are untouched; the close path still
clears. Every test row deleted by its own id; 0 orphan marks database-wide afterwards.

**Guard:** `verify:merge-keeps-mark` — the file that already owns this mark's lifecycle — gains six
checks on the delete path. Its first version read the whole migration file and so was satisfied by
the one-time repair's own `DELETE`; it now cuts at the function body's terminator, and removing the
trigger's delete makes it go red.

## F3 · `print_pairings` was left behind by a permanent removal — fixed by a sibling terminal

`verify:purge` was **red on clean `main`** when this run started: `print_pairings` (migration 368)
carried a `restaurant_id` and was neither cleared by `admin_purge_restaurant()` nor kept on
purpose, while its four siblings (`print_agents`, `print_jobs`, `print_stations`,
`printer_events`) were all cleared. Another sweep terminal applied its own migration 369 to the
shared dev database mid-run and closed it. Verified green here; **not duplicated.**

## Left as a decision, not fixed

`idx_inv_count_lines_count(count_id)` is a strict leading slice of the unique
`inv_count_lines_count_id_item_id_key(count_id, item_id)`: every query it can serve, the composite
serves too (8 index scans against the composite's 106). Real but tiny. Dropping an index on a live
table is the owner's call, not a sweep's. Ledger row `P25936`.

## What this range is clean on

- **Re-seed safety: 110 of 110 migration files.** The only `DROP COLUMN` is migration 219's
  deliberate one, and all three are `IF EXISTS`.
- **The public menu key: 37 of 37 tables** have row-level security on, zero policies **and zero
  `anon`/`authenticated` table grants** — sweep #6's migration 362 is holding.
- **Every declared object exists:** 36 tables, 64 indexes, 64 columns, 84 functions, 11 triggers.
- **No table ends itself:** 7 scheduled jobs, none of them closes a table.
- **A sale cannot disappear:** the immutability trigger refused this run's *own* cleanup on a
  numbered session.
- **The counter table is bounded:** sweep #6 measured 156 rate-limit counters; today there is 1.
