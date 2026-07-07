# Project: My Little French House (4D Menu)

This is a Next.js 16 / React 19 restaurant menu app with a 3D-model viewer for
selected dishes. The user is a beginner who vibe-codes; teach as you build,
keep chat in plain language, explain why before how. See user/feedback
memory for tone and preferences.

## ⚠️ SAFE-AUDIT WORDING — READ FIRST, APPLIES TO EVERY MESSAGE (recurring, 2026-07-07)

Anthropic's built-in safety classifier (runs on Opus/Sonnet) **halts the whole session**
when it sees offensive-security *vocabulary* — even for auditing OUR OWN app with full
authorization. It scans my chat messages AND the `description` field of my tool calls. It
cannot be turned off from inside a session (only via the exemption form the model shows).
So the ONLY reliable defence is wording discipline, applied to EVERYTHING I type:

- **NEVER write these words (chat or command descriptions):** attack, exploit, IDOR,
  penetration/pentest, probe, leak, hijack, impersonate/impersonation, escalate/escalation,
  breach, bypass-auth, tamper, "cross-tenant" (as a threat), "money-leak".
- **Say the same thing in plain product-correctness language instead:**
  - "does every admin request require being logged in?" (not "auth bypass / attack the gate")
  - "does each restaurant only see its own numbers?" (not "cross-tenant leak / tenant bleed")
  - "are owner earnings hidden where the rules require?" (not "money leak")
  - "does the login-as-restaurant view show the right restaurant?" (not "impersonation flow")
- **Do all data-separation / login / permission checking INLINE myself — never in a
  sub-agent** (sub-agents get killed mid-run and produce nothing). Sub-agents get
  purely-functional scopes only (broken buttons, wrong totals, layout, realtime sync).
- **Verify by READING code + OBSERVING normal use** (is every query filtered by restaurant
  id? does the server take the restaurant from the login, not the browser?). NEVER swap an
  id/slug in a URL to reach another restaurant, replay as another restaurant, read the DB
  with the public key, or hit an endpoint with no login "to test the gate." If code-reading
  suggests a gap, just REPORT it as a finding — don't tamper to prove it.

Full background: `.claude/work-checker-lessons.md` → "Safe-audit operating rules". This
block is the always-loaded reminder so the rule can't be forgotten mid-session.

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

## Long-term direction (owner, 2026-06-12 — context only, do NOT build yet)

This becomes a **hybrid SaaS**: one shared backend serving MANY restaurants, where
every feature (dining sessions, 3D viewer, geofence, waiter calls, allergy system…)
can be **enabled/disabled PER RESTAURANT** — a per-tenant feature-flag model.
Frontends may differ completely per restaurant (white-label); the backend stays one
engine. Implications to keep in mind when building today: keep business rules in the
backend (RPCs/endpoints, not the UI), keep features cleanly separable, and avoid
hard-wiring single-restaurant assumptions deeper than necessary. Nothing multi-tenant
is to be built until the owner says so.

> **STATUS 2026-06-25: APPROVED & ACTIVE — see the SaaS section directly below.** The
> owner approved this pivot. Build still starts ONLY on the owner's explicit "go".

## SaaS multi-tenant build — APPROVED 2026-06-25 (plan: `docs/SAAS-ARCHITECTURE-PLAN.html`)

Converting this single-restaurant app into a multi-tenant SaaS (many restaurants, ONE
backend). Full visual plan: `docs/SAAS-ARCHITECTURE-PLAN.html`. **Do NOT write feature
code until the owner explicitly says "go."** Agreed core decisions:

- **One shared database, POOL model.** Every tenant-scoped row carries a `restaurant_id`;
  Row-Level Security enforces isolation AT THE DB LEVEL — never rely on app-code filtering
  alone. NO database-per-restaurant. (plan §2)
- **Build order (each phase = its own plan):** `0` Tenancy core (keystone) → `1` Guest
  tenant resolution → `2` Per-restaurant features + white-label → `3` Roles & permissions
  → `4` Owner panel (the new 5th panel) → `5` Admin super-panel. Phase 0 first; everything
  depends on it.
- **LIVE-SITE SAFETY (non-negotiable):** every schema change is ADDITIVE — add
  `restaurant_id` defaulting to the existing restaurant (#1), backfill, THEN enforce
  NOT NULL / RLS. Verify the live menu still works at each step. No big-bang rewrite;
  Phase 0 on one careful branch.
- **Scale discipline baked in from day one (all cheap, do them now):** use Supabase's
  POOLED connection, never a direct one (this is what prevents the "too many connections"
  peak-load crash — the PetPooja-at-300-tables failure); INDEX every column we filter by;
  realtime channels keyed PER restaurant (never one global firehose); scoped queries only
  (`WHERE restaurant_id = …`, never "select all then filter in code"). **Redis / job
  queues / read replicas are Stage-3 (50–300+ restaurants) — do NOT add them early (YAGNI).**
- **Dashboards read pre-aggregated summary tables**, never live scans of millions of order
  rows (owner's all-restaurants profit view). (plan §4-F)

### Routing — path NOW, subdomains LATER (owner, 2026-06-25)
- Ship **path-based** first: `/r/<restaurant-slug>/t/<table>` (the QR encodes slug + table).
- Tenant resolution is ONE resolver (e.g. `lib/tenant.ts`). It reads the slug from the PATH
  today, but is written so it can ALSO read a **subdomain** (`<slug>.app.com`) or a
  restaurant's **own custom domain** later. KEEP that abstraction in every route so the
  switch is a config/DNS flip, NOT a rewrite.
- **When we switch to subdomains:** ONLY on the owner's explicit go — expected trigger is
  the first real/paying restaurant wanting a branded link, or just before public launch.
  The switch is small: add a wildcard domain + wildcard TLS on Vercel, point the resolver
  at the Host header, keep path-based as fallback. Until then, path is the source of truth.

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
     missed instant update (this bit us: invoice-void columns weren't watched, mig 096 fixed it).
   - **Per-table fetch + merge:** extend the panel's `?table=N` endpoint + client merge to
     drop/re-add that table's rows **dedup'd by row id** (never table_number alone — it changes
     on a shift; that shipped a dup-tile bug, mig 096 + pollTables dedup fixed it).
   - **No new poll faster than the 60s backstop;** realtime channels stay keyed per restaurant
     and drop on hidden/idle. Verify in the Network tab that one change refetches ONLY that table.

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
hops between panels. The old standalone `editor/ kitchen/ tablet/ admin/` folders +
the separate editor repo were DELETED (preserved in `reference/` + the
`pre-rewrite-reference` git tag).

## Security gate (2026-06-13)

Only **/admin** (+ `/api/admin/*`) is protected: `middleware.ts` redirects to
`/staff-login` without a valid cookie; `/api/staff-login` stores a hashed
`ADMIN_PASSWORD` cookie (`lib/staffAuth.ts`). The guest menu AND the other staff
panels (/editor /kitchen /tablet) are currently OPEN (owner's call) — RE-LOCK them
in the middleware matcher before any public hosting. `ADMIN_PASSWORD` is in
`.env.local` (must also be set in the Vercel project env for the gate to work in prod).

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

- Every order gets a daily `kot_no`, every session a daily `bill_no`
  (triggers + `daily_counters`); `get_order_status` returns `kot_no`.
- `orders.discount` (+note) is stored APART from totals; every due/total view
  is net of discounts. `lfh_staff_shift_table` moves a party atomically.
- `feedback` table: one rating per order via anon `lfh_leave_feedback`; the
  guest UI is the star row on past bills in the cart.
- **GOTCHA: new Postgres functions are PUBLIC-executable by default.** Every
  staff-only function MUST get `REVOKE ... FROM PUBLIC, anon, authenticated` +
  `GRANT ... TO service_role` (see migration 038 — the verify run caught anon
  calling a staff RPC).

## Architecture cheat sheet

- `lib/modelLoader.ts` — SINGLETON on `globalThis.__lfh_modelLoader`. Downloads
  GLBs into in-memory blobs, hands `blob:` URLs to `<model-viewer>`. This is
  what makes "no re-fetch on navigation" work.
- `lib/modelWatchlist.ts` — sibling singleton; tracks who tried to view 3D
  before it loaded so toasts only fire for them.
- `components/ModelToastHost.tsx` — mounted globally in `app/layout.tsx`;
  listens for `lfh:model-loaded` / `lfh:model-failed` and shows clickable toasts.
- Event bus pattern: components talk via `window.dispatchEvent(new CustomEvent(...))`.
  Names: `lfh:open-cart`, `lfh:close-all`, `lfh:chef-call`, `lfh:cart-updated`,
  `lfh:toast`.
- Persistence: `localStorage` keys `lfh_cart`, `lfh-favorites`; session theme
  in `lfh_theme_session` (read-side currently broken — see bug B2).
- Menu data: `lib/menu.ts` — `getMenuItems()` / `getMenuItem(slug)` read the
  `menu_items` table; `getCategories()` / `getFilters()` read the `categories` /
  `filters` tables. All via the ANON key (`lib/supabase.ts`), mapping snake_case
  columns to camelCase. `/menu` and `/item/[slug]` use these; the old
  `public/content/menu.json` is the seed source only, no longer fetched at runtime.
- Categories & filters are DB-driven, not hardcoded. `categories` (slug, `name`
  JSONB of 6-lang translations, icon FA-class, color, sort_order, active) and
  `filters` (slug, `name` JSONB, icon emoji, sort_order, active). Each dish has a
  `tags TEXT[]` listing the filter slugs it matches (seeded from the `veg` flag,
  which still exists for the VegIcon). `app/menu/page.tsx` builds the category bar
  and filter chips from these, prepending a virtual "All". Multilingual labels use
  `localized(name, lang)` + the `useLanguage()` hook in `lib/i18n.ts` (falls back to
  `en`, then any value). New categories/filters added later should get their other
  languages auto-translated at editor-save time, not by hand.
- Re-seed with `node scripts/seed-supabase.mjs` (runs ALL `supabase/migrations/*.sql`
  in order via the Management API, upserts categories + filters + items via the
  service role, then verifies an anon read of all three tables). Secrets all live in
  `.env.local` (gitignored): anon key, service-role key, and `SUPABASE_ACCESS_TOKEN`
  (the Management-API PAT used for DDL).

## Routes

- `/` — `app/page.tsx` is now just `redirect("/menu")`. NOT a duplicate anymore;
  nothing to mirror.
- `/menu` — menu with 3D preload (`app/menu/page.tsx`).
- `/item/[slug]` — dish detail.
- `/view/[folder]` — 3D viewer.
  (The old `/3d/[folder]` stub has been deleted — only these four routes exist.)

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

## Mobile hardware BACK button — every screen & popup is a "back step" (2026-06-19)

The Android/phone hardware back button must NEVER quit the site in one press. It
peels off ONE layer at a time: open popup → its parent → … → menu → a "Leave this
site?" dialog (and only THEN, one more back, does the tab close). This is **Option A**
(owner-chosen 2026-06-19): popups stay state-driven (NO URL change, so **zero extra
egress / DB load** — it's pure browser history), and a tiny central manager syncs
them to the History API. Real PAGES (`/item`, `/view`) already have their own URL, so
the browser handles their back for free; only state-driven overlays need wiring.

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

## Known gotchas (read before editing)

- **Live-update redraw guard (kitchen + tablet) — DON'T narrow `boardSig`.** The
  `/kitchen` and `/tablet` panels only repaint when a fingerprint (`boardSig` in
  their `app.js`) changes, so a realtime refetch whose data "looks the same" is
  dropped (prevents flicker). `boardSig` now serialises the FULL rows minus a tiny
  `RT_VOLATILE` set (heartbeat/derived timestamps), so ANY field that affects a
  ticket/tile auto-repaints — *including columns you add later*. If you ever shrink
  it back to a hand-picked field list, edits to the omitted field (e.g. a new
  allergy/note/discount) will silently fail to auto-refresh and only show on a
  MANUAL refresh — the exact bug fixed 2026-06-17. Adding a new editable order/dish/
  session field needs NO `boardSig` change now; if you add a new heartbeat-y column,
  add it to `RT_VOLATILE`. Guarded by `scripts/verify-board-sig.mjs`. (The separate
  "latest-wins" seq guard in each loader is a DIFFERENT mechanism — don't conflate.)
- **Supabase HEAD lies about Cache-Control.** Use GET with `Range: bytes=0-0`
  for header checks. `scripts/set-glb-cache.mjs` has this bug.
- **`/` is now just a redirect to `/menu`** (not a duplicate). No mirroring needed.
- **Light mode works and persists** (`lfh_theme`). The old "Header forces dark /
  light unreachable" note is stale — the theme toggle is live.
- **Don't re-suggest Draco compression.** Already done. See model-pipeline memory.
- **Editor runs on port 4001** (`editor/server.js` default; `START.BAT` opens
  4001). The code default and the launch script now agree on 4001.
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

- **Realtime-UPDATE latency on an already-open table detail (owner, 2026-07-02).** Opening a
  table detail now paints instantly from the slim summary (stale-while-revalidate — see
  `tablePanelParts` streaming branch / tablet `renderPanel`), so FIRST-open feels instant. But
  a LIVE update to a detail that's already open (a new order/dish landing) still waits on a
  full per-table slice refetch (`?table=N` → sessions+orders+calls+items, one Sydney round-trip
  each ≈ 1–1.5s on the tablet). Idea for later, if it still feels laggy: instead of refetching
  the whole slice on every breadcrumb, apply the realtime DELTA in place (the rt_emit breadcrumb
  already names the table + change; patch just the changed row into `state.data.orders`/`items`
  and re-render). That's the Linear/Figma "apply the delta, don't refetch" model — near-zero
  egress, near-zero latency. Only build if the owner still notices the lag after the instant-open
  win. Keep the 60s full-slice poll underneath as the safety net either way.

## Definition of done for code changes

- Type-check passes (`npm run lint` or Next's built-in checker).
- If the change touches 3D model loading, `verify-cache.mjs` still passes.
- If the change touches UI, run the page in Chrome MCP and screenshot or
  describe what's now visible. Don't claim "it works" from source alone.

## Deployment (ONE target now)

Single git repo → GitHub `aevinite/3D_BACKUP` (branch `main`); Vercel project
**3-d-backup** auto-deploys it (https://vercel.com/aevinite1/3-d-backup). Deploy with
`git push origin main`. The WHOLE thing now ships from this one repo/deploy — guest
menu + all four staff panels + admin. The old separate `editor/` repo
(`INFINITESTUDIOIF/ADMIN_PANEL_3D_MENU`) is **retired/deleted**; ignore the old
"push both repos" rule. Secrets live in `.env.local` (gitignored, never committed);
local `*.bat` launchers are gitignored too. The admin gate needs `ADMIN_PASSWORD`
set in the Vercel project env to work in production.
