# T15 — ADMIN ACCESS TREE & PEOPLE · problems found

Working machinery for the merge terminal. The owner reads the chat window, not this file.

Territory (sweep #7): `app/aevinite/{access,users}/**` · `components/admin/AccessTree.tsx` ·
`components/admin/StaffProfile.tsx` · `lib/access*.ts` · `lib/staff*.ts`.
Phases `P07001`–`P07500` (re-run) and `P22101`–`P22600` (new).

---

## SWEEP #6 (2026-08-18) — kept for the record

The twelve problems P1–P12 and the two handoffs H1/H2 below the line are sweep #6's. **All twelve
were re-checked on 2026-08-27 and all twelve are still fixed** — the em-dash header that made two
switches impossible to save, the refusal that vanished after one frame, the Default chip's
contrast, the waiter the admin could not create, and the restaurant picker carrying the previous
restaurant's open sections across. See the re-run banner in `LEDGER/T15.md`.

## SWEEP #7 (2026-08-27) — what this run found

| # | severity | state | what | where it lives | commit |
|---|----------|-------|------|----------------|--------|
| S7-1 | MEDIUM | **REPORTED, NOT FIXED — the owner dropped it, 2026-08-28** | **The Printing board offered a manager whose own page said no.** The person picker read the RESTAURANT-wide default for "May be the printer" once and applied it to every manager, while `managerCan()` — the gate that decides whether a screen may really take the paper — reads that person's own row first. Switch it off for one manager and the board still offered them: pick them, the board says their screen is the printer, the gate refuses it, the kitchen never gets the paper, and neither screen says why. The reverse failed too. `confirmed` — reproduced on French House against the running app, and re-run green after the fix. | admin console → Printing → the "which screen prints it" picker, on any line of paper | — (commit dropped) |
| S7-2 | LOW | fixed | **A field labelled "Last 4 digits" kept the FIRST four.** Type or paste a whole Aadhaar, PAN or account number and the first four were stored, silently, under a label saying "last 4" — the record then identified no document at all and looked perfectly filled in. Both the browser field and `digits()` on the server. The bank field had the same fault. `confirmed`. | admin console → Users → a person → "Papers & pay details"; and the owner's own copy of the same card on `/owner/staff/<id>` | `89c17006` |
| S7-3 | LOW | fixed | **A folder said it held two things and held three.** "Permission for manager" described itself as "the money actions: reopen a bill, and discount a bill". Since 2026-08-26 it also holds "May be the printer", which is not a money action. Structural, not a typo: its children are `...ACTIONS.map(mgrAction)`, so a row added to that array appears with the sentence unchanged. `confirmed` — read on screen in both skins. | admin console → Access & permissions → Manager → "Permission for manager", the sentence on the row and the whole of it behind the ⓘ | `57cbfdf1` + `23721a0a` |
| S7-4 | LOW | fixed | **Two ⓘ pictures were promised by name and had never been in the repo.** `allergy_other → allergy-other.png` and `guest_note → guest-note.png`. Invisible, and that is why it lasted: since the 2026-08-18 fix a row with a MISSING named picture shows exactly what a row with no picture shows, so the promise degraded into silence. `code-read` + confirmed on the sheet. | admin console → Access & permissions → the ⓘ on "Guest can add their own allergy" and on "Guest can write their own note" | `5e5d87a8` |

## SWEEP #7 FOLLOW-UP (2026-08-28) — "do all except 1"

He picked items 7, 8, 9 and 10 and dropped item 1. **Item 1's commit is gone from the branch.**
Rebasing onto that morning's `main` showed why that was the right call: the Printing route had been
reworked twice since I branched (mig 369 retired the coarse target, the board moved into a shared
`lib/printBoard`, and T17 added a ceiling to the very read I had changed), so the edit conflicted
with live work in a file that was never in my territory. **The fault is still real and still on
`main`** — T17 fixed the row limit, not the per-person resolution — which is why the S7-1 row above
stays, marked reported-not-fixed. `managerPowerFor()` and `verify:access` check 53 went with it.

| # | severity | state | what | where it lives | commit |
|---|----------|-------|------|----------------|--------|
| S7-5 | MEDIUM | fixed | **Every new restaurant was born with Pay later AND payroll switched on.** `cleanClonedSettings` copies restaurant #1's whole settings row and overrides a few columns by hand; `khata_allowed` and `payroll_allowed` were never in that list, and French House has both TRUE. So the Access screen said both start off and every restaurant created got them on — payroll being the one that matters, since it unlocks the staff pay ledger, salary visibility and the pay card on every person's page. `confirmed` — measured on the template row. **Found by the guard written for item 10, not by looking.** | admin console → Access & permissions → Extra features, on any restaurant created from now on | `item 10` |
| S7-6 | LOW | fixed | **A fourth row joined "Permission for manager" and the folder's sentence stayed at three.** "May set the printers up" joined ACTIONS on 2026-08-27 (mig 367). `confirmed` — **caught by check 51 on the first run after rebasing, one day after that check was written.** Two occurrences in two days from one cause. | admin console → Access & permissions → Manager → "Permission for manager" | `item 1c` |
| S7-7 | LOW | fixed | **A new restaurant could not move a party between tables.** `table_ops_allowed` and `table_tags_allowed` were seeded false, so a new restaurant was born without the merge/split menu and without table types. Seven on the backup stack are still like that. The row's own words admitted it — "A NEW restaurant starts with it OFF, which is why most of them have it off today". His word, 2026-08-28: they start ON. | admin console → Access & permissions → Main features, on any restaurant created from now on | `item 10` |

**A claim of mine that was wrong, and is corrected.** I reported "Rating review" as a switch with no
page behind it, repeating a sweep-#6 note. Traced end to end and then watched it: the entitlement
gates the **"Guest ratings" tab** on the owner's Feedback & complaints page, and switching it off
really removes that tab (measured with a real owner login — three tabs became one, and back on
restore). The switch is real and works; only the word "page" was wrong. Fixed as item 9.

### My own mistake, caught by opening the screen

`23721a0a` is a follow-up to `57cbfdf1`. My first draft of S7-3 opened with a tidy lead-in
sentence — and `rowText()` shows only the FIRST sentence of a long description, so the ⓘ became
right while the ROW went from naming two of its three children to naming none. Worse than what I
set out to fix, and invisible to the model. Caught by loading the page. Guard 51 now truncates the
description the same way `rowText` does before it looks, so it asks the question the screen asks.

## The guards this run leaves behind

| guard | what it now refuses | proven to fail by |
|---|---|---|
| `verify:access` **51** | a folder whose children are SPREAD IN FROM AN ARRAY, whose own first sentence does not name every one of them | deleting the new clause, then putting the lead-in back |
| `verify:access` **22** (second half) | a help picture named explicitly whose `.png` is not in `public/admin-help` | re-adding one of the two dead entries |
| `lib/staffProfileShared.test.mjs` | a "last 4" field that keeps the first four — 12-digit, 14-digit, spaced and short cases | putting `slice(0, n)` back |
| `verify:access` **54** | CLAUDE.md's count of outstanding owner asks drifting from the spec's own count | putting the stale 12 back |
| `verify:access` **55** | a new restaurant seeded differently from what the Access screen promises, **or** a module the clone never resets (so it is inherited from restaurant #1) | both shapes; its first draft missed the second and that hole is closed |

Guard 51 was **narrowed twice**. Two earlier drafts judged every folder's prose and both cried
wolf on good writing — "Design and styling" says "its theme, logo and wording", which happens to
contain three of its rows' words while enumerating nothing. Prose is not a list and a guard cannot
tell them apart, so it is pinned to the one shape where the screen can grow a row with no human
editing the sentence beside it.

## 🔗 A note on the fence

`app/api/admin/printing/[...path]/route.ts` (S7-1) is not in T15's territory. It is also in
**nobody's** — created 2026-08-26, after the 40 territories were drawn, named by no prompt and
appearing in no ledger. The permission it got wrong is declared in `lib/accessTree.ts` and offered
per person by `lib/staffCaps.ts`, both mine. It is its own commit so it can be dropped alone.

## Still open, listed for the owner rather than built

| # | what | why it is not built |
|---|------|---------------------|
| D7 | ~~The two ⓘ rows have no picture~~ — **BUILT** 2026-08-28 (item 7). | — |
| D8 | ~~CLAUDE.md's count is stale~~ — **BUILT** 2026-08-28 (item 8), with check 54 behind it. | — |
| D5 | ~~"Rating review" is a switch with no page~~ — **the premise was wrong**; corrected 2026-08-28 (item 9). It is a tab. | — |
| D6 | ~~A new restaurant starts without merge/split and table types~~ — **BUILT** 2026-08-28 (item 10), and it uncovered khata + payroll being inherited from #1. | — |
| D9 | **The seven restaurants already stored OFF for `table_ops` / `table_tags` are untouched**, and any restaurant created before today may be carrying khata or payroll switched on because it inherited them. Both are data, not code — switching them is his call per restaurant. | listed for him rather than migrated |
| D10 | **S7-1 is still live on `main`** — the Printing board's person picker resolves "May be the printer" restaurant-wide while the gate resolves it per person. He dropped the fix; the write-up above is what a later session needs. | his decision, 2026-08-28 |
