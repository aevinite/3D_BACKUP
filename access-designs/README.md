# Access panel — 5 design directions (DESIGN ONLY, not wired)

Mock prototype for the ground-up access/permission panel redesign.
Spec: memory `access-panel-redesign-spec.md` · canonical rules: `docs/ACCESS-LADDER.md`.

**Nothing here talks to the backend.** Toggles mutate an in-memory object only.
Wiring + enforcement (hidden in the UI AND refused by the server) is step 2, after
the owner picks a direction.

## Run

```bash
cd access-designs && python3 -m http.server 9001 --bind 127.0.0.1
open -a "Google Chrome" http://127.0.0.1:9001/
```

Switcher across the top flips between all five. The restaurant picker on the right
switches between **My Little French House** (fine dining, everything on) and
**Pizza Palace** (pure veg, most special features off, and one deliberately broken
row so the red "a manager can't exceed the owner" warning is visible).

## The information architecture (the actual point of this exercise)

Today's panel is five disjoint mechanisms — guest features / modules / manager
powers / tablet caps / owner sections — which is why it reads as a junk drawer.
Here they are re-cut into **10 functional areas**, and each permission declares
which **one of three control kinds** it needs:

| kind | what it looks like | used by |
|---|---|---|
| `switch` | plain admin on/off, no delegation | guest menu features, which staff apps exist, owner-panel sections |
| `ladder` | ONE stepper `Off · Owner · Owner + Manager`, revealing `[Owner can… \| Manager can…]` sub-tabs each with their own option chips | every staff power |
| `locked` | permanently the manager's; only the admin can remove it | `take_orders` |

Areas: Guest experience · The menu · Bills & money · Tables & floor · Kitchen ·
Banquet & events · Reports & insights · Staff & settings · Staff apps ·
Owner panel sections.

Special features (banquet, khata, table types, table & ticket ops, auto-print)
get an **"Admin allows"** gate strip above the stepper. Everyday owner powers do
not — the owner inherently has them; the only question is delegation downward.

## Rules the mock actually enforces

- **Cascade.** Dropping the stepper below `Owner + Manager` empties the manager
  side and the waiter rung. Dropping below `Owner` empties everything.
- **Manager ⊆ Owner.** Unticking an owner option removes it from the manager.
  Pre-existing bad data raises a red per-power warning + a page-level banner, with
  a **Fix it** that lifts the owner up (never silently strips the manager).
- **Cross-badges.** On the Owner tab a chip also on for the manager shows **M**;
  on the Manager tab a chip also on for the owner shows **O**. Hover for the tooltip.
- **Admin gate off** collapses every rung below it.
- **Per person** = `Follows restaurant (→ resolved On/Off) · Force ON · Force OFF`.
  Only capabilities relevant to that person's role are listed. Staff sort
  Owner → Manager → Waiters → Kitchen.
- **"Who has this →"** on any power jumps to Per person filtered to it.
- **(i) everywhere**, on the power AND on each sub-option, opening a plain-English
  description plus a screenshot of where it lives in the real app — **loaded only
  on tap**, enlargeable to a lightbox.

Screenshots are drawn placeholders with the control ringed. Real HD captures go in
`public/admin-help/` when this is wired.

## Files

```
index.html            shell + the four shared overlays
styles/app.css        tokens + every shared control
styles/layouts.css    the five arrangements
js/data.js            the IA, the rules, the sample restaurants  ← read this first
js/controls.js        stepper, sub-tabs, chips, conflicts, (i), drawer
js/layouts.js         the five renderers + the shared Per person tab
js/app.js             switcher, breadcrumb, tabs, scroll-spy
```

Real backend keys are used throughout (`FEATURE_DEFAULTS`, `MANAGER_POWER_FLAGS`,
`OWNER_SECTION_KEYS`, the module `*_allowed` columns) so wiring is a mapping job,
not a rewrite. New granular permissions that do **not** exist yet and will need a
migration: the `edit_menu` sub-options, `revert_payment`, `export_reports`,
`view_logs`.
