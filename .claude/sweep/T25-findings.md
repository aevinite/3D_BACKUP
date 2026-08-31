# T25 findings — sweep #7 · `lib/**`, the files no other terminal owns

Branch `sweep7/t25-other-libraries` · 2026-08-28 · against `origin/main` c005b3d3.
Twelve problems, twelve fixed, one commit each so any single one can be dropped.
**The owner's four-part report is in the terminal window, not here** (sweep-#7 rule 3).

| # | commit | where a person meets it | what was wrong | guard left behind |
|---|---|---|---|---|
| 1 | `57f46981` | admin → a restaurant → Access & permissions → "Format of the bill" → the KOT preview | The sample kitchen ticket printed **"Table 5"**; the real one prints **"T5"**. The page's own note promises "the exact ticket the manager panel and the kitchen board print". It said Table 5 from the day it was written — the ledger row that claimed otherwise (`P12371`) had been filed green on a claim that was never true. | `verify:print-helper` block 8a — the parity test now drives all THREE copies of the label rule, not two |
| 2 | `136c501f` | admin → Restaurants → Add restaurant → then its Access & permissions | A new restaurant inherited restaurant #1's **Pay later, Payroll and Inventory** ladders. Measured: #1 holds `payroll_allowed=true` AND `payroll_owner_control=true`, so every restaurant created was born with staff payroll live and the owner already holding the switch. The file's own drift tripwire had been naming all nine columns in the server log on every creation. | `verify:settings-columns` check 3b — every ladder column something READS must have an explicit default |
| 3 | `46239cb5` | admin → Owners → view this owner's cockpit | Two reads that decide which restaurants you are looking at never checked whether they worked. A blip showed ONE of a five-restaurant owner's estate, silently. Finding F22 fixed the third read in the same branch and left these two. | `verify:owner-scope` check 1b — asserts the PROPERTY (every read that shapes the scope reads its own `.error`), so the next read added is covered |
| 4 | `a2978ede` | admin → Bills → delete a bill, and Restore beside it | Both first reads threw their error away, so a failed read answered `{deleted: 0}` / `{restored: 0}` — which is what an already-deleted bill looks like. A green "done" for something that never happened. Also unchunked. | `verify:id-chunks` now names `restoreOrders` beside `softDeleteOrders` |
| 5 | `a647a059` | manager → a table → Generate bill (with a customer) | `"Couldn't save the customer: " + error.message` put a PostgREST sentence in front of a manager on the invoice path, in a function whose own header promises "a plain message the panel can show as-is". Second change, same file: `billCustomerRequired` conflated a read error with "no settings row", so a blip silently switched the requirement off. | **NEW** `verify:plain-refusals` — no shared `lib/` helper may build a person's message out of a caught error's `.message`, with the two legitimate exemptions named AND re-checked |
| 6 | `7bb73565` | backend only, nothing on screen | `notifyAggregator` — the one call to Zomato/Swiggy — had no deadline, where `lib/alerts.ts` learned exactly that on 2026-07-31 and set 4s. Nothing waits on it, but an un-awaited fetch with no ceiling holds the serverless instance open. | `verify:abort-guard` (11 files now); the deadline is feature-guarded the way that guard asks |
| 7 | `4a37ae96` | backend only, nothing on screen | `hexToRgbTriplet` was exported from **both** `lib/accent.ts` and `lib/brandTheme.ts`, and the two DISAGREED: one required the leading `#`, the other did not. `components/AppShell.tsx` imports from both files. | `verify:id-chunks` gained the general rule its four hard-coded names were a special case of — no two files in `lib/` may DEFINE the same exported name |
| 8 | `d819ef2f` | backend only, nothing on screen | `lib/guestName.ts`: 18 lines nothing imported. Its only mentions were a June design spec for a component that shipped differently, and a row in LEARN-MY-APP. | `verify:id-chunks` walks `lib/`; new row `P27391` asserts every file is imported by something |
| 9 | `f8480551` | backend only, nothing on screen | The delivery webhook read the WHOLE `settings` table — no filter, no limit — to find which restaurant an inbound order belongs to, pulling every restaurant's `platform_channels` (the connection KEYS) across on a public path. PostgREST caps an unlimited select at 1,000 rows with no error. | `verify:settings-columns` check 3c — no `lib/` file may read `settings` with neither a filter nor a limit |
| 10 | `52a5053d` | owner → Dashboard, and admin → Analytics — any money tile | `compactINR(Infinity)` returned **"₹InfinityCr"**. `Number(value) \|\| 0` catches NaN, null and undefined — all falsy — and lets Infinity through. | **NEW** `lib/money.test.mjs`, run by the existing `test:units`: no code word for any input shape, the Indian buckets, the minus sign, and `roundTicks` refusing an unusable domain |
| 11 | `600bc2ee` | backend only, nothing on screen | Adding a guard makes `.github/scripts/verify-doc-counts.mjs` red — three rulebooks state the number of `verify:*` scripts in prose, and no npm script wraps that checker, so CI goes red while every local guard is green. | the checker itself, run by path |
| 12 | `fe37eba0` | owner → Audit & logs (and the Activity card on a staff profile) | `lib/logVisibility.ts`'s "HOW IT CANNOT COME BACK" section names three things. Two are real. The third — `npm run verify:log-visibility` — **had never been written**: no file, no script, no commit for the path. Nothing is broken today; what was missing is the thing that stops the next route re-introducing finding F23. | **NEW** `verify:log-visibility`, five properties, proven RED against a throwaway file written in F23's exact original shape |

## What did NOT turn up

- **No regression.** All 500 sweep-#6 rows were re-run; not one that was green is red.
- **No money rule disagreed with itself.** `netOf` is one definition, the tax split foots both ways
  at 200 random targets, the business day agrees with the SQL rule at 200 random instants, and the
  bill/parcel previews foot to the rupee on screen.
- **No data-separation fault.** Every tenant read in the territory is scoped by `restaurant_id` or
  by a row's own primary key; the three keyed on a globally-unique value are named with reasons in
  `P27332`.
- **No secret moves.** No cache holds `password_hash` or `pin_hash`, no `lib/` file logs one, and the
  two that hand a token over do it once each by design.

## Handoffs — not my files

- **`app/api/inventory/[...path]/route.ts` → `invCan()`** carries a near-copy of `managerCan`'s
  override-then-grant tail. No hole today: its Feature half is the Inventory MODULE ladder, checked
  separately. The difference that could bite is that `invCan` never reads `access_config[flag].on`,
  so the day an Access row is added for `inv_stock`, `managerCan` would honour the Feature switch and
  `invCan` would not. (T10's territory.)
- **The chart-shape rejection is recorded NOWHERE in the repo** — not in `docs/REJECTED-IDEAS.md`
  and not as a `REJECTED (owner, …)` comment in `components/owner/Charts.tsx`. It lives only in the
  owner's own memory, so `npm run verify:rejected` (which holds the doc↔comment PAIR) cannot see it.
  Someone will offer it again. (T11's territory.)
- **`lib/orderStatus.ts` and `lib/printBoardWords.ts` both export `STEPS`** — two unrelated English
  words, nothing imports both. Allow-listed in `verify:id-chunks` WITH a check that nothing starts
  importing both. Renaming either touches components and an admin page in other territories.
