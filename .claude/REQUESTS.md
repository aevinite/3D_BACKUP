# Aevidine — running request checklist

Every owner request lands here. Each item gets checked off ONLY when built **and**
verified across the panels it touches. Owner: "do work → check everything → repeat;
don't stop until every single bit is done."

## 🔴 BUGS / FURY (fix first — these are visibly broken)

- [x] **Per-restaurant intro/splash** — `IntroSplash` now takes the restaurant's wordmark +
  accent (via AppShell); non-#1 shows ITS name + accent glow/ring + NO French House logo.
  Verified: Pizza Palace intro = "Pizza Palace" in red, no LFH logo. #1 unchanged (isDefault
  branch = original). [shipping]
- [ ] **Kill the floating "panel shifter" (AdminSwitcher ⠿ Panels) in the admin panel** — it's
  confusing and not how to reach restaurants.
- [ ] **Admin must reach ANY restaurant** — its guest menu, its owner panel, its manager/
  kitchen/tablet panels — with NO password and INVISIBLY (the owner gets no hint they're being
  viewed). Admin = top power. Right now only French House is reachable; e.g. there's no way to
  open Pizza Palace's menu. Make it obvious + working from `/aevinite/restaurants`.
- [ ] **"Accept order" is broken** from admin → French House manager panel (clicking does
  nothing / console errors). Fix it. Also: the manager table-DETAIL may have no Accept button —
  add it so an order can be accepted from the table view too.
- [ ] **Real-time across ALL panels:** an order change made anywhere must update owner + admin +
  manager + tablet INSTANTLY, with no flicker (no "show old value 1s → refresh to new"). Verify
  on every restaurant.

## 🟡 DYNAMIC UI FEATURES

- [ ] **Manager right sidebar collapsible.** Open/close it. When CLOSED, tapping a table opens a
  FULL-SCREEN popup for that table (closable). When OPEN, the table detail shows in the sidebar.
- [ ] **Nav as a hover-expand icon rail** — icons only by default; hover expands to show the
  label. Less screen space.
- [ ] **Customizable nav** — an "edit" mode (top-right) to drag-reorder which icons show first.
- [ ] **Breadcrumb inside a restaurant** — `Restaurants › Little French House › …` so you can
  step back up.
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
