# GUARD MAP — "I changed this file. Which check covers it?"

There are **96** `verify:*` / `test:*` commands in `package.json`. Each one exists because a specific
bug reached somebody's screen once. That is a real asset and a real problem at the same time: nobody
can hold 96 names in their head, so in practice a person runs none of them, or reaches for
`verify:everything` (the 500-phase suite — 40 minutes, writes to the shared database, one run at a
time). Both of those are the wrong answer.

**So: find the row for the file you touched, and run what it says.**

```bash
npm run verify:push          # ALWAYS. ~90s, no database, no login. Exactly what CI runs.
npm run <the row's guard>    # THEN the one that covers your change.
```

Three columns you need to read before running anything:

| column | what it means |
|---|---|
| **needs** | `nothing` = reads repo files only · `.env.local` = talks to the dev database · `app running` = needs `npm run dev` on 4000 (or `-- --base <url>`) |
| **writes** | `no` = safe any time, safe in parallel · **`YES`** = creates rows in the shared database. One at a time, never while a sweep is running |

Kept honest by `npm run verify:pointers`: it fails if a guard named here has vanished from
`package.json`, and it fails if a NEW `verify:*` is added to `package.json` without a row here.

---

## 0 · Run these on every change, no exceptions

| command | what it is | needs | writes |
|---|---|---|---|
| `npm run verify:push` | type-check → lint → unit tests → all static guards → access model. The same set CI runs. | nothing | no |
| `npm run typecheck` | `tsc --noEmit`. **`npm run lint` does NOT check types** — they are separate gates. | nothing | no |
| `npm run test` | `test:money` + `test:errors` + `test:units` — 37 tests, ~0.1s. | nothing | no |
| `npm run verify:static` | all 31 static guards. Runs **every** one and reports **every** failure — add `-- --quiet` for failures only. Inside `verify:push`. | nothing | no |
| `npm run check:current` | is this folder level with `origin/main`? **Run before any audit or "X is broken" claim.** | nothing | no |

Everything in section 0 is also inside `verify:push`, so normally you just run that.

---

## 1 · Guest menu — `/menu`, `/r/<slug>/menu`, `/q/<code>`

Code: `app/menu`, `app/r/[restaurant]`, `app/q/[code]`, `components/*`, `lib/menu.ts`, `lib/i18n.ts`

| you touched | run | needs | writes |
|---|---|---|---|
| anything a diner sees | `verify:guest` | app running | no |
| the menu read / what a guest is allowed to read | `verify:guest-read` | `.env.local` | no |
| a dish hidden or taken off the menu | `verify:hidden` | nothing | no |
| the scroll-spy category strip | `verify:scrollspy` | app running | no |
| languages / translated text | `verify:i18n-scope` | nothing | no |
| allergy chips or per-item allergy data | `verify:allergy-isolation` | `.env.local` | **YES** |
| the guest's cart, order placing, or the offline outbox | `verify:order-retry`, `verify:guest-recovery`, `verify:outbox` | nothing | no |
| the guest session / table hand-over | `verify:session-ux` | `.env.local` | **YES** |
| branding, theme, IntroSplash (one tenant must never show another's) | `test:units` (`lib/brandText`, `lib/brandTheme`) | nothing | no |

## 2 · 3D dish viewer

Code: `components/PublicModelViewer.tsx`, `lib/modelLoader.ts`, `app/view/*`

| you touched | run | needs | writes |
|---|---|---|---|
| the loader, caching, or "no re-fetch on navigation" | `verify:cache` ← **in the Definition of done** | app running | no |
| the slow-network / still-loading message | `verify:slow-load` | app running | no |
| GLB upload or storage cache headers | `node scripts/set-glb-cache.mjs` (check-only unless creds are set) | `.env.local` | no |

## 3 · Manager panel — `/manager`, `/editor`

Code: **`public/panels/editor/app.js`** (plain JS in an iframe, not React), `app/api/editor/*`

| you touched | run | needs | writes |
|---|---|---|---|
| **anything at all in this panel** | `verify:manager-behaviour`, `verify:ui`, `verify:taps` | nothing | no |
| the tables floor / a tile / the floor summary | `verify:floor`, `verify:cancelled-tile` | nothing / `.env.local` | no |
| `lfh_table_view_summary` (the floor's one big read) | `verify:summary-parity` ← **not hand-review** | `.env.local` | no |
| the floor under load / rush hour | `verify:live-rush`, `verify:merged-floor` | `.env.local` | **YES** |
| a permission gate in the panel | `verify:manager-gates`, `verify:manager-hidden` | `.env.local` | no |
| the "Edit the menu" sub-switches | `verify:menu-parts`, then `verify:menu-parts-live` | nothing / app running | no |
| Bills, a bill's money, a discount | `verify:audit`, `verify:one-number`, `verify:tax-mode` | nothing / `.env.local` | no |
| the tax on a real bill, end to end (incl. an MRP bottle) | `verify:tax-mode-e2e`, `test:totals` (client maths vs the server's, to the cent) | `.env.local` | `verify:tax-mode-e2e` **YES** |
| the printed bill or kitchen ticket | `verify:print-format` (one file does both: `public/panels/billdoc.js`) | nothing | no |
| joining / merging tables | `verify:merge`, `verify:merge-who`, `verify:merge-keeps-mark`, `verify:void-party` | mixed | some **YES** |
| the waiter rota | `verify:rota-clash` | `.env.local` | **YES** |
| a customer / CRM field | `verify:customers`, `verify:customer-erase`, `verify:personal-data` | `.env.local` | **YES** |
| a login in the recycle bin | `verify:recycle-name` | nothing | no |
| opening a table that had a join request (the "Attend" flash) | `verify:no-attend-flash`, `verify:open-request-guard` | nothing | no |

## 4 · Kitchen panel — `/kitchen`

Code: `public/panels/kitchen/*`, `app/api/kitchen/*`

| you touched | run | needs | writes |
|---|---|---|---|
| anything in this panel | `verify:ui`, `verify:taps` | nothing | no |
| the board's redraw fingerprint (`boardSig`, `RT_VOLATILE`) | `verify:board-sig` ← **never narrow `boardSig`** | nothing | no |
| a ready / served tile | `verify:ready-tile`, `verify:loadall` | nothing | no |
| the same action that also exists in manager or tablet | `verify:twins` | nothing | no |

## 5 · Tablet panel (waiter) — `/tablet`

Code: `public/panels/tablet/*`, `app/api/tablet/*`

| you touched | run | needs | writes |
|---|---|---|---|
| the waiter's floor | `verify:tablet-wants-in`, then `verify:tablet` | nothing / `.env.local` | `verify:tablet` **YES** |
| the tablet's own endpoints | `verify:tablet-parity` | `.env.local` | **YES** |
| waiter sections | `verify:sections` | `.env.local` | **YES** |
| the board fingerprint | `verify:board-sig` | nothing | no |

## 6 · Owner panel — `/owner/…` (16 pages)

Code: `app/owner/*`, `components/owner/*`, `app/api/owner/*`, `lib/ownerCache.ts`

| you touched | run | needs | writes |
|---|---|---|---|
| any report, chart or dashboard tile | `verify:owner-reports` | nothing | no |
| a chart's shape (must never be a lonely 1-bar plot) | `verify:owner-reports` + read `components/owner/Charts.tsx` header | nothing | no |
| the busiest-times heatmap | `verify:heatmap-parity` | `.env.local` | no |
| revenue anywhere | `verify:one-number` ← one revenue number, checked against the database | `.env.local` | no |
| light / dark skin, or any colour | `verify:css-tokens`, `verify:skin-ink`, `verify:dead-css` | nothing / app running | no |
| two owners editing the same value | `verify:owner-clash` | app running | no |
| the owner's first load on a fresh stack | `verify:owner-home` | `.env.local` | no |
| staff, profiles or pay | `verify:staff-accounts` | `.env.local` | **YES** |

## 7 · Admin console — `/aevinite/…` (22 pages)

Code: `app/aevinite/*`, `app/api/admin/*`, `lib/accessTree.ts`, `lib/staffCaps.ts`

| you touched | run | needs | writes |
|---|---|---|---|
| `lib/accessTree.ts` or any switch on the Access screen | `verify:access` ← **always via the npm alias** (it bundles the TS first) | nothing | no |
| the Access screen in the running app | `verify:access-live`, `verify:access-search` | app running | no |
| the admin's super-access view | `verify:xray` ← it MARKS what someone lacks, never hides it | nothing | no |
| a permission the manager must not see | `verify:manager-hidden` | `.env.local` | no |
| a rule the owner has already refused | `verify:rejected` — and **read `docs/REJECTED-IDEAS.md` first** | nothing | no |
| the Recycle bin's **purge** (permanently clears a deleted restaurant) | `verify:purge` ← the tenant keys have no cascade, so a purge names each child table by hand and can forget one | nothing | no |

## 8 · Any write endpoint, anywhere (`app/api/**/route.ts`)

| you touched | run | needs | writes |
|---|---|---|---|
| **added or changed ANY write** | `verify:clash-coverage` (say what you edited from), `verify:floor` (drop the floor snapshot), `verify:taps` (never a silent return) | nothing | no |
| ↳ *(`verify:clash` is kept as a short alias for the same thing — the file is `scripts/verify-clash-coverage.mjs`)* | — | — | — |
| an order write | `verify:order`, `verify:order-retry`, `verify:closed-session` | mixed | some **YES** |
| anything that lowers a bill | `verify:audit` ← every money change leaves a record | nothing | no |
| a reply we send to an outside system | `verify:outbound` | `.env.local` | no |
| behaviour when the server is overloaded | `verify:busy` | starts its own local server | no |
| behaviour with no internet | `verify:offline`, `verify:outbox`, `verify:warm-shell` | mixed | no |
| a route that must require a login | `verify:read-guards`, `verify:server-only` | nothing | no |
| anything that returns a guest's session data to STAFF | `verify:guest-pass` ← a diner's access pass (`session_members.token`) is their whole identity; it must never ride along in a staff payload | nothing | no |

## 9 · Database — `supabase/migrations/*.sql`

| you touched | run | needs | writes |
|---|---|---|---|
| **created a new Postgres function** | `verify:grants` ← a new function is PUBLIC-executable by default | `.env.local` | no |
| a one-time migration that rewrites existing data | `verify:grants` — and wrap it in `lfh_already_applied('<key>')` or a re-seed applies it twice | `.env.local` | no |
| a table storing a guest's phone number | `verify:personal-data` | nothing | no |
| session / table ownership | `verify:table-ownership`, `verify:two-parties`, `verify:lifecycle`, `verify:closed-session` | `.env.local` | **YES** |
| realtime breadcrumbs (`lfh_rt_emit`) | `verify:realtime` | `.env.local` | **YES** |
| anything at all, before a release | `verify:db-parity` ← the two databases must agree | `.env.local` | no |

## 10 · The panels' static assets (`public/panels/**`)

| you touched | run | needs | writes |
|---|---|---|---|
| any `.js` or `.css` under `public/panels/` | `verify:panel-cache` ← the `?v=` must be the file's own content hash, or staff run a weeks-old panel | nothing | no |
| an HTML comment, a `<style>` block, a CSS comment | `verify:ui` | nothing | no |

## 11 · Tooling, docs and the rules themselves

| you touched | run | needs | writes |
|---|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, or any doc CLAUDE.md points at | `verify:pointers` | nothing | no |
| `.claude/settings.json` or a permission rule | `verify:no-ask` | reads `~/.claude/CLAUDE.md` | no |
| anything under `scripts/` or `tests/` | `verify:test-safety` ← our own tests must not trip the app's rate limits | nothing | no |
| a file's line endings | `verify:ui` (check 14) | nothing | no |
| this map, or a new `verify:*` alias | `verify:pointers` — it fails if a guard has no row here | nothing | no |

---

## 12 · Cross-panel sweeps — when your change spans more than one screen

These do not belong to one panel. Reach for them when a change touches several at once, or when you
want the rare cases a single-panel guard cannot reach.

| you touched | run | needs | writes |
|---|---|---|---|
| something that can go wrong in a race (two people, one row, same second) | `verify:edge-cases` | `.env.local` | **YES** |
| error handling anywhere in the staff panels | `verify:families` | `.env.local` | no |
| a fix from an earlier sweep that needed a real write to prove | `verify:write-paths` | `.env.local` | **YES** |
| a small fix reported by a sweep across owner + tablet | `verify:sweep-extras` | app running | no |

## The five that need special care

| command | why |
|---|---|
| `verify:everything` | the 500-phase suite. ~40 min, writes to the shared database, pid-locked to one run. `-- --list` prints the phase map without running anything. |
| `verify:tablet` | POSTs a force-close. Writes rows. Not a hook, not for parallel runs. |
| `verify:avlive-release` | reads the **client** stack folder. Never in CI, never casually — announce it first. |
| `verify:live` | runs against a deployed site: `verify:live -- --base <url>`. Read-only. Run it after every deploy. |
| `load:ramp`, `stress*`, `demo:reset`, `db:maintain`, `seed-*` | these are not checks. They write. Read the header before typing the name. |

## What is NOT covered by anything

Honest gaps, so nobody assumes a green run means more than it does:

- **A green suite is not evidence the screen is right.** Every guard above reads code or data. Seeing
  it in a real browser, in the right role, on a non-flagship restaurant, is a separate step and it is
  in the Definition of done.
- `.claude/REQUESTS.md` staleness — nothing checks whether a listed request has since shipped.
- The owner-facing screenshots in `LEARN-MY-APP/screens/` — nothing notices when the UI moves past
  them.
