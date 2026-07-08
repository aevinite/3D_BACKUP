# Future features — parked by owner (2026-07-08)

From the manager-panel audit's "India-first, highest-impact" feature list. The owner reviewed
the four aggregator/GST ideas and decided:

- ✅ **BUILD NOW (approved):** a **one-click monthly GST report — for the RESTAURANT'S OWN sales only**
  (dine-in + takeaway rung on our POS). NOT the Zomato/Swiggy side yet. A downloadable monthly
  summary: taxable sales, tax collected (by rate/component), gross, per-day breakdown, ready to hand
  to an accountant. Lives in the manager/owner panel; reads the same paid-only, discount-before-tax
  figures the dashboard/Z-report already use. (Being implemented in this round of work.)

- ⏸️ **PARKED (keep in mind, do NOT build yet — owner will say when):**
  1. **Aggregator payout reconciliation** — match every Zomato/Swiggy order against their payout
     statement; flag missing / short-paid / mismatched orders and show commission/fee/tax → net
     payable. (This is the single biggest India-SMB pain per PetPooja/UrbanPiper.) We already have a
     Platform tab to build it onto.
  2. **One-click "sold-out"/price push to Zomato + Swiggy** — mark a dish 86 (or change its price)
     once in our menu and sync it to the aggregators, instead of editing each place separately.
  3. **WhatsApp bill + UPI "scan-to-pay"** — turn each bill into a WhatsApp link the guest can pay by
     UPI at the table.
  4. **Aggregator GST/TDS reconciliation** — the Zomato Sec-194-O TDS and Swiggy Sec-9(5) GST monthly
     statements matched against payouts. (The restaurant-only GST report above is the first, smaller
     step toward this.)

Context source: manager-panel competitor research (Toast, Square, Lightspeed, TouchBistro, Clover,
SpotOn, PetPooja, Posist, Rista, Zomato, Swiggy, UrbanPiper). Full findings in the session audit
ledger / memory `manager-panel-audit-2026-07-08`.
