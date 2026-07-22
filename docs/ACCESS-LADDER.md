# The Access Ladder — who controls what (canonical reference)

Owner rule (2026-07-22): **every feature and button carries the 4-rung ladder**
`admin → owner → manager → tablet`. Each rung toggles the rung below; a rung that's
off makes everything below it disappear from the UI AND get refused by the server
(hiding a button is never the only guard). The ladder IS the user-access system —
it lives in three screens:

| Screen | Who uses it | What it controls |
|---|---|---|
| `/aevinite` → **Access** | Admin | Every rung: panels, owner sections, the Modules ladder card (feature on/off + "owner controls"), manager powers (exists + granted), tablet tri-states, per-person overrides |
| Owner panel → **Staff & powers** | Owner | The owner→manager rung (each power, only where the admin's "exists" switch allows) |
| Owner panel → **Settings → Features you control** | Owner | A module's on/off — only where the admin transferred it (`…_owner_control`) |
| Manager panel → **Settings → Access** | Manager | The manager→tablet rung (tri-states off/on/PIN) + per-waiter overrides |

## The two admin switches per module (owner's correction, 2026-07-22)

Per laddered module the admin has exactly TWO switches (settings columns):
1. **`<x>_allowed`** — *application*: the feature exists for this restaurant at all.
2. **`<x>_owner_control`** — *power transfer*: hand the on/off to the owner. When on,
   the owner's Settings page gains the toggle (**`<x>_enabled`**); when off, only the
   admin's switch counts and any stale owner value is ignored.

**Effective = allowed AND (NOT owner_control OR enabled).** Server helper:
`moduleLadder()` in `lib/tableTags.ts`.

## The defaults rule (apply to EVERY new feature, everywhere)

- **Brand-new module:** `allowed` OFF · `owner_control` OFF · `enabled` ON (so a later
  transfer changes nothing by itself) · manager grant OFF (owner grants deliberately)
  · tablet tri-state `off` · per-user override "default" (inherit). Nothing anywhere
  changes until the admin flips the module on. Also add the same defaults to
  `lib/settingsClone.ts` so a NEW restaurant never inherits #1's switches.
- **New rung added to a PRE-EXISTING feature:** every new rung defaults to the
  feature's CURRENT behaviour (non-breaking) — e.g. banquet's manager grant was
  BACKFILLED true (mig 167) because managers already used it.
- **Enforcement truth:** `managerCan()` reads an ABSENT manager-permission key as
  **false** — so `MP_DEFAULT` (admin access route) must always carry an explicit
  default per flag, matching the migration's backfill. Display and truth must agree.
- **Money-risk actions** (discount, mark-paid, invoice, void, khata, on-the-house):
  always laddered; the waiter rung defaults **off**.
- **Everyday operational actions** (accept, serve, open/close a table, attend a
  call): covered by the per-restaurant PANEL switch — deliberately NOT individually
  laddered, or the app becomes a switchboard.

## Current inventory (2026-07-22 audit)

| Capability | Rungs | Where |
|---|---|---|
| Panels (manager/kitchen/tablet/owner) | admin only (access = the panel itself) | Access → Panels |
| Guest menu features (11 switches) | admin only (guests aren't staff) | Access → Guest menu features |
| Owner-panel sections (6) | admin → owner | Access → Owner panel sections |
| Manager powers: manage_staff · edit_menu · give_discounts · view_dashboard · void_bills · edit_settings · view_ratings · table_tags · khata · banquet · table_ops | admin "exists" + owner "granted" | Access → Manager powers / Owner → Staff & powers |
| Tablet caps: discount · mark_paid · invoice · banquet · table_tags · khata · table_ops | manager tri-state + per-user | Access → Tablet / Manager → Settings → Access |
| Module: table types + khata (mig 166) | FULL ladder (reference implementation) | Access → Modules |
| Module: banquet (migs 130 + 167) | FULL ladder | Access → Modules |
| Module: Table & KOT operations — the KOT ▾ menu: change table, merge tables, move a KOT/dish, split bill, reprint (migs 172-177) | FULL ladder; when off, the classic ⇄ Shift renders instead | Access → Modules |
| Auto-print KOT (mig 107) | admin `allowed` + restaurant toggle `auto_print_kot` (owner/manager via edit_settings) — transfer permanently on by design | Manager → Settings → Kitchen |
| Serve/Ready/Pay undo bar | inherits the underlying action's permission | — |

Defaults per restaurant today: every module OFF except what the admin explicitly
enabled (Aangan: banquet + auto-print + table types; Pizza Palace: table types demo).
