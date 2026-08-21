# T30 findings — cross-panel truth, and the ledger

Sweep #6, terminal 30 of 30. Phases **P14501–P15000**. Against `origin/main` **aad569aa**.

**This terminal owns three documents and no product file.** So every problem below is a
`🔗 HANDOFF` naming the file and the exact change, per §1 of the sweep rules. Nothing here was
edited by this terminal.

**The product itself came back clean.** 42 live navigations across all five panels, both sizes,
both skins: zero console errors, zero page errors, zero 5xx. The money agreed across four
surfaces. Every cache had a writer that busts it. Every breadcrumb reached a screen. One
product fault was found, by comparing a pair of files — which is what a cross-panel terminal is for.

---

## 🔗 HANDOFF 1 — three per-restaurant panel doors give the browser tab no name (code-read)

**Files:** `app/r/[restaurant]/manager/page.tsx` · `app/r/[restaurant]/kitchen/page.tsx` ·
`app/r/[restaurant]/tablet/page.tsx` · **owner: nobody** (T29's catch-all only)

`app/manager/page.tsx`, `app/kitchen/page.tsx` and `app/tablet/page.tsx` each carry
`export const metadata = { title: "… — Aevidine" }`. `app/manager/page.tsx` says why, inline:

> "All four panels inherited the root 'Aevidine — Restaurant OS', so a manager with the manager
> panel, the kitchen screen and the waiter view open in three tabs had three identical tabs to pick
> from (T15 sweep, 2026-08-05)."

The three per-restaurant twins set no metadata at all, so they still inherit the root title.

- **who is worse off:** a manager at a restaurant running on its own web address
  (`/r/<slug>/manager`), with the floor, the kitchen screen and the waiter view in three tabs.
- **when:** always, on those three routes.
- **not deliberate:** nothing in the files says so, and the twin's own comment argues the opposite.
  Not in `docs/REJECTED-IDEAS.md`.
- **`/login` vs `/r/<slug>/login` is NOT part of this** — neither sets a title, so they agree.

**The change:** one line per file.
```ts
export const metadata = { title: "Manager — Aevidine" };   // Kitchen — / Waiter tablet —
```

**Guard:** extend `scripts/verify-panel-twins.mjs` so it compares each `app/<panel>/page.tsx`
against `app/r/[restaurant]/<panel>/page.tsx` for a metadata title. It already compares the three
panel API routes for matching safety sets; the page doors are the same idea one level up.

---

## 🔗 HANDOFF 2 — `verify:realtime` has five defects, and two of them hide the rest

**File:** `scripts/verify-realtime.mjs` · **owner: T28** (`scripts/**`) — **ledger NEVER FILED**

This is one of the three guards this terminal was told to run. It is red and it crashes. Its own
step-5 comment reads *"A guard that is permanently red is a guard people learn to skip."*

**2a — step 1 fails on CORRECT product behaviour.** `✗ dish edit: NO menu/menu_item breadcrumb
within 5s`, while steps 2 and 3 pass in 209 ms and 473 ms. The breadcrumb **is** written: counting
rows on the dev database, French House's `menu_item` breadcrumbs went **8 → 9** across the same
write. Step 1 is the first assertion after subscribing and loses the replication warm-up race.
→ do one throwaway write-and-discard after `subscribe()`, before step 1 asserts.

**2b — step 4 crashes, so step 5 never runs at all.** `sessions.restaurant_id` is `NOT NULL` on the
live database; the insert at line 69 omits it, the error is logged but not returned, and line 72
does `s.id` on `null` → `TypeError`. The guard's real coverage is smaller than it claims.
→ add `restaurant_id` to the insert and guard `s?.id`.

**2c — the session cleanup is not scoped to a restaurant.** Line 69:
`svc.from("sessions").delete().eq("table_number", tnum)` — that removes table 9931's session in
**every** restaurant. §4 of the sweep rules: never a broad delete-whatever-is-there filter.
→ scope it, and delete by the id it inserted.

**2d — the category step writes to every restaurant sharing a slug, Aangan included.** Line 61:
`.update({ active: !data.active }).eq("slug", data.slug)` with no restaurant filter. On the dev
database the slug `drinks` is shared by **7** restaurants. It restores on the next line — and the
script then dies two steps later at 2b, so a kill in that window leaves a category switched off.
That is the scar §3 of the sweep rules opens with.
→ scope the flip to French House.

**2e — the dish step picks its row with an unscoped, unordered `.limit(1)`.** Line 51. It returned a
French House dish today; it may return Aangan's tomorrow.
→ `.eq("restaurant_id", FRENCH_HOUSE).order("id")`.

---

## 🔗 HANDOFF 3 — `verify:pointers` is red on clean `main`

**File:** `docs/GUARD-MAP.md` · **owner: T29** (`docs/**`) — **ledger NEVER FILED**

Checked out clean `origin/main` **aad569aa** and ran it **before changing anything**:

> `docs/GUARD-MAP.md` has no row for 2 check(s): `verify:split-payment`, `verify:t24-money-rules`

Both entries are new (`verify:t24-money-rules` from T24, `verify:split-payment` from PR #1089) and
landed without their GUARD-MAP rows. Re-confirmed after this terminal's own edits: same two, so
nothing here caused or worsened it.

**The change:** add a row for each in the section for the area it protects, naming what it needs and
whether it WRITES.

---

## 🔗 HANDOFF 4 — the counts written into CLAUDE.md and the sweep prompts are all wrong

**Files:** `CLAUDE.md`, `.claude/sweep/T*-PROMPT.md` · **owner: T29** — **ledger NEVER FILED**

| written | actual | command |
|---|---|---|
| 55 page routes | **56** | `find app -name page.tsx \| wc -l` |
| 81 API routes | **84** | `find app/api -name route.ts \| wc -l` |
| 339 migrations | **362** | `ls supabase/migrations/*.sql \| wc -l` |
| 48 `/api/admin/*` routes | **50** | `find app/api/admin -name route.ts \| wc -l` |

The last one matters most: CLAUDE.md's own invariant is "that count must equal the number that grep
`tokenIsValid`". Both are **50** today, so the invariant holds — but a terminal told "48" greps 48
and stops two files early. **The fix is to write the command, not the digit**, which
`docs/QA-500-PHASES.md` already does for the phase count ("Ask the suite, never a document").

---

## 🔗 HANDOFF 5 — three ledger files break "one ID, one check, forever"

**Files:** `.claude/sweep/LEDGER/T9.md`, `T13.md`, `T6.md` · owners: T9, T13, T6

- **T9 wrote 518 rows into a 500-id block**, so `P04501`–`P04518` name one check in `T9.md` and a
  *different* check in `T10.md`. 18 ids, two meanings each.
- **T13** repeats **15** ids inside itself (515 rows, 500 distinct).
- **T6** repeats **3** ids inside itself (503 rows, 500 distinct).

`LEDGER/INDEX.md` reserves **`P15001`–`P15100`** for exactly this repair and allocates
`P15001`–`P15036` to the three cases. A new sweep starts at `P15101`.

---

## 🔗 HANDOFF 6 — 73 ledger rows across 15 files do not render as table rows

**Files:** `.claude/sweep/LEDGER/T{1,2,3,4,6,8,10,11,12,13,15,16,17,18,23}.md` · owners: those terminals

A ledger row is `| id | check | how to verify | result | note |`. When a cell contains an
**unescaped `|`** — and they do, because the natural way to write these checks is
`grep -c 'a\|b' file` or `find … | wc -l` — the row splits into the wrong number of cells and
markdown stops rendering it as a row.

Counted with a split on unescaped pipes only (splitting naively under-counts, which is how this
went unnoticed):

| file | malformed rows | | file | malformed rows |
|---|---|---|---|---|
| T13 | 16 | | T15 | 5 |
| T1 | 14 | | T8 | 4 |
| T18 | 13 | | T12, T17, T23, T6 | 3 each |
| | | | T10, T2, T4 | 2 each |
| | | | T11, T16, T3 | 1 each |

**Who is worse off:** the next sweep. The text is still in the file, but the row is not a row, so it
is easy to skim past and nothing can count it. This terminal hit the same fault while writing its
own ledger and fixed it by escaping every cell at generation time.

**The change:** escape the pipe inside the cell — `\|` — wherever one appears in a `check`, `how to
verify` or `note` column. Mechanical, and the guard in
`.claude/sweep/T30-guard-verify-ledger-index.mjs.txt` finds every one of them by name.

---

## Coverage gaps — ground nobody was told to check

Recorded in full, with the reasoning, in `LEDGER/INDEX.md` → *THE GAP LIST*. In short: no file
anywhere is claimed by two territories (the fence held), but its arithmetic leaked in four places —
`components/PanelFrame.tsx` and `components/RealtimeProvider.tsx`, the four per-restaurant panel
doors, the print helper's screen and endpoint, and `app/api/admin/rate-limits/route.ts` (position 26
of 50, between T19's `head -25` and T20's `tail -24`). Plus four territories (T26–T29, `P12501`–`P14500`)
whose 2,000 checks have never been executed once.

---

## Checked carefully and NOT findings — do not re-file these

- **The owner's revenue includes soft-deleted bills.** Measured: French House August-to-date is
  ₹3,76,788 all-in versus ₹2,08,231.50 excluding binned bills. This is **required** —
  `docs/COMPLIANCE-GUARDRAILS.md` §4, and migration 309's header states the asymmetry (what is
  *owed* drops a deleted bill, what was *collected* keeps it).
- **The admin creating a restaurant seeds a menu without busting `menuTag`.** Checked precisely
  because it is the exact shape this terminal was sent to hunt. The restaurant id is a fresh uuid,
  so `menu-<rid>` cannot be warm. Not a fault.
- **Four admin screens showed the offline page.** The dev server compiles each route on first hit and
  `public/sw.js` has a deliberate 6-second navigation stall guard. All four render fine with
  `waitUntil: "networkidle"`. My own impatient check, not a product fault.
- **`document.body`'s background is identical in both owner skins.** The skin is painted on the
  shell. The light skin genuinely works — confirmed by reading the screenshot.
- **The per-restaurant manager door does not carry the admin's `?as=` pin.** The admin console links
  to `/manager?rid=…&as=…`, never to the slug door, so no named person loses anything.
- **No staff panel subscribes to the `audit` topic.** Migration 267 moved `staff_actions` off `ops`
  on purpose. The manager's Audit screen updating on the 60-second backstop is the consequence, and
  it is deliberate.
