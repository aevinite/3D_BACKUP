# T8 findings — printing, the bill document and the numbers on it

> This file was sweep #6's findings and is now sweep #7's. **Nothing was lost:** every sweep-#6
> finding (F1-F8, I1-I2) is a permanent row in `.claude/sweep/LEDGER/T8.md`, each marked `❌→✅`
> with its F-number, and every one was **re-run this run and still holds**. Its handoff 1 (the
> paper guard) has since landed as `scripts/verify-billdoc-paper.mjs`; its handoff 2 is still open
> and is carried forward below.

**Sweep #7, terminal 8 of 40.** Branch `sweep7/t8-printing-and-bill`, worktree `../wt-s7-t8`, dev
port **4208**. Territory: `public/panels/billdoc.js` · `public/panels/billcustomer.js` ·
`docs/NUMBERING.md` (+ the guards that watch them).

**11 numbered items fixed, one commit each. 3 handoffs, all outside my four files. 1 decision for
the owner.** Every fix was proven by running the check against the pre-fix code (it fails) and the
fixed code (it passes), and every one left a `verify:*` guard behind.

| | |
|---|---|
| Sweep-#6 rows re-run | **500 of 500** — 467 ✅ · 27 ❌→✅ · 2 ✅ deliberate · 2 ❌ · 2 ⏭ |
| New checks written and run | **500** (`P18601`–`P19100`) — 462 ✅ · 35 ❌→✅ · 3 ⏭ |
| Regressions found | **1** (item 8 — a row sweep #6 passed, broken by a change three days later) |
| Guards | `verify:print-paper` extended with 6 sections · **`verify:bill-screens` is new** |

---

## The one REGRESSION — a row that passed in sweep #6 and did not pass now

### item 8 · HIGH · the toolbar was sitting on top of the restaurant name

**Where:** manager panel → a table → 🖨 Print bill → the bill window that opens. Also the waiter
tablet's bill and every "Format of the bill" preview. **What he would SEE:** the grey bar with
Print/Close covering the restaurant's name at the top of the sheet — the biggest text on a
customer's bill, and the first thing anyone looks at.

Ledger row **P03899** ("on the A35 it does not cover the first line either") was ✅ in sweep #6.
The preview grew its fit-to-window **zoom layer on 2026-08-19**, three days later, and broke it.

The bar is `position:fixed` and wound back to life-size with the INVERSE zoom, so its height on
screen is constant. The space kept clear for it is `body{padding-top:calc(2mm + 34px)}`, which sits
INSIDE the zoomed body and shrinks with the zoom. **They scale in opposite directions.** Measured
over 6 window sizes × 6 bill lengths — **24 of 36 combinations were covered**:

| | | |
|---|---|---|
| A35 360×780, 8-line bill | zoom 1.02 | covered by 4px |
| A35 360×780, 60-line bill | zoom 0.60 | covered by 26px — the whole name |
| desktop 1280×900, 30 lines | zoom 0.61 | covered by 26px |
| laptop 1440×700, 8 lines | zoom 0.91 | covered by 10px |

A long bill is **not** a corner: the owner's own Aangan bill is 178mm of paper, which is exactly why
the 0.6 zoom floor is in this file. The common real case was the broken one.

**Fixed** by measuring the bar and dividing the allowance by the zoom (converting it into the
body's coordinates), and by solving the fit as `content×zoom + toolbar ≤ window`. Screen only —
the print rules carry `!important` and beat an inline style; asserted directly.
**Guard:** `verify:bill-screens` (new).

---

## The other ten

### item 1 · HIGH · one sale could print TWO invoice numbers, depending on the tablet

**Where:** manager panel and waiter tablet → 🖨 Print bill → the **INVOICE** row.
**What he would SEE:** `INV/2026-27/000041` on one device and `INV/2025-26/000041` on another, for
the same sale — and on the second one, a sheet **dated 1 April 2026 carrying financial year
2025-26**.

`financialYear()` read `getFullYear()`/`getMonth()` — the printing machine's own calendar. IST runs
+05:30, so every device behind India reads the previous FY for the first five and a half hours of
the new one. Measured at 2026-04-01 01:00 IST:

    India tablet   INV/2026-27/000041   dated 01/04/2026
    London / UTC   INV/2025-26/000041   dated 01/04/2026
    New York       INV/2025-26/000041   dated 01/04/2026

Same fault class as the bill's date (fixed 2026-08-05), the banquet sheet's (2026-08-06) and the
kitchen ticket's (2026-08-17) — **the fourth and last surface, and the worst of them**, because the
FY is part of the number that IDENTIFIES the tax document, and 31 March / 1 April is the most
consequential date in Indian accounting. **Guard:** `verify:print-paper` §1 now sweeps both FY
boundary instants across five zones, plus a named `financialYear` block.

### item 2 · HIGH · a negative taxable value and negative tax printed on a tax invoice

**Where:** manager panel → a banquet booking → 🖨 Print → the **item table**, last row.
**What he would SEE:** `4  Stage decoration  1  28,800.00  **-691.63**  18.00%  **-124.50**`.

Found by rendering the real A5 sheet and looking at it. The per-line columns are footed to the
bill's stored totals by giving the LAST line the whole difference (T7's I8) — so when the lines add
to MORE than the bill, that line goes past zero. And the over-shoot is the exact case I8 exists for
("a line edited after the bill was saved, or a line missing from the fetch"). It needs no big gap
either: a ₹1,00,000 hall beside a ₹100 welcome gift, ₹1,000 over, printed the gift at −1,000.00.

The thermal bill has forbidden this since 2026-08-06; the rule was never carried to the
largest-value document. **Fixed** by absorbing backwards, taking from each line only what it holds.
Both properties now hold together — the columns still foot AND no cell is negative. An everyday
sheet is byte-identical. **Guard:** `verify:print-paper` §3e, five shapes.

### item 3 · HIGH · a restaurant with no GST number still handed guests a "Tax Invoice"

**Where:** every panel → 🖨 Print bill → the heading under the letterhead, and the tab title.
**What he would SEE:** `TAX INVOICE` on a sheet carrying no GSTIN line at all.

`billIdentity()` has refused to invent a GSTIN since 2026-08-04 ("a fake tax number on a real bill
is illegal") — the heading never got the same reasoning. CGST Rule 46(b)/(c) makes the supplier's
GSTIN a mandatory particular; `docs/COMPLIANCE-GUARDRAILS.md` already carries the rule in one line.

**Not a corner: 16 of 17 restaurants on the dev database have no GSTIN, the flagship included.** An
empty Billing card is the state every new tenant starts in, and `taxModel()` falls back to 5% for
all of them. **Fixed:** no GSTIN, not composition → the sheet is headed **"Bill"**. No money, no
number and no row moves. A restaurant that HAS filled its GSTIN in is byte-identical.
**Guard:** `verify:print-paper` §3f.

> **⚠️ LEFT FOR THE OWNER, deliberately untouched.** The sheet still adds and names CGST/SGST rows
> for an unregistered restaurant. Those rupees were genuinely charged and sit inside the TOTAL, so
> dropping the rows would stop the column footing. That is a real decision about what an
> unregistered tenant should collect — not a formatting one.

### item 4 · MEDIUM · the digit counter said "0/10" beside a complete number

**Where:** manager panel and waiter tablet → generate a bill → the **"Who is this bill for?"** sheet
→ the small counter inside the Mobile number box. **What he would SEE:** `98250 12345` in the box
and `0/10`, not green, beside it.

`paintCount()` only ran on the `input` event, and assigning `.value` from script fires none — so on
the two paths where the number arrives without being typed the counter kept whatever it last said:
a reopened bill showed `0/10`, tapping a suggestion showed `5/10`. Both times the Generate button
was live while the counter said the number was incomplete. At a till, "0/10" reads as *retype it*.
Neither path is an edge — the reopen path is the case the prefill feature was **built** for.
**Fixed** with one door (`setPhone`). **Guard:** `verify:print-paper` §3g, structural.

### item 5 · MEDIUM · `docs/NUMBERING.md` described a bill the printer stopped producing

**Where:** backend only, nothing on screen — the page anyone opens to answer "which number is
this?". It still said the bill number is what "the customer's bill" shows, six days after the sheet
stopped showing it whenever there is an invoice number (owner, 2026-08-21). Migrations 333/339
(`bill_printed_at`) were in neither the prose nor the index table. **Fixed**, both.
**Guard:** `verify:print-paper` §5b reads the gate out of `billdoc.js` and fails if the page and the
paper disagree **in either direction**.

### item 6 · MEDIUM · the banquet tax invoice could print "Invalid Date" where its date goes

**Where:** manager panel → a banquet booking → 🖨 Print → the **Dated** field, the **Function** line
and every **advance receipt** line. **What he would SEE:** `Dated   Invalid Date`.

The ticket has refused since it was written and the bill since 2026-08-05; the banquet sheet
guarded none of its three date fields. **Reachable through the data, not only the preview:**
`banquet_bills.advances` is JSONB and migrations 237/239 store the date with **no cast at all** —
`COALESCE(NULLIF(v_a->>'date',''), to_char(v_now,'YYYY-MM-DD'))` — so any non-empty text the client
sends is kept verbatim. **Fixed** with one helper; a missing date prints nothing, and an advance
never loses its **money** with its date. **Guard:** `verify:print-paper` §3h, 30 junk values.

### item 7 · MEDIUM · a typed space defeated "empty prints no line", and no floor stopped a negative money box

**Where:** every printed bill → the **letterhead**, and the **money block**.
**What he would SEE:** a blank restaurant name, a bare `Ph` and a bare `GSTIN` with nothing after
it; and on the money side `Food subtotal ₹-300`, or a phantom `Round off + ₹5` where a Discount row
should be.

`s.x || fallback` treats `"  "` as real. And `billRows` clamped a discount *bigger* than its row but
not a *negative* one, and never floored the taxable value — while `billMoney`, thirty lines away in
the same file, has always ended `Math.max(0, ...)`. **Fixed:** trimmed at the one place that
resolves the identity; the two floors `billMoney` already has; and an untaxed pile that is not a
genuine part of the subtotal drops the split entirely (the reasoning `mrpPart()` already applies to
a composition restaurant). `billDocHtml` now reads `R.nontax` instead of re-deriving it, so the
label, the MRP row and the arithmetic cannot answer differently.
**Guard:** `verify:print-paper` §3i.

### item 9 · MEDIUM · the sheet told the waiter what was missing, then took it back

**Where:** the **"Who is this bill for?"** sheet → the status line under the Mobile box.
**What he would SEE:** a red *"Enter the customer's name"*, and a third of a second later a **green
"New customer"** in its place — reassuring, while the button still refuses.

Measured at server lags of 0, 80, 250 and 600ms — **every one**. Not a race that sometimes bites:
the last keystroke always schedules a lookup that lands after the tap. This is the panel's own "a
tap must never vanish in silence" rule undone one beat after it was honoured — and the message it
erases is the one sweep #6's F4 fix existed to create. **Fixed** with one rule in `sync()`.
**Guard:** `verify:bill-screens` §4.

### item 10 · MEDIUM · the same bill said "Tax" from one panel and "GST" from another

**Where:** manager panel vs waiter tablet vs the Access "Format of the bill" preview vs the admin
preview → 🖨 Print bill → the small note under the total on an MRP bill, and the fallback tax line
on a mixed-rate or banquet sheet. **What he would SEE:** `MRP items include ₹2 Tax` from the
manager and `MRP items include ₹2 GST` from everywhere else.

`tax_label` had **two defaults inside one file**: `billIdentity` said "Tax", three inline reads said
"GST". The manager panel copies `billIdentity`'s answer into its own settings first; nothing else
does. Same restaurant, same bill, two words — the exact fault this whole file was created to end.
**Fixed:** all three read the one answer. **Guard:** `verify:print-paper` §3j.

### item 11 · MEDIUM · one bad line cost the whole piece of paper

**Where:** any panel → 🖨 Print (bill, kitchen ticket or banquet sheet).
**What he would SEE:** **a blank window and no paper at all**, with nothing saying why.

A single `null` in a line list threw out of the render on **all three** documents, and they are
drawn into a `window.open` or a hidden iframe — so a throw is a blank window. `items` is JSONB in
this product, so a null element is one database write away. Printing the other nine dishes beats
printing nothing. **Fixed:** every line list drops empty entries; every public entry point defaults
its argument. **Guard:** `verify:print-paper` §3k, seven shapes + all 23 entry points.

---

## 🔗 HANDOFFS — real, confirmed, and outside my four files

### HANDOFF 1 → whoever owns `supabase/migrations/` + `app/api/editor/[...path]/route.ts`
**The customer lookup's row cap does nothing.** `lfh_customer_phone_search` (migration 227) ends:

```sql
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 20));
```

…**after a `json_agg`**. In SQL the LIMIT applies once the aggregate has collapsed to one row, so it
caps that one row and the array inside it is unbounded. **Measured on the dev database:
`p_limit=1` came back with 3 rows.**

**Where it lives:** manager panel and waiter tablet → generate a bill → the "Who is this bill for?"
sheet → nothing visible; it is a data-use fault. On a mature restaurant a four-digit prefix
downloads every matching customer, on the till's hot path, while a waiter types — and the sheet then
renders only the first four of them. The route, the sheet's own header and the migration all claim
"at most 6 rows"; none of them is true. (I corrected the false claim in `billcustomer.js`'s header,
which is my file, and pointed it here.)

**The change** — move the cap inside the aggregate:
```sql
  WITH q AS (...), hits AS (
    SELECT c.phone, c.name, c.visits, c.blocked
      FROM customers c, q
     WHERE q.pfx IS NOT NULL AND length(q.pfx) >= 3
       AND c.restaurant_id = p_restaurant_id
       AND c.phone LIKE q.pfx || '%'
     ORDER BY c.last_seen_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 20)))
  SELECT COALESCE(json_agg(json_build_object(
           'phone', phone, 'name', name, 'visits', visits, 'blocked', blocked)), '[]'::json)
    FROM hits;
```
Ledger row **P03785**.

### HANDOFF 2 → whoever owns `lib/auditDetail.ts` — **open since sweep #6, never picked up**
**The Audit's evidence bill prints the bare table digit.** Line ~136:
`tableDisp: was.table_number != null ? String(was.table_number) : "—"`.

**Where it lives:** manager panel → Audit & logs → open a removed bill → the evidence card → the
**TABLE** row. A restaurant that renamed T5 to "Terrace 2" sees **"Terrace 2"** on the paper the
guest was handed and **"5"** on the record of it being removed. Every other document in this product
resolves the name. The three-line change is in sweep #6's findings and still applies verbatim.
Ledger rows **P03798**, **P03949**, **P19011**.

### HANDOFF 3 → whoever owns `public/panels/editor/app.js` + `app/api/editor/[...path]/route.ts`
**The verification line is built and DARK.** `billDocHtml` prints
`Verification 1042 · a3f9c1d2e4b5` the moment it is handed both parts — verified. The manager API
now *does* fetch the mig-332 chain, but attaches it to the **bill rows** (`o.chain_seq`) while
`billData` reads it off the **session** (`sess.chain_seq`), so it still never appears on any paper.

**I deliberately did not wire it up.** It puts a new line on every guest's bill, and the very
adjacent decision — the reprint band — the owner reversed two days after asking for both. **This one
is his call**; it is raised in the chat report as a decision. Ledger rows **P03995**, **P19082**.

---

## Came back CLEAN, after real checking

The bill's money on every shape (plain, discounted, mixed-rate, tax-inside, composition, MRP both
treatments) · the whole escaping surface on all three documents · `splitTax` / `billRows` /
`orderTaxRate` / `taxModel` / `combineBillLines` · the kitchen ticket end to end · the banquet
sheet's frozen `tax_lines`, amount-in-words, paper setup and A4/A5 split · the parcel and platform
numbering · the one-ink rule and the 66mm fit on every shape · the customer sheet's three lookup
layers, its back-button registration and every dismissal path · the preview's zoom layer (86 checks,
after item 8) · every cross-panel trace but the three handoffs above.

## What would rot first, if nobody touched this territory for a year

**The device-locale class of fault.** Four documents' worth of dates, times, days and now the
financial year have each been left to the printing machine at some point — 2026-08-05, 2026-08-06,
2026-08-17 and 2026-08-22. All four are now pinned **and** swept by `verify:print-paper` across five
time zones × three locales × ten boundary instants, and ledger row `P19084` fails if a new un-pinned
clock or a device-local date read appears in this file at all.
