# Sweep #10 · Terminal 14 — the bill and KOT document · findings

Territory: `docs/NUMBERING.md` · `lib/billCustomer.ts` · `lib/billPreview.ts` · `lib/printBoard.ts` ·
`lib/printBoardWords.ts` · `lib/printDocs.ts` · `public/panels/billcustomer.{css,js}` ·
`public/panels/billdoc.{js,d.ts}`. Ledger: `LEDGER/T14-S10.md` (503 new rows, P183001–P183640).

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

**Not fixed, needs the owner (in the chat report, Part 4):** what an old bill looks like after a
restaurant changes to the composition scheme (0 restaurants affected today); one 18% bill described two
ways when the restaurant has a CESS line; whether an unregistered "Bill" should name CGST/SGST.
