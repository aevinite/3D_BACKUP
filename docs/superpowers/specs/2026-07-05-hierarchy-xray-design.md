# Hierarchy X-ray / grey-out — design + phased plan (2026-07-05)

Rishi's ask: ONE dynamic hierarchy (admin > owner > manager > kitchen/tablet) where the
SAME panel renders differently by who opened it. A feature turned OFF for a role is
HIDDEN from the real lower-role user but shown GREYED (locked) to a higher role viewing
in — with a jump-to-the-setting, a "reveal all" master toggle, a count of what's hidden,
and a "viewed by admin" marker. Plus admin→owner lands on that owner's all-restaurants
overview. Full rule captured in memory `hierarchy-xray-greyout`.

## The invariant (server is the source of truth)
The server already enforces every capability (`managerCan()` in the editor route,
`tabletPerm` for the tablet, RLS/`.eq(restaurant_id)` for tenancy). Grey-out vs hide is
PURELY presentation — it never grants power. A revealed/greyed item an admin clicks still
only works because the admin genuinely has that power server-side.

## The one signal everything hangs off: `whoami`
Each panel asks the server "who am I, and what are this restaurant's permissions?"
- Manager route: `GET /api/editor/whoami` → `{ actor: admin|owner|manager, higherView,
  managerPermissions }`. (SHIPPED this vertical.)
- Tablet/kitchen: add the same to their routes (returns per-user `permissions` +
  `higherView`).
Grant rule (matches the server): a manager is granted a flag ONLY when it's explicitly
`true`; undefined/false = not granted. Higher roles (admin/owner) always effectively
granted, but SEE the greyed state so they know what staff can't do.

## Rendering rule (client)
For each permission-gated control/tab/section:
- granted for the lower role → normal for everyone.
- not granted:
  - real lower-role user → **hidden**.
  - higher role (higherView) → **greyed/locked**, unless "reveal all" is on (then usable).
- A fixed bar shows "Viewing as ADMIN/OWNER · N off for staff · [Reveal all]"; the count
  and each locked item jump to the setting that controls it.

## Build phases
- **Phase 1 — SHIPPED (this branch, reference implementation):** manager panel, the
  Dashboard tab gated by `view_dashboard`. Real manager → Dashboard hidden; admin/owner
  → Dashboard greyed + lock icon; bottom bar with count + Reveal all; locked click jumps
  to `/owner/staff` (Access). Verified live on :4007 (manager hidden, admin greyed,
  reveal toggles). `XRAY_TABS` is a table — add rows to gate more.
- **Phase 2 — manager in-tab actions:** grey the Bills discount/void controls
  (`give_discounts`, `void_bills`), the Editor save (`edit_menu`), and the Access section
  (`manage_staff`) via the same WHO signal. Needs those controls to read `XRAY_WHO`.
- **Phase 3 — tablet panel:** `whoami` for tablet + grey "mark paid"/discount/invoice
  per `staff_users.permissions` (tri-state on/pin/off). Real tablet user → control
  hidden/blocked; admin viewing → greyed, usable when revealed.
- **Phase 4 — kitchen panel:** same treatment for any gated kitchen actions.
- **Phase 5 — jump-to-setting polish:** instead of just opening `/owner/staff`, deep-link
  to the exact control, scroll to it, and pop/highlight it briefly (his "take me exactly
  there" ask). Needs anchor ids on each setting + a `?focus=<key>` handler.
- **Phase 6 — admin→owner landing + banner everywhere:** admin clicking an owner lands on
  that owner's all-restaurants overview (owner panel already drills in); extend the
  "viewed by admin" ribbon to tablet/kitchen (the owner + manager panels already have it).

## Why staged, not merged tonight
This touches the LIVE manager/kitchen/tablet panels the day of the Aangan demo. Phase 1
is proven and safe; the rest should land after Rishi reviews at localhost:4007/manager
(admin act-as vs a real manager login). Do NOT merge to main until then.
