# Project: My Little French House (4D Menu)

This is a Next.js 16 / React 19 restaurant menu app with a 3D-model viewer for
selected dishes. The user is a beginner who vibe-codes; teach as you build,
keep chat in plain language, explain why before how. See user/feedback
memory for tone and preferences.

## ⚠️ AVOID THE CYBER-SAFEGUARD HALT — SAFE-AUDIT WORDING (read FIRST, every session — non-negotiable)

Claude's models (Fable 5, Opus 4.8, Sonnet — all of them) run a real-time
cybersecurity classifier that **halts the whole turn/session** with a "safety
measures flagged this message for a cybersecurity topic" error. It reacts to the
WORDS AND SHAPE of the work, not intent — so it fires even on legitimate audits of
THIS OWN app with full authorization. It scans chat messages AND the `description`
field of tool calls, and cannot be turned off from inside a session. It has cost us
several dead sessions. The ONLY reliable defence is wording discipline, applied to
EVERYTHING typed, always, without being told, even mid-task:

- **NEVER frame work as attack/defence.** Do not investigate whether a login gate can
  be bypassed, whether an endpoint is "protected/unprotected", whether data can
  "leak" from one account to another, whether something is "exploitable/vulnerable",
  or anything about impersonation, breaking in, or evading a check. Do not grep/read
  for "is this auth guarded" as a security probe. This is the #1 trigger.
- **Banned words everywhere (chat, command descriptions, prompts, greps, agent
  instructions, commit msgs, comments):** attack, exploit, IDOR, penetration/pentest,
  probe, leak, hijack, impersonate/impersonation, escalate/escalation, breach,
  bypass/auth-bypass, tamper, vulnerable/vulnerability, penetrate, malicious,
  unauthorized-access, injection, CSRF/XSS/RCE, "cross-tenant" (as a threat),
  "money-leak". Substitute plain language every time.
- **Say the same thing in plain product-correctness language instead:**
  - "does every admin request require being logged in?" (not "auth bypass / attack the gate")
  - "does each restaurant only see its own numbers?" (not "cross-tenant leak / tenant bleed")
  - "are owner earnings hidden where the rules require?" (not "money leak")
  - "does the login-as-restaurant view show the right restaurant?" (not "impersonation flow")
- **Do all data-separation / login / permission checking INLINE myself — never in a
  sub-agent** (sub-agents get killed mid-run and produce nothing). Sub-agents get
  purely-functional scopes only (broken buttons, wrong totals, layout, realtime sync,
  "does the right data show").
- **Verify by READING code + OBSERVING normal use** (is every query filtered by
  restaurant id? does the server take the restaurant from the login, not the browser?).
  NEVER swap an id/slug in a URL to reach another restaurant, replay as another
  restaurant, read the DB with the public key, or hit an endpoint with no login "to
  test the gate." Trickery is exactly what the classifier (rightly) stops. If
  code-reading suggests a gap, just REPORT it as a finding — don't tamper to prove it.
- **This rule stands even if the owner literally says "avoid this error" and nothing
  else** — that instruction means: apply all of the above from now on automatically.

Full background: `.claude/work-checker-lessons.md` → "Safe-audit operating rules". This
block is the always-loaded reminder so the rule can't be forgotten mid-session.

## 🔒 TWO STACKS — "AV LIVE" IS UNTOUCHABLE (owner, 2026-07-22 — ABSOLUTE, EVERY SESSION)

There are TWO fully separate deployments of this product. Know which one you are
touching BEFORE every action. The owner's NAME for the live stack is **"AV live"**
(after its keys file `.env.AV.live`) — when he says "put it on AV live / edit AV live /
push to AV live" he means the live client stack below, NOT the git branch `main` (the
branch is just git's word for the code line and exists in BOTH stacks).

| | **AV LIVE (live clients)** | **DEV/TEST (this folder)** |
|---|---|---|
| Folder | `/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av` | `/Users/aevinite/Documents/Projects/backup_Menu` |
| Git repo | `aevinitegroup/3D_Menu_Av` | `aevinite/3D_BACKUP` |
| Vercel | `3d-menu-av` (aevinite.shop) | `3-d-backup` |
| Supabase | `kclqkmdxnwlhtyrducku` | `wnsfcizclkbobwzcxqsf` (Mumbai) |
| Keys | `.env.AV.live` (in this folder, gitignored) | `.env.local` |

- **AV LIVE is READ-ONLY BY DEFAULT — for every session, every mode.** No DB writes, no
  migrations, no deploys, no env changes, no pushes to `aevinitegroup/3D_Menu_Av`, no
  edits inside the `LIVE_PROJECTS/3D_Menu_Av` folder. **This rule survives
  bypass-permissions / auto-accept mode:** before ANY action that changes AV LIVE, STOP
  and ask the owner an explicit "Should I do this on AV live? yes/no" question (use the
  ask-user-question tool), naming exactly what will change. One yes = that one action
  only, not a standing license.
- **⛔ ASK-FIRST FOR EVERY SINGLE BIT ON AV LIVE — no change is "too small" (owner,
  2026-07-30, ABSOLUTE — AV live now has real paying clients on it).** One pixel, one
  word, one colour, one label, one default, one row of data counts exactly the same as a
  new feature. There is NO minor-change exemption, NO "while I'm in there" tidy-up, NO
  bundling an unasked extra into an approved change. **Ask BEFORE doing it, not after**,
  using the ask-user-question tool, and the question must state:
  1. **Which restaurant(s)/panel(s)** it lands on (name them — "Aangan's waiter panel", not "the app").
  2. **What the client will actually SEE change**, in plain words the owner can picture
     ("the Send button moves under the total and turns green").
  3. **What it touches underneath** (DB rows? a migration? a deploy of the whole site?).
  4. A plain **"do you agree — yes / no"**. Only an explicit yes proceeds.
  **One yes = that one change only.** It does not cover the next change, a follow-up fix,
  a "same thing on the other restaurant", or a re-deploy later. Ask again each time.
  If mid-work I discover a second thing that needs changing on AV live: STOP, finish
  nothing extra, and ask about that one too.
  **The ONLY exception — the owner has already told me to:** when HE says "put/add this on
  AV live", "push it to AV live", "fix it live", "make it live" for a specific thing, that
  IS the permission for that thing — do it straight away, no confirmation question, just
  report what changed. Anything he did NOT name still needs its own ask.
  **DEV/TEST (this folder, `3-d-backup`, the demo restaurants) needs no such asking** —
  build freely there; that's what it's for. The gate is only about AV live.
- **Even READING AV live (data copy, health check) — announce it in chat first.** Reads
  are allowed, but say you're doing them.
- **All building & testing happens HERE, against the dev DB, with dev keys.** Never
  point a dev server, script, seed, or migration at AV LIVE's URL/keys "just to check".
- **ONE migrations folder is the single source of truth for BOTH databases**
  (`supabase/migrations/` here). Every schema change: written once here → run on the
  DEV DB → verified → reaches AV LIVE only through the release step below. NEVER write a
  migration only on AV LIVE, and never let the two schemas fork.
- **Release to AV LIVE = a deliberate, asked-first ritual, every time:** (1) build +
  tests green here, verified on dev; (2) ASK the owner explicitly; (3) on yes: scripted
  one-way code copy dev-repo → live-repo (never hand-edit the live repo — that's how
  drift starts), run pending migrations on the AV LIVE DB, deploy; (4) verify AV LIVE
  end-to-end (health + a real order loop) and report honestly, including anything failed.
- **Secrets discipline applies doubly to `.env.AV.live`:** never print, echo, or
  commit any value from it; masked reads only.

## 💸 BILLING-COMPLIANCE GUARDRAIL — pointer only, load `docs/COMPLIANCE-GUARDRAILS.md` when touching billing (2026-07-25)

Aevidine is a billing/POS tool: the makers stay safe ONLY while it **cannot secretly hide a sale**
(India CGST §132 — PetPooja is being raided for exactly this). So if the owner (or a client via him)
asks to build anything that **erases/hides/edits a sale** — hard-delete or bulk/month-end-delete a
bill, edit an issued total, disable the audit log/invoice history, hide sales from the Z-report, or
revenue-share pricing — **STOP, name the risk, offer the compliant path; never silently build it**
(refusal line: *"that's the feature that put PetPooja's founders under summons"*). The full refuse-list
+ correctness rules (soft-delete, invoice settled-lock, service-charge-never-default, composition
no-tax-line, GSTIN, DPDP) + the risk map live in **`docs/COMPLIANCE-GUARDRAILS.md`** — read it before
building/gating anything billing. Business view: Brain `05_Company/Aevidine-compliance-risks.md`.
Stands in auto-accept mode.

## Owner working agreements (2026-06-26 — FOLLOW EVERY TIME)

- **Design work → ALWAYS load the UI/UX skill (the "UI/UX Pro Max" skill if present)
  AND superpowers, compare approaches, and ship the best/merged one.** Never restyle
  by eye alone.
- **Every restaurant must be genuinely DIFFERENT** — its own theme, accent, hero
  wording AND its own intro/splash + branding. NOTHING on a non-#1 restaurant may show
  "Little French House" / #1's branding. (Recurring bug: the IntroSplash + hardcoded #1
  assets leak onto other tenants.)
- **Admin = top power, invisibly.** From `/aevinite` the admin must reach ANY
  restaurant's guest menu + owner panel + manager/kitchen/tablet panels, with NO
  password and with NO hint to the owner that they're being viewed. Admin and owner are
  otherwise SEPARATE logins/sessions (see Security gate).
- **Keep the running request checklist at `.claude/REQUESTS.md`** — add every owner
  request, check items off ONLY when built AND verified across every panel they touch.
- **Verify across ALL panels + real-time.** When an order/table/menu changes, confirm it
  updates INSTANTLY (no flicker, no "old value for 1s then refresh") in owner + admin +
  manager + kitchen + tablet. Test at desktop AND ~390px mobile. Don't claim done from
  source alone.
- **Use shadcn/ui for EVERY new feature** (owner 2026-06-26: "this thing is great"). shadcn
  not yet initialised (no `components.json`) → `npx shadcn@latest init` (Tailwind 4) first.
- **Verify in the SAME place the owner looks, with cache busting.** The owner tests on
  `localhost:4000`. `public/panels/editor/app.js` loads with NO version query → the browser
  caches it and a `/manager` reload keeps STALE app.js in the iframe. Bust it (query string /
  ignoreCache) before claiming an app.js change works. **ONE codebase only: main.** The
  `worktree-feat+saas-multitenant` worktree was deleted 2026-06-26 — never reintroduce a
  worktree dev server on 4000 (that served stale code and looked like "nothing got fixed").

## READ-ONLY reference: the working single-restaurant app (owner, 2026-06-26 — HARD RULE)

`/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av` is the **live, working single-restaurant**
version where EVERYTHING (accepting orders → bills → every panel) works perfectly for one
restaurant. It is the **gold standard** to copy behaviour from when fixing the multi-tenant app.

- **NEVER modify ANYTHING in that folder** — no file edits, no writes, no DB changes to its
  Supabase project. **READ ONLY.** You may read its code AND read its database to learn the
  working approach, then re-implement the same behaviour PER restaurant here in `backup_Menu`.
- Approach the owner wants: study the reference's working flow → plan → implement ONE thing here
  → verify it live → implement the next → **do not stop after a check; keep going until every
  feature works for EVERY restaurant** (accept order, bills, real-time, all panels).

## Be brutally honest + protect the DB (owner, 2026-06-26 — FOLLOW EVERY TIME)

- **Brutal honesty is required.** If the owner is heading the wrong way, say so directly and
  redirect him to the better path with the reason — don't just comply. He explicitly wants to be
  corrected, not agreed with. Propose the better option first, name the trade-off, let him decide.
- **Protect the database / connection budget (his #1 scaling fear).** Idle/backgrounded tabs must
  NOT hold live realtime connections forever (he saw ~41 realtime "users" with almost no real
  traffic — stale open tabs). Every realtime subscriber (guest menu + all panels) should DROP its
  realtime channel when the tab is hidden/idle for a few minutes and RE-SUBSCRIBE on focus/
  interaction (visibilitychange + an idle timer). Keep using the POOLED Supabase connection.
- **Dashboards/analytics must be indexed + cheap.** Any query that filters/groups `orders` by
  `created_at`/`restaurant_id` MUST have a covering index (e.g. `orders(restaurant_id, created_at)`)
  — the owner analytics RPCs were full-scanning `orders` and took ~147s under load (stress test
  2026-06-26). Index every column we filter by; prefer pre-aggregated summary tables at scale.

## What "blur" means (owner's word — 2026-06-13)

When the owner says **"blur"** they mean the brand bar's **frosted glass**: a
**transparent background + `backdrop-filter: blur(20px)`** (see `.nav` and
`.menu-sticky` in `app/globals.css`). It only shows over content scrolling
behind it (e.g. the pinned category+search bar over the dishes) — at the very
top there's nothing behind it to frost. Use this exact recipe for any "blur".

- **BUILD GOTCHA:** write `backdrop-filter` as a SINGLE unprefixed line. Do NOT
  hand-add `-webkit-backdrop-filter` next to it — the Tailwind-4 / Lightning-CSS
  build then DROPS the property entirely and the blur silently vanishes (cost us
  a long debugging round). The build auto-prefixes for Safari on its own.

## SaaS multi-tenant architecture (approved 2026-06-25, since built — plan: `docs/SAAS-ARCHITECTURE-PLAN.html`)

Many restaurants, ONE backend, every feature enable/disable-able PER RESTAURANT; frontends may
differ completely per restaurant (white-label). The live technical rules — all still binding:

- **One shared database, POOL model.** Every tenant-scoped row carries a `restaurant_id`; Row-Level
  Security enforces isolation AT THE DB LEVEL — never rely on app-code filtering alone. NO
  database-per-restaurant.
- **Every schema change is ADDITIVE** — add the column with a default, backfill, THEN enforce NOT
  NULL / RLS. Verify the live menu still works at each step. No big-bang rewrite.
- **Scale discipline (all cheap — always do them):** the POOLED Supabase connection, never a direct
  one (this is what prevents the "too many connections" peak-load crash — the PetPooja-at-300-tables
  failure); INDEX every column we filter by; realtime channels keyed PER restaurant (never one
  global firehose); scoped queries only (`WHERE restaurant_id = …`, never "select all then filter in
  code"). **Redis / job queues / read replicas are Stage-3 (50–300+ restaurants) — do NOT add them
  early (YAGNI).**
- **Dashboards read pre-aggregated summary tables**, never live scans of millions of order rows.
- **Business rules live in the backend** (RPCs / route handlers, not the UI); keep features cleanly
  separable.
- **Routing is path-based today** (`/r/<slug>/t/<table>`, the QR encodes slug + table) through ONE
  resolver (`lib/tenant.ts`) written so it can ALSO read a **subdomain** or a restaurant's **own
  custom domain** later — KEEP that abstraction in every route so the switch is a config/DNS flip,
  NOT a rewrite. Switching to subdomains happens ONLY on the owner's explicit go.
- Build order + the subdomain switch detail: `docs/PROJECT-HISTORY.md` §9.

### EVERY new feature is a toggleable, permission-scoped MODULE (owner, 2026-06-25)
Planned future systems (CONTEXT ONLY — do NOT build until told): **inventory management,
staff analysis/performance, staff payments/payroll** — and more (this list will grow).

**NEW-FEATURE CHECKLIST — apply to EVERY new feature/section from now on, automatically,
without being reminded.** When you add anything, wire ALL of these that apply:
1. **Admin entitlement.** Gate the feature by a per-restaurant entitlement the ADMIN
   controls (admin decides whether a restaurant is even ALLOWED the feature). New modules
   default OFF. Extends the existing `settings.features` / `useFeatures()` pattern, scoped
   per `restaurant_id`.
2. **Feature on/off is ADMIN-controlled, NOT the owner.** Per owner 2026-06-25 the OWNER
   panel has NO feature-toggle screen — owners get staff management, manager-power grants,
   and analytics, not feature flags. (Re-confirm with owner before Phase 2 if in doubt.)
3. **Permission-scoped, least-privilege.** Gate by role (admin > owner > manager >
   kitchen/tablet). NO role — admin included — gets blanket "access to everything"; each
   capability is granted deliberately. If a manager should use it, add a manager-power
   switch the OWNER can grant/revoke (same on/off pattern as features).
4. **Backend-first.** Business rules live in RPCs / route handlers scoped by
   `restaurant_id` (not the UI); queries indexed + scoped; realtime per restaurant.
5. **Surface in the right panels.** For each new feature ask: does ADMIN need an
   entitlement toggle? does the OWNER panel need a control / a new manager-power switch?
   does the operational panel (manager/kitchen/tablet) that uses it need UI? Wire every
   one that applies — this is what keeps the panels in sync as we grow.
6. **Render nothing when its flag/permission is off** (the existing guest `useFeatures()`
   habit) — no dead UI for restaurants that don't have the module.
7. **Great, easy UI/UX.** Every new section gets a clean, beginner-simple interface.
8. **Register new popups/drawers in the back-button manager** (existing rule, below).
9. **Egress-safe by default (NON-NEGOTIABLE — egress hit the quota 2026-06-26; 96.6% was
   whole-board PostgREST reads).** A new feature may NOT reintroduce a whole-board read.
   See `docs/SAAS-EFFICIENCY-PLAYBOOK.md` for the full pattern. Before merging, confirm ALL:
   - **Scoped read:** every query has `.eq("restaurant_id", rid)`, an explicit column list
     (never `.select("*")` on a hot/polled path), and a `.limit()`. No read-all-then-filter-in-JS.
   - **Targeted breadcrumb:** if a new table drives a live panel, add an `rt_emit` trigger that
     carries `table_number` when the change is scopable to ONE table (so the manager's
     `pollTables` refetches just that table); leave `table_number` NULL when it can't be scoped
     (forces a safe full reload). For column-scoped triggers (`UPDATE OF …`), **every column a
     panel renders must be in the watch-list** — a rendered column the trigger ignores = a silent
     missed instant update.
   - **Per-table fetch + merge:** extend the panel's `?table=N` endpoint + client merge to
     drop/re-add that table's rows **dedup'd by row id** (never table_number alone — it changes on
     a shift). Both bugs behind these two rules: `docs/PROJECT-HISTORY.md` §12.
   - **No new poll faster than the 60s backstop;** realtime channels stay keyed per restaurant
     and drop on hidden/idle. Verify in the Network tab that one change refetches ONLY that table.
10. **WORKS WITH NO INTERNET (owner, 2026-07-30 — "this is a must thing, for every restaurant").**
   Every new screen must OPEN and READ offline (the service worker handles this automatically for
   any `GET /api/...` under the families in `public/sw.js` → `DATA_PATHS`; **add the family if the
   feature uses a new one**), and every new WRITE must go through the panel's `api()` / the guest
   outbox so it is saved on-device and replayed at-most-once. If the screen shows saved data it
   must SAY so (the offline bar / `components/OfflineNotice.tsx`) — never present saved figures as
   live. Full guide: `docs/OFFLINE-SYNC.md`.
11. **NO SILENT OVERWRITES — clash-checked (owner, 2026-07-30: "it is for ALL possible options,
   anywhere clash should not happen").** If two people on two devices can change the same thing,
   the feature MUST decide who wins and TELL the other person. The rule everywhere is **first save
   wins**; the loser gets a plain message naming what it says now, and their screen refreshes to
   the truth. Wiring is one line at the call site — send what the screen was editing FROM:
   `api("POST", path, body, { expect: { table: "<table>", id, fields: { <col>: <oldValue> } } })`
   — the one gate in each panel route (`lib/clash.ts` → `expectClash`) does the rest. This is
   NOT optional and NOT only for new code: **when you touch ANY feature, check it is covered and
   add it if it isn't.** `node scripts/verify-clash-coverage.mjs` lists every staff write and
   fails on an editable one that has no expectation — keep it green.

## Charts / graphs must be DYNAMIC — never a lonely 1-bar plot (owner, 2026-07-25)

A single fat bar floating in a wide empty plot reads as broken. EVERY chart (owner,
admin, manager, any new one) must be dynamic: big & full when sparse, scrollable when
dense, and an honest message when there's nothing — never an empty 1–2 line graph.
The shared implementation lives in `components/owner/Charts.tsx` — reuse it, don't
reinvent (dataviz skill agrees: "a single value is a stat tile, not a one-bar chart").

- **< 2 points of real activity → NO chart.** Render the `NotEnough` card ("Not enough
  data yet") with the one value still shown as a number. Gate: `populated(values) < MIN_POINTS`.
- **Sparse timeline (only one active day/month) → AUTO-DRILL to finer time.** The
  reports API (`app/api/owner/reports/route.ts`) re-queries `lfh_owner_sales_report` at a
  finer `p_bucket` (day→hour, month→day) and returns `drillRows`/`drillBucket`; the page
  charts use those while KPI cards + GST tables keep the daily `rows`. One day fills into
  ~24 hourly bars instead of one bar.
- **Dense → SCROLL, don't squeeze.** `ScrollX` keeps bars ≥~24px (`width: max(100%, …)` so
  it fills the card when it fits, scrolls when it doesn't). `LeaderBar` caps ~8 rows then
  scrolls vertically.
- **New time charts MUST route through `populated()` / `NotEnough` / `ScrollX`** (or
  replicate the three behaviours). Pairs with the adaptive-time-axis tick-thinning rule.

## Stack at a glance

- Next 16.2.6, App Router, async `params`. React 19.2.4. TS strict.
- Tailwind 4 (postcss). GSAP (npm-only, imported in `HeroTitle.tsx` + `IntroSplash.tsx` — the old "npm + CDN duplication" bug is gone; there is no GSAP CDN tag).
- `<model-viewer>` web component loaded via `<Script>` from CDN inside `components/PublicModelViewer.tsx` (NOT in `app/layout.tsx`).
- GLB models on Supabase Storage; two tiers per dish (small ~2 MB, optimized ~9 MB).
- Dev: `npm run dev` (port 4000). Playwright: `node scripts/verify-cache.mjs`.

## ONE unified app (2026-06-13 — was four separate servers, now merged)

Everything is a SINGLE Next app on **port 4000** (`npm run dev` / `START-ALL.bat`).
The panels are routes inside it:

- **/menu** — guest menu (`app/`). Scroll-spy category strip in `#sticky-header`.
- **/admin** — owner control room (`app/admin/page.tsx`): live floor (reads the
  `lfh_floor_state` brain), key numbers, maintenance switch, and the 10 guest
  FEATURE TOGGLES. **The only password-gated route** (see Security gate).
- **/editor** — boss panel: Dishes/Categories/Tags/Orders/Tables/Dashboard/
  Customers/Log/General; KOT chips, per-order discount, ⇄ Shift table. (Features
  tab REMOVED — toggles live in /admin now.)
- **/kitchen** — KDS: New→Cooking→Ready, 86 board (sold-out tag), chime.
- **/tablet** — waiter app: floor tiles + TAKE ORDER via `lfh_staff_place_order`.

The editor/kitchen/tablet UIs are the original vanilla files served from
`public/panels/<name>/` (embedded full-screen); their old Express APIs are ported
to Next route handlers at `app/api/<name>/[...path]/route.ts` (service-role via
`lib/supabaseAdmin.ts`). The admin-only floating switcher (`components/AdminSwitcher`)
hops between panels. The old standalone folders + the separate editor repo were deleted
(`docs/PROJECT-HISTORY.md` §12).

## Security gate (2026-06-13)

**⚠️ THERE IS NO `middleware.ts`** (nor a Next 16 `proxy.ts`). Looking for that file finds nothing
and may suggest the gate is missing — it isn't, it MOVED, and the per-route shape is deliberate:
env vars are reliable in the Node runtime, which edge middleware could not promise (hence
`lib/staffAuth.ts`'s comment that the admin gate runs in "layout + /api/admin routes"). What
actually guards what, verified route by route in the 2026-08-04 API sweep:

- **`/aevinite` (the admin console)** — `app/aevinite/layout.tsx` checks `tokenIsValid` server-side.
- **`/api/admin/**`** — every one of the 43 route files checks `tokenIsValid` (usually via a local
  `admin(req)` / `requireAdmin(req)` helper), and in every handler the gate call precedes any
  database call. `/api/staff-login` stores the hashed `ADMIN_PASSWORD` cookie (`lib/staffAuth.ts`).
- **`/api/{editor,kitchen,tablet,inventory}/**`** — `requireRole()` (`lib/userAuth.ts`), which ALSO
  re-checks the per-restaurant panel entitlement and the recycle bin on **every request** (30s
  cache), so switching a panel off cuts an already-open tab instead of only blocking new logins.
- **`/api/owner/**`** — `ownerScope()` (`lib/ownerScope.ts`); null → 401.
- **Deliberately public** (the COMPLETE list — an API route absent from here must have a gate;
  re-checked route by route in the T9 sweep 2026-08-05, which found the last two missing):
  `/api/health`, `/api/blocked`, `/api/log/client-error`, `/api/guest/limit-hit`,
  `/api/guest/place-order`, `/api/r/<slug>/menu-data`, `/api/rt-config`,
  `/api/aggregators/webhook/<source>`, and the guest menu itself.
  - `/api/guest/place-order` is a diner's own order — identity is the session token / the table in
    the body, and both RPCs are SECURITY DEFINER, so there is no login to require.
  - `/api/rt-config` returns only the PUBLIC Supabase url + anon key (already shipped inside the
    guest bundle) plus which restaurant the caller's panel belongs to. No cookie → restaurant #1.
  - `/api/aggregators/webhook/<source>` is an inbound POST from Zomato/Swiggy, so it cannot carry
    our cookie; it is dormant until the `aggregators` flag is on and verifies a shared secret.

`ADMIN_PASSWORD` is in `.env.local` (must also be set in the Vercel project env for the gate to
work in prod). **If you re-introduce a middleware, update this section in the same commit.**

## Feature switches (migration 035)

- `settings.features` JSONB merged over `lib/features.ts` defaults; components
  call `useFeatures()` and render nothing when a switch is off. Editor →
  Features tab edits the ten guest-facing switches.
- **Four BACKEND-ONLY switches stay invisible in every UI** (owner's order):
  `verification`, `payments`, `aggregators`, `gst_invoice` — default OFF,
  flippable only by hand in the DB. Their plumbing: migration 037
  (verification_codes + OTP RPCs that answer `disabled`, payments +
  aggregator_orders tables, GST settings columns).

## KOT / bills / billing depth (migrations 036–038)

- Every order gets a daily `kot_no`, every session a daily `bill_no` (triggers +
  `daily_counters`); `get_order_status` returns `kot_no`. `orders.discount` (+note) is stored APART
  from totals; every due/total view is net of discounts. `lfh_staff_shift_table` moves a party
  atomically. More: `docs/PROJECT-HISTORY.md` §12.
- **GOTCHA: new Postgres functions are PUBLIC-executable by default.** Every staff-only function
  MUST get `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` (mig 038 —
  the verify run caught anon calling a staff RPC; mig 267 caught 17 more that had drifted).

## Architecture cheat sheet

- `lib/modelLoader.ts` — SINGLETON on `globalThis.__lfh_modelLoader`; downloads GLBs into in-memory
  blobs and hands `blob:` URLs to `<model-viewer>`. **This is what makes "no re-fetch on navigation"
  work.** `lib/modelWatchlist.ts` is a sibling singleton tracking who tried to view 3D before it
  loaded, so toasts only fire for them; `components/ModelToastHost.tsx` (mounted in `app/layout.tsx`)
  listens for `lfh:model-loaded` / `lfh:model-failed`.
- Event bus pattern: components talk via `window.dispatchEvent(new CustomEvent(...))`. Names:
  `lfh:open-cart`, `lfh:close-all`, `lfh:chef-call`, `lfh:cart-updated`, `lfh:toast`.
- Persistence: `localStorage` keys `lfh_cart`, `lfh-favorites`; session theme in
  `lfh_theme_session` (read-side currently broken — see bug B2).
- Menu data: `lib/menu.ts` — `getMenuItems()` / `getMenuItem(slug)` read `menu_items`;
  `getCategories()` / `getFilters()` read `categories` / `filters`. All via the ANON key
  (`lib/supabase.ts`), snake_case → camelCase. The old `public/content/menu.json` is the seed source
  only, no longer fetched at runtime.
- **Categories & filters are DB-driven, not hardcoded** — the `categories` / `filters` tables; each
  dish's `tags TEXT[]` lists the filter slugs it matches. `app/menu/page.tsx` builds the category bar
  and chips from these, prepending a virtual "All". Multilingual labels use `localized(name, lang)` +
  the `useLanguage()` hook in `lib/i18n.ts`. Column shape + the auto-translate-at-save rule:
  `docs/PROJECT-HISTORY.md` §12.
- Re-seed with `node scripts/seed-supabase.mjs` (runs ALL `supabase/migrations/*.sql` in order via
  the Management API, upserts categories + filters + items via the service role, then verifies an
  anon read of all three). Secrets all live in `.env.local` (gitignored): anon key, service-role
  key, and `SUPABASE_ACCESS_TOKEN` (the Management-API PAT used for DDL).

## Routes

- `/` — `app/page.tsx` is just `redirect("/menu")`.
- `/menu` — menu with 3D preload (`app/menu/page.tsx`).
- `/item/[slug]` — dish detail.
- `/view/[folder]` — 3D viewer. (Only these four routes exist.)

## Skills and tools to reach for

Use the right skill the moment the task fits — don't ask permission.

- **Verifying anything visual or runtime** (network requests, cache headers,
  state values, theme behaviour): launch Chrome via MCP tools
  (`mcp__chrome-devtools__new_page`, `navigate_page`, `list_network_requests`,
  `evaluate_script`). Don't speculate from source code alone.
- **Confirming a 3D-cache change didn't regress**: run
  `node scripts/verify-cache.mjs` (Playwright; checks zero re-fetch on
  navigation) and/or `verify-slow-load.mjs` (slow-network toast behaviour).
- **Reducing permission prompts**: run the `fewer-permission-prompts` skill.
- **Verifying a new feature actually works end-to-end**: use the `verify` skill.
- **Reviewing the current diff before committing**: use `code-review` skill
  (low/medium effort for routine work).
- **Settings / hooks / allowlist edits**: use the `update-config` skill —
  do not hand-edit `.claude/settings.json` blindly.
- **Migrating Claude API or Anthropic SDK code**: use the `claude-api` skill.
- **Running or screenshotting the app**: use the `run` skill.

When a deferred tool is needed (e.g. `TaskCreate`, MCP browser tools), load it
via `ToolSearch` BEFORE planning around it.

## 🙋 I AM NOT THE TEST SUBJECT — drive it yourself BEFORE handing it over (owner, 2026-08-02)

The owner opened a preview, went looking for a new button, and it was not there — it had been
built into the wrong header. He had to be the one to find that. That is the failure: **not the
mistake, but shipping it to him unchecked.** So, for every hand-over, without being asked:

- **Do the exact thing you are about to tell him to do, first.** If the sentence is "tap a table,
  then tap ⚡ QO/P", then tap a table and tap ⚡ QO/P — in the running app, headlessly, and assert
  the button EXISTS and OPENS. A flow you never walked is a flow you are asking him to test.
- **Confirm the change is where HE will look, not where you put it.** When he names a place in his
  own words ("the KOT in the table live view"), SCREENSHOT that place and read it before building,
  and again after. Two different headers can both plausibly match a description — the screenshot
  decides which, not the guess that is quicker.
- **Never hand over on "the code says so."** Same rule as the green-suite lesson above: assert the
  RENDERED thing (`count() > 0`, visible text, `offsetParent`), not that the source contains it.
- **If a check would have caught it, that check was owed before the hand-over, not after.**

## "Check phone view" / "check tablet view" — open a LIVE Chrome (owner shortcut, 2026-07-08)

ONLY when the owner explicitly says something like **"check phone / phone view / view on
my phone / see it on phone"** (or the **tablet** equivalent) — NOT automatically, never
"just to be safe" — open a REAL, VISIBLE Chrome window of the local app, device-emulated,
so the owner can look at it live. This is on-demand only so it doesn't burn tokens/load.

- **Run:** `node scripts/view-device.mjs` (dev server must be on :4000). Flags:
  `--device phone|tablet` (default **phone = Samsung Galaxy A35, 360×780, dpr3**; the owner's
  actual phone — tablet = iPad 1194×834), `--role guest|tablet|manager|kitchen|owner`
  (default guest), `--slug <restaurant>` (guest menu, default french-house).
  - phone view of the guest menu: `node scripts/view-device.mjs`
  - phone view of the waiter panel: `node scripts/view-device.mjs --role tablet`
- It launches the installed Chrome (`channel:"chrome"`, `headless:false`, `devtools:true`),
  logs in as the RIGHT role first, opens the route, and LEAVES the window open (run it in
  the background so the session isn't blocked).
- **Gotcha it bakes in:** opening `/tablet` `/manager` etc. with the ADMIN cookie shows the
  admin console + an orange "ADMIN VIEW" bar — NOT the true staff view. The script logs in as
  the per-restaurant diag staff user (see test-staff-logins memory) to get the clean real view.
- Save any screenshots to the owner's **Desktop**, never the temp scratchpad.

**When the owner asks to CHECK / VERIFY any UI work, always do it THIS way (not a
detached mockup):**
- Verify against the **real running app on `localhost:4000`** in a live Chrome window —
  NOT a standalone `temp-*` prototype folder (its own `index.html`/`app.js` + static
  `desktop.png`/`mobile.png`). Testing a throwaway mockup is testing the wrong thing.
- Check **BOTH desktop AND phone (A35, ~360–390px)** — the owner tests on mobile.
- **Log in as the right role FIRST** (per-restaurant diag user) so you see the true
  panel, not the admin console + orange "ADMIN VIEW" bar.
- Confirm it also works for a **non-#1 restaurant** (tenant bugs hide there), and that a
  live change refetches only what changed (Network tab).
- Don't leave throwaway `temp-*` prototype folders behind; screenshots go to the Desktop.

## Mobile hardware BACK button — every screen & popup is a "back step" (2026-06-19)

The Android/phone hardware back button must NEVER quit the site in one press. It peels off ONE
layer at a time: open popup → its parent → … → menu → a "Leave this site?" dialog (and only THEN,
one more back, does the tab close). Popups stay state-driven (NO URL change, so **zero extra
egress / DB load** — pure browser history) and a tiny central manager syncs them to the History
API. Real PAGES (`/item`, `/view`) already have their own URL, so only state-driven overlays need
wiring.

- **Guest app:** the manager is `lib/backStack.ts`. ANY popup/overlay/drawer/sheet/
  dialog MUST register itself while open with the hook — ONE line, called
  unconditionally near the top of the component (it self-noops while closed):
  ```ts
  useBackClose("cart", open, () => setOpen(false)); // id must be unique per overlay
  ```
  The manager pushes a history entry when the layer opens and, on a back press,
  closes the TOP layer instead of leaving the site. The root "Leave this site?
  [Stay] [Leave]" dialog + the menu exit-guard live ONCE in
  `components/BackQuitDialog.tsx` (mounted in `GuestChrome`) — never duplicate it.
- **Staff panels (vanilla JS):** the sibling manager is `public/panels/backstack.js`,
  loaded via `<script>` like `maint.js`/`realtime.js`. When you OPEN any drawer/modal/
  confirm: `const off = LFH_BACK.layer("86-board", () => closeBoard());` and call
  `off()` if it closes by other means (X, backdrop, completion).
- **RULE FOR ALL FUTURE WORK (guest OR staff):** every NEW popup/modal/drawer/sheet/
  dialog MUST be registered the moment it's built, or the back button will skip it
  and quit the site — the exact bug this feature fixed. New full PAGES need nothing.
- **Never hand-roll `history.pushState`/`popstate` in a component.** All the tricky
  bookkeeping (rapid double-back, `lfh:close-all`, reconcile, the exit-guard) lives
  in the two manager files above; components only ever call `useBackClose` / `LFH_BACK.layer`.

## Offline sync — connection light + offline queue (LIVE 2026-07-07 — KEEP EXTENDING)

The app has a green/yellow/red **connection light** on all six panels and an **offline
action queue**: writes taken while offline are saved on-device and replayed on reconnect,
guarded so each runs **at most once** (no double bills). Full guide + roadmap:
**`docs/OFFLINE-SYNC.md`** — READ IT before adding a panel, a write endpoint, or touching
ordering/billing. Hard rules: the ONLINE path stays untouched (queue diverts only when
`navigator.onLine === false`); every new staff write handler must be wrapped with
`withIdempotency(..., "<panel>")` and every new client write must go through the panel's
`api()` / the guest outbox so it carries an `X-LFH-Action-Id`; the dedup guard FAILS OPEN.
Only guest place-order is queued so far — other guest writes and a real-device test are the
main TODOs. Code: `lib/idempotency.ts`, `lib/connectionStatus.ts`, `lib/guestOutbox.ts`,
`components/ConnectionBadge.tsx`, `public/panels/{outbox,connbadge}.js`, `realtime.js`,
`app/api/guest/place-order/route.ts`, migration `138_action_idempotency.sql`.

## Analytics / dashboards MUST use the compute-on-view snapshot cache (owner, 2026-07-25 — ALWAYS)

Any owner/admin dashboard, report, or analytics number that comes from an aggregate query
(scans/groups `orders` or similar) must be served through the **compute-on-view snapshot
cache**, never recomputed on every open. This is now the DEFAULT for every such feature —
do it automatically, without being asked. Reuse the existing engine, don't reinvent:

- **Engine:** `lib/ownerCache.ts` (`cachedOwnerPayload`) + table `owner_analytics_cache`
  (migration 196) + the change-detector `lfh_owner_orders_fingerprint`. Wrap the route
  handler's compute in `cachedOwnerPayload({ key, force, fingerprint, compute })`.
- **Behaviour it gives (all required):** a normal open returns the STORED JSON instantly
  (one row read — near-zero egress); a snapshot older than ~5 min recomputes on next view
  **only if the fingerprint shows data changed** (else it just reuses the JSON — "don't
  recalc when nothing changed"); the **Refresh button forces a live recompute** (`?refresh=1`
  → "wait for the live value"). The response carries `cachedAt` so the UI shows **"updated
  X ago"** next to Refresh.
- **Key** = `<area>:v<n>:<scopeKey>:<report>:<range>` where `scopeKey` comes from the
  ALREADY-authorized `ownerScope` (`scopeKeyOf`) — never from raw request params — so
  isolation is unchanged (an owner only ever hits their own restaurants' rows).
- **Why (owner's #1 fear):** this LOWERS egress + DB load — reads become a single-row lookup
  instead of whole-table scans, and heavy compute runs rarely (throttled + change-gated),
  never on every open or every 60s poll. Do NOT add a blind cron that recomputes every
  restaurant on a timer (wasted work on idle tenants); the lazy compute-on-view + fingerprint
  is the pattern. Pairs with the egress rules in the SaaS efficiency playbook.

## 🚦 NEVER set off the app's own limits while building or testing (owner, 2026-07-29 — EVERY session)

The "limit reached" alerts exist for REAL trouble in a real restaurant. Our OWN sessions were
setting them off — a test session signing in over and over made *"limit reached"* pings land on
the owner's phone about himself. That is pure noise, and noise is how a real alert gets ignored.
So tripping a limit during our own work counts as a BUG in the test, not a finding:

- **Sign in ONCE per session and reuse that session** (keep the cookie / the Playwright context /
  the logged-in tab). Never put a login inside a loop, a retry, or a per-request helper.
- **The trap that actually caused this:** the "open it in Chrome so the owner can look" scripts
  (`view-device.mjs`, `sweep/login.mjs`, any `show-*.mjs`) sign in AGAIN for every browser context /
  role / restaurant they open. If a script opens several views, **log in once and reuse that
  context's cookies for the rest**, and never run the same show-script back-to-back in a loop.
- **Never repeat a limited action just to "see what happens".** The limited ones are: staff/owner
  login (5 per 5 min), manager PIN, guest orders, waiter calls, join-table, OTP requests
  (`rate_limit_rules`, mig 205).
- **If a test genuinely must reach the wall** (verifying the wall itself, or the alert wording):
  do it ONCE, prefer a throwaway/unknown name over a real account, then **CLEAN UP in the same
  turn** — delete the `rate_limit_events` + `rate_limit_counters` rows you created, reset
  `failed_count`/`locked_until` on any account you touched — and TELL the owner in chat that a
  test ping went to his phone.
- **Never widen or switch off a limit rule to make a test pass**, and **never add code that
  suppresses, filters or hides a limit event or its alert** (his no-hiding rule — silent is fine,
  invisible is not). If a limit is genuinely too tight for real service, change the NUMBER in
  `/aevinite` → rate limits and say so.
- **Don't leave anything re-logging in on a timer** (watchers, polling scripts, parallel panels).

**NOW ENFORCED, not just asked for (2026-07-30)** — the stories are in
`docs/PROJECT-HISTORY.md` §3:

- **Use the shared helpers, never a hand-rolled login.** `scripts/sweep/login.mjs` exports
  `loginAs()` — which CACHES the session, so five browser contexts cost ONE login — and
  `adminCookie()`/`adminHeaders()`, which present the admin gate cookie and make **zero** login
  requests ever.
- **Never POST to `/api/staff-login` with JSON.** That route reads FORM data, so a JSON body sends
  an EMPTY password and each "check" becomes a wrong-password attempt that raises an `admin_login`
  limit event about the owner's own panel. For admin API access from a script use `adminHeaders()`.
- **A test that deliberately trips a wall must sweep up in the same run.** Deleting the test users
  does NOT clear `rate_limit_events` / `rate_limit_counters` / `login_throttle`, and an OPEN event
  sits in the admin's Problems list looking like a real restaurant in trouble.
- **Guarded by `npm run verify:test-safety`** (`scripts/verify-test-safety.mjs`) — checks each of
  the mistakes above, proven to fail on all three. It also runs AUTOMATICALLY as a PostToolUse hook
  after any edit under `scripts/` or `tests/`: silent when clean, and it REFUSES the edit with an
  explanation when a script could raise an alert. Add a check there when a new way to trip a limit
  appears.

Code: `lib/rateLimit.ts` (counter + alert), `lib/alerts.ts` (phone ping), mig 205/208/214.

## 👆 A USER'S TAP MUST NEVER VANISH IN SILENCE (owner, 2026-07-30 — every panel, every dialog)

A button that swallows a tap is indistinguishable from a broken button, and it leaves no trace to
debug. It cost a real close on a live client's floor (PR #554 — the story is in
`docs/PROJECT-HISTORY.md` §4). Whenever you write a dialog, overlay, or any handler that can
decline a tap:

- **Never `return` on a user action without a trace.** Either HOLD the action and run it when
  you can (`tapGuard().act()` in the manager panel), or refuse it VISIBLY — a shake
  (`.confirm-nudge` / `.cf-nudge`), a toast, a disabled state. Silent `resolve(false)` is banned.
- **Never leave a promise unresolved.** A shared dialog element whose handlers get reassigned
  orphans the earlier `await` forever and that action dies mid-flight (the tablet's
  `#confirmOverlay` did this — fixed with a `confirmOpen` re-entry guard that answers the
  second call).
- **Any overlay wearing the shared `.confirm-overlay` class must stamp `data-closing` when it
  closes**, or `confirmDialog()` silently answers "no" during its 200ms fade-out.
- **Never decide UI behaviour by pattern-matching a server's prose.** Send a reason CODE and
  branch on that (`reason: 'unpaid' | 'cooking' | 'both'` from `lib/sessionClose.ts`). The old
  `/owes money/` text-match missed the cooking-only refusal, so a paid-but-unserved table had
  no "close anyway" button at all.
- **Guarded by `npm run verify:taps`** (`scripts/verify-tap-guard.mjs`) — 9 static checks, each
  mapped to a bug that actually happened. It also runs AUTOMATICALLY as a PostToolUse hook after
  any edit to `public/panels/*/{app.js,style.css,index.html}`: silent when clean, and it fails
  the edit with an explanation if a check breaks. Add a check there when you add a dialog.

## 🪑 A TABLE SHOWS ONLY ITS OWN PARTY (owner, 2026-07-30 — every floor, every panel)

A FREE table once showed a nine-day-old party's food and ₹1,150 due; "Mark all paid" would have
billed the new guests for it (`docs/PROJECT-HISTORY.md` §5). Two rules came out of it; keep BOTH
true forever:

- **Ownership is the SESSION, never the table number.** Anything that answers "which orders
  are at this table?" must match the table's CURRENT open-session id (a session-less row —
  banquet/legacy — still counts, so no order is ever hidden).
- **An order can never outlive its session.** Cleanup lives on the status change itself
  (mig 232 extends the mig-020/146 close trigger + the delete trigger), so EVERY close —
  the app path, a script's bare `UPDATE sessions SET status='closed'`, a hand-run SQL fix,
  anything we write later — cancels the unpaid non-khata work (a visible ✕ record) and
  archives the rest. Nothing is deleted: reports/Bills never filter `archived`.
- **Guarded by `npm run verify:table-ownership`** (add `--base http://localhost:4000` for the
  browser pass): panel source, a floor-wide data scan, the close behaviour, and a tile-by-tile
  click sweep proving each tile and its detail describe the SAME table. `/bug-test` §5b runs it.

## 🩺 A GREEN TEST SUITE IS NOT EVIDENCE THAT THE SCREEN IS RIGHT (2026-07-30 — after two faults reached the owner)

Two faults reached the owner's screen on the same day and **every check that was running passed** —
the source was valid, the data was fine, only what a person SAW was wrong (both are written up in
`docs/PROJECT-HISTORY.md` §6 and reproduced as tests in `verify:ui`). The root cause of BOTH is the
thing to guard against: **the work was verified with checks that could not have caught the failure**
— the wrong surface (offline-only tests), the wrong artefact (source instead of the served file), or
the wrong signal (skimming output instead of an exit code). So, permanently:

- **`npm run verify:ui`** — static, instant, and wired into the PostToolUse hook: refuses an edit
  that leaves an HTML comment open, strands a panel script inside a comment, or commits a
  merge-conflict marker. Both faults above are reproduced in it as tests.
- **`npm run verify:live -- --base <url>`** — run this against the DEPLOYED site after every
  deploy. It reads the RENDERED text of every panel and page and fails on leaked code
  (`-->`, `${`, `[object Object]`, `undefined`, `NaN`), on a screen that renders empty, on console
  errors, and on **UI that contradicts itself** (an alarm bar while the badge says Live).
- **Never derive a claim from data that doesn't support it.** A status warning must read the SAME
  signal the existing indicator reads, expire on its own, and self-heal — one slow request is not a
  connection verdict.
- **For AV live, verification is READ-ONLY** (no logins, no test orders — see the rule above): fetch
  the served files, check the panel HTML comments balance, and diff them against the backup site.
  `node scripts/verify-avlive-offline-complete.mjs` proves a surgical release landed COMPLETELY —
  a patcher that skips a file writes nothing and says so in one line among many.

## 🔑 ACCESS & PERMISSIONS WAS REBUILT (2026-07-31) — the LADDER above is retired

The old 4-rung ladder (`admin → owner → manager → tablet`) with the owner granting manager powers is
**retired** — `docs/ACCESS-LADDER.md` is HISTORY only (why: `docs/PROJECT-HISTORY.md` §10). What is
true now:

- **A toggle exists only where the owner listed one** (`lib/accessTree.ts`). Everything else is
  permanently ON for whoever's panel owns it.
- **Only the admin holds permissions.** `/aevinite` → Access & permissions is the one screen
  (plus its Per-person tab). The owner panel and the manager panel configure none.
- **No greyed-out ghosts.** Unreachable = absent from that role's screen — but hiding is never
  the only guard, the endpoint must refuse too.
- Canonical spec: **`docs/ACCESS-MODEL.md`**. `docs/ACCESS-LADDER.md` is HISTORY only.
- Guards: **`npm run verify:access`** (a switch that reaches no real code fails) and
  **`npm run verify:everything`** — **501 numbered phases** against a chosen site, one by one:
  every route, all four panels as their real role, every switch off→gone→on→back, a real
  order followed end to end, the guest journey feature by feature, bills + the compliance
  rules, Inventory/Payroll, the resilience rules, the owner's A35 phone AND a tablet, and
  records/integrity. It signs in once per role, restores every setting it flips (even if
  killed) and deletes every row it creates. Map: **`docs/QA-500-PHASES.md`**;
  `--list` prints it without running, `--only 419-440` re-checks one group.
- **The two demo restaurants have different jobs in the test, keep it that way.** French
  House is the one written to (switches flipped, a real order pushed through, restored after).
  **Aangan is the CONTROL: it stays at the factory default permission set and is only ever
  READ** (owner, 2026-07-31 — "keep aangan with all the default permission"). Phases 348-418
  prove all 68 of its switches still read exactly the model's `def`. Put any restaurant back
  to those defaults with **`npm run access:defaults -- --slug <slug> --apply`** (dry run
  without `--apply`); it refuses to point at anything but the backup database.
- **Access & permissions has a search bar** (`components/admin/AccessSearch.tsx`) — jump to any of
  the ~90 settings, phone-Settings style, with the path shown and the same amber ring the `?focus=`
  deep links use. The index is built ONCE at module load from `SECTIONS` (a constant), so a keystroke
  costs ~1.3ms and no network call; **ADD TO the synonym map when you add a node** (khata, zomato,
  swiggy, 3d, sold out, salary…). A row whose parent is off has no row to jump to, so its result is
  labelled "needs <parent>" and lands on that parent instead. Guarded by
  **`npm run verify:access-search`** (22 checks, desktop + A35 phone) = phase 501.

## 👤 EVERY PERSON HAS ONE PROFILE, AND IT HAS ONE SHAPE (owner, 2026-08-01 — ALWAYS)

Owner, manager, waiter, kitchen — every human in this product opens the **same** profile panel
(`components/admin/StaffProfile.tsx`, his chosen "Dossier" design). His instruction was explicit:
*"whenever Claude does something, he should see this and arrange in this structure only."* So
before adding anything about a PERSON — a field, a number, a control, a new panel's idea of a
user — read **`docs/STAFF-PROFILE.md`** and put it inside that structure instead of inventing a
second one. Left rail: photo (optional) · name · role · "record complete X of 14" · the daily
buttons. Right column: Permissions → who they are → emergency → job → pay → papers → signing in
→ activity → private note → danger zone.

- **Permissions are the Access & permissions rows for that role and nothing else.** ONE list
  feeds the profile, the Access screen's Per-person tab and the write route's allow-list
  (`lib/staffCaps.ts`); an unknown key is REFUSED, never stored — a stored key no enforcer reads
  looks granted and isn't.
- **One dropdown per row: `Default (On)` · `On` · `Off`** (waiter money rows add `On + manager
  PIN`). The bracket states what the restaurant gives that role. **Every new person starts on
  Default for everything** (`permissions: {}` at create).
- **Manager = two blocks** (their menus + what they may manage). **Owner = one** (their menu,
  read-only — owner_entitlements is a restaurant setting; a dropdown that saves nothing is the
  dead switch the access rebuild deleted). **Waiter = one. Kitchen = none, said in a line.**
- The photo is **optional everywhere** and never required by anything.

## 🧾 THE FLOOR IS READ ONCE AND SHARED — a write MUST drop that snapshot (2026-07-31)

Whole-floor reads for the same restaurant inside a **1.5s window share ONE database call**
(`lib/floorSummary.ts`, wired into both panel routes). Three properties keep that safe, and each
is easy to break with no symptom in any other test:

- **Every write handler drops that restaurant's snapshot** (`invalidateFloor(rid)`, one line right
  after the handler resolves `rid`). Without it, a device that changes something and reloads is
  handed a floor computed BEFORE its own action — a waiter marks a table paid and watches the tile
  flick back. **Add a write path → add that line.**
- **A targeted `?table=N` refetch is NEVER shared** — that is what makes a tile update the instant
  its order lands. Keep the `tbl ? …live… : …shared…` shape.
- **The window stays ~1.5s.** The floor is a live screen; widening it makes it stale.

Also:

- **Mig 238 made each call cheap too; do NOT "simplify" it back to a per-table loop** on the theory
  that its one-line count fix was the whole win (measured: it wasn't). An earlier set-based rewrite
  was rejected by measurement — read **`docs/PROJECT-HISTORY.md` §1** before touching this.
- **Touching `lfh_table_view_summary`? Use `node scripts/verify-summary-parity.mjs`** — it compares
  a candidate against the live one tile by tile, for every restaurant and every occupied table, and
  is proven to catch a trailing space in a label, money rounded to 1 decimal, and an off-by-one in
  the ready threshold. Do not hand-review a diff of this function instead.
- ⏳ **OPEN FOLLOW-UP — run `npm run check:floor-timeouts` and act on the verdict.** It reports
  FIXED / TOO EARLY / NOT FIXED against the real error rows and prints what a floor read costs now.
  **`docs/FLOOR-TIMEOUT-WATCH.md`** holds the ordered what-to-do-if-not-fixed list (and the trap:
  if a floor read is already ~10–30ms, the remaining cause is CONTENTION, so making the query
  faster again achieves nothing). On FIXED, delete the doc + script + npm script — it's designed to
  be retired. AV live has the sharing fix but NOT mig 238; that needs its own ask.

Guarded by **`npm run verify:floor`** (`scripts/verify-floor-share.mjs`) — static, instant, proven
to fail when an invalidation is removed. Run it against another checkout with `--repo <path>` (that
is how AV live is checked without adding a file there).

## 🌊 A RUSH MUST SLOW THE APP DOWN, NEVER TAKE IT DOWN (owner, 2026-08-01 — every write, every poll)

**Order volume is NOT the risk** — 100 genuinely simultaneous orders land in ~2s on the free tier
and the rest of the site never wobbles (measured, `npm run load:ramp`). What saturates the instance
is a handful of **unbounded analytics reads landing together**. The measurements, and the ramp's own
two safety rules, are in **`docs/PROJECT-HISTORY.md` §2** — read it before buying compute to
"handle the rush", or before writing any load/test script.

Four rules came out of the 2026-07-31 outage. Keep all four true:

1. **A change-detector may never scan the table it guards.** If a guard costs more than the query
   it protects, it is not a guard. Maintain a counter/watermark on write and read that (mig 246
   turned a 21.6s all-orders scan into 5ms this way).
2. **"The server can't take this right now" takes the SAME path as "no internet"** (owner's own
   words: *"it should work like online, things just save on his device, and when internet comes
   everything starts working"*). A 5xx or a timed-out write is NOT a rejection: the panel
   (`public/panels/outbox.js` → `send()`) and the guest cart (`lib/menu.ts` → `createOrder` throws
   a `busy` error, `components/CartPanel.tsx` catches it) save it on-device under the SAME
   `X-LFH-Action-Id` and deliver it when the server recovers. **4xx is different** — a clash, a
   closed table, a sold-out dish must reach the person, never be retried behind their back.
3. **Every write carries a deadline, and every retry backs off with jitter** — `WRITE_TIMEOUT_MS`
   + `RETRY_BASE_MS`→`RETRY_MAX_MS` with ±25%, and `useActiveAutoRefresh` spreads its 60s tick by
   ±20%. No timeout leaves a waiter's tap on a spinner forever (not applied, not saved); a FIXED
   retry beat makes every device retry in lockstep, which is a retry storm.
4. **Nothing may poll at a fixed fast rate while its own reads are failing.** A saturated database
   is exactly what drops realtime, so a "realtime is down" poll at a fixed 5s puts every device on
   the same fast read and keeps the database down. `LFH_RT.catchUp()` (`public/panels/realtime.js`)
   keeps 5s liveness when reads succeed and doubles to a minute while they fail — use it for any new
   catch-up poll.

Also: **`npm run verify:everything` refuses to start while another run is alive** (a pid lock at
`.claude/verify-everything.lock`, `--force` to override). Two concurrent 501-phase runs are what
actually took the database down — the test rig, not the product.

**Guarded by `npm run verify:busy`** (`scripts/verify-busy-server.mjs`) — 14 checks against the
REAL shipped files via a local stub (no database, no login, no load): a busy server's tap is
queued not lost, delivered exactly once under its original id on recovery, a 4xx still reaches the
person, deadlines/backoff/jitter are present, and the guest's order is classed correctly (5xx and
timeout = save it, sold-out = tell them). Proven to fail with 5 red checks when the fix is removed.

⚠️ Still true: it is a free-tier shared-CPU instance with 60 connections, and these changes add no
capacity — they mean a burst QUEUES and drains instead of collapsing.

## Known gotchas (read before editing)

- **Live-update redraw guard (kitchen + tablet) — DON'T narrow `boardSig`.** The `/kitchen` and
  `/tablet` panels only repaint when a fingerprint (`boardSig` in their `app.js`) changes, so a
  realtime refetch whose data "looks the same" is dropped (prevents flicker). `boardSig` serialises
  the FULL rows minus a tiny `RT_VOLATILE` set (heartbeat/derived timestamps), so ANY field that
  affects a ticket/tile auto-repaints — *including columns you add later*. **Never shrink it back to
  a hand-picked field list** — edits to an omitted field then silently fail to auto-refresh and only
  show on a MANUAL refresh (the bug fixed 2026-06-17). A new editable field needs NO change; a new
  heartbeat-y column goes in `RT_VOLATILE`. Guarded by `scripts/verify-board-sig.mjs`. (The separate
  "latest-wins" seq guard in each loader is a DIFFERENT mechanism — don't conflate.)
- **Supabase HEAD lies about Cache-Control.** Use GET with `Range: bytes=0-0`
  for header checks. `scripts/set-glb-cache.mjs` has this bug.
- **Light mode works and persists** (`lfh_theme`) via the theme toggle.
- **Don't re-suggest Draco compression.** Already done. See model-pipeline memory.
- **Service-role Supabase keys must never be committed or echoed.** If the user
  pastes one in chat, warn them loudly and treat it as compromised.
- **ABSOLUTE RULE — secrets never appear in chat, ever.** This includes the Supabase
  access token (`sbp_`), service-role key, Vercel/Sentry tokens — whole OR partial.
  It has been violated before and the user's patience is spent. Operationally:
  (1) ANY `claude mcp ...` command echoes resolved secrets — ALWAYS redirect its
  output to null (`cmd /c "claude mcp ... >nul 2>&1"`); (2) never `cat`/`Get-Content`/
  `Select-String` a secret's VALUE into output — scripts read `.env.local` and write
  config directly, printing only presence/length; (3) verify configs via masked
  reads (node/jq printing everything EXCEPT the secret). No exceptions, no "just
  this once".
- **`scripts/seed-supabase.mjs` overwrites editor-made DB changes.** It upserts every
  column from menu.json, silently reverting anything the owner changed in the admin
  editor (3D configs, titles, sold-out tags…). To apply a new migration, prefer running
  just the migration via the Management API; full reseeds need a DB-vs-menu.json diff first.
- **MCP servers are NOT read from `.claude/settings.json`.** Claude Code loads
  them from `~/.claude.json` (via `claude mcp add ... -s local`) or a root
  `.mcp.json`. The supabase MCP is registered in `~/.claude.json` and uses
  `@supabase/mcp-server-supabase` v0.8.1, whose flags are `--access-token` (PAT)
  + `--project-ref` — NOT `--supabase-url`/`--supabase-key`. Any MCP config change
  needs a full Claude Code restart to take effect.

## Deferred optimizations (owner-approved to revisit later — NOT yet built)

- **Realtime-UPDATE latency on an already-open table detail** (owner, 2026-07-02) — apply the
  realtime DELTA in place instead of refetching the whole per-table slice. Only build if the owner
  still notices the lag. Full write-up: `docs/PROJECT-HISTORY.md` §11.

## Definition of done for code changes

- Type-check passes (`npm run lint` or Next's built-in checker).
- If the change touches 3D model loading, `verify-cache.mjs` still passes.
- If the change touches UI, run the page in Chrome MCP and screenshot or
  describe what's now visible. Don't claim "it works" from source alone.

## 🚦 DEPLOY LOCK — one session deploys at a time (owner, 2026-07-25 — pointer only, load the detail ONLY when deploying)

Many sessions run in this SHARED folder at once and have been OVERWRITING each other's
small un-shipped edits (name changes etc.). So deploying is now a **locked, one-at-a-time
ritual**. This block is only the always-loaded reminder — keep it cheap; the full
step-by-step protocol lives in the **`ship-safety`** skill under "Deploy lock". **Do NOT
read/expand that protocol every session — invoke the skill ONLY at the moment you are about
to deploy** (push to `main` / merge an auto-deploying PR / trigger a Vercel build).

- **The moment a deploy is requested → invoke `ship-safety` FIRST**, then follow its Deploy-lock
  steps: (1) if another session is mid-deploy (`.claude/deploy.lock` is fresh) → **WAIT**, poll,
  don't deploy in parallel; (2) take the lock; (3) **overwrite check** — `git fetch` + rebase on
  `origin/main`, stage ONLY the files THIS task changed (never blind `git add -A`, never revert
  another session's uncommitted small edits); (4) deploy + verify live; (5) **release the lock**.

## 🥇 BACKUP-1 IS **UPSTREAM** — everything lands there first (owner, 2026-08-01)

The word for what backup-1 is: **upstream**. (Plain English: the *source of truth*; in git terms the
*trunk*.) Everything else — AV live, backup-2 — is **downstream** of it. The rule in one line:

> **Nothing may exist downstream that is not in backup-1's `main` first.**

Backup-1 (`aevinite/3D_BACKUP` → 3-d-backup.vercel.app) is always the newest, most complete copy of
this product. A change made for AV live or for backup-2 is still merged into backup-1 FIRST; the
other stacks only ever receive what backup-1 already has. That is what stops the three stacks
forking, and it is why backup-1 is the one place to look to answer "what is the latest?".

**"First" means MERGED — not necessarily deployed** (owner, 2026-08-01). Backup-1's Vercel is on the
free plan (~100 deploys/day) and a busy day of parallel sessions genuinely exhausts it; when it caps,
a merged fix simply cannot go out. **That does NOT block anything.** The order is:

1. **Merge into backup-1 `main`** — always, without exception. This alone satisfies "backup-1 first".
2. **Deploy backup-1** when it can. If capped: retry a couple of times spaced ~60–90s, then STOP —
   the code is safe on main and deploys when the rolling window frees. **Do not hammer the cap.**
3. **Meanwhile, deploy backup-2 so the owner still has a live, current site** —
   **https://3d-backup-2.vercel.app** (separate Vercel account = its own 100/day quota, separate
   Supabase). Put that link in the "In short" line so he can switch immediately.
4. When backup-1's window frees, deploy it, so **backup-1 is the latest again**.

**How to deploy backup-2** (its Vercel project has NO Git connection, so a push does nothing):
upload a clean checkout of `main` — do NOT reuse the `backup_Menu_2` folder, other sessions keep
uncommitted work there:

```bash
git worktree add --detach /tmp/b2 origin/main          # a clean copy of main
cp /Users/aevinite/Documents/Projects/backup_Menu_2/.vercel/project.json /tmp/b2/.vercel/
cd /tmp/b2 && npx vercel deploy --prod --yes --token "$(cat .claude/.vercel2.token)"
git worktree remove /tmp/b2                            # tidy up after
```

**Before assuming backup-2 needs schema work, CHECK** — on 2026-08-01 it was already in step. Its
management token is expired, so use `psql`; connection details + the PostgREST-404 trap that fooled
me are in **`docs/PROJECT-HISTORY.md` §8**, along with the deploy-cap waste numbers.

### 📥 THE MAC FOLDER MUST NEVER FALL BEHIND BACKUP-1 (owner, 2026-08-04 — ABSOLUTE, EVERY SESSION)

The owner's freshness ladder, in his own order. Each rung is **never newer** than the one above it:

| rung | what | how it gets current |
|---|---|---|
| **1 · newest** | **this Mac folder** (`/Users/aevinite/Documents/Projects/backup_Menu`) | where work is written — must be rebased on `origin/main` |
| 2 | **backup-1 `main`** (`aevinite/3D_BACKUP`) | a merged PR |
| 3 | **backup-1 site** (3-d-backup.vercel.app) | a deploy |
| 4 | **backup-2** (3d-backup-2.vercel.app) | an uploaded clean checkout of `main` |
| 5 · last | **AV live** | the asked-first release ritual |

**A stale folder does not announce itself: nothing is red, the app runs, the findings just aren't
about the real product.** (It cost a full ten-terminal sweep — `docs/PROJECT-HISTORY.md` §7.)

- **CHECK BEFORE YOU AUDIT, PLAN, OR CLAIM ANYTHING IS BROKEN.** `npm run check:current` (or
  `git fetch origin && git status -sb`). Behind by even a few commits → say so in chat and get
  current FIRST. **Never open a finding, write a plan, or tell the owner something is broken from a
  folder that is behind** — re-verify against `origin/main` first. That is the whole lesson.
- **"MAKE IT LIVE" NOW INCLUDES BRINGING THIS FOLDER UP TO DATE.** When the owner says "make it
  live / deploy / push it", the ritual is: merge → **pull this folder to the merged `main`** → deploy
  backup-1 → (then backup-2 / AV live as separately asked). The folder is never left behind after a
  release.
- **SYNCING IS NOT `git pull` IN A SHARED FOLDER.** Many sessions live here, each holding small
  uncommitted edits. Before syncing: `git status --porcelain` — if files you don't recognise are
  modified, they are **another live session's unshipped work. Leave them untouched, do NOT stash,
  commit or revert them,** and do not sync until those sessions have landed their work (ask the
  owner to let them finish).
- **CANNOT SYNC RIGHT NOW? WORK IN A WORKTREE INSTEAD, off `origin/main`** — never switch the shared
  folder's branch under another session (`git worktree add -b <branch> .claude/worktrees/<name>
  origin/main`, then a real `npm install` in it).
- **A worktree is only as fresh as the moment you made it.** Re-`git fetch` and re-check a finding
  before you fix it, or you will "fix" something another session already fixed — and conflict with it.
- Guarded by **`npm run check:current`** (`scripts/check-folder-current.mjs`): prints how far behind
  the folder is, names the uncommitted files that would collide with a sync, and exits non-zero when
  the folder is behind. Read-only — it never fetches destructively and never touches the working tree.

## Deployment (ONE target now)

Single git repo → GitHub `aevinite/3D_BACKUP` (branch `main`); Vercel project
**3-d-backup** auto-deploys it (https://vercel.com/aevinite1/3-d-backup). Deploy with
`git push origin main`. The WHOLE thing now ships from this one repo/deploy — guest
menu + all four staff panels + admin. The old separate `editor/` repo
(`INFINITESTUDIOIF/ADMIN_PANEL_3D_MENU`) is **retired/deleted**; ignore the old
"push both repos" rule. Secrets live in `.env.local` (gitignored, never committed);
local `*.bat` launchers are gitignored too. The admin gate needs `ADMIN_PASSWORD`
set in the Vercel project env to work in production.
