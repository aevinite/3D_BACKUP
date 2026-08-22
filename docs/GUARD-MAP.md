# GUARD MAP — "I changed this file. Which check covers it?"

There are **97** `verify:*` / `test:*` commands in `package.json`. Each one exists because a specific
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
| any of the THREE guest doors (`/menu`, `/r/<slug>/menu`, `/q/<code>`), or a tap that promises the guest something | `verify:guest-doors` ← all three doors must reach the SAME restaurant, and a guest's tap must never claim something that did not happen | nothing | no |

## 2 · 3D dish viewer

Code: `components/PublicModelViewer.tsx`, `lib/modelLoader.ts`, `app/view/*`

| you touched | run | needs | writes |
|---|---|---|---|
| the loader, caching, or "no re-fetch on navigation" | `verify:cache` ← **in the Definition of done** | app running | no |
| the dish page or the 3D viewer's own code — badges, fallbacks, what a diner is told when a model can't open | `verify:3d-viewer` ← source-level, so it runs in under a second with no server | nothing | no |
| the slow-network / still-loading message | `verify:slow-load` | app running | no |
| GLB upload or storage cache headers | `node scripts/set-glb-cache.mjs` (check-only unless creds are set) | `.env.local` | no |

## 3 · Manager panel — `/manager`, `/editor`

Code: **`public/panels/editor/app.js`** (plain JS in an iframe, not React), `app/api/editor/*`

| you touched | run | needs | writes |
|---|---|---|---|
| **anything at all in this panel** | `verify:manager-behaviour`, `verify:ui`, `verify:taps` | nothing | no |
| the tables floor / a tile / the floor summary | `verify:floor`, `verify:cancelled-tile` | nothing / `.env.local` | no |
| how many tables sit in a row / the floor's CSS bands / sideways scrolling | `verify:floor-per-row` | nothing | no |
| `lfh_table_view_summary` (the floor's one big read) | `verify:summary-parity` ← **not hand-review** | `.env.local` | no |
| the floor under load / rush hour | `verify:live-rush`, `verify:merged-floor` | `.env.local` | **YES** |
| a permission gate in the panel | `verify:manager-gates`, `verify:manager-hidden` | `.env.local` | no |
| the "Edit the menu" sub-switches | `verify:menu-parts`, then `verify:menu-parts-live` | nothing / app running | no |
| Bills, a bill's money, a discount | `verify:audit`, `verify:one-number`, `verify:tax-mode` | nothing / `.env.local` | no |
| the tax on a real bill, end to end (incl. an MRP bottle) | `verify:tax-mode-e2e`, `test:totals` (client maths vs the server's, to the cent) | `.env.local` | `verify:tax-mode-e2e` **YES** |
| **cancelling an order** — the "was the food made?" answer, the loss it records, or migration 355 | `verify:cancel-loss` ← the answer is read off the row where answers live (not the `order_cancelled` row, which is how a correction stopped being marked as one), and a record-only loss is never summed twice by the Audit screens. Makes its own order, stock and audit rows and deletes each BY ID. | `.env.local` | **YES** |
| ↳ the same answer driven through the REAL endpoint (`PATCH /api/editor/orders/<id>`), not the RPC | `verify:cancel-made` ← asserts the EFFECTS — a real expense row, a real stock reversal — because the first wiring called the classifier before the row was cancelled, so the RPC refused, returned `{ok:false}`, and nothing failed and nothing was logged. | app running + `.env.local` | **YES** |
| the printed bill or kitchen ticket | `verify:print-format` (one file does both: `public/panels/billdoc.js`) | nothing | no |
| ↳ a bill printed a second time | `verify:bill-reprint` ← a reprint is a PRINT, not a new bill: same numbers, same totals, and it says DUPLICATE on the paper (added by another session, 2026-08-19; row added here so the map stays complete) | nothing | no |
| ↳ a DATE, a TIME or a DAY on any printed document, or the rows that explain a bill's money | `verify:print-paper` ← every document must read the SAME on every device (it re-renders under five time zones), an MRP line is counted once, and a printed percentage describes the rupees beside it | nothing | no |
| ↳ auto-print itself — WHO prints and WHETHER it prints at all | `verify:print-queue` ← a ticket is a ROW (mig 335), the print path never refuses a hidden/covered window, the targeted slice carries the queue, and one shared claim serves both panels | nothing | no |
| how long a restaurant's logs are kept, and who may change it | `verify:retention` ← the admin LOCKS it rather than silently capping it, the lock is visible to the restaurant ("🔒 set by Aevidine"), the check sits ABOVE the manager permission gates so a manager is never told it is a permission problem, and the lock is never cached | nothing | no |
| a table on the floor whose number is outside the plan ("off-plan") | `verify:floor-offplan` ← an off-plan tile is shown while a party is LIVE on it and never hidden while it is, so a seven-digit number reads as odd rather than vanishing with a real party on it | nothing | no |
| ↳ a COMPUTER printing instead of a screen (the print HELPER) | `verify:print-helper` ← the code is stored hashed, a helper may only touch jobs it claimed, the paper is still built by `billdoc.js` (no second layout), every screen stands down when a helper owns a kind, the admin looking at a client's panel prints nothing at their shop, the Chrome watchdog and the print-completion follow survive, and the panel's table label matches the server's to the character (parity test) | nothing | no |
| releasing everything to AV live (the client site) | `node scripts/release-avlive.mjs --dry-run "<his words>"` ← says what it WOULD do (files, migrations, order) and changes nothing; the real run needs his own AV-live deny rules lifted, on purpose | `.env.AV.live` + the live folder | no |
| ↳ is AV live the SAME SHAPE as backup (tables · columns · functions + their bodies · triggers · indexes · policies · RLS · enums) | `npm run compare:schemas` ← read-only, both databases, shape only — never a row of anyone's data. Answers "identical or not, and exactly what differs, on which side" | `.env.local` + `.env.AV.live` | no |
| joining / merging tables | `verify:merge`, `verify:merge-who`, `verify:merge-keeps-mark`, `verify:void-party` | mixed | some **YES** |
| the waiter rota | `verify:rota-clash` | `.env.local` | **YES** |
| paying a bill in PARTS (Mark paid → Split payment), and what Pay Later then owes | `verify:split-payment` ← a split is still a mark-paid, one part may be left as a tab, and the khata/Pay Later book owes the REMAINDER of the bill rather than all of it | nothing | no |
| the money and safety libraries — tax, tax filing, pay splits, clash detection, idempotency, the log trail, user auth, rate limiting | `verify:t24-money-rules` ← the permanent regression guard for every phase in `.claude/sweep/LEDGER/T24.md` a script can answer; most of them are a NUMBER a person could be charged or a SENTENCE they have to read | nothing | no |
| a customer / CRM field | `verify:customers`, `verify:customer-erase`, `verify:personal-data` | `.env.local` | **YES** |
| the owner's Customers / Pay Later / Inventory / Complaints / Manager-mode screens | `verify:owner-money` ← every fault these five screens had was the same shape: the ROUTE did the careful thing (a true head-count, a `moduleOff` flag, a `partial` list, a `?refresh=1` escape hatch, the month's real counts) and the SCREEN quietly ignored it. Also pins the owner's 2026-08-18 decisions (R34: Pay Later never hides itself) and the rendering rule that `--border` is a whole border, not a colour — a 1★ rating drew five gold stars for months because of it. | nothing | no |
| a login in the recycle bin | `verify:recycle-name` | nothing | no |
| opening a table that had a join request (the "Attend" flash) | `verify:no-attend-flash`, `verify:open-request-guard` | nothing | no |
| a parcel, or the 🛵 Platform / 🥡 Parcels tab appearing/disappearing | `verify:parcel-home` ← a parcel has ONE home; the floor must never grow a parcel strip again (owner, 2026-08-14) | nothing | no |
| a table on the floor whose number is outside the plan ("off-plan") | `verify:floor-offplan` ← an off-plan tile is shown while a party is LIVE on it and never hidden while it is, so a seven-digit number reads as odd rather than vanishing with a real party on it | nothing | no |

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
| **anything at all in `public/panels/tablet/app.js`** | `verify:tablet-taps` — it compiles the file (a stray backtick in a template literal blanks the whole panel), and holds the four bulk actions, the KOT rows, the destination pickers and the money buttons to "a tap must never vanish in silence" | nothing | no |
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
| the owner's **Menu editor**, **Team** roster or **Settings** page | `verify:owner-panel` ← every fault these three screens had was the same shape: the screen SAID something that was not what happened — a query that failed reported as "the admin switched Menu off", a first-save-wins refusal whose sentence the reload erased before it was painted, a refusal rendered 950px above a phone screen, a picker with nothing in it telling you to pick. Also pins the owner's 2026-08-18 decisions: **R36** (the owner is never shown which sections are switched OFF — only the admin knows that), the Team search, the disabled-people group, and the banner heading that names the reason instead of always crying "Something went wrong". **Section numbers 1–7 map to the seven problems**; §9 holds the three things he picked himself. | nothing | no |
| the same three screens, but a CODE claim rather than a behaviour | `verify:owner-territory` ← the static half of the 500 recorded checks for this territory: 49 claims about what those four files do (the switch enforced server-side, the refusal message surviving its own reload, both per-tab pins, the stated server limits, R36's silence, R7's plain span, one row renderer, no permission writes). It lived as a throwaway script for three sweep passes and was deleted with the scratch files each time, so the next pass re-typed it from memory — which is how a check drifts. Comments are stripped before anything is matched and ordering checks are scoped per function, because both mistakes produced false reds. | nothing | no |
| the same three screens, DRIVEN — the roster, the profile sheet, the settings card, the phone widths, and a change traced to the guest doors / manager panel / waiter tablet | `verify:owner-territory-live -- --base <url>` ← 131 assertions: bands C, D and E of the 500 recorded checks. Everything polls (six rows used to flap on fixed delays); contrast is COMPUTED in both skins at 1280×800 and 360×780; where the API hides a field it reads the DATABASE, and where an endpoint was unknown it was found by WATCHING the panel request it. Owns everything it touches: its own `zzlive` prefix, a pre-clean for a killed run, every row deleted by id, and it FAILS if it left anything behind. | app running + `.env.local` | **YES** |
| the owner's **home dashboard** or his **Audit & logs** page | `verify:owner-screen` ← the six T12 faults, each one code that ran perfectly and still did not do what the screen promised: a hero shortcut naming a page the sidebar calls something else, a "See all" gate on an entitlement key the server has never sent (`undefined !== false` is always true), a 403 folded into the same `null` the card renders as "Loading…" for ever, the 60s backstop refreshing everything except the activity feed, a deliberate "not enabled" answer printed as a red "Couldn't load.", and a one-page money line calling itself a total. | nothing | no |
| **any handler under `app/api/owner/*`** — a new one, or how it gets its scope | `verify:owner-scope` ← a scope it COULD NOT READ must answer a retryable 503, never an unhandled 500. `ownerScopeOr503()` was written for exactly that and had ZERO callers: all twelve owner routes called `ownerScope()` bare, so the failure path was a blank 500 with nothing to retry, on every owner screen, for a week. A helper existing is not a helper being wired in. | nothing | no |
| the owner's first load on a fresh stack | `verify:owner-home` | `.env.local` | no |
| staff, profiles or pay | `verify:staff-accounts` | `.env.local` | **YES** |
| **deleting a person who has been PAID** — or anything about the pay ledger and the recycle route | `verify:pay-history-delete` ← a salary or an advance is part of the books (docs/COMPLIANCE-GUARDRAILS.md), so a login delete must never take one with it. This was a written MANUAL check for three sweep passes and therefore never run: proving it needs real money rows. It now makes its OWN throwaway person, records one ₹1 entry through the product's endpoint, asserts the 409 AND that the owner is told on screen with the "Mark as left" way forward, then removes the payment row and the person BY ID and fails if it left anything behind. | app running + `.env.local` | **YES** |

## 7 · Admin console — `/aevinite/…` (22 pages)

Code: `app/aevinite/*`, `app/api/admin/*`, `lib/accessTree.ts`, `lib/staffCaps.ts`

| you touched | run | needs | writes |
|---|---|---|---|
| `lib/accessTree.ts` or any switch on the Access screen | `verify:access` ← **always via the npm alias** (it bundles the TS first) | nothing | no |
| the Access screen in the running app | `verify:access-live`, `verify:access-search` | app running | no |
| the admin's super-access view | `verify:xray` ← it MARKS what someone lacks, never hides it | nothing | no |
| a permission the manager must not see | `verify:manager-hidden` | `.env.local` | no |
| a rule the owner has already refused | `verify:rejected` — and **read `docs/REJECTED-IDEAS.md` first** | nothing | no |
| the ACCESS ladder of a NEW module (a feature the admin grants, the owner may be given, the waiter may reach) | `verify:settings-columns` ← `settings` is one row per restaurant with 110 columns, ~44 of them the same four repeated per module; a new module's ladder belongs in `settings.modules` (mig 326), not in four more columns | `.env.local` | no |
| a dish COUNT on a tile or the kitchen board ("2 cooking · 0/4 served") | `verify:dish-counts` ← an order's dishes live in `order_items` rows AND the `orders.items` ticket; the floor and the kitchen each spell the rule out and drifted three times (migs 105/122/136), so this compares both spellings on every live order | `.env.local` | no |
| the **Recycle bin's rules** — restoring, a taken web address, or opening a binned restaurant's panels | `verify:recycle-bin -- --base <url>` ← three owner decisions from 2026-08-20 that a source-read cannot prove: a permanent removal has NO waiting period (the 90-day lock was enforced in TWO places and mig 342 removed only the SQL half, so a stack whose migrations are behind still raises `Retention lock` — the only way to know is to actually purge something), restoring into a taken web address ASKS instead of renaming silently and writes nothing until the admin answers, and a binned restaurant's panels open only on an explicit opt-in from the bin. Makes its own `ZZ-RBIN` restaurants and deletes exactly those, by id, in the same run. Companion to `verify:recycle-name` (the owner half) and `verify:admin-restaurants` (the screen's source). | app running + `.env.local` | **YES** |
| the Recycle bin's **purge** (permanently clears a deleted restaurant) | `verify:purge` ← the tenant keys have no cascade, so a purge names each child table by hand and can forget one | nothing | no |
| the admin's **Restaurants, Owners, Settings, Billing & plans, Recycle bin** or the platform **Live floor** | `verify:admin-restaurants` ← every T16 fault was a screen quietly disagreeing with the code under it: one shared debounce timer losing a "Saves on its own" value when its row collapsed, a restaurant whose owner is suspended or binned reading as having NO owner (the route lists only ACTIVE owners), and a floor tile that did nothing and said nothing when the browser blocked its pop-up. | nothing | no |
| the admin's **money view** — Platform analytics, Platform revenue, Customers, the Bill ledger | `verify:admin-money -- --base <url>` ← the eight T18 faults: both ends of a date window pinned to IST (a "19 Aug → 19 Aug" window found 30 bills of 181), only the newest reply allowed to land (a 30-day label over a 7-day number), a drill-in renaming every label, and every column of a row on screen at 360px. Sections A–B run without a server; the rest drive the real console on the admin cookie and write nothing, ever. | app running | no |
| an admin route that DECIDES something — a gate, a lock, or a save that reports back | `verify:admin-refusals` ← two shapes of the same mistake: a refusal must FAIL CLOSED (the banquet bill-number lock read `Number(issued.count) || 0` with the error unchecked, so a passing database hiccup said "no bills issued yet" and let a live series' starting number move after bills had gone out on it), and a save that landed NOWHERE must not say "Saved" (the Access endpoint drops unknown keys, and two of its four branches rewrote the column with its own value and showed a green tick). | nothing | no |
| **any handler under `app/api/admin/*`** — a new one, or the shape of an old one | `verify:admin-api-a` ← the four rules, handler by handler: the sign-in gate runs BEFORE the first database call (CLAUDE.md counts the routes that grep `tokenIsValid`, and a count says nothing about ORDER), named columns instead of `select("*")` on a console read, a bounded row limit, and an honest failure. | nothing | no |
| the admin's diagnostics screens — System health, Audit & logs, Repair & support, Rate limits, Staff online, Usage & cost | `verify:admin-health` ← the rule it exists for: **a page that could not ask must not say "all clear"**. Four of these screens drew a green empty state over a failed read. It also refuses a hard-coded feed limit (the "showing the latest N" notice would then disagree with the query), any timer under the 60s backstop, and any money figure on a screen that must show none | nothing | no |

## 8 · Any write endpoint, anywhere (`app/api/**/route.ts`)

| you touched | run | needs | writes |
|---|---|---|---|
| **added or changed ANY write** | `verify:clash-coverage` (say what you edited from), `verify:floor` (drop the floor snapshot), `verify:taps` (never a silent return) | nothing | no |
| ↳ *(`verify:clash` is kept as a short alias for the same thing — the file is `scripts/verify-clash-coverage.mjs`)* | — | — | — |
| an order write | `verify:order`, `verify:order-retry`, `verify:closed-session` | mixed | some **YES** |
| anything that lowers a bill | `verify:audit` ← every money change leaves a record | nothing | no |
| **deleting a bill**, or anything that would delete more than one at a time | `verify:one-bill-delete` ← bulk bill-deleting was removed on the owner's instruction (2026-08-21). One bill per request, ENFORCED on the session (a bill is a session — there is no `bills` table), and R27 still holds: `canDeleteBill()` is true for the Aevidine admin console only, so a restaurant cancels and never deletes | nothing | no |
| a GUEST or STAFF-PANEL api route (`app/api/menu`, `app/api/editor`, `app/api/kitchen`, `app/api/tablet`) | `verify:panel-api` ← the scoping, gating and shape rules the T10 sweep put back, so they cannot quietly come back out | nothing | no |
| a reply we send to an outside system | `verify:outbound` | `.env.local` | no |
| behaviour when the server is overloaded | `verify:busy` | starts its own local server | no |
| behaviour with no internet | `verify:offline`, `verify:outbox`, `verify:warm-shell` | mixed | no |
| `public/offline.html` — the last-resort screen | `verify:offline-retry` ← it must keep ONE backing-off retry loop however many times the device says it is back, and must never blame the wrong side | starts its own local stub | no |
| a read about EVERY restaurant in an owner's estate (or the admin's whole platform) | `verify:id-chunks` ← 800 uuids is 29.6 KB of URL and PostgREST answers "Bad Request"; a select with no `.limit()` is silently capped at 1,000 rows. Either way the estate comes back SHORT with no error — a restaurant missing from the owner's own sidebar, a module reading as OFF, activity hidden that they may see. Route it through `lib/inChunks.ts` (measured limits are in its header) | nothing | no |
| a route that must require a login | `verify:read-guards`, `verify:server-only` | nothing | no |
| anything that returns a guest's session data to STAFF | `verify:guest-pass` ← a diner's access pass (`session_members.token`) is their whole identity; it must never ride along in a staff payload | nothing | no |
| a DEADLINE on anything a BROWSER runs — a fetch timeout, an abort signal | `verify:abort-guard` ← READING `AbortSignal.timeout` **throws** on a browser that lacks it, so `?? AbortSignal.timeout(ms)` does not skip the deadline, it throws out of the request. Five files in this repo already feature-test it; `lib/supabase.ts` — the client every browser database read goes through — did not, and with the API absent a guest's dish page rendered 17 characters instead of 627 and made zero of its 23 Supabase reads (T25 sweep, 2026-08-21) | nothing | no |

## 9 · Database — `supabase/migrations/*.sql`

| you touched | run | needs | writes |
|---|---|---|---|
| **created a new Postgres function** | `verify:grants` ← a new function is PUBLIC-executable by default | `.env.local` | no |
| a one-time migration that rewrites existing data | `verify:grants` — and wrap it in `lfh_already_applied('<key>')` or a re-seed applies it twice | `.env.local` | no |
| **CREATE OR REPLACE of a function that already existed** | `verify:fix-survives` ← it asserts every earlier fix is still in the NEWEST definition. Three rewrites have silently dropped one (203/215 put a flat 5% tax back for 55 migrations; 190 dropped the pay-later day from four reports) | nothing | no |
| a table storing a guest's phone number | `verify:personal-data` | nothing | no |
| session / table ownership | `verify:table-ownership`, `verify:two-parties`, `verify:lifecycle`, `verify:closed-session` | `.env.local` | **YES** |
| realtime breadcrumbs (`lfh_rt_emit`) | `verify:realtime` | `.env.local` | **YES** |
| anything at all, before a release | `verify:db-parity` ← the two databases must agree | `.env.local` | no |
| **applied ONE migration by hand** (`scripts/run-migration.mjs`) | `verify:run-alone` ← that script's header promises "CREATE OR REPLACE / IF NOT EXISTS are safe to re-run", and for a file whose objects a LATER migration removed it is not. Running 005/015/036 alone once re-created 7 pre-tenancy overloads (5 anon-callable) and reverted 5 function bodies. Also checks no table went back to guessing the restaurant, and that the issued-bill lock has not drifted | `.env.local` | no |
| **retired an object** (dropped a function, policy or trigger a migration still creates) | `verify:run-alone` ← the file that creates it must end by removing it again, or a single-file run puts it back. Migrations 099, 281 and 297 each patched only their own case | `.env.local` | no |
| **a new RPC that takes `p_restaurant_id`**, or a new call to one | `verify:rpc-scoped` ← 25 of them still DEFAULT the restaurant to #1, so a caller that forgets does not fail, it answers for French House. That is how the admin floor showed the wrong restaurant's tables | nothing | no |

## 10 · The panels' static assets (`public/panels/**`)

| you touched | run | needs | writes |
|---|---|---|---|
| any `.js` or `.css` under `public/panels/` | `verify:panel-cache` ← the `?v=` must be the file's own content hash, or staff run a weeks-old panel | nothing | no |
| any of the SHARED panel files every staff panel loads (`public/panels/*.js` — the write queue, the connection pill, the back-button manager, the undo card, the guest bell, the settings drawer, the issue modal, the theme, the error log) | `verify:panel-plumbing` | nothing | no |
| …and AFTER DEPLOYING any of those shared panel files | `verify:panel-plumbing-live -- --base <url>` ← runs the same checks against the bytes the SITE is really serving, and prints the served content hash beside the local one. A green guard on a laptop proves the source is right, not that the site is: the panels are static assets behind a cache `vercel.json` lets go stale for up to 24h, and a device has twice run a weeks-old panel whose bug was already fixed. GET requests for static files only — signs in to nothing, writes nothing | app running | no |
| moved, renamed or deleted a panel HELPER function | `verify:panel-scope` ← a helper must exist where the code that calls it can see it; a panel that throws on load is a blank screen for staff | nothing | no |
| a payload that hands a `settings` row to a panel, or `lib/panelSettings.ts` | `verify:panel-secrets` ← the row carries the delivery apps' connection keys; a panel must never receive them (T17 finding F1) | nothing | no |
| an HTML comment, a `<style>` block, a CSS comment | `verify:ui` | nothing | no |

## 11 · Tooling, docs and the rules themselves

| you touched | run | needs | writes |
|---|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, or any doc CLAUDE.md points at | `verify:pointers` | nothing | no |
| `.claude/settings.json` or a permission rule | `verify:no-ask` | reads `~/.claude/CLAUDE.md` | no |
| anything under `scripts/` or `tests/` | `verify:test-safety` ← our own tests must not trip the app's rate limits | nothing | no |
| a file's line endings | `verify:ui` (check 14) | nothing | no |
| `package.json` dependencies, or `package-lock.json` | `verify:deps` ← fails only on a **new** high/critical advisory; the parked ones are acknowledged by name inside the script | **the npm registry** (skips, never fails, when offline) | no |
| **the owner says "check the securities" / "check security"** — or you touched a login, a permission, or anything about one restaurant seeing another's data | **`docs/SECURITY-CHECKLIST.md`** ← his own 20-point list (kept 2026-08-16) **plus** the 8 points this app needs that the list never mentions. Read its wording warning FIRST. | mixed, per row | no |
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
| `load:ramp`, `stress*`, `db:replace-demo-history`, `db:vacuum-rebuild`, `seed-*` | these are not checks. They write. Read the header before typing the name. |

## What is NOT covered by anything

Honest gaps, so nobody assumes a green run means more than it does:

- **A green suite is not evidence the screen is right.** Every guard above reads code or data. Seeing
  it in a real browser, in the right role, on a non-flagship restaurant, is a separate step and it is
  in the Definition of done.
- `.claude/REQUESTS.md` staleness — nothing checks whether a listed request has since shipped.
- The owner-facing screenshots in `LEARN-MY-APP/screens/` — nothing notices when the UI moves past
  them.
