# Project: My Little French House (4D Menu)

This is a Next.js 16 / React 19 restaurant menu app with a 3D-model viewer for
selected dishes. The user is a beginner who vibe-codes; teach as you build,
keep chat in plain language, explain why before how. See user/feedback
memory for tone and preferences.

## Stack at a glance

- Next 16.2.6, App Router, async `params`. React 19.2.4. TS strict.
- Tailwind 4 (postcss). GSAP (npm-only, imported in `HeroTitle.tsx` + `IntroSplash.tsx` — the old "npm + CDN duplication" bug is gone; there is no GSAP CDN tag).
- `<model-viewer>` web component loaded via `<Script>` from CDN inside `components/PublicModelViewer.tsx` (NOT in `app/layout.tsx`).
- GLB models on Supabase Storage; two tiers per dish (small ~2 MB, optimized ~9 MB).
- Dev: `npm run dev` (port 4000). Playwright: `node scripts/verify-cache.mjs`.

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
