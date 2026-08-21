# T23 findings — the database, migrations 231 → the newest

Working machinery for the merge terminal. The report the owner reads is the terminal window.
Territory: `supabase/migrations/`, every file numbered 231 or higher (115 files, ~15,900 lines).
500 phases, ledger `LEDGER/T23.md`. Three real problems, all fixed. One 🟡 for him. One 🔗 handoff.

---

## F1 — `npm run verify:db-parity` was RED on clean main: two migrations share the number 346

**Severity:** medium (a shared guard nobody can trust) · **confirmed** (ran it on a clean checkout of `origin/main`)

**Where it lives:** backend only, nothing on screen.

**Who is worse off:** everyone who runs the database guards. `verify:db-parity` section A2 failed on
clean `origin/main` before a line of this sweep was written:

```
✗ new duplicated migration number(s): 346 → 346_a_purge_clears_the_printing_setup.sql
                                          + 346_usage_and_cost_answers_for_any_window.sql
                                          — renumber the newer file
```

A guard that is red for something nobody is going to fix is a guard people learn to scroll past —
which is how the two cron jobs went missing for months (mig 267 F4).

**Reachable:** always. `npm run verify:db-parity` on any checkout of main.

**Not deliberate:** the opposite. `scripts/verify-db-grants.mjs` KNOWN_GAPS says in as many words:
*"Whichever of the two 346s lands first keeps the number and this line goes away; if the other is
renumbered, it should take 347"*, and 347 was left free *"as headroom for the second of the two
colliding 346s to be renumbered into. Expected to be filled, not to stay a gap."*

**Fixed:** `346_usage_and_cost_answers_for_any_window.sql` → `347_…`. The purge file landed first
(553fca40), so it keeps 346. The two touch no object in common, so nothing about the outcome moves —
`verify:db-parity` itself asserts that. Both guards are now green.

**Guard:** already exists and is now green — `verify:db-parity` A2 and `verify:grants`' gap check.

---

## F2 — a re-seed silently undoes an admin's choice: migration 235's two settings backfills

**Severity:** medium · **confirmed** (measured on the backup database, then proved by simulating the re-seed)

**Where it lives:**
* the GUEST MENU's language / currency switchers — what a diner sees on their phone;
* Admin console → a restaurant → Access & permissions → Pay later (khata).

**Who is worse off:** the admin, and the diner. `scripts/seed-supabase.mjs` step 1 re-runs every file
in this folder with no ledger. Two of migration 235's statements test *"is it not the value I want"*
rather than absence — the exact shape migration 321 named for 198 / 209 / 295 / 288 (findings
7510 / 7822). 321's sweep covered 151–308; 235 is inside that range and was missed.

Measured on the backup database, 2026-08-21, before the fix:

| statement | rows a re-seed would rewrite | what it would do |
|---|---|---|
| `menu_languages` / `menu_currencies` re-expansion | **4 restaurants**, one of them **AANGAN GARDEN RESTAURANT — live, not binned** | hand five languages back to a menu the admin narrowed to English |
| `khata_allowed = table_tags_allowed` | **1 settings row** | drag pay-later back onto the table-types switch, discarding the admin's own setting |

Nothing on screen and nothing in the Activity log would say either had happened.

**Reachable:** anyone running `node scripts/seed-supabase.mjs`. CLAUDE.md documents that command and
warns about this exact hazard; migrations 307 / 313 / 321 / 344 all exist because of it.

**Fixed:** both statements wrapped in the migration-307 ledger guard, using migration 043's
`to_regprocedure` + `EXECUTE` pattern (the helper is created 72 files later, so a fresh database still
runs each one its single legitimate time). Keys `235_menu_language_defaults` and
`235_khata_follows_table_tags`, recorded by the new migration 350.

The third statement in that file — `takeaway_allowed = TRUE` — is deliberately left **unguarded**, and
the file now says why: migration 263 sets both halves TRUE for every restaurant unconditionally and
sorts later, so a full pass always ends the same way. A guard there would be noise pretending to be
safety.

**Proved, not assumed.** Recorded the keys, then re-ran migrations 235 and 301 against the dev
database — the re-seed, simulated:

```
BEFORE  aangan-garden-restaurant  menu_languages ["en"]        khata_allowed false
        french-house              menu_languages ["en","fr","hi"]  khata_allowed true
AFTER   aangan-garden-restaurant  menu_languages ["en"]        khata_allowed false
        french-house              menu_languages ["en","fr","hi"]  khata_allowed true
```

Unguarded, Aangan Garden's guest menu would have gained five languages at that point.

**Guard:** 🔗 HANDOFF H1 below — the automated half lives in `scripts/`, which is not this
terminal's territory. Manual check written into ledger rows P11023 / P11024 meanwhile.

---

## F3 — a re-seed after a GST change re-prices filed months: migration 301's `disc_gross` backfill

**Severity:** medium · **confirmed** (code-read + measured population)

**Where it lives:** backend only, nothing on screen — but it reaches Owner panel → Dashboard and
Owner panel → Reports → Sales.

**Who is worse off:** the owner. Migration 301's backfill is

```sql
UPDATE orders SET disc_gross = discount * (1 + COALESCE(NULLIF(tax_rate, 0),
                               lfh_effective_tax_rate(restaurant_id)))
WHERE COALESCE(discount, 0) <> 0;
```

For a row that carries a stamped rate this is a deterministic recompute — harmless twice. For a row
whose `tax_rate` is NULL or 0 it falls back to **the rate configured right now**, which is correct on
the day the migration first runs and wrong every day after. And `orders.net_amount` is
`GENERATED ALWAYS AS (total − disc_gross) STORED` (mig 310), so moving `disc_gross` moves the owner's
revenue for months that are already filed.

This is the fault migration 321 recorded for `288_null_implausible_tax_rates` — *"after a GST change a
re-run would un-stamp all history and re-price it"* — one column over, in a file the same sweep read
and did not catch.

**Measured, 2026-08-21:** 11 discounted orders carry no stamped rate, out of 2,382 discounted rows.
Small, and it grows with every legacy or hand-made row.

**Reachable:** a re-seed after any change to a restaurant's tax setup.

**Fixed:** wrapped in the migration-307 guard, key `301_backfill_disc_gross`, recorded by migration 350.
The trigger `zz_orders_disc_gross` is deliberately untouched and keeps the same fallback — at INSERT
time "now" genuinely *is* the rate being charged. Only the re-run of a historical backfill turns that
fallback into a re-pricing.

**Guard:** 🔗 HANDOFF H1.

---

## ✅ F4 — the bill-chain verifier could not tell a BINNED bill from an ALTERED one

**FIXED — migration 353, on the owner's instruction (2026-08-21). It was reported as a 🟡 first; he
read it and said do it.** Severity: **high**, higher than first written up — see WHERE below.

**Where it lives:** Manager panel → 🧾 KOT ▾ → **Z-report**, the day-close sheet. Migration 332's
verification is PRINTED there on purpose — *"that is the moment a restaurant states its takings, it
is the paper an inspector is handed"*. That is what raises this from untidy to serious: the sheet was
printing `⚠ Bill ledger — 11 problems — tell the owner` every single day-close.

**What happens:** migration 332 signs every issued bill into an append-only chain and
`lfh_verify_bill_chain` reports three things — `row_rewritten`, `chain_broken`, and `bill_changed`
("signed at ₹105.00, the bill now adds up to ₹0.00"). `bill_changed` is computed as *"the live orders
on this session no longer add up to what was signed"*.

A bill that is **soft-deleted into the admin recycle bin** after its invoice was issued satisfies that
exactly — every order on it is tombstoned, so it now adds up to ₹0. So does a bill whose session row
was removed. Both are permitted, recorded, reversible acts with their own audit rows; neither is
tampering. Measured on the backup database, calling the verifier for French House over all time:

```
11 of 12 signed bills came back  bill_changed
  · 8 are bills binned into the recycle bin after their invoice was issued
  · 2 point at a session row that no longer exists (bill_chain.session_id has no FK)
  · 1 is the arithmetic of a live bill, which verifies correctly
```

Admin → Bills shows **831 deleted bills** on this stack. On a real restaurant that number is small
(R27: the restaurant has no delete-a-bill permission at all; only the admin, with a reason) — but the
mechanism is the same, and the whole value of 332 is that the report is *readable*. If every lawfully
binned bill lights up as changed, the one bill that really was altered is buried in the list, and the
owner learns to stop reading the page — which is precisely the failure migration 344 was written to
undo on the Repair board.

**Fixed as shape (1) — the recommendation, which he approved.** `bill_binned`, `bill_cancelled` and
`bill_gone` join `row_rewritten`, `chain_broken` and `bill_changed`; the `checked` summary counts each,
so nothing can be silently dropped. The route splits problems from notes and the Z-report prints the
notes as information under a verified ledger.

**THE TAMPER TEST IS NOT WEAKENED**, and this is the load-bearing line: a bill is only re-labelled when
it has **no live orders left** AND the reason is visible in the data. Proved on the dev database after
applying migration 353:

```
french-house              bill_binned 9 · bill_gone 2 · checked 1
                          "12 bill(s) verified · 11 cancelled or binned (recorded)"
                          Z-report now prints: ✓ Bill ledger verified (notes listed below it)

aangan-garden-restaurant  bill_changed 1 · checked 1
                          "2 bill(s) verified · 1 unexplained"
                          Z-report still prints: ⚠ 1 problem
                          [bill_changed] signed at 1450.58, the bill now adds up to 1933.38
```

Aangan's one real finding **survived** — a bill that still holds live orders whose total moved up by
₹482.80 after it was signed. That is the shape an actual alteration takes, and it is still flagged.

---

## ✅ H1 — the re-seed guard now asserts the invariant instead of a list (BUILT on his instruction)

Reported as a handoff first because `scripts/` was outside this terminal's fence; he read it and said
do it. Below is the write-up as it stood, then what was actually built.

`scripts/verify-db-grants.mjs` already has the machinery. Around line 460 it carries:

```js
const GUARDED = {
  "043_inr_base_currency.sql": "043_inr_base_currency",
  "093_grandfather_r1_manager_powers.sql": "093_grandfather_r1_manager_powers",
};
```

That map is what stops anyone "tidying" a `DO $reseed_guard$` block away. It names 2 of the now **12**
one-time data rewrites in this folder. Please extend it to all twelve — the three this sweep added are:

```js
  "235_access_model_v2.sql": ["235_menu_language_defaults", "235_khata_follows_table_tags"],
  "301_a_discount_is_grossed_at_the_rate_it_was_charged.sql": "301_backfill_disc_gross",
```

(the map currently takes one key per file; these two files need it to take an array, or two entries.)
The other seven already-wrapped ones worth adding while you are there: 198, 209, 288, 295 (from mig 321),
049, 051, 311 (from mig 313), 344 ×2.

Stronger still, and cheap: instead of a hand-typed list, assert the invariant directly —
**every `lfh_already_applied('<key>')` in the folder must have a matching row inserted somewhere in the
folder, and vice versa.** That version cannot rot.

**BUILT, as the invariant.** The map is gone. The guard derives the population from the folder and
checks both directions, plus 043/093 still named individually for their measured blast radius. It now
covers **14 keys instead of 2**. Checked against two deliberate faults — an orphaned check and an
orphaned ledger row — and it caught both, naming the file and what to do. And it invented a failure on
its very first run, which is recorded in the code: the terminator for an `INSERT … lfh_applied_once`
block is `on conflict`, not `;`, because migration 344's note text contains a semicolon.

---

## Deliberately NOT reported (checked, and each one is a decision already taken)

* migration 238's one-pass floor summary — measured, and CLAUDE.md forbids simplifying it back. Re-timed
  this run: 305 ms round trip for a 31-table floor, 234 ms for a 10-table one.
* the gaps in the number series — 90, 165, 168–171, 216, 252, 255, 275, 276 are all explained in
  KNOWN_GAPS. 346/347 stop being gaps with F1's fix.
* `347_usage_and_cost_answers_for_any_window.sql` being plain `STABLE` rather than SECURITY DEFINER —
  migration 153's `lfh_admin_usage`, which it is modelled on, is the same, and only service_role can
  call either.
* mig 286 reverting 278's `LFH01` error code — already found and fixed by migration 300 B1.
* the ban-function churn across 267 / 281 / 290 / 291 / 293 — a closed argument, settled in 293.
* 14-day-old tickets sitting on the kitchen board — dev fixture data whose sessions are still open, not
  a product fault. Migrations 232 / 243 / 302 / 303 handle the ownerless case.
* the whole-portfolio heatmap still crossing the 8 s wall over a long range — known, measured in
  migration 241's own header, written up in `docs/FLOOR-TIMEOUT-WATCH.md`, and the fix (a pre-aggregated
  day-of-week × hour table) is not this terminal's territory.

## An incident, recorded honestly

While proving F2/F3 I ran `node scripts/run-migration.mjs 301_…sql` to watch the new guard fire. It did —
but re-running that ONE file also re-created the twelve functions it defines, and six of them had been
rewritten by later migrations (310 / 315 / 317 / 321 / 327 / 337). `verify:one-number` went red with 5
failures: four owner functions were back to computing `total − disc_gross` by hand, and 2,245 rollup
rows had lost `net_paid`. That is the documented *"a migration that recreates a function reverts a later
fix"* trap, and the single-file applier has no ordering awareness of it.

Repaired by replaying the newest definition of every affected object, in ascending order (310, 315, 317,
321, 327, 337, 346 — 346 because 321 also defines `admin_purge_restaurant`). All four database guards are
green again, `verify:db-parity`'s *"no live function body looks hand-edited away from its migration"*
included, and `orders.net_amount` disagrees with `total − disc_gross` on 0 of 30,602 rows.

**A re-seed itself is not exposed to this** — it runs the whole folder in order, so the later files always
win. Only a single-file re-run is. Worth a line in `docs/` for whoever reaches for that command next.
