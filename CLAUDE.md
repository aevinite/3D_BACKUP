# Project: My Little French House (4D Menu)

This is a Next.js 16 / React 19 restaurant menu app with a 3D-model viewer for
selected dishes. The user is a beginner who vibe-codes; teach as you build,
keep chat in plain language, explain why before how. See user/feedback
memory for tone and preferences.

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
`STAFF_PASSWORD` cookie (`lib/staffAuth.ts`). The guest menu AND the other staff
panels (/editor /kitchen /tablet) are currently OPEN (owner's call) — RE-LOCK them
in the middleware matcher before any public hosting. `STAFF_PASSWORD` is in
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

## Known gotchas (read before editing)

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
local `*.bat` launchers are gitignored too. The admin gate needs `STAFF_PASSWORD`
set in the Vercel project env to work in production.
