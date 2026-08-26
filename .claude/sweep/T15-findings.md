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
| S7-1 | MEDIUM | fixed | **The Printing board offered a manager whose own page said no.** The person picker read the RESTAURANT-wide default for "May be the printer" once and applied it to every manager, while `managerCan()` — the gate that decides whether a screen may really take the paper — reads that person's own row first. Switch it off for one manager and the board still offered them: pick them, the board says their screen is the printer, the gate refuses it, the kitchen never gets the paper, and neither screen says why. The reverse failed too. `confirmed` — reproduced on French House against the running app, and re-run green after the fix. | admin console → Printing → the "which screen prints it" picker, on any line of paper | `f8ce16d1` |
| S7-2 | LOW | fixed | **A field labelled "Last 4 digits" kept the FIRST four.** Type or paste a whole Aadhaar, PAN or account number and the first four were stored, silently, under a label saying "last 4" — the record then identified no document at all and looked perfectly filled in. Both the browser field and `digits()` on the server. The bank field had the same fault. `confirmed`. | admin console → Users → a person → "Papers & pay details"; and the owner's own copy of the same card on `/owner/staff/<id>` | `89c17006` |
| S7-3 | LOW | fixed | **A folder said it held two things and held three.** "Permission for manager" described itself as "the money actions: reopen a bill, and discount a bill". Since 2026-08-26 it also holds "May be the printer", which is not a money action. Structural, not a typo: its children are `...ACTIONS.map(mgrAction)`, so a row added to that array appears with the sentence unchanged. `confirmed` — read on screen in both skins. | admin console → Access & permissions → Manager → "Permission for manager", the sentence on the row and the whole of it behind the ⓘ | `57cbfdf1` + `23721a0a` |
| S7-4 | LOW | fixed | **Two ⓘ pictures were promised by name and had never been in the repo.** `allergy_other → allergy-other.png` and `guest_note → guest-note.png`. Invisible, and that is why it lasted: since the 2026-08-18 fix a row with a MISSING named picture shows exactly what a row with no picture shows, so the promise degraded into silence. `code-read` + confirmed on the sheet. | admin console → Access & permissions → the ⓘ on "Guest can add their own allergy" and on "Guest can write their own note" | `5e5d87a8` |

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
| `verify:access` **53** | a screen that offers PEOPLE for a permission and resolves it restaurant-wide instead of per person | restoring the old `mgrPerm` shape |
| `lib/staffProfileShared.test.mjs` | a "last 4" field that keeps the first four — 12-digit, 14-digit, spaced and short cases | putting `slice(0, n)` back |

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
| D7 | The two rows above still have **no picture** in their ⓘ. Giving them one means adding them to `scripts/shot-access-help.mjs` and re-running it — they are guest-menu controls, so it is a deliberate job in another territory's screen, not a tidy-up. | listed for him as a numbered item |
| D8 | `CLAUDE.md` says `docs/ACCESS-REDESIGN-SPEC.md` has **12 open ☐**; the spec's own command (`grep -c '^- ☐'`) says **9**. `CLAUDE.md` is loaded into every session, so the wrong number sends every session looking for three items that do not exist. | `CLAUDE.md` is root config, not my territory, and 40 terminals may touch it this run |
| D5 | (still true from sweep #6) Access → Owner has a switch for **Rating review** and the owner panel has no such page in its nav. The entitlement is real and gates `/api/owner/ratings`, so it is not a dead switch — but there is no page of his to switch off. | a product decision |
| D6 | (still true) A **new restaurant** is born with `table_ops_allowed` and `table_tags_allowed` false, so it starts without the merge/split menu and without table types until somebody switches them on. | his call per restaurant; `lib/settingsClone.ts` is another terminal's file |
