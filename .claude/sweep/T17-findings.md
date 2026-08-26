# T17 findings — the ADMIN's health, logs, issues & limits

Territory: `app/aevinite/{health,logs,issues,attention,rate-limits,repair,staff-online,usage}/**`.
500 phases (P08001–P08500), 496 ✅ · 4 ⏭ (reasons in the ledger) · 0 ❌ on the second pass.
**Fourteen problems, all fixed in this branch, one commit each.** Guard:
`npm run verify:admin-health` (`scripts/verify-admin-health-logs.mjs`).

Four of the fourteen are the same shape and are the reason this territory needed a sweep:
**a screen that could not reach the server drew a green all-clear over the silence.** On the
Repair hub that read "All clear — no unresolved problems" and "No rate limits have been
reached." at the exact moment the admin most needed the truth.

| # | severity | who is worse off | confirmed? | fixed in |
|---|---|---|---|---|
| 1 | **high** | the admin — told the platform is quiet when the page could not ask | **watched happen** (route made to fail, then restored) | `repair/page.tsx` |
| 7 | **high** | the admin — four green all-clears on a page that never loaded | **watched happen** | `rate-limits/page.tsx` |
| 2 | medium | the admin — reads 19 problems / 200 log rows as the whole story; all three feeds are AT their cap right now | **watched happen** (50/200/200 returned) | `repair` + `logs` |
| 3 | medium | the admin — "Showing French House only" over another restaurant's complaints and at-risk rows | **watched happen** | `repair/page.tsx` |
| 14 | medium | everyone — an amber warning bar up on every single load teaches him to stop reading amber | **watched happen** (23 of 36, 20 of them closed restaurants) | `health/page.tsx` |
| 13 | medium | the admin on a phone — five table names and not one number | **measured** (card 296px, row forced to 540px) | `health/page.tsx` |
| 5 | medium | the admin — the one screen for limits refuses to offer the answer its own note promises | code-read, then confirmed against the server action | `rate-limits/page.tsx` |
| 8 | low-med | the admin — a wrong-password alert offers only "Block", not "let them retry" | code-read + server action confirmed | `rate-limits/page.tsx` |
| 9 | low-med | the admin — "Checking…" for ever after the check already failed | **watched happen** | `health/page.tsx` |
| 12 | low-med | the admin — four headline numbers stuck on "…" after a failed read | **watched happen** | `usage/page.tsx` |
| 4 | low | the admin — a red gauge beside the words "No rate limits have been reached" | **watched happen** | `repair/page.tsx` |
| 10 | low | the admin — a dish to fix with no clue whose menu it is on | **watched happen** (forced response) | `health/page.tsx` |
| 11 | low | everyone — a permanently amber "note" badge | **watched happen**, both skins | `staff-online/page.tsx` |
| 6 | low | the platform's egress — one deep link pulled 200 log rows twice | **watched happen** (2 calls → 1) | `logs/page.tsx` |

Improvement built: **15** — the Usage & cost headline strip on a phone (four numbers, two per
row, no stray vertical rule). `usage/page.tsx`.

## 🔗 HANDOFF — the real fix lives in another terminal's file

**H1 · `app/api/admin/health/route.ts` — two admin screens disagree about how many staff there are.**
System health reads "Staff online (last 3 min) 2 / 58"; Usage & cost reads "Staff (active) 49".
The health route counts every `staff_users` row with `active = true`, with no restaurant filter,
while `lfh_admin_usage` counts them per live restaurant — so staff attached to a binned restaurant
(or to none) are in one number and not the other. The health route already filters `restaurants`
by `deleted_at is null`; its staff read should be scoped the same way, or the label should say
"including staff with no live restaurant". Low severity, but it is two numbers for one thing on
two screens the admin reads together.

**H2 · `lib/errorSignature.ts` — the same fault can occupy two tiles on the Repair board.**
Live right now: "Uncaught ReferenceError: PRINT_SETUP_URL is not defined @ app.js…12176" and
"PRINT_SETUP_URL is not defined @ app.js…12176" are one bug from one line, recorded twice with
and without the browser's `Uncaught ReferenceError:` prefix, so `errorSig()` keys them apart and
the board shows two tiles (one of them ×8). Stripping a leading
`/^(Uncaught )?(\w*Error):\s*/` in `errorSig` would merge them. Not changed here: that function is
shared by the alarm path, the Send-to-Claude guard and the fixed-problem record, so it belongs to
whoever owns that file.

**H3 · wherever guest-menu, tablet and owner errors are recorded — the tile has no restaurant.**
Five of the nineteen tiles on the board name no restaurant at all, including three from
`/r/french-house/menu`, whose URL says exactly which restaurant it is. Their `staff_actions` rows
were written with a null `restaurant_id`. The Repair page renders what it is given, so the fix is
at the recording end. Consequence: those tiles cannot be narrowed by the restaurant picker and
offer no "Go to that panel" button.

## NOT reported (deliberate, checked against the pre-empt list and `docs/REJECTED-IDEAS.md`)

- Ban and manager-PIN security settings — queued, deliberately unbuilt.
- Backup stacks are silent; no alert buzzes here.
- Tests cannot raise alerts.
- Sentry — the `errlog` network-noise filter and the removed error-checking are both left alone.
- The panels grid's sideways scroll and the Operations table's — T7's deliberate call (you read
  down those columns). Only the two-column key -> value lists were changed.
- R18: no second/deep health check was added, and `/api/health` was not touched.

---

# SWEEP #7 — the same territory, re-run and re-planned (2026-08-27)

Branch `sweep7/t17-admin-health` · dev server 4217 · nothing written to any database.

## The re-run of sweep #6's 500 rows

**495 ✅ · 4 ⏭ · 1 ❌ — and ONE REGRESSION.**

**REGRESSION · `P08095`** — *"Marking resolved flips the whole repeat-group locally the same way
the server does."* Green in sweep #6, red now. `/api/admin/resolve-error` moved to the shared
`errorSig()` group (it folds away order ids, row counts and the browser's own
`Uncaught ReferenceError:` prefix); `app/aevinite/logs/page.tsx` was left comparing `detail`
character for character. Measured on the live error feed: of 42 groups, 3 hold rows whose text
differs — the worst being **nine rows of one fault written two ways**. So one press of "Mark
resolved" cleared nine rows on the server and struck through only the exact matches. Fixed as
**item 2**, and the guard now asserts the shared function *by name* rather than the client's own
shape — which is exactly why it did not catch this.

**Newly red · `P08201`** — `app/api/admin/custlog/route.ts:33` reads
`sb.from("blocklist").select("*")`: ten columns for the six the Customers tab renders, one of them
a banned guest's `unban_phone`. Bounded at 200 rows, so the cost is small. **Not fixed here** —
that file belongs to the admin-API terminals. Carried into the chat report as a decision item.

**11 expectations moved** — System health was rebuilt on 2026-08-20 (R42), so the pill strip those
rows were written against is gone. The rules they protect all still hold, on the check rows that
replaced it; each row says so and keeps its id.

**All three handoffs from sweep #6 are now BUILT.** H1 — System health and Usage & cost disagreed
about the staff count; the health route now filters staff to live restaurants. H2 — one fault sat
on the board as two tiles; `errorSignature.ts` now strips the browser's own `Uncaught
ReferenceError:` prefix. H3 — five tiles named no restaurant; `app/api/log/client-error` now
derives the restaurant from the guest URL's own slug, and its header comment cites those exact
five. **Measured on today's board: 0 of 6 tiles carry a null restaurant.**

## The 500 new rows · `P23101`–`P23600`

**499 ✅ · 1 ❌** (that one is `P23269`, the same `select("*")` as `P08201`).

Six problems found, all fixed, one commit each:

| # | severity | who is worse off | confirmed? | fixed in |
|---|---|---|---|---|
| 1 | **high** | the admin — "0 open complaints" over a list the page could not read, and "…" for ever beside it | **watched happen** (both routes made to fail) | `repair/page.tsx` |
| 2 | **high** | the admin — presses Resolve, watches half the group stay red, cannot tell if it worked | **proved on the live feed** (9 rows / 2 texts) | `logs/page.tsx` |
| 3 | medium | the admin — 8 reports he set to come back tomorrow look exactly like live crashes | **watched happen** (8 of 200 rows) | `logs/page.tsx` |
| 4 | low | the admin — "8 reports" under a banner saying one restaurant; 7 were hers | **watched happen** (8 vs 7) | `repair/page.tsx` |
| 5 | low | the admin — a list, a count and a button that mean three different sets | code-read (no fix records on this stack) | `repair/page.tsx` |
| 6 | low | everyone — 28 panel cells in the alarm colour for a state the page calls normal | **measured**, both skins | `health/page.tsx` |

Guard: `npm run verify:admin-health` now holds **21** fixes. Each item's assertions are inside
that item's own commit, so vetoing an item takes its guard with it.

## Two traps recorded so nobody re-derives them

1. **A dev-server page fires every request twice** — Next 16 defaults `reactStrictMode` on. Judge
   the shape of the calls, never the count.
2. **Route interception is defeated by the service worker** — a `page.route` handler does not see
   a request the app's own service worker answers. Five fault-injection checks in this run were
   falsely green until the context was opened with `serviceWorkers: "block"`.
