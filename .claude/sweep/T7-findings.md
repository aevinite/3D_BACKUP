# T7 findings — the waiter tablet (sweep #7, 2026-08-22/23)

**Territory:** `app/tablet/**` · `public/panels/tablet/{app.js,index.html,style.css}`
**Branch:** `sweep7/t7-waiter-tablet` · **Base:** `origin/main` b64951ad · **Port:** 4207
**Ledger:** `.claude/sweep/LEDGER/T7.md` — all 500 existing rows re-run, 302 new rows added
(`P18101`–`P18404`).

**Improvement ideas are NOT in this file.** They were printed in the terminal, which is what the
owner asked for on 2026-08-22. This file is problems only.

---

## The headline: no regression, and the panel is in good shape

All 500 sweep-#6 rows were re-run. **Not one went from ✅ to ❌.** The 16 `❌→✅` fixes from sweep #6
all still hold, and the four `⏭` are still skipped for the same written reasons. That matters more
than anything below: the tile-clipping fix (P03314), the merge/unmerge work, the "never drop a tap"
fixes and the party-slice rewrite (P03047) are all still doing their jobs, verified on a real party.

Three things were found. **One is a real product fault a waiter would hit. One is an unfinished fix
from the day before. One is a guard that had quietly stopped running.**

---

## 1 · A 40-paise shortfall told the waiter "₹0 of the bill is still uncovered"  — FIXED

**Where it lives:** waiter tablet → tap a table → **💳 Mark bill paid** → **Split payment**. What he
would see: the running line says "₹0.40 still to cover", and the refusal directly under it says
"**₹0** of the bill is still uncovered." Take payment refuses, names nothing, and refuses again on
the next tap. There is nothing on screen that tells the waiter what is wrong.

**Measured** on a ₹483 bill at 1194×834 and 360×780:

| | says |
|---|---|
| the running line (`inrExact`) | `₹0.40 still to cover` |
| the refusal (`inr`) | `₹0 of the bill is still uncovered.` |

Two halves of one sentence disagreeing about one number. This panel declares both helpers on
purpose, and the note above `inrExact` states the rule in a line: `inr()` rounds to whole rupees,
and "the ONE place that is wrong is a figure the person has to MATCH — the server recomputes the due
to the paise." The three refusals below quote exactly that kind of figure and used the rounding one.

**Reachable** the moment a waiter edits a box — which is the whole point of the panel ("the amounts
fill in evenly and you can change any of them") — and by **＋ Add another part**, which seeds the new
box with the exact remainder. The KOT-menu split had the worse version of it: "The shares must add up
to exactly ₹483" on a bill whose due is ₹483.33 is a target that cannot be typed.

**Fixed** in the three places that quote a figure a person must match; headings keep `inr()`, because
a title is not something anyone has to match. Verified live: `₹0.40 of the bill is still uncovered`,
`₹0.40 more than the bill`, and a ₹50 gap still reads `₹50` — not `₹50.00`.

**Guard:** `verify:tablet-taps` §9, four checks. Each proved red with the fault restored, green
without it. Commit `a3c412a4`. Ledger `P18293`, `P18303`, `P18304`.

---

## 2 · "Every overlay dims by the same amount" had reached 4 of 15 overlays  — FIXED

**Where it lives:** waiter tablet → tap a table, then its **− Discount whole bill**, then answer its
confirm. What he would see: the floor behind dims by **three different amounts in one action**, each
step a slightly different grey.

`--scrim` was added to this panel on 2026-08-22 under the message *"all three staff panels: every
full-screen overlay dims the page by the same amount"*, and its own comment names the problem: *"each
one had picked its own value … Two overlays on the same screen therefore dimmed by different amounts,
which is the sort of thing that makes one product feel like several."*

**Measured** by reading each overlay's computed `backgroundColor` on the running panel:

| dim | overlays |
|---|---|
| `rgba(3, 7, 16, 0.60)` — the token | confirm · drawer · dish-options popup · quick-order picker |
| `rgba(4, 8, 18, 0.66)` | discount · table type · payment · pay-later person · settings · dish edit · manager PIN · reason · price · ＋Other allergy — **ten**, all built in `app.js` |
| `rgba(4, 8, 18, 0.5)` | the table-detail backdrop — the one a waiter sees more than any other |

`rgba(4,8,18,.66)` is one of the four values that commit's own comment lists as the fault.

**Fixed:** the ten hand-built overlays read `var(--scrim)`, and so does the detail backdrop.
Re-measured: all fifteen report `rgba(3, 7, 16, 0.6)`. The **blur** is deliberately left at each
overlay's own value — a heavier blur is how a stacked layer says it is on top, and that commit says
so.

**Not touched, because he has already ruled on it:** the ~30×27px ✕ on these sheets is **R22**
(owner, 2026-08-13, after looking at a screenshot: *"x is fine"* — do not pad it, do not resize it,
do not re-report it). Only the dim changed; every close button is byte-identical.

**Guard:** `verify:tablet-taps` §10, four checks, each negative-tested. It reads whole declaration
BLOCKS rather than a fixed character window, so a comment someone adds later cannot make it cry
wolf. Commit `dbe43c17`. Ledger `P18302`.

---

## 3 · `verify:tablet` died at check 81 of 103, and looked like a product fault  — FIXED

`npm run verify:tablet` reported 80 green checks and then crashed:

```
frame.click: Timeout 30000ms exceeded.
  locator resolved to <button disabled id="sendOrder" ...>CHOOSE TABLE & SEND →</button>
  - element is not enabled
```

That reads as a broken panel. It is not. SEND is **correctly** disabled because the cart is empty,
because the guard's own dish tap added nothing:

```js
await F.click(".dish:not(.out)");
```

That takes whatever the menu renders first — and on little French house the first dish is the **one
dish with size options** (Espresso, 3 groups). A dish with options deliberately does not quick-add;
it opens the options popup, which is this panel's own written rule.

**What it cost,** measured before and after: the crash threw outside the section's soft-retry, so
everything after it never executed — the whole end-to-end loop (order → the picker sends it → serve →
settle → the finished tile's ⏻ → the close confirm → the table is free again), the touch-size pass at
1194px and 1024px including "no tile clips at touch size", the final "no page errors anywhere", and
its own `sweepUp()` cleanup, so a crashed run could leave a test party on a table. **23 checks nobody
was told had stopped running.**

**Fixed** by picking a dish that quick-adds — no option groups, no open price, not sold out — and
then PROVING the tap landed instead of finding out 30 seconds later at a disabled button. A menu with
no quick-addable dish now says so and retries, through the section's existing soft-failure path.

`before: 80 ok, then an uncaught exception` → `after: All 103 checks passed`. No product file is
touched. Commit `498ce623`. Ledger `P18405` is reserved for its re-check.

---

## WITHDRAWN — five red rows that were MY OWN CHECK, not the product

Written down so the next sweep does not re-file them. Every one of these looked like a real fault
until it was checked against the file it accused.

| what my check claimed | what was actually true |
|---|---|
| **"Tapping a dish adds nothing to the cart"** — reproduced on all three devices, `state.cart` stayed `[]` | My selector took the FIRST dish, which is the only one on this menu **with size options**. Tapping it correctly opens the options popup instead of quick-adding. 58 of 59 dishes are plain. Pick a dish with no options, no open price, not sold out. (Same root cause as finding 3.) |
| **"A typed per-dish allergy vanishes"** — the set stayed empty and the chip never appeared | `document.querySelector("[data-alg-other]")` also matches the **CART's whole-order avoid row**, which sits earlier in the document and is `display:none` while browsing but still present. My allergy went onto the whole-order list. **Scope every options-popup selector to `#optOverlay`.** |
| **"Backing out of an order for a free table does not return to the floor"** | The tile READ free but held an open session — a party with nothing ordered is deliberately drawn as Free (owner, 2026-07-31), and keeping its detail is right. Select on the RAW summary state, not the tile's class. |
| **"The dark skin fails contrast at 1.11:1"** on nine floor labels | A tile's background is a `linear-gradient`, i.e. `background-image`, so `backgroundColor` is transparent; my walk up the ancestors fell through to a **white fallback**. The screenshot shows a perfectly readable dark floor. Compute contrast against a resolved backdrop — or just look at it. |
| **"The admin ribbon is missing"** | `?rid=` is deliberately ignored without the console's **act-as** cookie. `requirePanel` says so in its own comment, and `/manager?rid=` redirects identically, so it is not a tablet fault. |

Two more cost false reds through timing alone, and both are worth knowing:

* **`page.goBack()` is the wrong tool on this panel.** The back-stack uses `pushState` inside the
  panel iframe, so there is no `load` navigation to wait for and it times out after 30s. Use
  `page.evaluate(() => history.back())`.
* **Toasts self-remove after 2.6s.** A read taken after a 6-second settle finds none. Capture them
  with a `MutationObserver` on `#toasts` as they appear.

---

## Left open, honestly

| what | why | who should take it |
|---|---|---|
| The admin view's geometry (`P18374`–`P18404`, and `P03399`/`P03406`) | needs the console's act-as cookie — a browser-wide write this terminal would not make on a shared stack | a session that enters through /aevinite → Restaurants → the panel link |
| `verify:offline` (`P03268`) | needs a production build on its own port; this port was carrying the live walk | any later session |
| `verify:merged-floor` (`P03461`) | drives the MANAGER's floating tables, not this panel | T5's territory |
| The KOT-menu split, banquet billing, an MRP/open-price menu, a sectioned waiter, the offline WRITE path | each needs a SETTING this restaurant does not have on, or a fixture this pass did not build | listed with reserved ids at the bottom of `T7.md` |

## Guards run for this territory, all green

`verify:tablet` (103) · `verify:tablet-taps` (60, incl. the 8 new) · `verify:tablet-parity` ·
`verify:tablet-wants-in` · `verify:taps` (33) · `verify:floor` · `verify:floor-per-row` ·
`verify:floor-offplan` · `verify:table-ownership` · `verify:board-sig` · `verify:twins` ·
`verify:static` (32) · `verify:rejected` · `verify:clash-coverage` · `verify:panel-cache` (57) ·
`verify:busy` (33) · `verify:access` (50) · `verify:ui` · `verify:ledger-index` (14,820 rows).
`npm run typecheck` passes; `npm run lint` has 0 errors and the same 630 warnings as `origin/main`
(none in my files).

---
---

# ══ SWEEP #8 · TERMINAL 7 — the manager panel, part B ══

*(Everything above is sweep #7's waiter-tablet findings and was not touched. Sweep #8 re-cut the
territories from the real file tree, so "terminal 7" now means a different part of the product —
see the banner at the top of `.claude/sweep/LEDGER/T7.md`.)*

Territory: `public/panels/editor/app.js` lines 9,300→end · `public/panels/editor/inventory.js` ·
`public/panels/floor-layouts.js`. Rows: `.claude/sweep/LEDGER/T7.md`, sweep-#8 section.
Every item below is ONE commit, with its number in the message, so a single one can be dropped.

| # | what was wrong | where a person meets it | how it was proved |
|---|---|---|---|
| 1 | a dish edit SAVED and then said **"Couldn't save: _wq is not defined"** | manager → a table → ✎ Edit → ✎ Edit on a dish → Save | scope-resolved the file (acorn + eslint-scope), then drove the toast in a real browser (`P61205`/`P61206`) |
| 2 | restoring a binned bill worked and said **nothing at all** — the same `_wq` shape, thrown outside every `try` | manager → Bills → a deleted bill → Restore | same scope resolution; the throw is on the success path |
| 3 | `LFH_PROFILE_GET()` threw **"deadline is not defined"** on every call, on every panel that loads `maint.js` | any panel → 💳 My profile & pay | ran the file's head in a Node sandbox: `REJECTED: ReferenceError: deadline is not defined` before, `RESOLVED` with an 8s signal after |
| 4 | 🍴 Split the bill showed **₹111 five times for a ₹555.55 bill** (₹0.55 short), and its shares had lost a paisa before that | manager → a table → 🍴 Split | driven and screenshotted at 360px (`P61207`/`P61208`) |
| 5 | an expense with a **blank amount** was saved as ₹0 and answered "Expense recorded" | manager → 📦 Inventory → 💸 Expenses → + Add expense | driven: the card now stays open and says "Enter the amount" (`P61213`) |
| 6 | a stock search that matched nothing said **"No ingredients yet — add your first one."** | manager → 📦 Inventory → 📦 Stock → search | driven with 2 ingredients loaded (`P61211`/`P61212`) |
| 7 | 45 lines of dead wiring for a printer strip the owner deleted on 2026-08-31 | backend only, nothing on screen | nothing emits `data-prok` / `data-prhere` / `data-prsetup`; `printJobHere()` had one caller, that dead line (`P61214`) |
| 8 | the ＋ Simulate order menu stopped closing on an outside click after the first time | manager → 🛵 Platform → ＋ Simulate order | `{ once: true }` on a document listener registered at bind time |
| 9 | six money boxes on the banquet bill declared **whole rupees only** | manager → 🎪 Banquet → ＋ New bill | read off the rendered inputs; the rate box is filled with `249.5` (`P61209`/`P61210`) |
| 10 | `LFH_INV.reset()` was a public function **nothing in the repo called** | backend only, nothing on screen | repo-wide grep; deleted with an obituary |

**The guard left behind:** `npm run verify:panel-names` — every name a panel READS must exist where
it is read. Sabotage-tested against both the `_wq` and the `deadline` shapes; both go red.
