# ⚡ RESUME STATE (read FIRST after any compaction) — 2026-07-24

## Where / how
- Worktree `.claude/worktrees/access-panel-designs`, branch `worktree-access-panel-designs`.
- Deploy to BACKUP ONLY: `aevinite/3D_BACKUP` → Vercel `3-d-backup` (https://3-d-backup.vercel.app).
  DO NOT deploy MAIN (aevinite.shop / 3d-menu-av) — owner will say when. Every In-short: "MAIN deploy still pending".
- Flow per change: edit → `npm run build` → commit → `git push` → `gh pr create --base main` → `gh pr merge --merge`
  → poll Vercel READY → verify live headless → tick plan. Loop = ScheduleWakeup ~60s (owner "keep going").
- DEV Supabase = wnsfcizclkbobwzcxqsf (Mumbai). Migrations: highest = 180 (access_config). NEXT = 181.
  Apply a migration to DEV via Management API (SUPABASE_ACCESS_TOKEN + project ref from NEXT_PUBLIC_SUPABASE_URL); guard ref==='wnsfc...'.
- Diag logins (memory test-staff-logins): admin = POST FORM /api/staff-login {password:ADMIN_PASSWORD}.
  Staff = POST JSON /api/panel-login {username,password}. owner diago1/diag-o1-2026 (french-house #1 …0001);
  manager diagm2/diag-mgr-2026 (pizza-palace #2 …0002). Verify = headless Playwright, read→change→verify→REVERT, delete temp scripts.

## DONE + VERIFIED LIVE (backup)
- Stage 1-2: design #1 IS /aevinite/access; ratings/owner-sections UNIFIED (one laddered cap drives owner page + mgr power); owner-only caps show single Owner step.
- Stage 3: single-source (dup toggles removed from restaurant detail); syncs via 30s cache.
- Stage 4: role-relevance map (manager/tablet lists exclude owner-only caps).
- Stage 5 + GAP-A/B: owner per-user override UI capped by admin ceiling + role; verified 7/7 (banquet grant when off → 403; greyed "not enabled").
- Stage 7: per-restaurant privacy across reports/analytics/overview/customers/issues/ratings/settings (verified: reports off → 403, no revenue leak).
- Crash fix: permKey moved to MODULE scope (TDZ crashed the whole panel).
- Left rail: single consistent active (accent bar + soft tint) — verified only ONE highlights.
- ITEM 1 edit-menu sub-option enforcement — VERIFIED 5/5 (editor route menuSubAllowed reads access_config.edit_menu.manager_opts; non-breaking allow-when-unconfigured; manager blocked from delete/add when unticked; owner/admin full).
- ITEM 2 discount %-cap — VERIFIED 4/4 (lib/discountCap.ts; editor(manager)+tablet(waiter) refuse over access_config.give_discounts.limit[role]; non-breaking; admin uncapped).

## IN PROGRESS / NEXT (do in order)
1. Migration 181 — backfill restaurants.access_config.edit_menu {owner_opts,manager_opts} = the 7 sub-options
   (add_dish,edit_dish,edit_price,delete_dish,mark_86,manage_categories,manage_filters) all TRUE for existing
   restaurants (NOT edit_3d — admin-only). Panel display defaults; non-breaking. Run on DEV.
2. ITEM 3 — real HD screenshots: headless-capture guest menu dish card / manager bill+discount / kitchen / tablet
   into public/admin-help/*.png; wire /aevinite/access (i) popover to lazy-load the matching image + lightbox,
   replacing the placeholder. Map each PERMISSIONS[].shot → a file (lib/accessModel has `shot` in the prototype
   but the REAL panel's (i) uses perm.what + a placeholder — wire the image there). Keep lazy/egress-safe.
DEFERRED (note, low priority): edit_3d field-level server gate (3D saved inside item upsert; needs the model
   column names + strip-for-manager; admin-only anyway). edit_price/mark_86 ride edit_dish (coarse, OK).

## KEY FILES
lib/accessModel.ts (model + reachLevel/allowed/permKey), lib/discountCap.ts, app/aevinite/access/page.tsx (the panel),
app/api/admin/restaurants/access2/route.ts (admin read/write), app/api/owner/staff/route.ts (set_permissions + GAP-B ceiling + module-effective in GET),
app/api/owner/{analytics,overview,settings,reports}/route.ts (entitledSubset per-restaurant privacy),
app/api/editor/[...path]/route.ts (menuSubAllowed + discount cap), app/api/tablet/[...path]/route.ts (discount cap).
Full history: ACCESS-MASTER-PLAN.md. Memory: access-panel-BUILD.md.
