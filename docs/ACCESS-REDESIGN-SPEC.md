# Access screen — the outstanding list (owner, 2026-08-01)

Working spec. **Delete this file once every line is built and verified.**
`☐` not started · `☑` done · ❓ = I am guessing, confirm.

---

## A · Menu

- ☑ **Rename** "Dining sessions" → **"Dining session and location"**.
- ☑ **Kill the extra sub-option.** There must be NO "Session rules & café location" wrapper.
  Require-location, require-OTP and lat/long/radius sit **directly** in the row's dropdown.
- ☑ The two toggles in there are **far too tall** — the label wraps to five lines and the box grows
  with it. Fix the sizing so they read as one line.
- ☑ **The on/off toggle overlaps the (i).** Move the (i) or the switch; they must not collide.
- ☑ **New: "Put menu on maintenance."** Default **OFF everywhere**.
  Sub-option: **who may do it — Owner / Owner + Manager**.
  Whoever is granted it gets a **red control in their own Settings** to take the menu down.
  Standard rule applies: feature off ⇒ that control does not appear at all.

## B · Auto-print kitchen tickets

- ☑ Remove the **"Printer check & sample ticket"** sub-option. Its contents go **directly** inside
  Auto-print kitchen tickets.

## C · Bill

- ☑ Add a **print preview** — prints a sample bill with made-up customer/lines so the layout can
  be seen before it is used.
- ☑ Add a **logo/image upload**. Uploaded ⇒ prints at the top; not uploaded ⇒ starts with the name.
- ☑ **Saving is broken** — editing the fallback tax rate does nothing and there is no visible save.
  Work out how save is meant to work here and make every field genuinely save.
- ☑ **Remove "Fallback tax rate"** from the bill format — it is confusing.

## D · Table  (renamed from "Tables & QR codes")

Three sub-options, each opening its own existing card:
- ☑ **Table name & seats** — the "Table setting" grid.
- ☑ **Guest QR link per table** — the QR list.
- ☑ **Number of tables per row** — the floor-layout card.
- ☑ **Delete "Auto close / restart tables" completely** — including the *restart table* choice.
  It is useless under the logic already built.

## E · Platforms

- ☑ Zomato and Swiggy **default OFF**.
- ☑ **A dropdown opens even while its feature is off**, so what is inside can be READ.
  Trying to change anything while off ⇒ a notification saying the feature has to be on first.
  (Read-only when off, not hidden.)

## F · Banquet billing

- ☑ The UI is cramped and unfriendly — reorganise it properly.
- ☑ **Add a preview** if at all possible.
- ☑ **The "Add tax" button does not work.** Fix it, and check every other button on that card.

## G · Saving — across the whole screen

- ☑ **TWO save bars appear at once.** One, and only one.
- ☑ It must **stick to the bottom-centre of the screen** until dealt with.
- ☑ It **does not match the UI** (a yellow button against this palette).
- ☑ It is **broken on hover — it flickers**.

## H · Dropdowns

- ☑ Clicking **anywhere on the row** opens it, not only the little chevron.

---

## Later (his words: "we'll do manager menu and all that after")
Manager menu diagnosis and the rest.


---

## Verified 2026-08-01
- **37 of 37** switchable rows flip and the change reaches the SERVER (browser-driven sweep).
- The bill form **saves**: edit → one bar → Save → the server has it → bar clears on reload.
- No page errors anywhere in the sweep.
