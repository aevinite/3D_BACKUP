# T27 — EVERY WORD ON EVERY SCREEN · sweep #7 findings

Branch `sweep7/t27-every-word`, against `origin/main` c005b3d3, 2026-08-27/28.
Ledger: `.claude/sweep/LEDGER/T27.md` — 500 sweep-#6 rows re-run in place, 500 new rows
`P28101`–`P28600`. The four-part report went to the terminal, not here.

## 7 problems, 7 commits

| # | what was wrong | where a person would see it | commit |
|---|---|---|---|
| 1 | R23's "no" was recorded once, at `lib/i18n.ts`, while the code someone edits is in four other files | nothing on screen — it is why this run wasted an hour re-fixing a parked fault | `e76f43d7` |
| 2 | a bill search that matched one day and not the other printed **120px of blank box**, no words | manager panel → Bills, with Yesterday showing | `3e9f81ec` |
| 3 | eight refusals said **"No restaurant scope"**; two said it with no next step at all | manager / waiter / kitchen / inventory panels, as a red message | `7a598a3c` |
| 4 | a **36-character machine id** sat inside an English log line | owner → Activity, and admin → Logs, in the list | `a016ddc6` |
| 5 | the line explaining "On the house" said **"Comped deliberately."** | manager panel → Bills → a bill settled free | `4c7eb7c7` |
| 6 | the one screen saying **"purged"** where every other word on it says "removed" | admin → Recycle bin | `f86c5354` |
| 7 | a refusal offered a person the word **null** | owner → Staff → Access, saving a permission | `31ad770e` |

## The regression, and why nothing caught it

`P13140` was `✅` in sweep #6 and is the reason to re-run a ledger rather than write a new one.

"No bills match that search." **is gone from the product.** The Bills-screen rework (`cdacc318`)
replaced it with `${searching ? "" : emptyMsg}`, and `.empty` carries 60px of padding top and
bottom — so the box is still 120px tall with nothing in it.

Suppressing that sentence during a search was *correct*: "No bills from yesterday." is a lie when
yesterday has bills and none of them match. The mistake was emptying the **box** instead of
replacing the **sentence**.

**No string check could have caught it, because the string was fine.** Sweep #6 counted 83 empty
state STRINGS and every one was good. This run counted 52 empty state BOXES, and one of them could
render empty. That is the whole difference.

## The guard this territory did not have

`npm run verify:wording` — `scripts/verify-wording.mjs`, 4 checks over **1,165 refusal and toast
sentences**. Nothing previously read a single one of them: `verify:i18n-scope` watches the 67-key
guest dictionary, `verify:audit` watches that every action code has a label.

All four checks were proved by sabotage. **Two did not go red the first time**, and both silences
were bugs in the guard:

- the refusal regex used a character class that excluded the **letter n**, so every refusal
  containing an "n" was truncated — the check read almost nothing and printed `ok`. Fixing it took
  coverage from a handful of sentences to 1,165.
- text nodes were read from `.tsx` only, leaving the **panels** — where most staff-visible words
  live, built in template literals — outside the vocabulary check entirely.

Both are written into the file's own tail so the next person starts from them.

## What I found, fixed, and then REVERTED

**The Arabic hero greeting renders as disconnected, backwards letters.** True, measured — and
**REJECTED, R23, parked by the owner on 2026-08-14.**

This run found it, fixed it (`needsUnbrokenRun()` in `lib/brandText.ts`, six lines at two call
sites), wrote five guard checks for it, screenshotted the fix working, and then read
`docs/REJECTED-IDEAS.md` and reverted all of it. The rejection was recorded at `lib/i18n.ts`; the
lines someone edits are in `HeroTitle.tsx`, `IntroSplash.tsx`, `brandText.ts` and `globals.css`.
Three files is far enough to miss. **Item 1 is that gap closed** — the NO now sits on all four.

## Two things this run nearly filed and should not have

1. **"Three of six languages fall back to English."** They do, and it is right: a restaurant offers
   the languages it chooses (French House offers `en fr hi`) and a guest carrying another
   restaurant's choice is moved to one this one offers. `components/Header.tsx` says so.
2. **"Arabic doesn't read right-to-left."** `lib/format.ts → applyDirection` pins `dir=ltr`
   deliberately, with the reasoning beside it. A decision, not a gap — and this closes sweep #6's
   own biggest `⏭`.

## Green at the end

`npm run typecheck` · `verify:wording` · `verify:i18n-scope` · `verify:audit` ·
`verify:rejected` · `verify:ledger-index`.
