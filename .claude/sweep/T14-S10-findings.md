# Sweep #10 · Terminal 14 — the bill and KOT document · findings

Territory: `docs/NUMBERING.md` · `lib/billCustomer.ts` · `lib/billPreview.ts` · `lib/printBoard.ts` ·
`lib/printBoardWords.ts` · `lib/printDocs.ts` · `public/panels/billcustomer.{css,js}` ·
`public/panels/billdoc.{js,d.ts}`. Ledger: `LEDGER/T14-S10.md` (503 rows, P183001–P183640, + round 2's 534, P214001–P214590).

**Re-run:** 135 of 135 existing rows on these files, in place, 2026-10-12. Regressions: **0**. One row
re-decided: **P101066** had been green only because T11's `/…|FY|…/i` matched the "fy" in "verify" —
the page never stated the financial-year rule. Item 3 wrote it.

**Seven problems, all fixed, one commit each, each with a sabotage-tested guard:**

| # | what was wrong | guard |
|---|---|---|
| 1 | "Who is this bill for?" could not scroll — on a phone sideways or with the keyboard up, Generate bill was cut off and unreachable (manager panel + waiter tablet) | `verify:shared-panel-styles` §4 |
| 2 | one empty entry (a missing order, add-on, banquet advance or tax line) could still blank the guest's bill window; the guard checked billMoney, never billData | `verify:print-paper` hole block |
| 3 | `docs/NUMBERING.md` taught the removed "Reprint" button stamp (R62) and the reversed "re-issue = new invoice number" (mig 407); never stated the invoice's financial year; left a moved/merged table out of the honest gaps | `verify:bill-reprint` part 5 |
| 4 | the print computer's banquet sheet never read the restaurant's own banquet tax lines or "Prepared by"; the test banquet sheet said "GST 0%" for a 5% restaurant | `verify:print-helper` (settings derived from billdoc.js) |
| 5 | a bill from the waiter tablet or a print computer never named the customer it was made out to; the print computer's copy also ignored the print-customer switch and the MRP-tax setting, and had no logo | `verify:print-helper` |
| 6 | loyalty points never printed from the manager panel or the waiter tablet (billData dropped them) | `verify:print-helper` |
| 7 | on the waiter tablet the sheet's ✕ was a white browser button (its style lived only in the manager stylesheet) | `verify:shared-panel-styles` §5 |

**Checked and clean (the rows that prove it):** on 40 real French House bills the printed TOTAL equals
`SUM(orders.net_amount)` to the rupee (P183162); on 3,000 random bills every printed row foots to its
TOTAL and the TOTAL is billMoney's (P183401–P183402); KOT numbers unique per business day across all
channels on French House and Aangan (P183521–P183522); bill numbers drawn only at the first order or a
move onto a table (P183527); number-drawing functions not callable from a browser key (P183533); every
builder takes its restaurant from the print helper's own token (P183156–P183158).

**Needed the owner in round 1 — all three DECIDED 2026-10-16 and built in round 2 (below):** an old bill
after a switch to the composition scheme (item 13); one 18% bill described two ways with a CESS line
(item 14); whether a restaurant with no GSTIN charges tax at all (item 12 — his option c: it does not).

## Round 2 — 2026-10-16 · the owner's decisions built, then a fresh full test

His words: *"The sixth number thing should only be working when the feature toggle is on … there wouldn't be
any kind of clue also that there is a loyalty feature"* · *"for 12th do c option"* · *"for 14 you choose it"* ·
*"for the thing that you have listed other ones, uh, do all that"* · *"do a full bug test … replan whole test."*

| # | what changed | guard (each sabotage-tested) |
|---|---|---|
| 6 | Loyalty OFF leaves no trace — the customer sheet's privacy line names rewards only when the module is on (server ladder rule, `moduleOn`); the admin preview shows sample points only when it is on | `verify:print-helper` loyalty no-trace (27 switch combinations, sheet, both panels, preview, sample) |
| 8 | Esc closes "Who is this bill for?", like every other panel dialog | `verify:shared-panel-styles` §6 |
| 9 | the printing board's waiting time says "1 minute", "1 hour", "a whole day" — never "1 minutes" or "24 hours"; the panel's copy matches the server's words | `verify:print-helper` waitedWords ↔ fmtWaited parity |
| 10 | on a phone, a preview's explanation gets its own row instead of an 11-line column (bill, KOT and banquet previews) | `verify:print-paper` item 10 |
| 11 | dead bits removed and notes made true (unused imports, a `:disabled` rule nothing could reach, the 6-digit lookup comment, the banquet tax type spelled out) | `verify:shared-panel-styles` §7 |
| 12 | **a restaurant with no GSTIN charges no tax** — SQL (mig 426: `lfh_effective_tax_rate`, `lfh_banquet_tax_rate`, guest payload's `gst_registered`), `lib/tax.ts`, the bill file, the waiter tablet's fallbacks; the banquet sheet is titled Bill / Tax Invoice / Bill of Supply by the bill's rule; the admin preview shows no tax rows. Already-stamped orders keep the tax they charged | `verify:print-paper` item 12 block, `verify:print-format` §9c, `verify:tax-mode` (a settings read that decides the rate must include gstin) |
| 13 | a reprint never hides the tax a bill CHARGED behind today's composition scheme — what the bill charged names the paper | `verify:print-paper` item 13, §3f split in two |
| 14 | each rate is named by the restaurant's OWN set of lines whose rates add up to it (dine-in set, then banquet set, then CGST/SGST halves) — same rule on a single-rate bill, each slice of a mixed bill and a banquet sheet; no invented "CESS 3%" | `verify:print-format` §9b (RE-DECIDED), §9c |

**The fresh test** (`LEDGER/T14-S10.md` → ROUND 2): 534 rows · 522 ✅ · 12 ⏭ · **0 ❌, 0 new product
faults**. The 539 round-1 rows re-ran green on the same code; four were RE-STATED for items 12–14 and each was
re-checked by reverting the change it pins. Firefox was not driven (not installed; Chromium + WebKit were).

**Outside T14's files, seen on main, not touched:** the T30 harness rows P167392 / P210054 (`lib/clash.ts`)
and sweep #8 T11 bank J's positional ids (shifted by the 2026-09-13 mig-380 removal) — left to their owners.

**Not released to AV live.** Item 12 changes money for a GSTIN-less restaurant; it needs his own words naming
AV live before it goes there.
