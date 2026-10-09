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
