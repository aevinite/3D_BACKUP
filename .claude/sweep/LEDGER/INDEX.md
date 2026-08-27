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

**Next free ID: `P35237`.** (`P15001`–`P15100` is reserved — see *The ID repair block*.)

> **SWEEP #7 took `P15101`–`P35100`** — 40 terminals × 500, contiguous and in terminal order, so
> T1 is `P15101`–`P15600`, T5 is `P17101`–`P17600`, and T40 is `P34601`–`P35100`. Each terminal
> RE-RAN its own existing rows before writing one new id, and appends its new block to the bottom
> of its own `T<n>.md`.
>
> | terminal | block | filed |
> |---|---|---|
> | T1 · the guest menu core | `P15101`–`P15600` | ✅ 500 written, 500 executed, 500 ✅ — plus all 502 of `P00001`–`P00500` re-run (499 ✅ · 3 ⏭ · **no regression**, and one long-standing `⏭` closed) |
> | T5 · the manager panel | `P17101`–`P17600` | ✅ 500 written, 500 executed, 500 ✅ — plus all 500 of `P02001`–`P02500` re-run (499 ✅ · 1 ⏭ · **no regression**) |
> | T5 · the owner's own follow-up run | `P35101`–`P35200` | ✅ 100 new rows for the thirteen things he asked for 2026-08-23→26, all green, plus P17101–P17600 re-run (399 ✅ · 1 expectation moved · **no regression**). Taken from the next-free mark, past every sweep-#7 block. |
> | T4 · working offline, and in every language | `P16601`–`P17100` | ✅ 500 written, 500 executed (497 ✅ · 3 ❌→✅ fixed on the branch) — plus all 500 of `P01501`–`P02000` re-run: **no regression**, 4 expectations moved, and one row (`P01936`) found to have been **filed green on a claim that was never true** |
> | T17 · the admin's health, logs, issues & limits | `P23101`–`P23600` | ✅ 500 written, 500 executed (499 ✅ · 1 ❌, and that one is a single line in a file this territory does not own) — plus all 500 of `P08001`–`P08500` re-run: **ONE REGRESSION** (`P08095` — the server moved to the shared `errorSig()` group and the Logs page was left comparing message text letter-for-letter, so "Mark resolved" cleared 9 rows server-side and struck through 1), 1 row newly red (`P08201`), 4 ⏭ unchanged, and 11 expectations moved because System health was rebuilt. **6 problems fixed, one commit each.** |
> | T15 · the admin's access tree and people | `P22101`–`P22600` | ✅ 500 written, 500 executed, 500 ✅ (5 of them recorded a real fault) — plus all 500 of `P07001`–`P07500` re-run: **no regression**, 6 expectations moved, and one row (`P07441`) found to have been **filed green on a claim that was never true** |
> | T15 · the owner's own follow-up ("do all except 1") | `P35201`–`P35236` | ✅ 36 rows for items 7, 8, 9 and 10, all green. Item 1 dropped on his word. Three faults found by the guards written for the picked items: a fourth ACTIONS row unnamed by its folder (one day after the guard landed), and khata + payroll INHERITED from restaurant #1 by every new restaurant. |
>
> | T27 · every word on every screen | `P28101`–`P28600` | ✅ 500 written, 500 executed (484 ✅ · 10 ✅ deliberate · 6 ❌→✅ fixed) — plus **the T27 ledger itself landed on main at last**, and all 500 of `P13001`–`P13500` re-run: **ONE REGRESSION** (`P13140` — the Bills-screen rework replaced \"No bills match that search.\" with an empty string inside a box that carries 120px of padding, so a search matching today but not yesterday printed blank nothing under a \"0 bills\" heading), 2 more rows newly red, **42 of the 59 reserved rows CLOSED**, and sweep #6’s biggest ⏭ answered: all six languages photographed, and Arabic right-to-left found to be a written decision rather than a gap. **7 problems fixed, one commit each**, and a new `verify:wording` guard — this territory had none of its own. |
>
> Other sweep-#7 terminals add their own line here. **Rebuilding this whole file honestly from what
> is on disk is terminal 40's job** — this is the one line the ID guard needs in the meantime, kept
> deliberately small so it does not collide with that rebuild.

---

## Where the sweep got to

*Recounted 2026-08-22, after T21, T22, T25, T26 and T29 merged.*

| | |
|---|---|
| Terminals planned | **30** |
| ID space allocated | **P00001 – P15000** (30 blocks of 500) |
| Ledgers **filed** | **27** — T1–T25, T29, T30 |
| Ledgers **never filed** | **1** — T28. *(T27 was filed 2026-08-27 by sweep #7. The rest of this block is sweep-#6 arithmetic and terminal 40 owns the honest recount — these two words are corrected only because a line claiming a ledger does not exist, sitting in the same folder as that ledger, is how a stale number becomes a fact.)* |
| Phase rows on record | **13,518** |
| Rows passing | **12,893** |
| Rows recording a problem | **281** — most already fixed in that terminal's own PR |
| Rows reserved, each with a written reason | **343** |

**T26 filed its ledger but it is not in this folder yet** — it lives on
`origin/sweep6/t26-the-look` (the LOOK: 577 rows). Read it from there until the merge terminal lands
it. **T27 (every word on every screen) was filed on 2026-08-27.** Sweep #7 pulled its 500 rows off
PR #1101, re-ran every one — finding one regression — and added 500 more; see its row in the
sweep-#7 table above. **T28 (the repo’s own guards, `P13501`–`P14000`) has still never been filed**
— 500 checks never executed once, and now the most expensive gap left on this page.

T28's absence is the expensive one, so T30 audited the guards' own health as a stand-in. That
section is at the bottom of this file. It found the guards are alive — but two were red, and both
were **stale allowances**, not dead checks.

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
| 21 | P10001–P10500 | **The database, migrations 001–118** (positions 1–120 of the sorted list) | ✅ | 500 | 498 | 0 | 2 |
| 22 | P10501–P11000 | **The database, migrations 119–222** (positions 121–230) | ✅ | 500 | 364 | 0 | 135 |
| 23 | P11001–P11500 | **The database, migrations 223 onward** (positions 231 to the end) | ✅ | 500 | 443 | 4 | 49 |
| 24 | P11501–P12000 | **The money and safety libraries** — `lib/{clash,paySplit,tax,taxFiling,idempotency,idempotencyRule,logTrail,userAuth,rateLimit}.ts`, `docs/COMPLIANCE-GUARDRAILS.md`, `docs/SAAS-EFFICIENCY-PLAYBOOK.md` | ✅ | 500 | 499 | 0 | 1 |
| 25 | P12001–P12500 | **Every other shared library file** — the ~108 files in `lib/` no other terminal owns | ✅ | 500 | 500 | 0 | 0 |
| 26 | P12501–P13000 | **THE LOOK** — `app/globals.css`, `public/panels/**/style.css`, and every Tailwind/styled-jsx block. Layout, spacing, colour, size, fit. Desktop, Samsung A35, iPad both ways up, both skins | ⚠️ filed on `origin/sweep6/t26-the-look`, not yet merged | 577 | — | — | — |
| 27 | P13001–P13500 | **EVERY WORD ON EVERY SCREEN** — `lib/i18n.ts` dictionary values, and every user-visible string in `app/`, `components/`, `public/panels/`. Labels, buttons, errors, empty states | ✅ **filed 2026-08-27 (sweep #7)** — written by T30, landed and re-run by T27 | 1000 | 966 | 9 | 25 |
| 28 | P13501–P14000 | **THE REPO'S OWN TESTS** — `scripts/**`, `tests/**`, and the 130 `verify:*` entries in `package.json`. Is each guard alive, honest, and cleaning up after itself? | ❌ **NEVER FILED** | 0 | — | — | — |
| 29 | P14001–P14500 | **Docs, tooling, root config AND THE REMAINDER** — `docs/**`, `package.json`, `next.config.ts`, `tsconfig*.json`, `.github/**`, plus every file no other territory names | ✅ | 500 | — | — | — |
| 30 | P14501–P15000 | **Cross-panel truth, and this ledger** — `LEDGER/INDEX.md`, `docs/QA-500-PHASES.md`, `.claude/skills/terminal-test-improve/**` | ✅ | 500 | 342 | 59 | 99 |

---

## ✅ The ID faults — found, checked, and fixed (T30, 2026-08-22)

The whole scheme rests on **one ID, one check, forever**. Three things were reported here; **one was
real, two were my own detector being wrong.** Both outcomes are recorded, because a withdrawn
finding is as useful as a confirmed one — it stops the next sweep re-filing it.

| what was claimed | verdict | what happened |
|---|---|---|
| **T9 overran its block into T10's** | ✅ **REAL — now fixed** | T9 wrote **518** rows into a block of 500, so `P04501`–`P04518` were genuine phase rows in `T9.md` naming *different* checks from the ones T10 gave those ids. **Renumbered to `P15001`–`P15018`.** The checks are unchanged; only the numbers moved. `T9.md` carries a banner saying so, and T10's block was correct and untouched. |
| **T13 repeats 15 IDs inside itself** | ❌ **WITHDRAWN** | Those 15 rows are back-references in T13's own recap table *"What this pass found that the first two did not"* — a three-column narrative table, not a second check. Legitimate and useful. **My detector was wrong**, not the ledger: it counted any line starting `\| P##### \|` as a phase row. |
| **T6 repeats 3 IDs inside itself** | ❌ **WITHDRAWN** | Same shape — T6's *"Rows whose expectation CHANGED (not failures — the product moved)"* table. |
| **73 rows do not render** | ✅ **55 real — now fixed** · 18 were the recap rows above | The real cause is almost always **JavaScript's `\|\|` inside a code snippet** in the `how to verify` column (`${slug \|\| DEFAULT}`), plus a few single stray pipes from a `grep -c 'a\|b'`. **55 repaired** across T1 (14), T18 (13), T15 (5), T8 (4), T12/T17/T23 (3 each), T10/T2/T4 (2 each), T11/T13/T16/T3 (1 each). |

**A phase row is identified by its SHAPE — six pipes, five cells — never by its first column.** An
id in the first column of any other table is a back-reference, and the guard below now checks that
it resolves to a phase row somewhere rather than treating it as a duplicate.

**Always split on UNESCAPED pipes only** (`line.split(/(?<!\\)\|/)`). Cells legitimately contain
`\|`, because the checks are full of `grep -c 'a\|b'`, `find … \| wc -l` and `a \|\| b`. Splitting
naively both under-counts real rows and invents malformed ones — which is how the two withdrawn
findings above came to be filed in the first place.

### The guard that keeps this true

**`npm run verify:ledger-index`** — `scripts/verify-ledger-index.mjs`, installed by T30. It fails
when two phase rows share an id, when a ledger has no row in this file, when this file points at a
ledger that does not exist without saying so, when a recap table references an id nothing carries,
when a ledger has no phase rows at all, or when this file stops telling the next sweep to re-run
before it re-invents. Reads only; no key, no database, well under a second. It is **green** as of
this commit: 24 ledgers, 12,018 phase rows, 12,018 distinct ids, no collisions, 18 back-references
all resolving.

### The ID repair block

**`P15001`–`P15100` is reserved for repairs and nothing else.** `P15001`–`P15018` are now
**allocated to T9**. `P15019`–`P15100` remain free for the next repair. **A new sweep starts at
`P15101`.**

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

### THE GAP LIST — checked on 2026-08-22, and here is what was actually behind it

The four holes below were named because **no terminal's bullet listed them**, so nobody was *told*
to check them. T30 then went and checked them anyway. **All four came back clean** — which is worth
knowing, because "unowned" and "broken" are not the same thing, and a gap list that cries wolf is
one nobody reads.

| the gap | what was behind it | verdict |
|---|---|---|
| **`components/PanelFrame.tsx`** — every panel route renders through it | It solves two real phone bugs (a `100vh` iframe hanging below the URL bar; `env()` not resolving inside a nested iframe) and its own rule is *"every panel host must render this, never a raw `<iframe>`"*. Checked every file that embeds a panel: the six fixed full-screen hosts all use `PanelFrame`; the owner console's inline embeds all use the shared `useEmbedFrame` hook, which attaches the **same** `lib/safeAreaBridge` — so the insets reach both. The one remaining raw `<iframe>`, in `components/admin/RemovalDetail.tsx`, is a **sandboxed bill document** (`srcDoc`, no `allow-scripts`, auto-grown height), not a panel, so the rule does not apply to it. | ✅ **clean** |
| **`components/RealtimeProvider.tsx`** — every guest live update flows through it | Scopes the socket per restaurant server-side via `topic_rid` (mig 145), keeps a JavaScript restaurant check as a safety net for the async window before `rid` resolves, drops its channel after 120s hidden, force-rebuilds on wake because a backgrounded socket dies silently, throttles the 2–3 wake signals into one rebuild, refuses to reopen a socket on `online` while hidden, debounces a burst into one refetch, and tears everything down cleanly. Every realtime rule this sweep tests for holds. | ✅ **clean** |
| **The print helper's two halves** — `app/aevinite/printing/page.tsx` and `app/api/print-agent/[...path]/route.ts` | The endpoint identifies its caller by the helper's own token (`agentByToken`) and takes `restaurant_id` **from the agent row, never from the request** — so a caller cannot name a restaurant. Every one of its ~15 queries carries `.eq("restaurant_id", agent.restaurant_id)`. And it is **not actually unwatched**: `npm run verify:print-helper` covers it (48 checks, all passing), including that every verb checks the token. | ✅ **clean** — and guarded, despite no ledger naming it |
| **`app/api/admin/rate-limits/route.ts`** — position 26 of **50**, between T19's `head -25` and T20's `tail -24` | Read it: `const admin = (req) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)`, used by GET, PATCH **and** POST. All 50 admin routes carry the check, so CLAUDE.md's own invariant holds. | ✅ **clean** |

**The lesson for the next sweep, and the reason this table replaced the alarm:** the arithmetic hole
was real — `head -25` + `tail -24` over fifty files genuinely leaves the 26th to nobody, and four
directories genuinely have no owner. But *unchecked* turned out not to mean *wrong*. **Assign these
files to a territory so they are checked on purpose rather than by luck; do not assume they are
broken.**

### Still genuinely unassigned — give these an owner next time

1. **The six remaining unowned components** — `AutoFitNumbers.tsx`, `BackQuitDialog.tsx`,
   `FitNumber.tsx`, `PointerCaptureGuard.tsx`, `ToastHost.tsx`, `VegIcon.tsx`. Smaller than
   `PanelFrame`, and still rendered across more than one panel.
2. **`access-designs/`, `LEARN-MY-APP/`, `reference/`** — name an owner, or state in one line that
   they are out of scope. Right now they are neither, so every sweep rediscovers them and none
   checks them. (`test-results/` genuinely needs no phases — it is regenerated Playwright output.)
3. **The 17-file tail of `supabase/migrations/`** — T23's ledger says it covered "115 files,
   numbered 231 or higher", but positions 231→end of the sorted list hold **132**. The difference is
   the tail that landed while T23 was running, including migrations **350–354**.
4. **The five orphan page routes** — `app/aevinite/printing/page.tsx` and the four
   `app/r/[restaurant]/{manager,kitchen,tablet,login}/page.tsx`. The tab-title fault that lived in
   three of them **has since been fixed** (T29, 2026-08-22, with
   `.github/scripts/verify-twin-route-parity.mjs` to keep it fixed) — but the files still belong to
   nobody's bullet.
5. **The two orphan API routes** — `app/api/admin/rate-limits/route.ts` and
   `app/api/print-agent/[...path]/route.ts`. Both verified clean above; both still unassigned.

### And the territories that never ran at all

`P13001`–`P14000` — **1,000 checks that have never been executed once.** The WORDING (T27) and
**the repo's own 142 `verify:*` guards (T28)**. The LOOK (T26) and the docs + remainder (T29) have
both since filed.

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

---

## The guards' own health — audited 2026-08-22 (a first slice of T28's unrun territory)

T28 (`P13501`–`P14000`) owns the question *"is each of this repo's guards alive, honest, and
cleaning up after itself?"* — and its ledger was never filed. That is the most expensive gap on this
page, because a permanently-red or silently-dead guard hides real regressions: `verify:cache`, the
3D no-re-fetch check CLAUDE.md tells everyone to run, sat green and asserted **nothing** for a month
because its subject had deliberately stopped doing the thing it waited for.

T30 did the core of that audit. **This is not a substitute for running T28** — it covers the health
of the guards, not the 500 phases T28 was scoped to write — but it answers the expensive question.

### Can each guard fail at all?

**138 `verify:*` / `test:*` entries. Every single one can fail.** Three looked dead and all three
were **my own detector being wrong** — recorded here so nobody re-files them:

| looked dead | actually |
|---|---|
| `test:units` | runs `node --test lib/*.test.mjs`: **17 real tests, all passing.** A glob has no single script file, which is all my check saw. |
| `verify:clash-coverage` | counts `problems++` and ends `process.exit(problems … ? 1 : 0)`. My detector looked for `problems.push`. |
| `verify:avlive-release` | counts `bad++` and ends `process.exit(bad === 0 ? 0 : 1)`. **Not executed here on purpose** — it reads the client stack's folder, which this terminal does not touch. Verified by reading it. |

### Do they actually pass?

**67 of the 138 need no key and no running app.** Two were excluded deliberately —
`verify:everything` is pid-locked and belongs to the merge terminal, and `verify:avlive-release`
reads the client stack. **The remaining 65 were run. 63 were green; 2 were genuinely red; both are
now fixed** (T30, this branch):

| guard | why it was red | fix |
|---|---|---|
| `verify:rejected` | `scripts/verify-t24-money-rules.mjs` says `REJECTED` in a comment that *explains why the guard strips comments* — it talks **about** the convention rather than making a claim. The guard flags any file saying REJECTED without pointing at `docs/REJECTED-IDEAS.md`. | Named the doc in that comment. One line. The guard was not weakened. |
| `verify:admin-refusals` | Its `NOT_YET` allowance for `app/api/admin/restaurants/settings/route.ts` said **2** while the file had **3**. A third `return { error: … }` had been added inside the SAME already-exempt helper (`ensureCodes`, the scoped re-read for the efficiency playbook) and nobody bumped the number. | Checked the caller first — it is `adminFail("this restaurant's table QR codes", { message: codes.error }, …)`, so the database's words reach the log and never a toast. Allowance bumped to 3, with the reasoning written beside it. **The route was correct; the guard's count was stale.** |

One more shows as non-zero and is **correct**: `verify:panel-plumbing-live` refuses with
`--base <url> is required` and exit 2. It is a live guard; my classifier called it repo-only.

### What is still unaudited, and what to watch for

- **71 guards need a key or a running app** and were not executed here. Running them is T28's job,
  and the two faults above suggest what it will find: not dead guards, but **stale allowances and
  stale expectations** — a guard whose subject moved and whose number nobody bumped.
- **16 guards write to the database and have no `delete().eq("id", …)`**, and **11 write with no
  restore-on-kill** (`SIGINT`/`SIGTERM`/`finally`). Both lists are worth a real look: this sweep's
  own scar is `verify:realtime`, which flipped a category off across seven restaurants and then
  died two steps later. Not filed as faults here — several are certainly read-then-write patterns
  that clean up another way, and judging 27 scripts properly is T28's work, not a grep's.

### How to redo this audit

```sh
node -e "const p=require('./package.json');console.log(Object.keys(p.scripts).filter(k=>/^(verify|test):/.test(k)).length)"
```
Then, for each guard: resolve its script file(s), check the source can reach a non-zero exit
(`process.exit(1)`, `problems++`, `bad++`, `fail(`, `check(`, `throw`), and **run the ones needing
neither `.env.local` nor a server**. Never run `verify:everything` (pid-locked) or
`verify:avlive-release` (it reads the client stack).

**Judge a "dead guard" by reading it, never by a grep.** Three of my three static hits were false.
