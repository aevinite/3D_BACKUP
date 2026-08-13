# Project: Aevidine — multi-tenant restaurant SaaS (dev stack "backup_Menu")

Next.js 16 / React 19 restaurant platform; 3D dish viewer is the differentiator. The owner is a
beginner who vibe-codes: teach as you build, plain language, why before how.

> 📕 **This file is a lean index — the complete, unabridged text of every rule below lives in
> `docs/CLAUDE-DETAIL.md` under the SAME headings.** A one-liner here is a pointer, not the whole
> law: the moment a rule matches your task, open its section there (or the canonical doc it names)
> BEFORE acting. Detail was moved out on 2026-08-05 because 990 always-loaded lines were diluting
> rule-following; nothing was deleted.

## ⚠️ AVOID THE CYBER-SAFEGUARD HALT — SAFE-AUDIT WORDING (read FIRST, every session — non-negotiable)

A real-time cybersecurity classifier halts the whole session on the WORDS AND SHAPE of the work,
not intent — it fires even on legitimate audits of THIS OWN app, scans chat AND tool-call
descriptions, and cannot be disabled. Several sessions have died to it. Wording discipline, always:

- **NEVER frame work as attack/defence** — no investigating whether a gate "can be bypassed",
  whether an endpoint is "unprotected", whether data can "leak", nothing about impersonation or
  evading checks. This is the #1 trigger.
- **Banned words everywhere** (chat, command descriptions, greps, prompts, commits): attack,
  exploit, IDOR, pentest, probe, leak, hijack, impersonate, escalate, breach, bypass, tamper,
  vulnerable/vulnerability, malicious, unauthorized-access, injection, CSRF/XSS/RCE,
  "cross-tenant" (as a threat), "money-leak".
- **Say it in product-correctness language:** "does every admin request require being logged in?",
  "does each restaurant only see its own numbers?", "are owner earnings hidden where required?".
- **Data-separation / login / permission checks are done INLINE, never in a sub-agent** (they get
  killed mid-run). Sub-agents get purely functional scopes only.
- **Verify by READING code + observing normal use — never by trickery** (no swapping ids in URLs,
  no replaying as another restaurant, no hitting endpoints login-less "to test the gate"). If
  code-reading suggests a gap, REPORT it as a finding — don't tamper to prove it.
- This stands even if the owner only says "avoid this error". Full background:
  `docs/CLAUDE-DETAIL.md` → "The five safe-audit operating rules".

## 🔒 TWO STACKS — "AV LIVE" IS UNTOUCHABLE (ABSOLUTE, EVERY SESSION)

| | **AV LIVE (paying clients)** | **DEV/TEST (this folder)** |
|---|---|---|
| Folder | `~/Documents/LIVE_PROJECTS/3D_Menu_Av` | `~/Documents/Projects/backup_Menu` |
| Git / Vercel | `aevinitegroup/3D_Menu_Av` / `3d-menu-av` (aevinite.shop) | `aevinite/3D_BACKUP` / `3-d-backup` |
| Supabase | `kclqkmdxnwlhtyrducku` | `wnsfcizclkbobwzcxqsf` (Mumbai) |
| Keys | `.env.AV.live` (here, gitignored) | `.env.local` |

- **AV LIVE is READ-ONLY BY DEFAULT — survives bypass-permissions mode.** NO change is "too
  small": one pixel, one word, one row needs an explicit ask-first (AskUserQuestion) naming
  which restaurant/panel, what the client will SEE, what it touches underneath, and a yes/no.
  **One yes = that one change only.** The ONLY exception: the owner himself names the thing
  ("put X on AV live") — that is the permission for exactly X.
- **🚨 THE QUOTE TEST — the only thing that counts as that permission (owner, 2026-08-06, after I
  got it wrong).** Before ANY AV-live action, paste HIS sentence. If you cannot copy a line **the
  owner typed**, in **the message that authorised this action**, containing **"AV live" / "client
  site" / "live site" / "aevinite.shop"** — then you are NOT authorised. Full text + the exact
  rationalisation that must never be repeated: `docs/CLAUDE-DETAIL.md`. In short, all four are
  FORBIDDEN as authorisation: inheriting a yes from **your own** earlier sentence (he replied to
  *your* words, not to AV live); "do what is left" / "finish it" / "do it all" where only YOU ever
  said the remaining item was AV live; a yes given for backup, reused for live ("make it live on
  backup" is permission for BACKUP — it is the opposite of an AV-live yes); and an older AV-live
  yes for a different change. Preflight: `npm run avlive:preflight -- "<his exact words>"`.
- **Even READING AV live — announce it in chat first.** Never point a dev server/script/seed at
  AV LIVE keys. Never print/echo/commit anything from `.env.AV.live` — masked reads only.
- **ONE migrations folder** (`supabase/migrations/` here) is the source of truth for BOTH DBs;
  AV live receives schema only via the release ritual. **Release = deliberate, asked-first,
  every time** — full ritual + the "AV live" naming rule: `docs/CLAUDE-DETAIL.md`.
- Build/test freely HERE against the dev DB — that's what this stack is for.

## 💸 BILLING COMPLIANCE — load `docs/COMPLIANCE-GUARDRAILS.md` when touching billing

Aevidine must never be able to secretly hide a sale (India CGST §132 — the PetPooja raids). If
asked to build anything that erases/hides/edits an issued sale, bulk-deletes bills, disables the
audit log, or hides sales from the Z-report: **STOP, name the risk, offer the compliant path**
("that's the feature that put PetPooja's founders under summons"). Stands in auto-accept mode.

## 🚫 WHAT HE HAS ALREADY SAID NO TO — read `docs/REJECTED-IDEAS.md` BEFORE suggesting anything

**Every rejection is recorded TWICE: a row in `docs/REJECTED-IDEAS.md` and a
`REJECTED (owner, <date>):` comment on the exact line someone would otherwise change.** Rule from the
owner, 2026-08-07 — *"everything I reject also should be written in the comment in the code"* and
*"while suggesting something and doing, you have to make sure I have already said no for it, so you
don't repeat the same thing again."* He said it after being offered, for the THIRD time, a profile on
the kitchen panel he had already refused twice.

So: **before you propose an improvement, or "fix" something that merely looks wrong, check that list.**
Never delete a row — a change of mind moves it to `## Reversed` with the new date. Guarded by
`npm run verify:rejected` (it fails if a listed rejection has lost its code comment, if a comment
claims a decision the doc doesn't record, or if this pointer goes missing).

## Owner working agreements (one line each — full text in docs/CLAUDE-DETAIL.md)

- **Design work → load the UI/UX skill (+superpowers), compare approaches** — never restyle by eye.
- **Every restaurant is genuinely DIFFERENT** — own theme/intro/branding; nothing may show
  restaurant #1's branding on another tenant (recurring bug: IntroSplash leaking).
- **Admin = top power, invisibly:** from `/aevinite`, reach any restaurant's panels, no password,
  no hint shown to the owner.
- **Keep `.claude/REQUESTS.md` current** — every owner request; tick only when built AND verified.
- **Verify across ALL panels + realtime** (owner/admin/manager/kitchen/tablet), desktop AND ~390px.
- **shadcn/ui CLI is BLOCKED on Tailwind 4 — do not reopen**; hand-build to existing patterns
  (the shadcn MCP is fine as reference).
- **Verify where the owner looks: `localhost:4000`, with cache-busting** (`app.js` caches in the
  iframe). ONE codebase: main. Never a worktree dev server on 4000.
- **Reference app** `~/Documents/LIVE_PROJECTS/3D_Menu_Av` is also the gold-standard
  single-restaurant behaviour source: READ-ONLY, copy behaviour per restaurant into here.
- **Be brutally honest** — redirect the owner when he's heading the wrong way; he wants correction.
- **Protect the DB/connection budget:** pooled connection always; realtime channels drop when a
  tab is hidden/idle and resubscribe on focus; index every filtered column; no full-scan analytics.

## SaaS architecture (approved 2026-06-25 — binding; full text in docs/CLAUDE-DETAIL.md)

One shared DB, POOL model: every tenant row carries `restaurant_id`, **RLS enforces isolation at
the DB level** (never app-code filtering alone). Schema changes are ADDITIVE (default → backfill →
enforce). Scoped queries only (`WHERE restaurant_id=…`), realtime keyed per restaurant, dashboards
read pre-aggregated tables, business rules live in RPCs/route handlers. Routing is path-based
(`/r/<slug>/menu?table=N` — the QR encodes the slug in the PATH and the table as a query; the route
folder is `app/r/[restaurant]/…`, there is no `/t/` segment) through ONE resolver (`lib/tenant.ts`)
built to switch to subdomains by config, not rewrite. Redis/queues/replicas are Stage-3 — do NOT add early.

### EVERY new feature = a toggleable, permission-scoped MODULE — the 11-point checklist (apply automatically)

1. Admin entitlement per restaurant, default OFF (`settings.features` / `useFeatures()` pattern).
2. Feature on/off is ADMIN-controlled, not the owner.
3. Permission-scoped, least-privilege — no blanket access for any role.
4. Backend-first: rules in RPCs/route handlers scoped by `restaurant_id`; indexed; realtime per restaurant.
5. Surface in the right panels (admin toggle? owner control? operational UI?).
6. Render nothing when the flag/permission is off.
7. Great, beginner-simple UI/UX.
8. Register every new popup/drawer in the back-button manager (rule below).
9. **Egress-safe (NON-NEGOTIABLE):** scoped read with column list + `.limit()`, targeted `rt_emit`
   breadcrumb, per-table fetch + merge dedup'd by row id, no poll faster than the 60s backstop.
   Playbook: `docs/SAAS-EFFICIENCY-PLAYBOOK.md`.
10. **Works offline:** screen opens/reads offline (add the API family to `public/sw.js` →
    `DATA_PATHS` if new), every write goes through the panel `api()` / guest outbox, saved data is
    labelled (`components/OfflineNotice.tsx`). Guide: `docs/OFFLINE-SYNC.md`.
11. **No silent overwrites:** first save wins, loser gets told — send
    `{ expect: { table, id, fields } }` at the call site (`lib/clash.ts`). Keep
    `node scripts/verify-clash-coverage.mjs` green.

## Stack & app map

- Next 16.2.6 App Router (async params), React 19.2.4, TS strict, Tailwind 4, GSAP (npm only).
  `<model-viewer>` via CDN inside `components/PublicModelViewer.tsx`. GLBs on Supabase Storage.
- **ONE app on port 4000** (`npm run dev`). Panels are routes: `/menu` guest · `/aevinite` admin
  console (22 pages, password-gated; there is NO `/admin` route) · `/manager` + `/editor` (both
  embed `public/panels/editor/` — a "manager panel" bug = edit `app.js` there) · `/kitchen` ·
  `/tablet` · `/owner` (16 pages) · `/login`, `/staff-login`. Panel APIs live at
  `app/api/<name>/[...path]/route.ts`.
- **55 page routes** (`find app -name page.tsx | wc -l`) and **THREE guest menu doors** — `/menu`,
  `/r/<slug>/menu`, `/q/<code>` — every guest rule must hold in all three (PR #761's lesson).
- Menu data via `lib/menu.ts` (anon key); categories/filters are DB-driven; multilingual via
  `lib/i18n.ts`. Re-seed: `node scripts/seed-supabase.mjs` — ⚠️ it overwrites editor-made DB
  changes AND **re-runs EVERY file in `supabase/migrations`, in filename order, with no ledger**.
  Prefer running just the one migration. Two files rewrote data on a second pass and are now
  guarded by `lfh_applied_once` (mig 307): **043** multiplied all money ×84 again (₹36.6M →
  ₹3.08bn, measured) and **093** replaced restaurant #1's 24 manager-permission keys with 5.
  A NEW one-time migration that rewrites existing data must wrap itself the same way —
  `IF lfh_already_applied('<key>') THEN RETURN; END IF;` — or a re-seed will apply it twice.
  `verify:grants` fails if either guard is removed.

## Security gate (verified per-route 2026-08-04/05 — full route list in docs/CLAUDE-DETAIL.md)

**There is NO `middleware.ts` — deliberate.** The gate moved per-route: `/aevinite` layout +
all 48 `/api/admin/*` routes check `tokenIsValid` before any DB call (re-counted 2026-08-11, handler by handler;
`find app/api/admin -name route.ts | wc -l` must equal the number that grep `tokenIsValid`); panel APIs use
`requireRole()` (re-checks entitlement every request); `/api/owner/*` uses `ownerScope()`.
The deliberately-public list is COMPLETE in the detail doc — an API route absent from it must
have a gate. `ADMIN_PASSWORD` must be set in Vercel env. If you re-introduce a middleware,
update the detail doc's section in the same commit.

## Operational rules — one line each; open the detail/doc BEFORE working in that area

- **Feature switches (mig 035):** `settings.features` + `useFeatures()`; four backend-only flags
  (`verification`, `payments`, `aggregators`, `gst_invoice`) stay invisible in every UI.
- **KOT/bills (migs 036–038):** daily `kot_no`/`bill_no`; discount stored apart from totals.
  Which of the THREE numbers is which, and why bill/invoice series have honest gaps: `docs/NUMBERING.md`.
  **New Postgres functions are PUBLIC-executable by default** — every staff-only fn needs
  REVOKE/GRANT (mig 038/267 lesson); `verify:grants` guards it.
- **3D loading:** `lib/modelLoader.ts` singleton on `globalThis` — it is what makes "no re-fetch
  on navigation" work. Event bus: `lfh:*` CustomEvents. Don't re-suggest Draco (done).
- **Charts are DYNAMIC, never a lonely 1-bar plot:** route through `populated()` / `NotEnough` /
  `ScrollX` in `components/owner/Charts.tsx`; sparse timelines auto-drill to finer buckets.
- **Analytics/dashboards use the compute-on-view snapshot cache** (`lib/ownerCache.ts`,
  `cachedOwnerPayload`, fingerprint-gated; Refresh forces live) — never recompute per open, never
  a blind cron.
- **🚦 Never trip the app's own rate limits while testing:** sign in ONCE per session
  (`scripts/sweep/login.mjs` `loginAs()` caches; `adminHeaders()` for admin APIs — never POST
  JSON to `/api/staff-login`); a test that must hit a wall cleans up its rows the same run.
  Enforced by `npm run verify:test-safety` (auto PostToolUse hook on `scripts/`/`tests/` edits).
- **👆 A tap must never vanish in silence:** no silent `return` on a user action — hold it
  (`tapGuard().act()`), or refuse visibly; never leave a promise unresolved; overlays with
  `.confirm-overlay` stamp `data-closing`; branch on server reason CODES, not prose.
  `npm run verify:taps` runs as a hook on panel edits.
- **🪑 A table shows only its own party:** ownership is the SESSION, never the table number; an
  order can never outlive its session (close-trigger cleans up, mig 232). `verify:table-ownership`.
- **🧾 Floor reads are shared (1.5s window):** EVERY write handler calls `invalidateFloor(rid)`;
  a `?table=N` refetch is never shared; don't "simplify" mig 238 back (measured). Touching
  `lfh_table_view_summary` → `node scripts/verify-summary-parity.mjs`, not hand-review.
  ⚠️ AV live does NOT have mig 238 — needs its own ask. `npm run verify:floor`.
- **🌊 A rush slows the app, never takes it down:** change-detectors never scan the table they
  guard; 5xx/timeout = queue like offline (4xx = tell the person); every write has deadline +
  jittered backoff; no fixed fast poll while reads fail (`LFH_RT.catchUp()`). `verify:busy`.
  `verify:everything` refuses to start while another run is alive (pid lock).
- **Offline layer is LIVE — keep extending:** read `docs/OFFLINE-SYNC.md` before touching a panel
  or write endpoint; every staff write is wrapped `withIdempotency(...)` + goes through `api()`
  (X-LFH-Action-Id); on the guest side ONLY place-order is queued so far — don't rebuild the
  staff outbox on a misreading.
- **🔑 Access model v2 (the 4-rung ladder is RETIRED):** a toggle exists only where the owner
  listed one (`lib/accessTree.ts`); only the ADMIN holds permissions; hiding is never the only
  guard. Spec: `docs/ACCESS-MODEL.md`; **still-unbuilt owner asks: `docs/ACCESS-REDESIGN-SPEC.md`
  (12 open `☐`)**. Guards: `verify:access`, `verify:everything` (`--list` for
  the phase map — never hard-code phase numbers). **French House is written to; Aangan is the
  READ-ONLY control at factory defaults.**
- **👤 One profile shape for every person WHO HAS ONE — owner, manager, waiter. KITCHEN HAS NO
  PROFILE** and that is deliberate (owner, 2026-07-29 and re-confirmed 2026-08-05: *"Don't need
  the profile"*): `lib/staffProfileShared.ts` → `PROFILE_ROLES`. Do not "fix" the kitchen rows on
  `/owner/staff`. Otherwise read `docs/STAFF-PROFILE.md` before adding anything about a person;
  one permission list feeds profile + Access tab + write allow-list (`lib/staffCaps.ts`); unknown
  keys are REFUSED.
- **Mobile back button:** every popup/overlay registers `useBackClose(...)` (guest) or
  `LFH_BACK.layer(...)` (panels) the moment it's built — never hand-roll pushState/popstate.
- **📍 EVERY problem / bug / improvement / idea you list MUST say WHERE IT LIVES** (owner,
  2026-08-12, STANDING — he was left "completely lost" by a list that named files only). Each item
  gets, in this order: **the panel** (guest menu / manager / kitchen / tablet / owner / admin /
  none-it's-backend-only) → **the exact screen or tab** ("Bills tab", "Tables floor", "Reports →
  Sales", "Recycle bin") → **what the person would SEE** → only then the file. If it has no screen,
  say "backend only, nothing on screen" in those words — never leave him guessing which log, which
  audit, which history. "History file" style shorthand is banned: name it as
  `supabase/migrations/099…` AND say it is a migration file, not a log or an audit screen. Full text
  + the panel→file map: `docs/CLAUDE-DETAIL.md` → "Where it lives".
- **📋 Any list he must CHOOSE from uses the decision format** (owner, 2026-08-13, STANDING): per item
  — Where (panel→screen→what he'd SEE) · What it is · If yes · If no · Effort · Risk — numbered, grouped
  *can-do-now* / *needs-you*, ending with your recommendation. `docs/CLAUDE-DETAIL.md` → "The decision format".
- **✅ You check your OWN work — the work-checker is RETIRED and DELETED** (owner, 2026-08-13, STANDING;
  never recreate it, never hand verification to a sub-agent): run it and see the result, prove you broke
  nothing else, prove you disturbed no other session, report honestly with the output.
  `docs/CLAUDE-DETAIL.md` → "You check your own work".
- **🗑 Finished paperwork is deleted the day it's finished** (owner, 2026-08-13, STANDING) — closed audits,
  spent handoffs, temp plans, empty folders, looked-at screenshots. Don't ask; say so in the reply. Only a
  LIVE rule, a `⚠️ HISTORY`-bannered doc, or another session's uncommitted work survives.
- **🙋 The owner is NOT the test subject:** drive the exact flow yourself first (headless),
  screenshot the place HE named, assert the RENDERED thing — never hand over on "the code says so".
  "Check phone/tablet view" (only when he says it) = `node scripts/view-device.mjs` (A35 emulation,
  logs in as the diag staff user; screenshots to Desktop).
- **A green suite ≠ the screen is right:** `verify:ui` (hook), `verify:live -- --base <url>` after
  every deploy; AV-live verification is READ-ONLY.
- **Charts/data/egress feature work** → invoke the `data-cost-guard` skill BEFORE writing queries.
- **🗑 NEVER ask permission to delete or remove anything here — just do it and report it** (owner,
  2026-08-06, STANDING; full text in `~/.claude/CLAUDE.md`). Files, folders, branches, worktrees,
  screenshots, temp scripts, dev rows, stale doc sections, dead code. Holds in **every** permission
  mode and **especially bypass-permissions**, where a question defeats the mode he chose. Don't offer
  removal as a question, don't leave junk "to be safe". **Ask-first survives for four things only,
  and they are HIS rules:** the AV-live stack · the Brain vault (`~/Brain`) · another live session's
  uncommitted work in this shared folder · force-pushing `main`. Guarded by
  `npm run verify:no-ask` (auto-runs after any settings/CLAUDE.md edit) — it fails if an `ask`
  permission rule reappears, if the standing order goes missing, **or if the AV-live `deny` rules are
  ever removed in the name of "stop asking me"**.

## 🚦 Deploying & the folder ladder (pointer — invoke `ship-safety` AT the moment of deploying)

- **Deploy lock:** `.claude/deploy.lock` ritual (wait if fresh → take → rebase + stage ONLY your
  files → deploy + verify → release). Never blind `git add -A` in the shared folder.
- **Backup-1 (`aevinite/3D_BACKUP`) is UPSTREAM** — nothing exists downstream (AV live, backup-2)
  that isn't merged into backup-1 `main` first. "First" = MERGED, not necessarily deployed
  (free-tier ~100 deploys/day cap — don't hammer it; deploy backup-2 as the live fallback:
  clean-checkout upload steps in `docs/CLAUDE-DETAIL.md`).
- **This Mac folder must never fall behind backup-1:** `npm run check:current` BEFORE any audit,
  plan, or "X is broken" claim. Syncing is NOT `git pull` in a shared folder — unrecognised
  modified files = another session's live work, leave them. Can't sync? Work in a worktree off
  `origin/main`. "Make it live" includes pulling this folder current after the merge.
- **Deployment target:** one repo → `aevinite/3D_BACKUP` → Vercel `3-d-backup` auto-deploys
  `main`. The old separate editor repo is retired.

## Known gotchas (one line each — stories in docs/CLAUDE-DETAIL.md `## Known gotchas` and `docs/PROJECT-HISTORY.md §12`)

- **Don't narrow `boardSig`** (kitchen/tablet redraw fingerprint) back to a field list — new
  volatile columns go in `RT_VOLATILE`; guarded by `scripts/verify-board-sig.mjs`.
- **"Blur" = frosted glass** (transparent bg + `backdrop-filter: blur(20px)`), written as a SINGLE
  unprefixed line — hand-adding `-webkit-` makes the build DROP the property.
- Supabase HEAD lies about Cache-Control — use GET with `Range: bytes=0-0`.
- **Secrets NEVER appear in chat — whole or partial** (sbp_/service-role/tokens): redirect
  `claude mcp` output to null; masked reads only. Treat a pasted key as compromised.
- MCP servers load from `~/.claude.json` / root `.mcp.json`, NOT `.claude/settings.json`;
  config changes need a full restart.
- **Light mode: which surfaces even HAVE it.** The GUEST menu has a toggle (`lfh_theme`, tenant
  menus default DARK). The manager / kitchen / tablet panels have one (`lfh_panel_theme`, default
  LIGHT) and **a staff member's choice is remembered when they reopen the panel** — verified on
  all three, 2026-08-05. The **owner console DOES have light mode** — its own ☀/🌙 button in the
  top bar (`OwnerShell.tsx`), stored as **`aevidine_skin`** (localStorage + cookie), and it
  survives a reload. `lfh_theme` is the GUEST key and indeed does nothing on `/owner`, which is
  what made an earlier note here say "dark-only, no toggle" — measured wrong, corrected
  2026-08-05: tapping that button turns the cards white, the text dark, and pushes the same skin
  into the embedded panel by postMessage (`useOwnerSkin` exists precisely because that drifted).
  DARK IS THE DEFAULT and the owner asked to keep it that way — that part stands. So light-skin
  checks on `/owner` are real and worth writing; drive the **`aevidine_skin`** toggle, never
  `lfh_theme`.
- Staff can run a weeks-old panel: `?v=` is a content hash — `verify:panel-cache`.

## Definition of done

- Type-check passes (**`npm run typecheck`** — `npm run lint` is bare ESLint and does NOT check
  types; it is a separate, also-required gate). 3D-loading changes → `node scripts/verify-cache.mjs` still
  passes. UI changes → seen running in Chrome (real app, right role, non-#1 restaurant too),
  never claimed from source alone. The relevant `verify:*` guards stay green.
