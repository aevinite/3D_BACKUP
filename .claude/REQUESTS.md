# Aevidine — running request checklist

Every owner request lands here. Each item gets checked off ONLY when built **and**
verified across the panels it touches. Owner: "do work → check everything → repeat;
don't stop until every single bit is done."

## 🔴 BUGS / FURY (fix first — these are visibly broken)

- [x] **Per-restaurant intro/splash** — `IntroSplash` now takes the restaurant's wordmark +
  accent (via AppShell); non-#1 shows ITS name + accent glow/ring + NO French House logo.
  Verified: Pizza Palace intro = "Pizza Palace" in red, no LFH logo. #1 unchanged (isDefault
  branch = original). [shipping]
- [x] **Kill the floating "panel shifter" (AdminSwitcher ⠿ Panels)** — removed from `app/layout.tsx`
  (import + render). Admins reach restaurants from `/aevinite/restaurants` now. tsc green. [verified]
- [x] **Admin reaches ANY restaurant — guest menu + owner panel + manager/kitchen/tablet,
  invisibly.** ROOT CAUSE of "I can only access Little French House": `/api/admin/act-as` set the
  Set-Cookie on one response then `return`ed a *fresh* `NextResponse.json()`, silently dropping it —
  so every panel stayed on restaurant #1. FIXED (return the cookie-carrying response). PLUS added a
  **"Owner dashboard"** button + let `/owner` admit the admin ONLY when act-as is set (bare admin
  login still bounced — keeps admin/owner separate) + scoped `ownerScope` to that one restaurant.
  Verified in Chrome at desktop + 390px: Pizza Palace guest menu (its brand, no LFH leak), manager
  `/all` scoped to Pizza Palace, owner dashboard shows ONLY Pizza Palace with the
  `Restaurants › Pizza Palace › Owner dashboard` breadcrumb + "ADMIN VIEW" + "Exit view". Read-only,
  so invisible to the owner. [verified]
- [~] **"Accept order"** — ROOT CAUSE FOUND (systematic): the server endpoint
  `POST /api/editor/orders/<id>/accept` WORKS (verified 200, status received→preparing, even via
  admin act-as). The bug is CLIENT-SIDE: `renderTablePanel()` (the table-detail view) renders NO
  accept control — so clicking a table gives you no way to accept. `acceptOrder(id)` exists +
  works. FIX = surface Accept (+ serve/pay) in the table detail — folds into the table-detail
  REBUILD below (collapsible sidebar / full-screen popup with all actions). NEXT.
- [ ] **Real-time across ALL panels:** an order change made anywhere must update owner + admin +
  manager + tablet INSTANTLY, with no flicker (no "show old value 1s → refresh to new"). Verify
  on every restaurant.

## 🟡 DYNAMIC UI FEATURES

- [ ] **Manager right sidebar collapsible.** Open/close it. When CLOSED, tapping a table opens a
  FULL-SCREEN popup for that table (closable). When OPEN, the table detail shows in the sidebar.
- [ ] **Nav as a hover-expand icon rail** — icons only by default; hover expands to show the
  label. Less screen space.
- [ ] **Customizable nav** — an "edit" mode (top-right) to drag-reorder which icons show first.
- [~] **Breadcrumb inside a restaurant** — `Restaurants › <name> › …` so you can step back up.
  DONE for the admin's owner-dashboard view (amber breadcrumb bar in OwnerShell). STILL TODO: the
  admin restaurant-detail drill-in (`/aevinite/restaurants` → a restaurant) still uses a plain
  "All restaurants" back button — upgrade it to the same breadcrumb for consistency.
- [ ] Add small, great UX touches proactively (don't ask).

## ⚙️ PROCESS / MEMORY (durable — into CLAUDE.md)

- [x] shadcn MCP registered globally (restart Claude Code to use it).
- [x] `backup_Menu` synced to live (`fad35fc`).
- [ ] CLAUDE.md: for ANY design work, load the UI/UX (Pro Max) skill + superpowers; compare/
  merge approaches; pick the best.
- [ ] CLAUDE.md: every restaurant must be DIFFERENT (theme + intro + branding), never #1's.
- [ ] Keep this checklist current (add every request, check off only when verified).
- [ ] Keep `.claude/work-checker-lessons.md` pruned to only what matters.

## ✅ DONE (this round)
(none yet — populate as items above are verified)
