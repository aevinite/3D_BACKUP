# OVERNIGHT AUTONOMOUS BUILD — access panel (owner asleep 2026-07-24)

Owner: "make a loop, wake every ~30-40 min, complete all phases till I'm back;
full access; everything done when I wake." Spec = memory `access-panel-BUILD.md`
(the corrected model + 10 phases). This file = execution log. Resume from here each wake.

## Rules while owner sleeps
- DEV stack ONLY (Supabase wnsfc… / Vercel 3-d-backup). NEVER touch MAIN. Migrations on dev DB only.
- Work in THIS worktree (`.claude/worktrees/access-panel-designs`, branch worktree-access-panel-designs).
- Commit after every phase. Verify with headless Playwright + sub-agent functional tests (safe-audit wording).
- If genuinely blocked on a decision → make the safe assumption, log it here, keep going. Do NOT stop.
- Keep `npm run lint`/build green before each commit.

## Decisions taken without owner (safe defaults, flag on wake)
- `reorder_menu`: no drag-reorder UI found in editor → REMOVED that sub-option. (Owner questioned it.)
- Banquet reach = Owner + Manager (no tablet rung). Owner didn't add tablet for banquet.
- New toggle interaction (master toggle → auto-Owner → reach control) implemented per my reading of the prompt; owner to confirm look on wake.

## Phase status
- [x] P1 — Lock corrected model in prototype #1 (rail+accordion). DONE + verified (0 console errors).
      Applied: master-toggle header (on→Owner, off→collapse+reset) replacing the 3-seg stepper;
      reach control Owner/+Manager/+Tablet (tablet only on money+floor powers, maxReach); waiter
      rung = On / On-with-PIN only (no Off); removed scrollspy toggle, discount-one-dish, table-tag
      add/rename + on-house sub, reorder_menu, admin-actions log; un-admin-tagged guest 3D; auto-print
      now an admin-only switch; take_orders now a normal ladder (manager toggleable); void copy
      clarified; per-person Default/On/Off (+On-with-PIN for tablet people); FIXED "Who has this" →
      lists ALL relevant people with live holder count (was 1, now matches). Verified both tenants +
      390px, no h-scroll. Commit: (see git log).
- [x] P2 — DB foundation. DONE (dev only, additive). Migration 180 adds
      `restaurants.access_config jsonb default '{}'` and is APPLIED + verified on the DEV
      Supabase (wnsfcizclkbobwzcxqsf). MAIN untouched.
      KEY ARCHITECTURE DECISION (safe + incremental, logged in access-panel-BUILD memory):
      the new panel writes the EXISTING canonical columns for every capability that already
      exists — owner_entitlements (admin→owner), manager_permissions (owner→manager grant),
      settings.<x>_allowed/_owner_control/_enabled (module ladders), settings.tablet_<x>
      (tablet tri-states), staff_users.permissions (per-person overrides). So the app's
      proven server enforcement applies the instant the panel saves — NO risky rewrite of the
      33 routes' guards. Only the genuinely-new granular bits with no legacy home (edit-menu
      sub-options, dashboard/log sub-options, per-side discount caps) live in access_config;
      their enforcement is a later, REVIEWED migration (changes no live behaviour until then).
      settingsClone needs no change (access_config self-defaults to {}).
      HONEST NOTE for the owner: the cross-route enforcement SWITCH for the new granular
      sub-options + the owner-panel per-restaurant privacy (P6) are security-critical and
      should have the owner's eyes / multi-role verification before becoming the sole guard —
      they will be built + tested but flagged, not silently shipped as live security.
- [~] P3 — Real React panel. IN PROGRESS.
      done: read the real admin theme (globals.css `.adm` / `.adm.adx`: tokens --bg/--card/--border/
      --text/--muted/--accent [purple #6d28d9 light · cyan #22d3ee dark, NOT gold]/--adm-ok/-danger/-warn,
      reusable .adm-card/.adm-crumbs/.adm-page-*/.own-range; admin pages = client components, inline
      styles). Confirmed the read/write shape (app/api/admin/restaurants/access/route.ts: manager_permissions
      + owner_entitlements + settings tablet caps + module ladder switches). BUILT lib/accessModel.ts —
      the real-key-mapped model (GROUPS + PERMISSIONS with storage bindings feature/panel/section/power/
      module/tablet/adminSwitch + sub-options; reachLevel/allowed/maxReach/subState helpers; NEW_POWER_FLAGS
      = revert_payment/mark_paid_power/invoice_power/export_reports/view_logs that need later enforcement).
      Type-checks clean. NOTE the model must be restyled to admin tokens (purple/cyan), NOT the gold prototype.
      TODO next: (1) extend the access route to also return/accept features+panels+access_config+module _enabled
      in ONE call; (2) build the React page at a NEW /aevinite route (don't touch the old one) porting the
      rail+accordion prototype using admin tokens; (3) wire saves to canonical columns + access_config;
      verify logged-in as diag admin.
- [ ] P4 — Write layer + server enforcement (cascade, mgr⊆owner, tablet⊆mgr, grant-only-what-you-hold)
- [ ] P5 — Per-person overrides (Default/On/Off/On-with-PIN) + General→Person cross-link + fixed "Who has this" list
- [ ] P6 — Owner panel per-restaurant privacy (grey-out + zero data for ungranted; no admin/owner clash)
- [ ] P7 — Admin-only settings (auto-print / banquet gate / 3D) grouped + enforced
- [ ] P8 — Guest features cleanup (drop scrollspy toggle, un-admin-tag 3D) + X-ray parity
- [ ] P9 — Theme pass to match /aevinite admin panel + fix minor UI
- [ ] P10 — Bulletproof: sub-agent functional tests all panels/roles/tenants, desktop+390px, hidden AND server-refused

## Log
- (start) plan saved to memory; MEMORY.md compacted; prod dev deploy READY; loop armed.
