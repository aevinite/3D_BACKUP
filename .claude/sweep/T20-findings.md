# T20 · sweep #7 — what I found, and what I did about it

**Branch `sweep7/t20-admin-apis-b` · worktree `../wt-s7-t20` · port 4220 · ids `P24601`–`P25100`.**
Territory: admin routes 26→end of the sorted list (25 files) + all 13 `app/api/owner/**`.
38 files, 9,192 lines. Ledger: `.claude/sweep/LEDGER/T20.md` (1,000 rows now).

> The four-part decision report for the owner is in the TERMINAL, not in this file — sweep #7's rule.
> This file is the technical record.

## The one thing this run is about

Twenty of the twenty-five problems below are the same shape: **a read whose `.error` was dropped, in a
place where the null it produces decides a SENTENCE.** Not a wrong number — the sweeps before this one
found most of those. A wrong *sentence*: "Staff profiles & pay aren't enabled for this restaurant",
"That person isn't on your staff", "Restaurant not found", "This feature isn't enabled", `allowed:
false`. Each is confident, each names the wrong cause, and each arrives with a status nothing retries —
so the person's change is lost and they go looking for a configuration problem that does not exist.

The most expensive one was on a WRITE: `payrollByRid()` in `/api/owner/staff` came back empty on a
blip, `target()` is the front door for every profile and pay write, and saving a salary answered a 403
about the restaurant's setup. That is finding **F7** — fixed on 2026-08-12 — on the read **one line
below** the one F7 fixed.

## Fixed (25 numbered items, one commit each; the numbers match the chat report)

| # | where | what was wrong |
|---|---|---|
| 1 | owner → Team, and every profile/pay save | a hiccup could lose a salary save behind a 403 about the restaurant's setup |
| 2 | owner → Team → any account action | reset-password / disable / role / permissions / delete answered "that person isn't on your staff" |
| 3 | owner → Team → Add a waiter | the table picker came up empty with "Pick at least one table" and Add disabled (closes T13's 🔗 handoff) |
| 4 | owner → Team → a waiter's powers | every waiter power looked ungranted |
| 5 | owner → Reports → Inventory, all restaurants | "no expenses this month" for a month that had them |
| 6 | owner → Dashboard, one restaurant | a failed ▲/▼ read threw the whole dashboard away |
| 7 | owner → Settings → Kitchen printing | the printing rows vanished silently |
| 8 | owner → Settings → a feature switch | "This feature isn't enabled for that restaurant" for one he owns |
| 9 | owner → Printing card | the whole card disappeared |
| 10 | owner → Complaints / Ratings | resolving or replying vanished with nothing said |
| 11 | admin → Restaurants list | the Owner column read "—" for restaurants that have one |
| 12 | admin → Restaurants → suspend / bin / restore | "Restaurant not found." for a restaurant that is right there |
| 13 | admin → Restaurants → New restaurant | the owner login could exist with nobody owning the restaurant |
| 14 | admin → Restaurants → handover sheet | could print with every panel login and NO owner login |
| 15 | admin → Access & permissions → Save | "Restaurant not found." — and the merge could have dropped stored permissions |
| 16 | admin → Rate limits → unblock requests | Deny left no trace, and could succeed at nothing |
| 17 | admin → a person's profile | could say they had never been paid |
| 18 | admin → Repair Kit | recorded ₹0 for a reopened bill; claimed a cancel that failed |
| 19 | admin → Restaurants → remove logo | "removed" for a restaurant that does not exist |
| 20 | admin → Restaurants → New restaurant form | the remembered setup silently reverted |
| 21 | six console lists | stopped at PostgREST's cap and said nothing |
| 22 | the guards | `verify:admin-api-a` rules 2–4 watched 25 of 50 routes; `verify:read-guards` gained rules 7 + 8 |
| 23 | owner/staff | a never-invoked closure holding a never-run database read, on the permissions path |
| 24 | `verify:read-guards` | its comment stripper was reading **27%** of one file — every check on it could only pass |
| 25 | admin → Printing overview | ⚠️ **not my territory** — landed on main mid-run (PR #1136); my guard extension caught it the same day |

## Every fix leaves a guard behind

- **`npm run verify:admin-api-a`** — 181 → **281 checks**. Rules 2–4 now derive from the whole admin
  tree instead of `ALL.slice(0, 25)`, so the positional hole at 26 cannot come back and a route added
  tomorrow is covered the day it lands. Rule 2 learned the settings clone template *by shape*; rule 3
  learned to read a builder held in a variable, with a depth-tracked statement walk.
- **`npm run verify:read-guards`** — 32 → **42 checks**. New rule 7 (a refusal decided from a dropped
  error, six named sentences), new rule 8 (an admin companion list that turns into a claim), and a
  fixture that proves the comment stripper reaches the end of the file it used to eat.
- **Every new rule was verified by breaking it on purpose and watching it go red.** Recorded on the
  block-2 rows of the ledger.

## Green at the end

`npm run typecheck` · `npm run lint` (0 errors) · `verify:admin-api-a` 281/281 ·
`verify:read-guards` 42/42 · `verify:owner-scope` · `verify:clash-coverage` · `verify:floor` 27/27 ·
`verify:personal-data` 16/16. Live: 40/40 admin + 35/35 owner on port 4220, one sign-in.

## Not fixed, and why

- Three items are **decisions, not defects** — they are in Part 4 of the chat report and nothing was
  built for them.
- `lib/loginThrottle.ts`'s `listBlocked()` swallows its read error and returns `[]`, so the Rate
  Limits page's "blocked devices" list can read as empty when it could not be read. **`lib/` is not my
  territory** and the fail-open is deliberate there (it must never trap a real person on the blocked
  page). 🔗 **HANDOFF** to whoever owns `lib/loginThrottle.ts`: the *list* and the *gate* want opposite
  failure modes, and today they share one function.
