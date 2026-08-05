> # ⚠️ HISTORY ONLY — kept as a record, not as instructions
>
> This is the micro-phase plan for the July access redesign. The work it plans is **done**, and the model it describes was
> replaced by the access rebuild of 2026-07-31.
>
> **Do not follow it for new work. Read `docs/ACCESS-MODEL.md` instead.** It is kept because it
> records WHY things were built the way they were, which the finished code cannot say.
> Moved here from the repo root on 2026-08-05, where it read like a live plan.

# ACCESS + ADMIN-RESTAURANT REDESIGN — micro-phase plan (owner 2026-07-24)

Rule: complete ONE tiny phase at a time, verify, tick it, move on. Ship to DEV (3-d-backup)
in batches. DEV only, never MAIN (owner: main later). Single source of truth for access =
the /aevinite/access panel; the restaurant-detail page must STOP duplicating those toggles.

Legend: [ ] todo · [~] doing · [x] done+verified

## A — RESTAURANT DETAIL PAGE (app/aevinite/restaurants/page.tsx) — the loudest complaints
- [x] A1  Sidebar nav "Access control" → "Access & permissions" (components/admin/AdminShell.tsx)
- [x] A2  Header buttons: Access & permissions + Full report → plain secondary (NOT orange primary); page leads with normal detail
- [ ] A3  Full report view: add a clear "← Back" to the restaurant detail
- [x] A4  Tickets card: when 0 open tickets → compact one-line ("No open issues" + Show resolved), not a big empty box
- [x] A5  Remove Suspend button from the TOP status area
- [x] A6  Top status: keep a clean LIVE / maintenance STATUS display only (no destructive buttons)
- [x] A7  Improve "Take menu offline" (maintenance) wording + control clarity
- [x] A8  Google review card: add on/off state to the heading ("Google review nudge — ON/OFF") + clearer copy so it's not "out of nowhere"
- [x] A9  EnterCard "View & manage": redesign layout (clean grouping, good UI)
- [x] A10 EnterCard: clarify OR remove "Stop viewing as this restaurant" (owner doesn't know what it does)
- [x] A11 EnterCard: keep "Manage staff & create users" here; remove the confusing duplicate/"two things"
- [x] A12 REMOVE the "Panels" toggle card from detail (now in Access panel)
- [x] A13 REMOVE the "Staff features" (auto-print/banquet allow) card from detail (now in Access)
- [x] A14 REMOVE the "Guest features" toggle card from detail (kills stale scroll-spy/search too)
- [x] A15 Keep the panels FETCH (EnterCard needs it to know which panel buttons to show); only remove the toggle UIs
- [x] A16 Add a small "Manage panels, features & permissions in Access & permissions →" pointer where cards were
- [x] A17 Danger zone at BOTTOM: Suspend lives here now (moved from top)
- [x] A18 Danger zone: Delete is DISABLED until the restaurant is suspended (enforce suspend-before-delete) + explain why
- [ ] A19 Card order: status → tickets(compact) → view&manage → owner → theme → google review → danger zone
- [ ] A20 Verify nothing references the removed cards' state incorrectly; build clean

## B — ACCESS PANEL LOOK (app/aevinite/access/page.tsx) — "look is bad", esp. LIGHT mode
- [ ] B1  Screenshot current light + dark to baseline
- [x] B2  Card hierarchy: sections shouldn't be big empty white boxes — tighter, clearer
- [x] B3  Accordion header: better weight/spacing, count chip styling
- [x] B4  Rail: selected state + counts polish (light + dark)
- [ ] B5  Ladder card header: reach tag + toggle alignment + hover
- [ ] B6  Sub-tabs + chips: light-mode contrast + polish
- [ ] B7  Per-person rows + tri-state: light-mode polish
- [ ] B8  Contrast/accessibility pass (4.5:1) both skins
- [ ] B9  Mobile 390px recheck
- [ ] B10 Re-verify 0 console errors

## C — SYNC / SINGLE SOURCE (the "two systems" bug)
- [ ] C1  After A12–A14, access panel is the ONLY toggle UI for panels/features/modules
- [ ] C2  Access saves bust the features cache + panels cache so changes reflect in the live panels immediately (the "close KOT here → closes there")
- [ ] C3  Verify: flip auto-print / a panel in Access → reflected for manager/kitchen without stale
- [ ] C4  Remove now-unused toggle handlers/imports from detail page

## D — YESTERDAY'S MODEL ITEMS (verify each is actually done)
- [ ] D1  take_orders manager-toggleable · D2 scroll-spy gone everywhere · D3 discount-one-dish gone
- [ ] D4  void copy clear · D5 table-tags single mark/remove · D6 admin-log gone · D7 guest 3D un-tagged
- [ ] D8  auto-print admin-only · D9 per-person Default/On/Off/PIN · D10 Who-has-this list
- [ ] D11 M/O badges + conflict warning · D12 waiter On/On-PIN · D13 entry button + breadcrumb

## E — GRANULAR ENFORCEMENT (P4, server-side) — flagged security-critical, test hard
- [ ] E1  Design: how each granular sub-option maps to a server check
- [ ] E2  edit_menu sub-options enforced in the editor route
- [ ] E3  dashboard/log sub-picks enforced
- [ ] E4  discount caps clamped server-side
- [ ] E5  void/revert new tablet rungs enforced
- [ ] E6  new powers (revert_payment/export_reports/view_logs) scope decided + enforced
- [ ] E7  per-person override keys align with the server checks
- [ ] E8  verify each: hidden in UI AND refused by server, per role, both tenants

## F — OWNER-PANEL PER-RESTAURANT PRIVACY (P6)
- [ ] F1  Audit owner panel section read path
- [ ] F2  Grey-out ungranted sections per restaurant
- [ ] F3  Zero-data (no leak) for ungranted sections
- [ ] F4  Reconcile admin-set vs owner-set (no clash)
- [ ] F5  Verify cross-tenant isolation

## G — SHIP (per batch)
- [ ] G1 build green · G2 deploy dev · G3 verify live (headless, 0 errors) · G4 report

STATUS LOG:
- (plan created 2026-07-24)
