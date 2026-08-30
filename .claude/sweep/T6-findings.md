# T6 — THE KITCHEN SCREEN · sweep #7 · problems found, and fixed in this PR

Territory: `app/kitchen/**`, `public/panels/kitchen/{index.html,style.css,app.js}`.
Branch: `sweep7/t6-kitchen-screen`, off `origin/main` **b64951ad**.
Restaurant used for every runtime check: **French House** (writable). **Aangan was never written to.**
Dev server on **port 4206** from this terminal's own worktree — `lsof` confirmed the listening
process's cwd was `wt-s7-t6` before a single measurement was trusted.

**500 ledger rows re-run · 0 regressions · 500 new checks · 3 problems, all three fixed here.**

Every fix is covered by a check in `scripts/verify-ready-tile-and-kitchen.mjs`
(`npm run verify:ready-tile`), and every one of those checks was **proved to fail** with its fix
taken back out.

---

## 1 · A take-back put the dish back in the data and left the screen saying READY · HIGH · watched

**Who is worse off** — the cook (told the dish was put back, cannot re-send it), the waiter and the
manager (their screens show the truth, so the two disagree), the guest (waits on a dish the pass
believes is finished).

**When it happens** — a ticket with **more than one cooking dish**. The cook taps ✓ on one, realises
it was the wrong dish, and taps UNDO inside the four-second window.

**What happened** — the write landed: the server read `preparing` within a second. The kitchen board
kept the dish painted **READY with no ✓** — measured still wrong ten seconds later and after a forced
whole-board read. It only heals when something else changes that ticket's html, which on an old
ticket is the age text, once an hour.

**Watched happening**, two-dish ticket, UNDO tapped 450ms after the bar appeared:

```
AFTER ✓   ticks=[2nd dish]  lines=["line line-ready :: 1× Pink Pineapple Smoothie READY", "line :: 2× Avocado ✓"]
undo tapped: true after 450 ms
+1s   server=preparing   screen: ["line line-ready :: 1× Pink Pineapple Smoothie READY", "line :: 2× Avocado ✓"]
+10s  server=preparing   screen: unchanged        ← the fault
after the fix
+1s   server=preparing   screen: ["line :: 1× Pink Pineapple Smoothie ✓", "line :: 2× Avocado ✓"]
```

**Why** — the same cause as the refused ✓ fixed on 2026-08-19, on the other door. The ✓ tap edits one
line in place with `btn.outerHTML`, which never touches the card's `__kdsHtml` stamp; once the status
is restored the desired html matches that stale stamp exactly, `reconcileList` concludes "unchanged,
reuse the node", and the node it reuses is the one with no ✓ on it. A **single-dish** ticket hides it,
because finishing it moves the card to Ready and that rebuild re-stamps — which is exactly why the
note inside `undoReady()` claimed the call was unnecessary and said it had been "measured both ways".
That note said the opposite of the truth and is replaced with what was actually measured.

**Fix** — `undoReady()` collects every ticket the take-back touches (a per-dish take-back carries no
order id, so the ticket is found from the dish's own row) and forgets each card's stamp **before** the
repaint. Guard: three checks.

---

## 2 · A busy evening wrote unreadable rows into the owner's Everything Log · MEDIUM · watched

**Who is worse off** — the owner (rows in the log he reads that name a database sentence and nothing
he can act on), and the cook (told nothing at all).

**When it happens** — any post-write refresh while the database is slow or refusing: a take-back, a
refused ✓, a refused ALL READY, or a platform action.

**What happened** — `load()` and `freshLoad()` **reject** when the read fails; that is deliberate,
because `backoffPoll` and `LFH_RT.catchUp` back off on exactly that. Every timer and listener in the
panel therefore writes `load().catch(() => {})`. **Five post-write refreshes did not**, and nothing
awaited them — so a failed read became an unhandled promise rejection, and `public/panels/errlog.js`
reports every one of those straight into the Everything Log.

**Watched happening** — board answering 503 `the database is very busy`, cook taps UNDO:

```
unhandled rejections seen in the frame: [ "REJECTION: the database is very busy" ]
console/page errors:                    [ "pageerror: Error: the database is very busy" ]
toast:                                  (empty)
after the fix
unhandled rejections seen in the frame: []
```

*(Reproducing this needed `serviceWorkers: "block"` — `sw.js` answers the board GET, so route
interception never sees it and the read comes back 200 however hard the network is broken.)*

**Fix** — the five sites go through `refreshQuietly()`, which is `freshLoad()` with the file's own
convention applied. It swallows the **read** only: every write still reports its own outcome, and the
person has already been told what they need (the refusal toast fired, and the offline/busy bar owns
"the system is very busy"). Guard: three checks, including one that refuses a bare `freshLoad();`.

---

## 3 · A ticket with no table said `Tnull` on screen while the paper said `T?` · MEDIUM · measured

**Who is worse off** — anyone reading a banquet ticket, and the product's own standard: a raw `null`
on a staff screen is on `verify:live`'s leaked-value list.

**When it happens** — `orders.table_number` may be null (a banquet bill with the table left blank).
The live-board query filters on archived, deleted, status and the business day — it does **not**
exclude a null table.

**What happened** — measured by running the shipped helpers:

| `table_number` | ticket header (before) | printed KOT label |
|---|---|---|
| `null` | **Tnull** | T? |
| `""` | **T** | T? |
| `undefined` | **Tundefined** | T? |
| `7` | T7 | T7 |

`tlong()` was hardened for exactly this case — its own comment says "T?, never Tnull" — and
`tshort()`, which is what the ticket header a cook reads goes through, was not. The `title` attribute
on that very span **is** already guarded, so half of that line was fixed and half was missed.

**Fix** — `tshort()` carries the same guard. A real table number is untouched and table 0 is still
shown rather than swallowed by a falsy test. Guard: eight checks that **run** both helpers.

---

## Findings WITHDRAWN — my own harness being wrong

Recorded because a withdrawn finding is as useful as a confirmed one: it stops the next sweep filing
it again. The full list is in the ledger's third-pass section. The four that cost the most time:

- **A coordinate click misses on a repainting board.** Playwright's `.click()` hit the ✓ and nothing
  happened — the reconciler had replaced the card between the hit-test and the dispatch. Every ticket
  control is now tapped with an atomic in-frame click.
- **The take-back bar lives four seconds** and is shown from the POST's `.then`, so it can arrive a
  second or two late on a shared database — and removing its node breaks it for the rest of the
  session, because `undobar.js` caches the element. `LFH_UNDO.dismiss()`.
- **`.awaiting` measured 2.24:1.** It sits on a 12%-alpha wash; reading that as opaque invents a
  contrast failure. Composite the alpha stack.
- **"The manager cannot mark a dish ready."** Correct and deliberate — `/api/editor/items/:id/status`
  accepts received/preparing/served. READY is the kitchen's word.

## Rejections re-checked and still honoured

R3 (no collapsing an empty column) · R5 (no ageing signal on Ready) · R7 (no profile of any kind,
anywhere — including the new ☰ menu and Settings) · R21 (no `errText()` here) · R40 and R41 (the
connection pill's size, and the phone bar's button widths). **None of them is re-offered**, and the
ledger carries a line saying so, so the next sweep does not re-measure R40/R41 either.
