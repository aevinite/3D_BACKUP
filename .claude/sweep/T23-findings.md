# T23 findings — the database, migrations at POSITIONS 231–339 of the sorted folder

Working machinery for the merge terminal. **The report the owner reads is the terminal window.**

Territory (sweep #7): `ls supabase/migrations/*.sql | sort | sed -n '231,339p'` — **109 files,
16,120 lines**, `223_waiter_sections_full_access_backfill.sql` → `332_every_bill_is_signed_and_chained.sql`.
Ledger: `LEDGER/T23.md` — 500 old rows re-run, 500 new rows written (`P26101`–`P26600`).

**One real problem, fixed. Two improvements built. Two questions recorded for the owner.**

---

## ✅ F1 — a re-seed hands a narrowed waiter section back to the whole floor (migration 225)

**Severity:** medium · **confirmed by reading, and proved by running the fix in a transaction that rolled back**

**Where it lives:** the WAITER TABLET → the tables a waiter can see and open; and Owner panel →
Team → a waiter → their section, which would show the whole floor again.

**Who is worse off:** the manager who set the section, and the waiter who suddenly holds tables that
are not theirs. Migration 225's trailing backfill is:

```sql
UPDATE staff_users su SET assigned_tables = <everything they hold ∪ 1..settings.table_count>
 WHERE su.role = 'tablet'
   AND COALESCE(array_length(su.assigned_tables,1),0) > 0
   AND EXISTS (SELECT 1 FROM generate_series(1, table_count) g(t)
                WHERE NOT (g.t = ANY (su.assigned_tables)));
```

The WHERE tests **"is this waiter missing a table"**. That is true of the gap migration 225 was
written to close — and equally true of **every section a manager has deliberately narrowed since**.
Narrowing is the whole point of the feature; the file's own header says *"a section is only ever a
SUBTRACTION from the floor, never a hole in it"*.

This is the shape migration 321 named for 198 / 209 / 295 / 288 and migration 352 for 235 / 301:
*"a WHERE that tests 'is it not the value I want' rather than absence"*. `scripts/seed-supabase.mjs`
step 1 re-runs every file in this folder with no ledger, so it is reachable, not theoretical.

**Why nobody found it before:** sweep #6's T23 territory was *"every file numbered 231 or higher"*.
Sweep #7 redefined it by POSITION (231–339 of the sorted list), which begins at `223_…` — so files
223–230 were read by this terminal for the first time. Migration 225 is one of them.

**Measured on the backup database, 2026-08-28:** **0 waiters are narrowed today.** Migration 223's
backfill gave every one of them the whole floor and nobody has cut a section yet. So the guard costs
nothing now — and the day someone uses the feature is the day a re-seed would take it away again,
which is exactly the day nobody would be looking.

**Fixed:** the statement is wrapped in the migration-307 ledger guard (`DO $reseed_guard$` +
`to_regprocedure` + `EXECUTE`, migration 043's pattern, because `lfh_already_applied` is created 82
files later). Key `225_sections_follow_table_count`, recorded by the new **migration 369**.
The TRIGGER beside it is deliberately left unguarded and must stay so: it only ever fires when the
floor GROWS, which is the behaviour the file exists for.

**Proved, not assumed.** Ran the guarded block and the ledger INSERT on the dev database inside
`BEGIN … ROLLBACK`:

```
before_key        false     ← unapplied: the block RUNS its one legitimate time
after_key         true      ← recorded: the second run SKIPS with a NOTICE
rows_now_narrowed 0         ← and the one legitimate run changes nothing today
```
…then confirmed `select count(*) from lfh_applied_once where key='225_…'` = **0**. Nothing was left
on the shared database; the migration ships unapplied, in the PR.

**Guard:** `npm run verify:grants` already derives the one-time-key population from the folder and
checks BOTH directions. It now reports **17** keys instead of 16, and would fail if the key stopped
being checked or stopped being recorded. Ledger rows `P26502`, `P26521`–`P26523`, `P26596`.

---

## ✅ I1 — the purge guard could promise a table was kept forever while the purge deleted it

**Where it lives:** backend only, nothing on screen — but it is the check standing behind
Admin console → Restaurants → Recycle bin → "Remove permanently".

`scripts/verify-purge-classified.mjs` asked one question: *is this tenant table accounted for
SOMEWHERE* — deleted, or on KEEP, or on UNDECIDED. It never compared KEEP **against** the delete
list. So a table could sit on KEEP, with a written reason saying it survives forever, while
`admin_purge_restaurant()` deleted it, and the guard stayed green. **Four tables were in exactly
that state** — see D1/D2 below.

**Built:** KEEP now has to mean KEPT. A KEEP table the purge deletes is a FAILURE. Two supporting
changes so the guard is honest rather than merely strict:
* `settings` and `staff_users` moved to a new **`DELETED_LAST`** map — their KEEP notes already said
  they are deleted last, which made KEEP mean two different things;
* the four financial tables moved to a new **`DISPUTED`** map, printed loudly on every run, because
  what a purge removes is the owner's decision and not a guard's.
* and the other half of the same blind spot is now counted: **22 of the 47 tables the purge deletes
  carry no written reason anywhere**. Reported, not failed — writing those 22 reasons is deliberate
  work somebody has to choose to do.

Verified it can actually fail: with the three tables left on KEEP it went red with three named
failures; moved to DISPUTED, green. Ledger rows `P26593`–`P26595`.

---

## ✅ I2 — two guarded migrations pointed the reader at an unrelated file

**Where it lives:** backend only, nothing on screen.

`235_access_model_v2.sql` and `301_a_discount_is_grossed_at_the_rate_it_was_charged.sql` both said
*"migration 360 records the key"*. The recording file was written as 360, renumbered to **352** on
merge, and neither pointer followed — so both aimed at `360_the_last_half_of_a_retired_stub.sql`,
an unrelated migration. Nothing breaks (the key is matched by its TEXT), but the next person reading
a one-time data rewrite is misdirected at exactly the wrong moment. This is the same fault sweep #6
fixed for two other files; it came back through a renumber.

**Built:** both pointers corrected to 352, each with a line recording what moved and the warning that
the KEY must never be renamed (it is already in `lfh_applied_once` on every live database).

**Guard:** new, in `scripts/verify-db-grants.mjs` — a file that tells the reader *"migration NNN
records the key"* must name a migration that really records one of the keys that file checks.
Proved it fails: reverting 235's pointer to 360 turned `verify:grants` red with the exact sentence.

---

## 🟡 D1 — a purge deletes parcel and platform SALES (recorded, not changed)

`aggregator_orders` carries `total`, `paid`, `paid_at`, `payment_method`, `bill_no`, `invoice_no`
and `invoice_at`. Migration **261** — in this territory — draws those numbers from the **same series
a dine-in bill uses**. Measured 2026-08-28: **43 rows, 32 of them invoiced, and not one has a mirror
row in `orders`** (`order_id` is null on all 43). `admin_purge_restaurant()` deletes the table
outright, and it is on no list in the purge guard, so nobody ever wrote down why.

The guard's own KEEP list says *"a banquet bill IS a sale"*. A parcel bill is the same thing.

**Not changed on my own**, per `docs/COMPLIANCE-GUARDRAILS.md`: name the risk, offer the compliant
path, let the owner decide. Now printed by `verify:purge` on every run. Ledger rows `P26404`,
`P26416`, `P26594`.

## 🟡 D2 — a purge deletes money-OUT records the guard said were kept forever (recorded, not changed)

`expenses`, `inv_purchases` and `inv_purchase_lines` sat on KEEP with the reasons *"money out — a
financial record, same reasoning as a sale"*, *"stock bought — money out"* and *"the lines of those
purchases"*. The purge deletes all three. One of the two is wrong; which one is the owner's call.
Ledger row `P26595`.

---

## Things checked and NOT filed

* **`verify:purge` red on `print_pairings`.** It was red on the first run of this session and it was
  **not** a regression: the shared dev database was mid-way through another terminal's migration 368,
  so the purge's live body did not yet clear a table that had only just appeared. Green twenty
  minutes later, and `wt-s7-t24` turned out to be holding the very migration that closes it.
  Recorded in ledger row `P11463` so the next sweep does not re-file it.
* **48 numbered bills whose every order is cancelled or deleted.** All 48 explained: 4 voided (an
  issued invoice keeps its retired number), 39 binned bills, 5 numbered while live and cancelled
  afterwards. Migration 331 refuses to MINT a number for an already-cancelled bill; it never
  retracts one, which is P11303's own rule. Ledger row `P26586`.
* **`DELETE FROM order_items` in migrations 270/272.** That is `lfh_delete_order_item` — taking one
  dish off an UNPAID ticket. It refuses a paid bill, re-prices the order in the same transaction,
  and both routes that call it write a `dish_removed` Audit row with the dish's own worth first.
* **`verify:guards-alive` is red** on `verify-notfound-audience`, `verify-printing-sweep` and
  `verify-sw-version-report` — three scripts this branch does not touch, red on clean main, and the
  guards terminal's territory this wave.
