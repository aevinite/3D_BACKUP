# T8 findings — printing, the bill document & the numbers on it

Sweep #6, phases P03501–P04000. Territory: `public/panels/billdoc.js`, `public/panels/billdoc.d.ts`,
`public/panels/billcustomer.js`, `docs/NUMBERING.md`.

**8 real problems, all fixed in this branch. 2 safe improvements built. 1 handoff, 2 decisions for
the owner.** Every fix was proven by re-running the check against the pre-fix code (it fails) and
the fixed code (it passes).

**Came back CLEAN** (no fault found, after real checking): the bill's money arithmetic on the plain,
discounted, mixed-rate, tax-inside and composition shapes · `splitTax` / `billRows` / `orderTaxRate`
/ `taxModel` / `combineBillLines` · the whole banquet sheet (T7's F10 and I8 fixes are holding to
the paisa) · every escaping path · the invoice-number formatting and financial year · the parcel
and platform numbering (mig 261) · the reprint banner · the one-ink rule · the 80mm fit.

---

## F1 · HIGH · confirmed — the kitchen ticket's time and day came from the DEVICE, not the restaurant

**Where:** kitchen panel → the printed KOT, and manager panel → Orders → 🖨 (both tickets) → the
line under "KOT #… / <table>" that shows the time.

`kotWhen()` in `public/panels/billdoc.js` took its time from `toLocaleTimeString([], …)` — the
machine's own locale AND its own time zone — and decided today / YESTERDAY / a date by comparing
local calendar dates. One order rung at **2026-08-16 21:31 IST**, printed on four devices:

| device | the ticket said | the BILL for the same order said |
|---|---|---|
| India tablet | `YESTERDAY 09:31 pm` | 16/08/2026 09:31 pm |
| New York | `12:01 pm` | 16/08/2026 09:31 pm |
| London | `YESTERDAY 05:01 pm` | 16/08/2026 09:31 pm |
| Sydney | `02:01 am` | 16/08/2026 09:31 pm |

Four times, three days. The thermal bill was pinned to en-IN + Asia/Kolkata on 2026-08-05 and the
banquet sheet on 2026-08-06; **the ticket was the one document still on device time**, and the
comment directly above it says a kitchen ticket "must read the same on every device in the
building" — only the month name had ever been made to obey it.

Second half: "today" was the CALENDAR day. Everywhere else in this product it is the **05:00 IST
business day** (mig 044, `lib/businessDay.ts`, `docs/NUMBERING.md`) — the counters, every panel's
Today filter and the Z-report. So a ticket rung at 23:50 and reprinted at 00:10 of the SAME rush
came back branded YESTERDAY while the board still said today.

**Who is worse off:** the kitchen and the manager. A device not set to India time hands a cook a
time hours out and a day that is wrong — which is exactly the confusion this function was written
to remove. **Reachable:** any staff device whose OS zone or locale is not India (a tablet bought
abroad, one left on its factory zone), and every restaurant that serves past midnight.

**Fixed:** time and date parts pinned to en-IN + Asia/Kolkata (uppercased, as the .d.ts already
documented); the today/yesterday decision moved onto the 05:00 IST business day, derived the same
way `businessDayDate()` derives it. Trade-off written into the comment: a ticket rung at 03:00 and
reprinted after 05:00 now says YESTERDAY on the same calendar date — which is correct, because the
restaurant has turned its day over by then and every other "today" in the product turned with it.

---

## F5 · HIGH · confirmed — an MRP bottle was billed once but PRINTED twice, hidden by a ₹40 "round off"

**Where:** manager panel → a table → 🖨 Print bill (and the waiter tablet's bill, and the Access →
"Format of the bill" preview) → the money block under the items. Only on a restaurant that sells
MRP items and has **Settings → MRP treated as tax-inclusive**.

A ₹400 dal beside two ₹21 sealed bottles printed:

```
Food subtotal   ₹442     ← the WHOLE bill, under a heading that says food
CGST 2.5%        ₹9      ← ₹18 of a ₹20 tax; the other ₹2 pushed below the total
SGST 2.5%        ₹9
MRP items       ₹42      ← the bottles, a second time
Round off     − ₹40      ← the double count, silently clawed back
TOTAL          ₹462
```

An MRP line is kept OUT of the order's taxable base (that is what `nontax_amount` is) and the tax
inside its price is the manufacturer's, reported separately. But an MRP line whose `tax_mode` is
`"incl"` is not `"exempt"`, so it fell through into `grossTaxed` **and** `netIncl` in `billMoney` —
counted as a taxed item row, and counted again as the "MRP items" row the document adds after the
tax.

**The amount charged was always right (₹462).** Every row explaining it was wrong, on a document
headed Tax Invoice, and a "Round off" of ₹40 on a ₹462 bill contradicts this file's own note that
the row carries "at most a rupee or two". A guest who adds the column up cannot be shown where the
rupee went — the exact fault class `billRows()` was written to end.

**Who is worse off:** the guest holding it, and the restaurant that has to explain it.
**Reachable:** `mrp_tax_treatment = "inclusive"` plus any MRP line — a shop selling sealed bottles.

**Fixed:** an `is_mrp` line is skipped by both sums when its order really does hold it outside the
taxable base (`nontax_amount > 0`). The same bill now prints Food subtotal ₹400 · CGST ₹10 · SGST
₹10 · MRP items ₹42 · TOTAL ₹462, with **no round-off at all**, and the "MRP items include ₹2 GST"
note unchanged. Money did not move. An order carrying MRP lines with no `nontax_amount` behaves
exactly as before.

**How it was found:** by reading the rendered screenshot and adding the column up by hand (P03884).
Every code-read row above it had passed.

---

## F4 · MEDIUM · confirmed — "Generate bill" swallowed the tap it was written to answer

**Where:** manager panel and waiter tablet → generate a bill → the "Who is this bill for?" sheet →
the gold **Generate bill** button.

The button carried the real `disabled` attribute. A disabled button emits no click at all, so the
handler directly beneath it — the one that says WHICH box is missing and puts the cursor in it,
written explicitly against the panel rule that *"a tap must NEVER die in silence"* — **could never
run**. Exactly when a waiter needs telling (nine digits typed, or a complete number with no name),
tapping the primary button did nothing whatsoever: no message, no focus, no toast.

**Who is worse off:** the waiter at the till, mid-rush, tapping a button that ignores them.
**Reachable:** every incomplete sheet, which is every sheet before it is finished.

**Fixed:** the button now only LOOKS not-ready and stays tappable. The look is the three
declarations `.bcust-foot .btn.primary:disabled` applies in the panel stylesheet, mirrored inline,
plus killing the ready-state glow; `aria-disabled` keeps it honest for a screen reader. Measured
before/after: `.45 / not-allowed / no glow` → `1 / pointer / gold glow` — visually identical to
what shipped. Enter on the name box now also goes through the button, so it refuses visibly too.
The handler was widened to refuse a half-typed number on the *optional* path as well — it is now
the only thing between a mis-tap and a five-digit "mobile number" saved against a bill.

---

## F3 · MEDIUM · confirmed — correcting a digit threw the cursor to the end of the number

**Where:** the same sheet → the **Mobile number** box.

Reformatting the box to "98250 12345" reassigns `.value` on every keystroke, which drops the caret
to the end. A waiter who spotted a wrong third digit, tapped there and typed found the cursor had
jumped and the next keystroke landed at the far end of the number. At the till that means retyping
all ten digits.

**Fixed:** count the DIGITS before the caret, rewrite, put the caret back after that many digits
(the space the format adds is not a digit, so the count survives). Measured headless: typing "7"
at position 3 of "9825012345" now leaves the caret at 4; Backspace mid-number leaves it at 3;
typing straight through still lands at the end, exactly as before.

---

## F2 · LOW · confirmed — a clamped discount printed a percentage nobody was given

**Where:** any printed bill → the **Discount** row.

`billRows()` clamps a discount larger than the row it comes off (added 2026-08-06 so no negative
"Taxable value" reaches a guest), but the LABEL was the caller's own string and printed unchanged:
`Discount (150%)  − ₹100` against a subtotal of ₹100. Every panel path clamps before it gets here,
but `billDocHtml` is also called directly with hand-built figures by `lib/billPreview.ts`, the admin
preview and `lib/auditDetail.ts` — which is the same reasoning that put the clamp there in the
first place.

**Fixed:** when, and only when, the clamp bites, the label is re-worded from what the document
really deducted. An ordinary bill keeps the caller's own label byte-for-byte (verified).

---

## F6 · LOW · code-read — the flag the whole document's identity turns on was undeclared

**Where:** backend only, nothing on screen — `public/panels/billdoc.d.ts`.

`billDocHtml` branches its heading, its `<title>`, its band and its entire money block on
`d.cancelled`, and `billData` returns it — but `BillDocData` did not declare it. The `.d.ts` is what
the Next server and the admin React screens see, so a TypeScript caller **could not render a
cancelled bill at all**. **Fixed:** declared, with the behaviour it selects written down.

---

## F7 · LOW · code-read — a field documented as if the document rendered it

**Where:** backend only, nothing on screen — `public/panels/billdoc.d.ts`.

`taxable?: number` read as an input to the "Taxable value" row. `billDocHtml` never reads it — the
row is DERIVED inside `billRows()` precisely so it cannot disagree with the two rows above it — yet
four callers pass a value that is silently discarded. **Fixed:** the declaration now says so.

---

## F8 · LOW · code-read — the numbering index omitted its two newest rules

**Where:** `docs/NUMBERING.md` → "Where each rule actually lives".

The prose leans on migrations 261 (one KOT series, all channels) and 331 (a cancelled sale takes no
invoice number), and the index table — the part anyone actually scans — listed neither, nor 051.
**Fixed:** all three added, plus a line saying to find these by CONTENT rather than by the number in
the filename (18 numbers are already duplicated on `main`).

---

## 🟢 IMPROVEMENTS BUILT

### I1 — `docs/NUMBERING.md` now names the signed chain (mig 332)
The page tells anyone asking "where did that number go?" to check the Audit and the admin bill
ledger. Since mig 332 there is a stronger answer — the hash-chained ledger written the moment a bill
becomes a tax document — and the page did not mention it. Added as a third bullet, pointing at the
migration rather than restating it.

### I2 — the customer-suggestion rows are a real tap target
Measured 29px on a 360px phone. A row here puts a NAMED PERSON on a tax invoice, so a mis-tap does
not merely annoy — it bills the wrong customer. Now `min-height:44px` with the content centred, so a
two-line name still grows rather than being squeezed.

---

## 🔗 HANDOFF 1 → T28 (`scripts/**` + the `verify:*` entries in `package.json`)

**Add `scripts/verify-billdoc-paper.mjs` and wire it as `"verify:print-paper": "node
scripts/verify-billdoc-paper.mjs"`.** I wrote and proved it — it FAILS with 8 checks on the pre-fix
code and passes on the fixed code — but `scripts/**` is T28's territory, so I did not land it.

It closes the fault class that has now been fixed three times in three places and guarded zero
times: a document that renders correctly in development and differently on the machine that prints
it (the bill's date 2026-08-05, the banquet sheet 2026-08-06, the ticket 2026-08-17). It re-renders
every document in child processes pinned to five time zones and asserts the output is identical; it
also pins the MRP double-count, the clamped-discount label, the `.d.ts`-completeness rule and the
migrations `docs/NUMBERING.md` points at. Static — no database, no login, no browser, no dev server.

The complete source is at the end of this file.

## 🔗 HANDOFF 2 → whoever owns `lib/auditDetail.ts`

**`lib/auditDetail.ts` line ~136: `tableDisp: was.table_number != null ? String(was.table_number) : "—"`.**

Every other document in this product resolves a renamed table before printing it — the bill and the
KOT via `tableName()` / `tablePrintLabel()`, the banquet sheet inside `banquetDocHtml` itself. The
Audit's evidence card prints the bare digit, so a restaurant that renamed T5 to "Terrace 2" sees
"Terrace 2" on the paper the guest was handed and "5" on the record of it being removed.

**The change:** read `settings.table_names` (already fetched two lines above) and prefer the name,
exactly as `banquetDocHtml` does:
```ts
tableDisp: (() => {
  const t = String(was.table_number ?? "").trim();
  if (!t) return "—";
  return (((settings.table_names as Record<string, string>) || {})[t] || "").trim() || t;
})(),
```
Judgement call for that terminal: the snapshot is historical, so an argument exists for printing the
name as it was AT THE TIME. But the record currently shows neither — it shows a bare digit that
matches nothing the restaurant calls that table today.

---

## ✅ ITEMS 11 AND 12 — the owner said "do both" (2026-08-17). The PAPER half is built.

Both now exist in the document, which is the half that decides what comes out of the printer and
the half that lives in my territory. Neither can light up until the data reaches the panels, and
that data lives in three other terminals' files — written as handoffs 3 and 4 below.

### I3 — a reprinted BILL carries the Reprint · Duplicate band (built)
`billDocHtml` takes `reprint`, exactly as the kitchen ticket has since 2026-08-04, and draws the
same double-bordered band above the document's name. `billData` accepts `reprint` too, so a panel's
change is one word. A first print is **byte-identical** to what shipped (verified) — a sheet marked
DUPLICATE that is really the original would be a lie on paper. A bill both cancelled and reprinted
shows both bands, cancellation first. Still fits the 80mm roll (283px of 302px).

### I4 — the verification line (built)
`billDocHtml` takes `chainSeq` + `chainHash` and prints `Verification 1042 · a3f9c1d2e4b5` under the
totals — the bill's position in the mig 332 chain and the first 12 characters of its hash. Twelve
identifies one bill out of a restaurant's whole history and fits 66mm; the full value stays in the
ledger, which is where a verification reads it anyway. Prints **only** when both parts arrive, so
every bill printed today is unchanged, and never on a cancelled sheet. `billData` reads them
straight off the session row (`sess.chain_seq` / `sess.chain_hash`), so **the panels need no change
at all** for this one — only the API has to send the columns.

Both are pinned by `verify-billdoc-paper.mjs` (handoff 1), in both directions.

## 🔗 HANDOFF 3 → T5 (`public/panels/editor/app.js`) and T7 (`public/panels/tablet/app.js`)

**Pass `reprint` when the bill has been printed before.** The manager's `printBill(t, sess, os, opts)`
already carries an `opts` object, so the change is one property on the existing `billData({...})`
call in each panel:

```js
LFH_BILLDOC.billData({ …, reprint: <this bill has been printed before> })
```

**Where the answer comes from is the real decision, and it needs handoff 4's column.** A panel-local
"printed this session" set is wrong for the case that matters most — the manager prints, the guest
asks for another copy, and a WAITER reprints it from the tablet. That second device has no idea, so
it would print an unbranded duplicate, which is worse than not shipping the band at all. Wait for
`sessions.bill_printed_at`, then it is simply `!!sess.bill_printed_at` at both call sites.

## 🔗 HANDOFF 4 → T23 (`supabase/migrations/`, 231→newest) + the editor/tablet API route

Two small pieces, both with a precedent already in the repo:

1. **`sessions.bill_printed_at timestamptz`** — mirror migration **256**, which added exactly this
   `printed_at` column to `aggregator_orders` for parcel receipts, and the route already stamps it
   idempotently (`if (owns.printed_at) return ok(...)`). Stamp it on the first successful bill print;
   never overwrite. That single column makes handoff 3 correct across devices.
2. **Expose the chain reference on the session read.** `bill_chain` is RLS-locked with no policy —
   service role only, deliberately — so this must be a scoped read on the server, not a client
   query: return `seq` and `chain_hash` for that session alongside `bill_no`/`invoice_no` in the
   sessions select the panels already fetch, named `chain_seq` and `chain_hash`. The document and
   `billData` are already wired; nothing else has to change for the verification line to appear.

---

## THE GUARD, READY TO DROP IN (handoff 1)

<details><summary><code>scripts/verify-billdoc-paper.mjs</code></summary>

See `.claude/sweep/T8-guard-verify-billdoc-paper.mjs.txt` in this branch — kept as a separate file
so it can be `cp`'d into place without unpicking markdown.

</details>
