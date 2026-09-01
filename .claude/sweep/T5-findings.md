# T5 findings — the manager panel · sweep #7 (2026-08-23)

**Territory:** `app/manager/**` · `app/editor/**` · `public/panels/editor/{app.js,index.html,style.css}` ·
`public/panels/floor-layouts.js` · block `P17101`–`P17600`, plus a full re-run of `P02001`–`P02500`.

**Re-run of sweep #6's 500 rows: 499 ✅ · 1 ⏭ · NO REGRESSION.** Not one row that was green came
back red. Five rows had their expectation moved because the product legitimately changed (all five
owner decisions or shipped rework — see the ledger's sweep-#7 header); nine had a transcription
error in their stored regex repaired, with the check itself unchanged.

**New checks: 500 written, 500 executed, 500 ✅.** Every ❌ found on the way is fixed in this
branch and its row records the fixed state together with what the fault was.

**Everything below is fixed in `sweep7/t5-manager-panel`, one commit per item.**

---

## 1 · "unpaid" in the Bills search listed every cancelled bill

**Where it lives:** manager panel → **Bills** → **Previous bills** → the search box at the top →
what the list underneath shows.

Typing `unpaid` returned **313 bills, 310 of them CANCELLED** — bills that owe nothing — while the
day heading directly above the same list read *"3 bills · ₹20,664 collected · ₹1,449 still owed ·
290 cancelled"*. The list contradicted its own total. `due` and `outstanding` did the same.

`searchBlob()` wrote `"unpaid outstanding due"` onto any bill whose `paid` was false, and `paid` is
false for a cancelled bill **by construction**: `recOfGroup()` needs at least one live order to
call a bill paid, and a cancelled bill has none.

A cancelled bill now claims neither state. It is still found by `cancelled` / `void`.
**Measured after the fix:** `unpaid` → 3 rows, 0 cancelled, matching the heading for the first
time; `paid` → 20, unchanged; `cancelled` → 327, unchanged.

## 2 · Two places PRINTED a document from a write that never reached the server

**Where it lives:** manager panel → **Tables** → a table → **🖨 Print bill** (and Bills → a card →
Print bill) · manager panel → **Banquet** → **Issue bill**.

`api()` hands every non-GET to the offline outbox, and the outbox resolves `{ ok:true, queued:true }`
instead of throwing. Neither site ever saw a failure.

- `generateInvoice()` toasted *"Invoice generated"* and returned **TRUE**, so
  `printIssuingInvoice()` printed immediately — from `loadOrders()`'s saved copy, where
  `invoice_no` is still `null`. Its own comment says it returns true *"only when a number was
  actually issued"*, and that a printed bill with no number is what invoice-first exists to stop.
- The banquet path had every field of the reply `undefined`, so the toast read
  *"Bill undefined created — ₹0."* and it then printed a banquet **sheet** numbered `undefined`
  with ₹0 in every column — a document handed to a customer.

Both now say what is true, print nothing, and leave the write in the queue to land on reconnect.
The banquet button is re-enabled on that path, so the tap is never lost in silence.

## 3 · Three money messages said "undefined" or announced a blank number

**Where it lives:** manager → Tables → KOT ▾ → **On the house** · Tables → **Mark paid** → **Split
payment** → Go · Bills → a settled bill → **Credit note**.

*"On the house 🏠 — undefined orders settled at no charge"*, *"Paid in 3 parts 💳 — undefined orders
settled"*, *"Credit note # issued"*. The other split path in the same file already checked for a
queued write; this one was the odd one out.

## 4 · "Was the food made?" claimed an answer it had not sent

**Where it lives:** manager → **Audit & logs** → **Removals** → a cancelled KOT row →
**Yes, cooked** / **No, never started**.

Toasted *"Recorded as a loss of ₹441 — the ingredients stay used"*, then reloaded the record from
the saved copy where the row still read **"Not answered yet"**. The screen contradicted its own
message, and the sentence it picked was the one that claims a stock consequence.

## 5 · Park-on-khata and Merge announced a finished job over an unchanged floor

**Where it lives:** manager → Tables → KOT ▾ → **Pay later** · Tables → KOT ▾ → **Merge**.

Milder than 2–4 — neither printed the word `undefined`, both had a safe fallback — but *"📒 Parked
on <name>"* also cleared the open table while the party was still on the floor, and
*"Merged into T5 — one bill"* named the holding table from the screen's own guess because the
server's answer had not arrived.

## 6 · Four "REJECTED (owner, …)" comments pointed at somebody else's decision

**Where it lives:** backend only, nothing on screen — the comments in the code that record what the
owner has said NO to.

Three rows were added to `docs/REJECTED-IDEAS.md`, the numbers after them shifted, and four
comments kept citing the old ones:

| the comment | cited | the row actually is | what that number is NOW |
|---|---|---|---|
| `editor/app.js` no third "Order" face | R28 | **R31** | the guest menu's 3D-preload cap |
| `editor/style.css` the same rule | R28 | **R31** | as above |
| `editor/app.js` no 🍽️ Serve-all on the tile | R29 | **R32** | the guest call-waiter bell |
| `editor/app.js` the empty-party line | R30 | **R33** | the guest hero's translated fallback |

Anyone following "R29" out of the floor tile arrived at a decision about a guest-menu bell, with
nothing to say which of the two was wrong. `verify:rejected` stayed green through all of it: it
asks whether a comment exists near the code and whether it names the doc, never whether the NUMBER
lands on the right row.

## 7 · A parcel left overnight read "2709m"

**Where it lives:** manager panel → **Platform** tab → the small age chip on each order card.

`platAge()` returned bare minutes and never changed unit. At a glance "2709m" reads as roughly
forty-five minutes; it is forty-five **hours**, on the one board where age is the whole point.
It now steps minutes → hours → days — *"1d 21h"* — the same shape the kitchen wall already uses,
and returns `""` rather than `NaNm` for an unparsable timestamp.

---

## The guards this leaves behind

- **`npm run verify:queued-truth`** — NEW (`scripts/verify-queued-truth.mjs`). No server, no
  browser, no database. Four questions: `wasQueued()` still exists under that name; each of the
  six writes that announce money or mint a numbered document consults it; in the two places that
  print, the check comes BEFORE the print (compared by position, on comment-stripped code); and no
  ok-toast quotes a field off the server's reply without a queue check. **Deliberately narrow** —
  it does not demand a queue check at all ~60 write sites in the panel, because most of those are
  covered by the offline bar and the queue drawer, and a guard that failed on all sixty would be
  switched off within a week.
- **`npm run verify:rejected`** gains check **3b** — in a file the doc names as a code site, every
  rejection number a comment cites must be one of the numbers whose rows name that file. Proved by
  re-introducing the R29 drift: one red line, naming the file, the line and both decisions. Two
  earlier cuts of that check accused correct code and both are written into its comment so nobody
  re-tries them.
- **`npm run verify:panel-cache`** went red the moment `app.js` changed and was bumped — a staff
  device on the old `?v=` would have kept serving the pre-fix panel for up to 24 hours.

## What I deliberately did NOT do

- **P02326 is `⏭`.** Pressing Print on a live bill mints a real invoice number off the restaurant's
  own series. This run had no reason to burn one; the two faults behind that row are covered by
  `verify:panel-scope` and by item 2.
- **~60 other write sites** in this panel report success without asking the queue. I fixed the
  eight that announce money or mint a numbered document and left the rest. Naming all sixty as
  faults would have been dishonest and would have produced a guard nobody keeps.
- **Nothing was merged or deployed.** Sweep #7's rule: the run ends at an open PR.
