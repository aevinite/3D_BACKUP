# T18 improvements — the admin's money view

Three 🟢 built (each inside the territory, small, no migration, no new screen, no new permission, none
in `docs/REJECTED-IDEAS.md`). Two 🟡 left for him.

---

## 🟢 I1 — the busiest list says how many restaurants it is showing  · BUILT (item 9)

**Where:** admin console → Platform analytics → **Busiest restaurants** → the grey line under the
heading. It now ends "Showing the busiest 8 of 9 restaurants that took an order."
**Why:** `lfh_admin_busiest_restaurants` is asked for the top ten and the card lists eight, so on this
platform the 9th restaurant with orders fell off the bottom with nothing saying so — on the card whose
job is telling him who is busy and who has gone quiet. It also compounded HANDOFF H2: the visible list
already fails to add up to the headline, and silently dropping a row widens the gap.
**Behaviour:** the line appears only when there are more than are listed. Verified with 3 restaurants
(no line), 9 (says 8 of 9) and 10 (says 8 of 10).
`app/aevinite/analytics/page.tsx` — `busiestWithOrders` + the card hint. ~10 lines.

## 🟢 I2 — the Change log says when the list has more behind it  · BUILT (item 10)

**Where:** admin console → Bills → **Change log** → the foot of the list: "Showing the most recent 500
changes — there are older ones. Narrow to one restaurant, or to the at-risk rows, to reach further
back."
**Why:** the endpoint caps at 500 and the page simply stopped, so scrolling to the bottom told him
nothing about whether he had seen everything. On a log whose stated job is spotting bills being quietly
removed, "the list ended" and "there is nothing more" must not look identical. The sibling Bills ledger
has always ended with "Showing N — there are older ones".
**Behaviour:** silent below 500, because then the list really is the whole story. Verified with 500 real
rows and with a stubbed 12.
`app/aevinite/bill-audit/changes/page.tsx`. ~8 lines.

## 🟢 I3 — Platform revenue says how old its figures are  · BUILT (item 11)

**Where:** admin console → Platform revenue → beside **Refresh**: "updated just now", with the exact
IST time on hover.
**Why:** it was the one page in this territory that refreshed itself every 60 seconds and said nothing,
so a tab left open overnight looked live. Platform analytics and Customers both carry the stamp already
(it is the standing rule for anything a dashboard serves from a cache or a timer). `generatedAt` was
already in the reply and simply unread — no new request, no new field.
`app/aevinite/revenue/page.tsx`. ~12 lines.

---

## 🟡 I4 — the Closed-unpaid tile's VALUE beside its count — NOT BUILT, his call

**Where:** admin console → Bills → the **CLOSED UNPAID** tile, which today reads "31 · walk-outs /
cancels · on this page" — a count with no money, while the SETTLED tile beside it reads "1 · ₹441
collected".
**Why it might be wanted:** `docs/COMPLIANCE-GUARDRAILS.md` §3.0 point 5 says cancellations are
"reported, not just recorded: the day-close sheet states their count *and their value*, and the Bills
record names them beside the money collected". Thirty-one walk-outs at ₹80 and thirty-one at ₹900 are
very different mornings, and this screen cannot tell them apart.
**Why I did not build it:** **R10** in `docs/REJECTED-IDEAS.md` — he refused exactly this shape on the
manager floor header ("To pay 2 · ₹1,659"): *"We don't need improvement number six."* The count stays a
count. That was a different screen, and this one already shows money two tiles along, so it may well be
a yes here — but adding money beside a count is precisely the thing he has already said no to once, and
guessing is what the rejected-ideas rule exists to stop.
**Effort:** 15 minutes. **Risk:** none technically; it is a taste call he has ruled on nearby.

## 🟡 I5 — open a guest's record from the keyboard — NOT BUILT, needs a decision

**Where:** admin console → Customers → any row of the guest table. Clicking a row opens their record;
pressing Enter on it does nothing, because the row is a `<tr>` with an `onClick` and no keyboard role.
**Why it might be wanted:** it is the only way into a guest's cross-restaurant record, and someone
working down a list with the keyboard cannot reach it. The drawer itself is now fully keyboard-correct
(item 5), which makes the door the odd part.
**Why I did not build it:** the honest fix is a focusable control inside the row rather than a
`tabIndex` on the `<tr>` — that is a visible change to a table he has already signed off, and the same
pattern exists on other admin tables I do not own, so doing it here alone would make this one screen
behave differently from its siblings. It is a product decision about the admin table pattern, not a
local fault.
**Effort:** 20 minutes here; a couple of hours if it is applied to every admin table.
**Risk:** low, but it changes how a signed-off table looks and behaves.
