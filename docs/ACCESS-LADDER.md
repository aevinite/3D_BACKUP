# The Access Ladder — who controls what (canonical reference)

Owner rule (2026-07-22): **every feature and button carries the 4-rung ladder**
`admin → owner → manager → tablet`. Each rung toggles the rung below; a rung that's
off makes everything below it disappear from the UI AND get refused by the server
(hiding a button is never the only guard). The ladder IS the user-access system —
it lives in three screens:

## The ladder is a DELEGATION chain, not a usage chain (owner clarification, 2026-07-26)

A rung being ON means **"this role may PASS the capability down — and use it, if their
panel has a button for it."** Two different facts hide inside every owner rung:

1. **USE** — does this role's own panel surface the feature? The owner uses
   dashboard/staff/khata-book/menu in the OWNER panel (`ownerUse: "panel"` in
   `lib/accessModel.ts`), but floor features (parcel, take-orders, discounts, KOT ops…)
   have **no owner-panel page** — the owner uses those by opening the MANAGER panel,
   whose higher-view + `managerCan()` owner-bypass grants every power automatically
   (`ownerUse: "manager"`).
2. **GRANT** — may this role hand it to the rung below? The grant ceiling always comes
   from the rung ABOVE (admin `_allowed`/`power_<flag>` caps the owner; the owner's
   grant caps the manager), **never from what the role personally uses** — that's why
   an owner who never takes a parcel still grants parcel to managers.

The access panel states both facts on every ladder card (the "Owner has it / Owner can
give it" strip, driven by `ownerUse`). When adding a feature, set `ownerUse` honestly —
it is display truth only; enforcement is unchanged.

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

## The ADMIN X-RAY rule (owner, 2026-07-22 — apply to EVERY feature)

Two different worlds, never mixed up:

- **Coming from the ADMIN console (act-as view):** EVERY feature renders. When it's
  not actually on for the real staff (module off / grant off / tri-state off), it
  shows **GREYED (amber x-ray tint)** — never hidden — and it must **genuinely work**
  when the admin taps it (server bypass for the admin super-user; a tinted button
  that 403s is a lie). This is what lets the admin see exactly what staff experience
  while keeping full power.
- **Coming from a real LOGIN (owner / manager / waiter):** the ladder decides — they
  simply **see it or don't**. The OWNER's higher-view inside the manager panel tints
  grant-level switches (they can use those), but a module the admin turned off is
  gone for the owner too (the admin caps the reach).

Implementations: manager panel `XRAY_CONTROLS` + `applyHierarchyView` (tint) with the
feature's `xxxOn()` check letting `actor === "admin"` through; tablet `tshow()/txray()`
(higherView is admin-only there on purpose); server gates skip the module rung for the
admin super-user (`!g.user` in the editor API, `!actor` in the tablet API) — the same
bypass `tabletPerm`/`managerPinGate` always gave the admin.

**Status per feature (flag + fix any feature that doesn't comply):**
- ✅ table_ops (KOT ▾ menu) — admin always sees it (tinted when off), server bypasses
  the module rung for the admin, real logins follow the ladder.
- ✅ grant-level powers (discounts, void, ratings…) — tinted + usable for higher roles.
- ✅ table_tags / khata / banquet (fixed 2026-07-22, same PR as the KOT UI polish):
  admin view always sees their buttons/entries (tinted when the module or grant is off
  for real staff) and every module-rung server gate skips the admin super-user
  (`g.user &&` in the editor API, `actor &&`/`g.user &&` in the tablet API).

## THE RULE (owner, restated 2026-07-23): every feature is a laddered on/off

Any feature or **money/power** button we add gets the **full 4-rung ladder** wired from
day one — admin application (`<x>_allowed`) + admin power-transfer (`<x>_owner_control`)
→ owner on/off (`<x>_enabled`) → owner→manager grant (`power_<x>` + `manager_permissions
.<x>`) → manager→tablet cap (`settings.tablet_<x>` tri-state). It is a MODULE (Access →
Modules card + Owner → Features you control) whenever the whole feature can be switched
on/off for a restaurant — which is the default expectation now. Copy an existing module
end-to-end (`take_orders`, mig 179, is the latest worked example: `takeOrdersLadder`,
the six touchpoints below). Everyday operational actions (accept/serve/open-close/attend)
stay on the per-restaurant PANEL switch — see the carve-out in the defaults rule.

**Wiring is CONSOLIDATED since 2026-07-26 — most lists DERIVE from `lib/accessModel.ts`.**
A new laddered feature now needs only THREE hand-written touchpoints:
1. **One entry in `lib/accessModel.ts` `PERMISSIONS`** (module cols + `power` + `tablet`
   + `ownerUse`, and `moduleLabel` if several capabilities share one module). From this
   single entry the following wire themselves: the admin access panel + access2 route,
   the owner grant API (`MANAGER_POWER_FLAGS`), the owner Staff & powers page (add nice
   copy to its `PERM_COPY`), the owner Settings module toggle (`MODULE_DEFS`), the
   editor `whoami` (`allModuleLadders` + derived `features`/module-forced powers), the
   tablet + owner-staff per-person key whitelists (`TABLET_PERM_KEYS`), and the
   settingsClone drift-guard (warns if a ladder column has no clone default).
2. **The migration** adding `_allowed`/`_owner_control`/`_enabled` (+ the tablet
   tri-state column) **+ explicit defaults in `lib/settingsClone.ts`**.
3. **The feature's own server gates + panel UI** (a `moduleLadder` alias in
   `lib/tableTags.ts` for its action gates, the tablet GET overlay if the cap must
   force-off with the module, and the buttons themselves).

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
| Manager powers (DERIVED from accessModel since 2026-07-26): manage_staff · edit_menu · give_discounts · view_dashboard · void_bills · edit_settings · view_ratings · view_logs (absent-ON — an unset grant means ON, matching canViewLogs) · table_tags · khata · banquet · table_ops · take_orders · parcel | admin "exists" + owner "granted" | Access → Manager powers / Owner → Staff & powers |
| Tablet caps (DERIVED): discount · mark_paid · invoice · banquet (rung surfaced in the admin panel 2026-07-26 — it was server-enforced but invisible there) · table_tags · khata · table_ops · take_orders · parcel | manager tri-state + per-user | Access → Tablet / Manager → Settings → Access |
| Module: table types + khata (mig 166) | FULL ladder (reference implementation) | Access → Modules |
| Module: banquet (migs 130 + 167) | FULL ladder | Access → Modules |
| Module: Table & KOT operations — the KOT ▾ menu: change table, merge tables, move a KOT/dish, split bill, reprint (migs 172-177) | FULL ladder; when off, the classic ⇄ Shift renders instead | Access → Modules |
| Module: Order-taking — the manager ＋Take order builder + the waiter tablet's order button (migs 178-179) | FULL ladder; `_allowed` BACKFILLED on (ordering is core) — admin can switch a restaurant's ordering fully off | Access → Modules |
| Auto-print KOT (mig 107) | admin `allowed` + restaurant toggle `auto_print_kot` (owner/manager via edit_settings) — transfer permanently on by design | Manager → Settings → Kitchen |
| Serve/Ready/Pay undo bar | inherits the underlying action's permission | — |

Defaults per restaurant today: every module OFF except what the admin explicitly
enabled (Aangan: banquet + auto-print + table types; Pizza Palace: table types demo).
