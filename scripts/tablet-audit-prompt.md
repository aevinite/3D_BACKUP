You are running UNATTENDED at 4 AM as a scheduled deep audit. Nobody is watching, so
do NOT ask questions and do NOT wait — just do the full job and write the report.

# YOUR ONE JOB
Deep-audit the TABLET (waiter) panel of this restaurant SaaS app. Check EVERY page/screen,
EVERY button, EVERY tile, EVERY flow (take-order, add-dish, allergy note, discount, move/
shift table, waiter-call handling, settle/print) — on a real TABLET width (~768–1024px) AND
on a phone width (~390px), because waiters use both. Find every bug, error, broken thing,
and list every improvement we could make. Then write it all to a report file in EASY, plain
language a non-technical person can understand.

# CONTEXT YOU MUST READ FIRST
- Read `CLAUDE.md` (project rules) and the memory index at
  `/Users/aevinite/.claude/projects/-Users-aevinite-Documents-Projects-backup-Menu/memory/MEMORY.md`.
  Open the specific memory files that matter here:
    * `test-staff-logins.md`, `staff-identity-model.md`, and any saas-build-state / owner-creds
      note — for how to LOG IN as a waiter and reach the tablet panel.
    * `guest-table-route.md`, `per-restaurant-panels.md` — how tenants/tables/panels are routed.
    * `tablet-panel-audit-2026-07-06.md` and `four-closed-sessions-shipped-2026-07-07.md`
      (PR #197 tablet fixes: discount-before-tax, allergy-leak reset, dead status pill /
      Move-order, optimistic tiles, back-stack, server dedup, waiter-added-dish auto-accept)
      — so you do NOT re-report already-fixed bugs. Only report what is STILL broken.
    * `cart-ui-preference.md` (owner rejects floating cart bars; wants a persistent
      "This order" pane), `aangan-restaurant-setup.md` (tablet-only phone redesign).
    * `chrome-mcp-hangs-use-playwright.md` and `headless-playwright-fallback.md` — HOW to verify:
      the chrome-devtools MCP HANGS on this machine, so verify with the repo's own headless
      Playwright (scripts/verify-*.mjs are working examples of the login + iframe pattern).
    * `worktree-node-modules-real-install.md` — the panels render inside an IFRAME, so in
      Playwright you must query `page.frames()` to reach the tablet UI, not the top page.
    * `prefer-headless-verification.md` — never open a visible Chrome window.
    * `realtime-reliability-pattern.md`, `egress-targeted-refetch.md`,
      `stale-refresh-race-pattern.md` — the app's known live-update / cost bug classes.

# THE TABLET PANEL = these files
- `public/panels/tablet/app.js` and `public/panels/tablet/index.html` (the vanilla-JS waiter UI,
  embedded full-screen in an iframe at the `/tablet` route).
- `app/api/tablet/[...path]/route.ts` (its server endpoints; service-role).
- Shared panel plumbing it loads: `public/panels/realtime.js`, `public/panels/backstack.js`,
  `public/panels/connbadge.js`, `public/panels/outbox.js`, and `components/ConnectionBadge.tsx`.
- The order-placing RPC path (`lfh_staff_place_order`) and the per-table `?table=N` refetch.

# HOW TO AUDIT (be thorough, spend the time)
1. The dev server is already running at http://localhost:4000. Log in as a WAITER using the
   creds/flow from memory (panel login, then reuse the cookie) and confirm you can reach /tablet.
2. Spawn `bug-hunter` subagents to hunt in parallel, but ONLY ~2 at a time (per memory: many
   Chrome/Playwright agents at once deadlock on the shared browser). Suggested waves:
     Wave A: floor tiles + open-table detail   |   Wave B: take-order + add-dish flow
     Wave C: allergy note + per-order discount  |   Wave D: move/shift table + waiter-calls
     Wave E: settle/print + back-button stack + realtime live-update + offline outbox
   Give each hunter a tight scope, tell it to PROVE every bug with concrete steps (exact
   tap/input -> what goes wrong), and to check BOTH tablet (~768–1024px) AND phone (~390px).
3. Watch for this app's known bug classes: cross-tenant leak (one restaurant's tables/menu
   showing for another), money math (discount-before-tax, tax source of truth, paid-only
   revenue), stale/flicker on realtime updates (boardSig, latest-wins), whole-table egress
   reads instead of the scoped `?table=N` refetch, IST/timezone, non-#1 branding leaks, and
   the offline action-queue behaving at-most-once.
4. Verify live — don't judge from source alone. Where a hunter can't reach the running app,
   fall back to reading the code + the tablet API route.

# WRITE THE REPORT
Write to: `.claude/audits/tablet-audit-<TODAY:YYYY-MM-DD>.md` (create the folder if missing).
Structure it EXACTLY like this, all in plain, friendly language:

  # Tablet (Waiter) Panel Audit — <date>
  ## In short (read this first)
  <2-3 lines: how many bugs, how bad, and the single most important thing to fix>
  ## 🔴 Bugs & broken things (worst first)
  For each: a plain-language title, which screen/button, what goes wrong (with the exact
  steps to see it), why it matters, and tablet/phone/both. Number them.
  ## 📱 Phone-width problems (~390px)
  ## 💡 Improvements we could make (nice-to-haves, not bugs)
  ## ✅ What I checked and found working

Rank bugs most-severe first. Do NOT fix anything. Do NOT commit or push. Do NOT edit any
code — the ONLY file you create is the report. If login or the server fails, still write a
report saying exactly what blocked you.
