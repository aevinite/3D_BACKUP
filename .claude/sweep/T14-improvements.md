# T14 improvements — the owner's Customers, Pay Later, Inventory, Complaints & Manager mode

## 🟢 Built in this branch (safe by §6: inside the territory, small, no migration, no new screen,
## no new module, no new permission, not in `docs/REJECTED-IDEAS.md`)

**I9 · One database read instead of one per restaurant, before Inventory draws anything.**
`app/owner/inventory/page.tsx` asked whether the inventory module was on one restaurant at a time,
in series, so an owner with twenty floors waited for twenty round-trips before the page appeared.
`inventoryEffectiveByRid()` already exists for exactly this and is used by `/api/owner/reports`; the
rung it computes is the same expression `moduleLadder` uses, so no restaurant's answer changes — it
just arrives at once. Invisible on one restaurant; real on twenty. It also removes an uncapped
sequential fan-out of the kind the khata route was corrected for on 2026-08-04.

**I10 · An old tab looks old.**
The credit book is ordered by how much is owed, which is right — but it means a ₹120 tab from three
months ago sits quietly at the bottom under a ₹4,000 one from Tuesday, and a credit book is how a
small restaurant loses money without noticing. The age on each row now turns amber past 30 days and
red past 60. The **words are unchanged** ("oldest 92 days"), so the colour adds emphasis rather than
carrying the meaning by itself, and a fresh tab looks exactly as it always did. Nothing is sorted or
re-ordered, and no claim is made about the whole book — this is per-row emphasis only, which is what
keeps it honest over a list that is bounded to the 500 biggest debts.

## 🟡 Not built — his call

**J1 · The Customers table on a phone.**
At 360px, four of the eight columns (First visit, Last visit, the new/regular/blocked chip, and the
erase button) sit off the right edge behind a sideways scroll inside the table's own wrapper. The
page itself does not scroll sideways, and `verify:customers` confirms that at 390px. Making it read
as cards on a phone, or dropping the two date columns below a breakpoint, is a layout decision with
a real trade-off either way — and he has said before that he does not want horizontal scrolling
anywhere. Left alone rather than changed unasked.

**J2 · Make the four Customers tiles tappable filters.**
Tapping "Blocked · 2" would show the blocked guests. It is six lines. It also turns a shared
`adm-stat` tile into a button on ONE screen out of the sixteen that use them, which is either the
start of a good pattern or an inconsistency, depending on what he wants. His call, not mine.

**J3 · Order the credit book by age as well as by amount.**
The obvious answer — a sort toggle — would be misleading, because the list is bounded to the 500
biggest debts, so "oldest first" over that slice is not the oldest on the book. Doing it honestly
means the ORDER moves into `lfh_khata_outstanding`, which is a migration and another terminal's
file. I10 above is the part that could be done truthfully today.
