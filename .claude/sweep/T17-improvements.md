# T17 improvements — the ADMIN's health, logs, issues & limits

## 🟢 Built in this branch

**15 · Usage & cost: four headline numbers, two per row on a phone.**
Each cell asked for 150px plus 36px of padding, so at 360px two would not fit and they stacked
one per row — about 380px of scrolling for four numbers before the ranked table they exist to be
read with. A right-hand border on a stacked cell also drew a short vertical line floating at the
edge of each row. Now 2×2, 187px tall, divider following the direction they actually sit in.
Desktop untouched. `app/aevinite/usage/page.tsx`.

## 🟡 Left for the owner to decide (not built)

**A · System health's "1 open issue" pill is amber for any open complaint.**
On a platform with nine restaurants there will nearly always be at least one open complaint, so
this pill is amber most days — the same always-on shape as the panels bar (item 14). But unlike
that bar it is arguably correct: an unanswered complaint IS something waiting for him. Taste call
with a real trade-off either way, so left alone. `app/aevinite/health/page.tsx`.

**B · The Repair board has no way to act on more than one problem at once.**
Nineteen problems, eight of them the same three manager faults, each needing its own two-step
Resolve. A "resolve everything from this panel at this restaurant" control would clear a board
after a fix lands in one press. Needs a product decision (it is a bulk write to the audit trail)
and probably a server change, so not built.

**C · A problem tile cannot be snoozed, only resolved or left red.**
Four tiles are 12–15 days old. The admin's only choices are to resolve one he has not actually
fixed (which writes a false record) or to leave the board permanently red. A "not now, remind me"
state would need a migration, so it is his call.

**D · Usage & cost cannot be sorted or ranged.**
It is always 30-day order volume, always descending. Sorting by staff, tables or 7-day, or picking
a range, would make it answer more questions — but it is a cost proxy, not a report, and he has
Reports for the rest. Product decision.
