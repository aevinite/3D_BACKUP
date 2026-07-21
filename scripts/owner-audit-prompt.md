You are running UNATTENDED at 4 AM as a scheduled deep audit. Nobody is watching, so
do NOT ask questions and do NOT wait — just do the full job and write the report.

# YOUR ONE JOB
Deep-audit the OWNER panel of this restaurant SaaS app. Check EVERY page, EVERY button,
EVERY control, on desktop AND on ~390px mobile. Find every bug, error, broken thing, and
list every improvement we could make. Then write it all to a report file in EASY, plain
language a non-technical person can understand.

# CONTEXT YOU MUST READ FIRST
- Read `CLAUDE.md` (project rules) and the memory index at
  `/Users/aevinite/.claude/projects/-Users-aevinite-Documents-Projects-backup-Menu/memory/MEMORY.md`.
  Open the specific memory files that matter here:
    * `test-staff-logins.md` and any owner-creds / saas-build-state note — for how to LOG IN as an owner.
    * `owner-panel-diag-2026-07-06.md`, `owner-panel-redesign.md`, `owner-portfolio-multi-restaurant.md`,
      `full-app-audit-fixes-pr196.md` — so you don't re-report already-fixed bugs.
    * `chrome-mcp-hangs-use-playwright.md` and `headless-playwright-fallback.md` — HOW to verify:
      the chrome-devtools MCP HANGS on this machine, so verify with the repo's own headless
      Playwright (scripts/verify-*.mjs are working examples of the login + iframe pattern).
    * `prefer-headless-verification.md` — never open a visible Chrome window.

# THE OWNER PANEL = these routes (app/owner/*)
home/overview, sales, report, customers, inventory, menu, marketing, staff, settings —
plus shared bits: components/owner/OwnerShell.tsx, Charts.tsx, RangeSlider.tsx,
OwnerReconnecting.tsx, and the owner APIs under app/api/owner/*.

# HOW TO AUDIT (be thorough, spend the time)
1. The dev server is already running at http://localhost:4000. Log in as an OWNER using the
   creds from memory (POST /api/panel-login, then reuse the cookie). Confirm you can reach /owner.
2. Spawn `bug-hunter` subagents to hunt in parallel, but ONLY ~2 at a time (per memory:
   many Chrome/Playwright agents at once deadlock on the shared browser). Suggested waves:
     Wave A: overview/home + sales   |   Wave B: report + customers
     Wave C: inventory + menu        |   Wave D: marketing + staff
     Wave E: settings + shared shell/charts/range-slider + realtime live-update
   Give each hunter a tight scope and tell it to PROVE every bug with concrete steps
   (exact click/input -> what goes wrong) and to check BOTH desktop and ~390px mobile.
3. Watch for this app's known bug classes: cross-tenant data leak (one restaurant's numbers
   showing for another), money math (discount-before-tax, paid-only revenue), stale/flicker
   on realtime updates, whole-table egress reads, IST/timezone, and non-#1 branding leaks.
4. Verify live — don't judge from source alone. Where a hunter can't reach the running app,
   fall back to reading the code + the owner API routes.

# WRITE THE REPORT
Write to: `.claude/audits/owner-audit-<TODAY:YYYY-MM-DD>.md` (create the folder if missing).
Structure it EXACTLY like this, all in plain, friendly language:

  # Owner Panel Audit — <date>
  ## In short (read this first)
  <2-3 lines: how many bugs, how bad, and the single most important thing to fix>
  ## 🔴 Bugs & broken things (worst first)
  For each: a plain-language title, which page/button, what goes wrong (with the exact
  steps to see it), why it matters, and desktop/mobile/both. Number them.
  ## 📱 Mobile-only problems (~390px)
  ## 💡 Improvements we could make (nice-to-haves, not bugs)
  ## ✅ What I checked and found working

Rank bugs most-severe first. Do NOT fix anything. Do NOT commit or push. Do NOT edit any
code — the ONLY file you create is the report. If login or the server fails, still write a
report saying exactly what blocked you.
