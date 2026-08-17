# T7 improvements — the waiter tablet (sweep #6)

Two were BUILT (they live entirely inside my territory, are well under 150 lines, need no migration,
no new screen, no new module and no new permission, and are not in `docs/REJECTED-IDEAS.md`). Two are
listed for the owner to decide, because each is a product call with a real trade-off either way.

---

## 🟢 BUILT

### I1 · The "💳 Mark bill paid" button now says WHY it won't go, instead of eating the tap
**Where:** waiter tablet → tap a table with a not-yet-accepted order → the table popup's action row.
What he would SEE: the button is dimmed but still tappable, and tapping it says *"Accept the order
first — a bill can only be paid once the kitchen has it."*

While an order on the table is still un-accepted, the bill genuinely cannot be settled — that part is
right. But the button was rendered `disabled` with its reason in a `title` attribute. **A title needs
a hover, and a waiter carrying plates has no mouse**, so on the panel's own target device the tap
simply disappeared on the most repeated money control in a service. The split-payment button forty
lines away in the same file already answers this exact situation the right way — *"Stays ENABLED and
says WHY it won't go — a disabled button that swallows the tap is indistinguishable from a broken
one"* — and two controls in one panel should not answer the same situation two different ways.

Proved on screen at 1194×834 (screenshot read, not just asserted): dimmed button, toast, and no
payment sheet opening on a bill that cannot be settled yet.

### I2 · The ⚡ quick-order table picker now explains an empty grid
**Where:** waiter tablet → ⚡ Quick order → add dishes → **CHOOSE TABLE & SEND →**. What he would SEE,
if he holds no section: *"No tables assigned to you yet — ask your manager to give you a section"*,
with *"This order is safe — nothing has been sent yet."* above it, instead of an empty white box.

⚡ Quick order sits on the top bar at ALL times, so a waiter who has not been given a section can
build a whole order and land on a picker with nothing in it and nothing said. The floor behind
already explains this state kindly, and every other picker in the file has an empty state; this was
the last one without.

---

## 🟡 NEEDS A DECISION FROM HIM

### J1 · A waiter can merge two tables from the tablet, but can never un-merge one
**Where:** waiter tablet → a merged table → 🧾 KOT ▾. Today the sheet offers **🪢 Merge tables** and
shows **"Change table — unmerge first"** greyed out — an instruction the device gives him no way to
follow. Undoing a mis-tapped merge means walking to the manager panel.

**If yes:** a waiter can separate a party they joined by mistake, on the spot, on the device in their
hand — one new row on the KOT sheet of the CHILD table, matching the manager's own rule that you
unmerge by tapping the joined table.
**If no:** nothing breaks; merging stays a one-way door on the tablet and the manager undoes it.
**Effort:** ~15 lines in my territory, but it needs a `tables/:t/unmerge` route added to the tablet's
server file first (`app/api/tablet/[...path]/route.ts` — outside my territory; the exact change is
written up as handoff H1). Call it an hour end to end.
**Risk:** low — the RPC and the manager's flow already exist; the tablet would call the same one
behind the same `tablet_table_ops` permission that already gates merge.

### J2 · Held SIDEWAYS on a phone, 59% of the screen is chrome before the first table
**Where:** waiter tablet → the floor, on a phone turned sideways (measured at 780×360). What he would
SEE: the top bar, the four filter chips, the colour legend and the "Your tables 1–30" strip take
**211px of a 360px-tall screen**, so not one complete row of tables is visible without scrolling.
Held upright the same chrome costs 192px of 780px, which is fine.

**If yes:** a waiter who turns the phone sideways sees tables, which is the one thing that screen is
for — the fix would be a short-screen rule (`@media (max-height: 430px)`) that tightens the same
things the narrow-screen rule already tightens.
**If no:** nothing breaks; the floor scrolls, and this only bites on a PHONE turned sideways — an
iPad has the height for all of it.
**Effort:** ~20 lines of CSS in my territory, half an hour with measurements in both skins.
**Risk:** medium, and that is why it is here and not built: the cheapest 30px is the "Your tables"
strip, and **he has already refused hiding that strip once** (`docs/REJECTED-IDEAS.md` R2), so any
version of this has to leave it alone and take the room from the legend and the chip padding
instead — which is a look he has tuned by hand twice. This is his call, not mine.

---

## Considered and deliberately NOT done

* **Gating the "⇄ Change table" KOT row on whether any free table exists**, the way the merge row is
  now gated. Left alone on purpose: the shift picker already explains itself in words (*"No free
  tables to shift to."*), and a greyed row with no explanation would tell the waiter LESS than the
  screen it opens. The merge row was a different thing — its own comment states the rule it had
  drifted from.
* **Anything in `docs/REJECTED-IDEAS.md` R1, R2, R4, R6, R25** — the free tile's blank space, the
  "Your tables" strip, the 22–25px 💳/⏻ controls, restating `TILE_MIN_PX`, and completing the floor
  legend. All checked before every change; all left exactly as they are.
