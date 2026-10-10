# Sweep #10 · Terminal 30 — the money and compliance libraries · what was found

Ledger: `LEDGER/T30-S10.md` (506 new rows, P199001–P199820 in sub-ranges) · 285 existing rows re-run in
place · one regression (P14078). Ten problems, each fixed in its own commit with a guard; no
improvement was built — they were listed in the chat report.

| # | problem (plain) | where a person meets it | fix | guard (sabotage-tested) |
|---|---|---|---|---|
| 1 | **regression P14078** — the cancel-and-loss spec said its work is migration 337; it is 340 (renumbered 2026-08-19) | backend only, nothing on screen (a doc a session reads before touching cancellations) | doc corrected | `scripts/verify-money-pointers.mjs` (new) check 3 |
| 2 | `lib/tax.ts` pointed at migrations 269/271 for functions defined in 270/272 | backend only, nothing on screen | comments corrected | `verify-money-pointers` check 1 |
| 3 | the compliance doc said the purge was rewritten six times and that a guard "reads 342 only" — twelve files, and the guard follows the newest | backend only, nothing on screen | paragraph gives the command instead of a count | `verify-money-pointers` check 4 + `verify:t24-money-rules` |
| 4 | Pay in parts treated a failed database read as an answer: "Nothing to settle — already paid" (never retried), a guessed 5%, "not in the book" / a second copy of the person | manager & waiter → a table → Pay in parts, during a busy moment | every read checks its error → busy reply (503, kept and resent) | `verify:split-payment` block 9 |
| 5 | two devices settling one bill at the same moment both "succeeded" — the parts were recorded twice and the day-close drawer lines asked for double | manager till + waiter tablet → same table → Pay in parts | the stamp only matches unsettled rows; a shortfall reverses our parts and answers 409 | `verify:split-payment` block 9 · `verify:t24-money-rules` · `verify:t24b` |
| 6 | Pay in parts showed the waiter the database's own sentence on a failed save, always as a retry-for-ever 500 | the same sheet, when a save fails | plain sentence, honest status via `lib/dbRefusal` | `verify:split-payment` · `verify:plain-refusals` (now catches `x.error.message` chains) |
| 7 | Show password / Reset password left the plaintext password in the stored-replies table (27 rows on dev) | backend only, nothing on screen (Aevinite → a person → Show password) | `withoutSecrets()` before storing and before echoing; 37 dev rows' reply bodies cleared | `verify:order-retry` block 1b |
| 8 | the efficiency playbook located a loop by line 3440 (it is at 4277) | backend only, nothing on screen | quotes the sentence the loop sits under | `verify-money-pointers` check 5 |
| 9 | two managers editing the same menu category had no first-save-wins gate (looked up by an `id` the table does not have; the panel sent no expectation) | manager → Edit menu → Categories / Filters → Save | gate keys categories/filters by slug; one line in `public/panels/editor/app.js`; dead `table_tags` entry removed | `verify:t24-money-rules` (static + `--db`) |
| 10 | the playbook named two analytics indexes that had been dropped | backend only, nothing on screen | names the covering indexes that replaced them | `verify-money-pointers` check 6 |

## Noticed outside this territory (left for their owners)

- `scripts/verify-t14-reports-live.mjs` P05046 (owner hourly report, 24-bucket series) was red on :4430 at 02:00 IST.
- `scripts/verify-cancel-loss.ts` says the spec is "migration 355"; it is 340.
- 26 more "function beside a migration number" pointers outside this territory do not resolve (`scripts/verify-money-pointers.mjs`'s check 1 logic, run repo-wide).
- The dev database holds a scratch schema `wt767` (orders / order_items copies, no RLS, no guest grant) and five "T28 item 16 probe" restaurants.
- Aevinite → Billing & plans on a phone truncates restaurant names to 3–4 letters.

## Round 2 (owner, 2026-10-09 — "do all within your boundaries", then "500 to 1000 … zero error")

| # | what | where a person meets it | guard |
|---|---|---|---|
| 11 | a stored "already done" reply was repeated to anyone presenting the same action id — now only to whoever made it | backend only, nothing on screen | `verify:order-retry` 1c · `verify:t30-money` |
| 12 | a list of objects compared equal to any other list of the same length | backend only (no screen sends one yet) | `verify:t24-money-rules` · `verify:t30-money` |
| 13 | LFH04 had no sentence; LFH03 told a busy-table refusal as "say why" | manager → reopen a settled bill, from any door other than the manager route | `verify:t24-money-rules` |
| 14 | three pieces of unused money code (maxDiscount, keepWhatAnswered, two dead labels) | backend only | `verify:t24-money-rules` · t34 P104916 |
| 22 | the short rupee label printed "₹1000" for ₹999.50–₹999.99 | owner → dashboard / charts, any figure just under ₹1,000 | `test:units` (lib/money.test.mjs) |
| 23 | Pay in parts' two-paise tolerance answered differently on different bills (₹525.02 accepted, ₹200.02 refused) | manager / waiter → Pay in parts, parts 2 paise over | `verify:split-payment` · `verify:t30-money` |

Measured: 603 harness checks · 100% of lines and branches in all 13 code files (10 branches proven
unreachable) · 384 mutants: 362 caught, 22 proven equivalent, 0 unexplained. Items 15–18 and 21 were
left: their files belong to other terminals (the owner routes, the manager route, a new migration).

## Round 3 (owner, 2026-10-09 — "do all" items 15–18 and 21, then "500 to 1000 … replan whole test … I want zero")

| # | what | where a person meets it | guard |
|---|---|---|---|
| 15 | six owner-screen reads treated a database failure as an answer ("Account not found", "the name is free", nameless inventory rows, a false "tickets are waiting") | owner → Settings (password) · Team (add / rename / cancel a pay entry) · Reports → Inventory · the printing status | u-round3 owner-route scan · `verify:t30-money` |
| 16 | an order's allergy change wrote one unchecked UPDATE per dish (the N+1 in the playbook) | manager / waiter → an order's allergy line | `verify-money-pointers` check 5 · u-round3 |
| 17 | the manager's live order list fetched every column of every order | manager → the floor (backend only — the same screen, less data) | `verify-t24-money-rules --db` · u-round3 |
| 18 | a restaurant's tax rate could be saved as a number its orders then refused (mig 415) | admin → a restaurant's settings → tax rate | `verify-t24-money-rules --db` · u-round3 |
| 21 | table-by-table read of who may read or write what: 46 unused default privileges removed (mig 416) | backend only, nothing on screen | `verify:grants` (three new rules) |
| 24 | a failed allergy write could never heal on a retry (the line was saved first), and dish 501+ was skipped | manager / waiter → an order's allergy line, on a slow connection | u-orderAllergies · live.mjs P167701+ |
| 25 | two different values could compare equal in "first save wins" (`["a,b"]` = `["a","b"]`) | any panel save that sends an expectation | u-props P167080–P167081 · u-clashCompare |
| 26 | a GST report split could print a negative tax line (three-plus lines, a few paise) | owner → Reports → Tax / the GST export | u-props P167049 + the item-26 rows |
| 27 | undoing a bill paid in parts could leave its money counted as collected; the tablet un-paid first and could get stuck | manager / waiter → Undo / Mark unpaid on a bill paid in parts | u-props P167118–P167123 · u-paySplit P168217 |

Measured: 852 harness checks · 100% of lines and branches in all 14 code files · a FULL mutation run, 402
breaks: 379 caught, 23 proven equivalent, 0 unexplained · 153 app-vs-database checks · 103 driven on :4430 ·
28 screens. 507 new ledger rows, 1,087 earlier rows re-run green.

**Open — the owner's decision:** the app rounds half a paisa with floating point, the database exactly. 818
amounts in a million differ at 5% tax on top, 3,656 at 18%, 21,699 at 12% tax-inside (P167532–P167535). One
exact rounding rule must be shared by `lib/tax.ts` and `public/panels/billdoc.js` (outside this terminal), or
the screen and the paper would start to disagree instead. On the dev data no saved order is off by it.

**Owner said no, and it happened anyway once:** the busy-table screenshot step (one real order on French
House table 28, photographed, cancelled) was rejected on 2026-10-09, but its code had already been written
into `shots.mjs` and was committed unnoticed; it ran once at the 1 AM restart. It cleaned up after itself
(order cancelled with a reason, KOT 141, table closed) and the block has been removed.

## Noticed outside this territory in round 3 (left for their owners)

- The owner-film history seeder (`brag-output/ownerfilm/prep-history.mjs`) stores an order's total AFTER the
  discount (and takes it off the taxable base), and pays dine-in bills by "Swiggy / Zomato / Website" — the
  app does neither. 10,254 rows on dev; the films' demo restaurants show wrong discount and payment figures.
- Six aevidine demo orders of 2024-01-01 are stamped 0% while charging 5% (a reprint would show no tax).
- A test rig of 2026-08-29 cancelled three French House bills it had settled in parts without reversing
  the parts, so that day's cash figures on dev count ₹1,449 that was never kept.
- Two French House orders of 2026-08-05 say "cash" in lower case — written the morning the method check
  landed (51afda30); every path checks it now. A database rule on the column would catch any future slip,
  but would also break the film seeder's next run.

## Round 4 (owner, 2026-10-10 — "do all the things you have listed", then "500 to 1000 … replan whole test … I want zero error")

| # | what | where a person meets it | guard |
|---|---|---|---|
| 10 | the app rounded money the float way, the database exactly — 818 amounts in a million differed at 5%, 3,656 at 18% (round 3's open decision; the owner said yes to the shared bill file) | every bill on every screen and on paper — a paisa, on a bill with an untaxed line | `verify-money-round-twins` (in verify:static) · parity P167532–P167535 now green |
| 11 | a bill could be stored as paid by any spelling — the database now refuses all but the app's six (mig 417) | backend only, nothing on screen | u-round4 · parity "method refused / accepted" probes |
| 12 | the owner-film history seeder took discounts off twice and paid dine-in bills by "Swiggy"; seeder fixed, 2,730 dev rows repaired, roll-ups refreshed | owner → Dashboard / Reports on the film restaurants | parity r4 "film" rows |
| 13 | six aevidine demo bills stamped 0% while charging 5% — re-stamped | owner → an old aevidine bill reprinted | parity "demo stamps" |
| 14 | a test rig's ₹1,449 of payment parts left standing on three cancelled bills — reversed with a reason | manager → French House, 29 Aug cash | parity "rig parts" |
| 15 | four idle French House tables left open by tests — closed through the manager's own path | backend only | — |
| 16 | the guest menu read every reviewer's device id to find its own review — now lfh_dish_reviews answers "mine" (mig 418) | guest → a dish page → Reviews | parity r4 "reviews" (118 dishes) · live P1667xx |
| 28 | the waiter tablet charged a composition-scheme restaurant 5% in its own sums (found by this round's test) | waiter → a bill's due / discount at a composition restaurant | u-round4 P166012–P166015 |
| 29 | REGRESSION of item 16: the guest menu's ratings vanished — the ratings view runs with the guest's rights (mig 419; caught by reading the dish-page screenshot: "20 reviews" on a dish with 28) | guest → the menu's dish cards and the dish page's star count | parity "as the guest role" (118 rows) · live counts · shots |

Measured: 988 harness checks · 100% of lines and branches in all 14 files · 154 breaks of the three changed files:
146 caught, 8 proven equivalent, 0 unexplained · 439 app-vs-database checks · 171 driven on :4430 · 39 screens.
516 new ledger rows, 1,557 earlier rows re-run — the ledger is 2,158 rows, all ✅.

**Also corrected in round 4 (my own, before it shipped):** item 10's first shape made lib/taxFiling.ts import lib/tax,
breaking its rule that it imports nothing (ten scripts load it with plain node) — it now carries its own copy of the
rule, proven equal by verify-money-round-twins. And parity.mjs's ids were positions, not permanent ids: item 11's new
constraint moved every later row; each row is now keyed by its subject (parity-ids.json, seeded from the round-3 ledger).

## Noticed outside this territory in round 4 (left for their owners)

- `scripts/sweep/t18s10/rerun2.mjs:358` (T18) names `app/api/print/[...path]/route.ts`, which does not exist — the
  edit hook's verify-guards-alive flags it on every write in the shared folder.
- If a platform channel is wanted in the owner films, it belongs in `aggregator_orders` (lfh_platform_insert), not
  in how a dine-in table paid.
