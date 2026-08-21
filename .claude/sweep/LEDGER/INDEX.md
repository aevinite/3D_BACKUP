# THE LEDGER — what Aevidine has actually been checked for

**This file is the master record of this product's testing, and the ID registry for every future
sweep. It is read FIRST, before a single new phase is written.**

Written by terminal 30 of sweep #6, 2026-08-22, against `origin/main` **aad569aa**.

---

## 🔴 READ THIS BEFORE PLANNING ANYTHING

Sweeps #1 to #5 each invented a **different** set of checks. So five runs sampled five different
slices of the product, every run "found something new", and the same ground went unchecked five
times over. Nothing converged.

Sweep #6 ended that by writing **13,000 permanent, numbered, re-runnable checks** into the
`T*.md` files beside this one. That investment returns **nothing at all** unless the next sweep
re-runs it. So:

1. **RE-RUN EVERY EXISTING ROW BEFORE WRITING ONE NEW PHASE.** All of them, top to bottom — not
   only the `❌` ones. Update each row's `result` column in place. **A row that was `✅` last time
   and is `❌` now is a regression, and it is the most valuable thing a sweep can find.**
2. **Only then add new IDs**, and only for ground these files do not already cover. Take the next
   free ID from the registry below and update the registry in the same run.
3. **Never reuse an ID. Never renumber anyone else's.** An ID means one specific check, forever.
   That is the only reason "re-run row P07423" is a sentence that means something.
4. **Close the coverage gaps at the bottom of this file before inventing anything new.** They are
   the next sweep's first assignment, not its last.
5. **Never trust a count typed into a document — including this one.** Re-run the commands in
   *How this file was computed*. Every count in the sweep-#6 prompts (55 pages, 81 API routes,
   339 migrations, 48 admin routes) was wrong within days.

A row marked **`✅ NOT a finding`** or **`✅ deliberate`** exists precisely so nobody files it
again. Read those before reporting anything.

**Next free ID: `P15101`.** (`P15001`–`P15100` is reserved — see *The ID repair block*.)

---

## Where the sweep got to

| | |
|---|---|
| Terminals planned | **30** |
| ID space allocated | **P00001 – P15000** (30 blocks of 500) |
| Ledgers **filed** | **26** — T1–T25 and T30 |
| Ledgers **never filed** | **4** — T26, T27, T28, T29 (2,000 IDs, `P12501`–`P14500`) |
| Rows actually written | **13,036** (13,000 distinct IDs + 36 duplicated, see below) |
| Rows passing | **12,392** |
| Rows recording a real problem | **232** — most already fixed in that terminal's own PR |
| Rows reserved / skipped, each with a written reason | **340** |

**T21 and T22 are filed but not yet merged** — their ledgers live on `origin/sweep6/t21-db-migrations-a`
and `origin/sweep6/t22-db-migrations-b`. Read them from those branches until the merge terminal lands them.

---

## The 30 territories and their permanent ID blocks

`filed?` = does a `T<n>.md` exist. `ok / prob / resv` are that file's own second-pass results.

| T | ID block | territory | filed? | rows | ok | prob | resv |
|---|---|---|---|---|---|---|---|
| 1 | P00001–P00500 | **Guest menu core** — `app/menu/**`, `app/r/[restaurant]/menu/**`, `app/q/**`, `app/page.tsx`, `app/not-found.tsx`, and the 9 guest chrome components | ✅ | 500 | 482 | 0 | 4 |
| 2 | P00501–P01000 | **The 3D dish viewer and the dish page** — `app/item/**`, `app/view/**`, `PublicModelViewer`, `lib/modelLoader.ts` | ✅ | 500 | 486 | 0 | 12 |
| 3 | P01001–P01500 | **The guest basket, the table session, placing an order** — `CartPanel`, `SessionGate`, `OrderTracker` + 10 more, `lib/menu.ts`, `lib/guestOutbox.ts` | ✅ | 500 | 479 | 20 | 0 |
| 4 | P01501–P02000 | **Working offline, and in every language** — `public/sw.js`, `public/offline.html`, `AppShell`, `lib/i18n.ts` | ✅ | 500 | 484 | 14 | 0 |
| 5 | P02001–P02500 | **The manager panel, end to end** — `app/manager/**`, `app/editor/**`, `public/panels/editor/{app.js,index.html,style.css}`, `floor-layouts.js` | ✅ | 500 | 500 | 0 | 0 |
| 6 | P02501–P03000 | **The kitchen screen** — `app/kitchen/**`, `public/panels/kitchen/**` | ✅ | 503 | 484 | 12 | 4 |
| 7 | P03001–P03500 | **The waiter tablet** — `app/tablet/**`, `public/panels/tablet/**` | ✅ | 500 | 480 | 16 | 4 |
| 8 | P03501–P04000 | **Printing, the bill document and the numbers on it** — `billdoc.js`, `billcustomer.js`, `docs/NUMBERING.md` | ✅ | 500 | 468 | 26 | 3 |
| 9 | P04001–P04518 | **Shared panel plumbing** — the 15 `public/panels/*.js` helpers, `editor/inventory.js`, `public/panels/vendor/**` | ✅ | 518 | 501 | 17 | 0 |
| 10 | P04501–P05000 | **Guest and staff-panel API routes** — `app/api/{guest,r,editor,kitchen,tablet,inventory,…}/**`, `app/login/**`, `app/staff-login/**` | ✅ | 500 | 498 | 0 | 0 |
| 11 | P05001–P05500 | **The owner's reports and charts** — `app/owner/{reports,report,sales}/**`, `components/owner/Charts.tsx`, `lib/ownerCache.ts` | ✅ | 500 | 455 | 34 | 10 |
| 12 | P05501–P06000 | **Owner home, activity log, who's online, marketing** — `app/owner/page.tsx`, `activity`, `online`, `marketing`, `OwnerShell.tsx` | ✅ | 500 | 497 | 0 | 1 |
| 13 | P06001–P06500 | **The owner's Menu editor, Staff and Settings** — `app/owner/{menu,staff,settings}/**` | ✅ | 515 | 499 | 0 | 1 |
| 14 | P06501–P07000 | **The owner's Customers, Pay Later, Inventory, Complaints, Manager mode** — `app/owner/{customers,khata,inventory,issues,manager}/**` | ✅ | 500 | 492 | 0 | 8 |
| 15 | P07001–P07500 | **The admin's access tree and people** — `app/aevinite/{access,users}/**`, `AccessTree`, `StaffProfile`, `lib/access*.ts`, `lib/staff*.ts`, 3 docs | ✅ | 500 | 495 | 0 | 0 |
| 16 | P07501–P08000 | **The admin's restaurants, owners, settings, billing, bin, platform floor** — `app/aevinite/{restaurants,owners,settings,billing,recycle,floor}/**` | ✅ | 500 | 468 | 30 | 1 |
| 17 | P08001–P08500 | **The admin's health, logs, issues and limits** — `app/aevinite/{health,logs,issues,attention,rate-limits,repair,staff-online,usage}/**` | ✅ | 500 | 493 | 0 | 4 |
| 18 | P08501–P09000 | **The admin's money view** — `app/aevinite/{analytics,revenue,customers,bill-audit}/**`, `app/aevinite/page.tsx` | ✅ | 500 | 487 | 0 | 0 |
| 19 | P09001–P09500 | **The admin server routes, part A** — the first 25 of `find app/api/admin -name route.ts \| sort` | ✅ | 500 | 498 | 0 | 2 |
| 20 | P09501–P10000 | **The admin server routes, part B + the owner routes** — the last 24 admin routes, and all 12 `app/api/owner/**` | ✅ | 500 | 500 | 0 | 0 |
| 21 | P10001–P10500 | **The database, migrations 001–118** (positions 1–120 of the sorted list) | ✅ *(unmerged branch)* | 500 | 498 | 0 | 2 |
| 22 | P10501–P11000 | **The database, migrations 119–222** (positions 121–230) | ✅ *(unmerged branch)* | 500 | 364 | 0 | 135 |
| 23 | P11001–P11500 | **The database, migrations 223 onward** (positions 231 to the end) | ✅ | 500 | 443 | 4 | 49 |
| 24 | P11501–P12000 | **The money and safety libraries** — `lib/{clash,paySplit,tax,taxFiling,idempotency,idempotencyRule,logTrail,userAuth,rateLimit}.ts`, `docs/COMPLIANCE-GUARDRAILS.md`, `docs/SAAS-EFFICIENCY-PLAYBOOK.md` | ✅ | 500 | 499 | 0 | 1 |
| 25 | P12001–P12500 | **Every other shared library file** — the ~108 files in `lib/` no other terminal owns | ✅ | 500 | 500 | 0 | 0 |
| 26 | P12501–P13000 | **THE LOOK** — `app/globals.css`, `public/panels/**/style.css`, and every Tailwind/styled-jsx block. Layout, spacing, colour, size, fit. Desktop, Samsung A35, iPad both ways up, both skins | ❌ **NEVER FILED** | 0 | — | — | — |
| 27 | P13001–P13500 | **EVERY WORD ON EVERY SCREEN** — `lib/i18n.ts` dictionary values, and every user-visible string in `app/`, `components/`, `public/panels/`. Labels, buttons, errors, empty states | ❌ **NEVER FILED** | 0 | — | — | — |
| 28 | P13501–P14000 | **THE REPO'S OWN TESTS** — `scripts/**`, `tests/**`, and the 130 `verify:*` entries in `package.json`. Is each guard alive, honest, and cleaning up after itself? | ❌ **NEVER FILED** | 0 | — | — | — |
| 29 | P14001–P14500 | **Docs, tooling, root config AND THE REMAINDER** — `docs/**`, `package.json`, `next.config.ts`, `tsconfig*.json`, `.github/**`, plus every file no other territory names | ❌ **NEVER FILED** | 0 | — | — | — |
| 30 | P14501–P15000 | **Cross-panel truth, and this ledger** — `LEDGER/INDEX.md`, `docs/QA-500-PHASES.md`, `.claude/skills/terminal-test-improve/**` | ✅ | 500 | 342 | 59 | 99 |

---

## ⚠️ Three ID faults in the record — fix these before re-running

The whole scheme rests on "one ID, one check, forever". Three files break it:

| what | detail | what to do |
|---|---|---|
| **T9 overran its block into T10's** | T9 wrote **518** rows, so `P04501`–`P04518` name a check in **T9.md** *and* a different check in **T10.md**. 18 IDs, two meanings each. | Renumber **T9's** overflow rows to **`P15001`–`P15018`**. T10's block is `P04501`–`P05000` and is correct as written. |
| **T13 repeats 15 IDs inside itself** | 515 rows, 500 distinct. | Give the 15 repeats fresh IDs from **`P15019`–`P15033`**. |
| **T6 repeats 3 IDs inside itself** | 503 rows, 500 distinct. | Give the 3 repeats fresh IDs from **`P15034`–`P15036`**. |
| **73 rows across 15 files do not render** | A cell containing an unescaped `\|` — from a `grep -c 'a\|b'` or a `… \| wc -l` — splits the row into the wrong number of cells. T13 16, T1 14, T18 13, T15 5, T8 4, then T12/T17/T23/T6 3 each, T10/T2/T4 2 each, T11/T16/T3 1 each. | Escape the pipe inside the cell as `\|`. Mechanical; the guard below names every one. |

### A guard for all of this

`.claude/sweep/T30-guard-verify-ledger-index.mjs.txt` is a complete, working
`scripts/verify-ledger-index.mjs` — it fails when a ledger has no INDEX row, when two files claim
one ID, when a row is malformed, when the next-free-ID has already been used, or when this file
stops telling the next sweep to re-run before it re-invents. It was not installed by terminal 30:
`scripts/**` belongs to T28 and the `verify:*` entry to T29. **Install it in the same change as the
repairs above** — it reports all 51 of them today, and a guard that is red on arrival is a guard
people learn to skip.

### The ID repair block

**`P15001`–`P15100` is reserved for exactly this repair and nothing else.** `P15001`–`P15036` are
allocated above. A new sweep starts at **`P15101`**.

---

## Coverage — is every part of this product owned by some ID range?

Computed by cross-producing every file in the repo against all 30 territories' own bullets.
`named` = a terminal's prompt actually lists it. **T29's "any file no other terminal names" clause
formally covers the orphans — but T29 was never told what they were, and T29's ledger was never
filed, so an orphan is unchecked ground in practice.**

| inventory | count | named by a territory | ORPHANS |
|---|---|---|---|
| page routes (`find app -name page.tsx`) | 56 | 51 | **5** |
| API routes (`find app/api -name route.ts`) | 84 | 82 | **2** |
| migration files (`ls supabase/migrations/*.sql`) | 362 | 362 | 0 |
| files in `lib/` | 127 | 127 | 0 |
| scripts under `public/panels/` | 24 | 24 | 0 |
| top-level components (`ls components/*.tsx`) | 42 | 34 | **8** |
| documents under `docs/` | 32 | 32 | 0 |
| top-level directories | 12 | 8 | **4** |

**No file anywhere is claimed by two territories.** The fence held; only its arithmetic leaked.

### Top-level directories

| directory | owned by |
|---|---|
| `app/` | T1 T2 T5 T6 T7 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T26 T27 |
| `components/` | T1 T2 T3 T4 T11 T12 T15 T16 T26 T27 |
| `lib/` | T2 T3 T4 T11 T15 T24 T25 T27 |
| `public/` | T4 T5 T6 T7 T8 T9 T26 |
| `supabase/` | T21 T22 T23 |
| `scripts/` | T28 |
| `tests/` | T28 |
| `docs/` | T8 T15 T24 T29 T30 |
| `access-designs/` | **nobody** |
| `LEARN-MY-APP/` | **nobody** |
| `reference/` | **nobody** |
| `test-results/` | **nobody** — and it needs no phases; it is regenerated Playwright output |

### 🔴 THE GAP LIST — the next sweep's first assignment

Close these **before** inventing a single new phase. They are ordered by what a real restaurant
loses if they stay unchecked.

1. **`components/PanelFrame.tsx` and `components/RealtimeProvider.tsx`** — every panel route
   renders through `PanelFrame`; every live update flows through the realtime layer. Both are
   cross-panel by nature and neither is named by any of the 30 territories. **This is the
   thinnest-checked load-bearing code in the product.**
2. **The four per-restaurant panel doors** — `app/r/[restaurant]/{manager,kitchen,tablet,login}/page.tsx`.
   Named by nobody, and three of the four already carry a real divergence from their
   `/manager`, `/kitchen`, `/tablet` twins (see `T30.md`, the tab-title handoff). Unowned ground is
   where drift lives.
3. **The print helper's two halves** — `app/aevinite/printing/page.tsx` and
   `app/api/print-agent/[...path]/route.ts`. A computer owns the paper (mig 341, `docs/PRINT-HELPER.md`,
   `verify:print-helper`); neither the screen nor its endpoint is named by any territory.
4. **`app/api/admin/rate-limits/route.ts`** — T19 took `head -25` and T20 took `tail -24` of
   **fifty** admin routes, so the 26th belongs to neither. (Its sign-in check is present — verified.
   The gap is that nobody was told to look.)
5. **The remaining 6 unowned components** — `AutoFitNumbers.tsx`, `BackQuitDialog.tsx`,
   `FitNumber.tsx`, `PointerCaptureGuard.tsx`, `ToastHost.tsx`, `VegIcon.tsx`.
6. **`access-designs/`, `LEARN-MY-APP/`, `reference/`** — name an owner or state explicitly that
   they are out of scope. Right now they are neither.
7. **The 17-file tail of `supabase/migrations/`** — T23's ledger says it covered "115 files,
   numbered 231 or higher", but positions 231→end of the sorted list hold **132** files. The
   difference is the tail that landed while T23 was running, including migrations **350–354**.

### And the four territories that never ran at all

`P12501`–`P14500` — **2,000 checks that have never been executed once.** The LOOK (T26), the
WORDING (T27), **the repo's own 130 `verify:*` guards (T28)**, and the docs + remainder (T29).

T28 is the most expensive of the four to leave undone: a permanently-red or silently-dead guard
hides real regressions, and this project has already lost a month to exactly that (`verify:cache`
waited for something `MenuView` had deliberately stopped doing, and nobody noticed). Terminal 30
found a live example of the same shape — see the four `verify:realtime` handoffs in `T30.md`.

---

## Standing pre-empts — deliberate designs that look like faults

Every sweep re-discovers these. They are **not** findings. Each is sourced, not remembered.

| looks wrong | is right, because |
|---|---|
| the owner's revenue **includes soft-deleted (binned) bills** | **REQUIRED.** `docs/COMPLIANCE-GUARDRAILS.md` §4: "Z-report / dashboards must include voids and deleted bills". Migration 309's header states the asymmetry: what is **owed** drops a deleted bill, what was **collected** keeps it. Measured on French House: the owner's August figure is ₹3,76,788 all-in, not the ₹2,08,231.50 excluding-deleted one. **Do not "fix" this** — it is the feature that put PetPooja's founders under summons, inverted. |
| the kitchen has **no profile** | Ruled three times by the owner (2026-07-29, re-confirmed 2026-08-05). `lib/staffProfileShared.ts` → `PROFILE_ROLES`. |
| Aangan differs from French House | Aangan is the **read-only control** at factory permission defaults. Differences are the point. |
| a **reprint** leaves no trace | The owner's decision: a bill reprint is not an event. No band, no audit row, no question. |
| the manager's **Audit & logs** updates on the 60-second poll, not instantly | Migration 267 moved `staff_actions` onto its own `audit` topic so the oplog stops waking every staff panel. No floor tile renders from it. |
| `cart`, `cart_updated_at` and `last_activity_at` are **absent** from the sessions breadcrumb watch-list | Stated in migration 299's own header: `cart` has its own trigger (mig 109), and `last_activity_at` is a heartbeat — watching it would wake every device on the floor. |
| dark is the default everywhere | Intended. Guest `lfh_theme`, panels `lfh_panel_theme` (default light, per staff member), owner console **`aevidine_skin`**. `lfh_theme` does nothing on `/owner`. |
| `document.body`'s background does not change with the owner skin | The skin is painted on the shell, not the body. Probe the shell or read a screenshot — probing `body` is how an old note came to claim the owner console was dark-only. |
| the four flags `verification`, `payments`, `aggregators`, `gst_invoice` appear in no UI | Backend-only on purpose (mig 035). |
| the backup stacks raise no alerts | Deliberately silent. |
| four admin screens show "Can't open this screen" on a slow first load | The **dev server compiles each route on first hit**, and `public/sw.js` has `NAV_TIMEOUT_MS = 6000` — a deliberate stall guard ("busy = offline, both ways"). A production build has no per-route compile. Drive with `waitUntil: "networkidle"` before believing it. |
| a **same-value** database write produces no visible update | The trigger fires and the breadcrumb row IS written (count it). It simply is not delivered to a socket that subscribed under a second earlier. Assert on a **changed** value. |

---

## How this file was computed — re-run these, do not trust the numbers above

```sh
cd <the repo>
ls .claude/sweep/LEDGER/                                  # which ledgers exist
find app -name page.tsx            | wc -l                # page routes
find app/api -name route.ts        | wc -l                # API routes
find app/api/admin -name route.ts  | wc -l                # admin routes (CLAUDE.md's invariant)
grep -rl tokenIsValid app/api/admin --include=route.ts | wc -l   # …must equal the line above
ls supabase/migrations/*.sql       | wc -l                # migration files
ls lib | wc -l                                            # shared libraries
ls components/*.tsx | wc -l                               # top-level components
ls public/panels/*.js public/panels/*/*.js | wc -l        # panel scripts
node -e "const p=require('./package.json');console.log(Object.keys(p.scripts).filter(k=>k.startsWith('verify')).length)"
```

Then rebuild the ownership cross-product: take each of the 30 territories' bullets from
`.claude/sweep/T<n>-PROMPT.md`, match every file in each inventory against them, and list the files
matched by none. That list — not this one — is the current gap list.

Two boundary rules the commands hide, and which cost this sweep two real gaps:

- **`head -N` / `tail -M` must add up to the whole list.** `head -25` + `tail -24` over **50** files
  leaves the 26th to nobody.
- **A positional file range is not a numeric one.** Several migration numbers are used twice here
  (established practice), so `head -120` ends at `118_…` and `sed -n '121,230p'` really begins at
  `119_…`. Three ledger headers state a numeric range their command does not cover. The tiling is
  complete, so no file was missed — but do not trust the numeric labels.

---

## Will the next run come back clean?

**No — and it should not.** Four of the thirty territories never ran, so roughly **2,000 of the
15,000 checks have never been executed once**, including every check on the repo's own test guards.
Seven named coverage gaps are still open, and three ledger files carry duplicate IDs.

What *is* true, from 26 filed ledgers and 13,036 executed rows: **the product itself is in good
shape.** The panels agree with each other, the money agrees with itself across the database, the
manager's floor, the owner's Dashboard, the owner's Reports and the admin's ledger; every cache has
a writer that busts it; every breadcrumb reaches a screen. Waves 1 and 2 did real work.

The honest summary is that **the product is healthier than the scaffolding around it.** The next
sweep should start with T26–T29 and the gap list above — not with a fresh idea.
