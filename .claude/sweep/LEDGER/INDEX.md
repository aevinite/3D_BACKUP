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

**Next free ID: `P46801`.**

> **`P46301`–`P46800` is CLAIMED by T25's THIRD freshly-planned 500** (`lib/**` — every shared library
> file no other terminal owns, 2026-08-31). The owner's word, after round 2 was merged and deployed:
> *"re plan whole 500 phasess test in your boundaries and execute again so that you if any left you
> can able to do it"* — i.e. plan it again, run it again, and pick up whatever the first two rounds
> could not reach.
>
> Claimed by editing this line **before a single row was written**, taken from the mark AND checked
> against the highest id actually on disk (`P46300`), and **pushed to `main` before any row existed**.

> **`P45801`–`P46300` is T25's SECOND freshly-planned 500 — DONE: 500 written, 500 executed, 496 ✅ · 4 ⏭ · 0 ❌, and 10 problems found and fixed (items 24–33).** Four of the ten were *guards that stayed green when the thing they defend was broken* — found by sabotaging every guard this territory relies on, which is now part of the block (`P46241`–`P46262`). Originally claimed as: (`lib/**` — every shared
> library file no other terminal owns, 2026-08-31). The owner's word, after his first 500 was merged
> and deployed: *"plan whole five hundred phase test again within your boundaries that you have been
> given. Plan whole test divided into five hundred phases and run that test. Check every single part
> in your boundary. If you find any error, fix it. I want completely error free."*
>
> Claimed by editing this line **before a single row was written**, taken from the mark AND checked
> against the highest id actually on disk, and **pushed to `main` before any row existed** — the two
> halves of the rule this file has now recorded five collisions over.

> **`P45301`–`P45800` is CLAIMED by T9's THIRD 500** (shared panel plumbing, 2026-08-31) — the
> owner's word: *"replan whole 500 phases test and execute the test on the back up side again ...
> It should check every single bit of the thing within your boundaries"*. Claimed before a single
> row was written **and PUSHED before a single row was written**, which is the half of the rule my
> second 500 learned the hard way: I claimed `P42501`–`P43000` at 18:01 on 2026-08-30, T7 claimed it
> at 20:08, and mine still had to move because it never reached `main` where anyone could see it.

> **T7's FIFTH freshly planned 500 — `P44801`–`P45300` — is DONE: 500 written, 500 executed,
> 500 ✅** (2026-08-30, the owner's word:
> *"you plan 500 phases test again around the boundaries that you have given and run the test and
> check everything should be green If not solve that all things which are not"*). Claimed by editing
> this line BEFORE a single row was written, and taken above the highest id actually on disk
> (`P44800`) rather than from the mark — the two rules every T7 claim has followed.

> **`P44301`–`P44800` is T9's SECOND 500** (shared panel plumbing, 2026-08-30). **RENUMBERED FROM
> `P42501`–`P43000`.** I claimed that block correctly — by editing this line before writing a single
> row — at 18:01, and T7 claimed the same range at 20:08. Mine was earlier, and mine still moves,
> because a claim nobody can SEE is not a claim: it sat on my own branch and never reached `main`,
> so both T7 and T30 read this file, saw the range free, and were right to take it. T7's rows are on
> `main`; mine were not. **The rule below needs its other half, and this is it: claim before you
> write a row AND PUSH THE CLAIM, or you have only told yourself.** Fourth recording of this
> collision in this file, and the first where the earlier claimant was the one who had to move.

> **T30 claims `P43501`–`P44000`** for its round-2 block (2026-08-30). RENUMBERED FROM `P42501`–`P43000`: I wrote the rows first and claimed after, and T7 claimed that same range correctly — before writing — while I was working. Their claim stands; mine moved. This is the third time this file has recorded that collision, and every time the terminal that claimed FIRST was the one that had it right.

> **T7's FOURTH freshly planned 500 — `P42501`–`P43000` — is DONE: 500 written, 500 executed,
> 500 ✅** (2026-08-30, the owner's word: *"plan it and then rerun it. There shouldn't be any error
> left and even though it is job for other, do that fix that."*). Claimed by editing this line
> BEFORE a single row was written, and taken above the highest id actually on disk (`P42500`)
> rather than from the mark — the same two rules the third claim followed. The plan itself is
> `.claude/sweep/t7r4/PLAN.md`, written before any row.

> **`P42001`–`P42500` is CLAIMED by T3** — its THIRD sweep-#7 block, for the 500 phases the owner
> asked for on 2026-08-30 to cover four improvements he picked (items 10, 12, 13 and 14 of T3's
> list). Claimed BEFORE a single row was written, per the note further down this file.

> **`P43001`–`P43500` is FILED by T29** — 500 written, 500 executed, **500 ✅, 0 product faults**.
> **Renumbered from `P42001`–`P42500` on merge:** T3 claimed the same range in the same window and
> its claim reached `main` first, so theirs stands and mine moved. Claiming before writing is
> necessary and NOT sufficient — see the note on collisions below.
>
> ~~**`P42001`–`P42500` was claimed by T29**~~ — superseded; T3's claim on that range reached `main`
> first. T29's third block is `P43001`–`P43500`. The original claim read: (docs, tooling, root config and the remainder) for a THIRD
> freshly planned 500, on the owner's instruction of 2026-08-30: *"completely replan whole 500 phases
> test and do it, make sure everything in your area is error free"*. **Claimed before a single row was
> written**, which is the rule this file asks for after T7/T28 and then T29/T7 both took a live block.
>
> **`P41501`–`P42000` is TAKEN by T29** (docs, tooling, root config and the remainder) for its
> follow-up 500, on the owner's instruction of 2026-08-30. It was first written at
> `P35237`–`P35736` and **renumbered on merge**, because T7's own second 500 had claimed that
> range and filed first — the same collision T16 hit, from the same stale *Next free ID*.
> T7's claim stands; nothing of theirs moved. Claimed here before this line was committed.
>
> **`P41001`–`P41500` is CLAIMED by T3** (the guest basket / table session / placing an order) for its
> SECOND sweep-#7 pass, on the owner's instruction of 2026-08-30 to re-plan and re-run the 500.
> Claimed BEFORE a single row was written, which is what the note further down this file asks for
> after T7 and T28 both took `P35237` in the same minute.

> **T7's THIRD freshly planned 500 — `P40501`–`P41000` — is DONE: 500 written, 500 executed, 500 ✅**
> (2026-08-30, the owner's word: *"plan again 500 phases test within the boundary that you have
> given and rerun the test"*). Claimed BEFORE a single row was written, per the rule three lines
> below — and deliberately taken ABOVE the highest id actually on disk (`P40500`) rather than from
> the mark, which read `P37358` while rows already existed past it. Trust the disk, not the mark.
> Every row was driven against the LIVE site, so a green row says what a waiter meets today.
> (`P15001`–`P15100` is reserved — see *The ID repair block*.)

> **T28 · the two blocks the 500 squeezed out** at `P44001`–`P44300` (2026-08-30). Blocks E and F
> of the guards audit were RUN and then left out of the ledger, because blocks A–D filled the 500
> first. Registering them properly — and block E's fixture check had a hole that missed the very
> collision that caused three false "serious floor bug" reports, so it is rebuilt here.
>
> **THE REPO'S OWN SAFETY NET — 500 on the guards themselves** at `P37358`–`P37857` (2026-08-30).
> T28's own territory, asked for by the owner: "check everything is working fine as it should or
> not". Does each of the 153 `verify:*` / `test:*` entries actually run, actually bite when the
> thing it names is broken, still have a subject, obey the house rules, and earn its runtime.
>
> **THE SPLIT BILL — a whole 500 on one feature** at `P36858`–`P37357` (2026-08-29). Asked for
> after three faults he found on that screen were fixed and made live. Not a territory sweep: one
> feature, followed from the button that opens it to the row it writes and the money the book is
> left owing — across BOTH panels, because they are two screens holding one set of rules.
>
> **T7 · the waiter tablet — a SECOND, freshly planned 500** at `P35237`–`P35736` (2026-08-29).
> Not a re-run: the owner asked for the whole test to be **planned again from scratch** after his
> ten items were merged and made live, because the territory had changed under the old plan — a
> brand-new split screen, a payment sheet with a panel removed, four functions deleted, a tile
> threshold moved and a repaint newly guarded. Run against the DEPLOYED backup site, not a dev
> server, since "after making it live" is the point of it.

> **SWEEP #7 took `P15101`–`P35100`** — 40 terminals × 500, contiguous and in terminal order, so
> T1 is `P15101`–`P15600`, T5 is `P17101`–`P17600`, and T40 is `P34601`–`P35100`. Each terminal
> RE-RAN its own existing rows before writing one new id, and appends its new block to the bottom
> of its own `T<n>.md`.
>
> | terminal | block | filed |
> |---|---|---|
> | T1 · the guest menu core | `P15101`–`P15600` | ✅ 500 written, 500 executed, 500 ✅ — plus all 502 of `P00001`–`P00500` re-run (499 ✅ · 3 ⏭ · **no regression**, and one long-standing `⏭` closed) |
> | T3 · the guest basket, the table session, placing an order | `P16101`–`P16600` | ✅ 500 written, 502 executed (500 ids + 2 sub-rows), 500 ✅ — plus all 500 of `P01001`–`P01500` re-run: **no regression**, and `npm run sweep:t3` green in ONE sitting, which sweep #6's own pass 5 could not manage. **2 expectations CORRECTED** — `P01422` and `P01423` were both filed green in sweep #6 on a claim that was never true about the basket pill (it is a centred pill at desktop width, not hidden; and what really hides it is the bill being open). **6 problems fixed, one commit each**, the loudest being a saved request for water that read "0 items" under a chip saying "1 order waiting to send". `verify:guest-doors` extended by 26 checks (proved red on the pre-fix files: 25 of 26); 362 of the new rows are re-runnable as `sweep:t3-static` / `sweep:t3-live`. **14 candidates measured and WITHDRAWN** with their reasons, three of them cases where my own measurement, not the product, was the wrong thing. |
> | T5 · the manager panel | `P17101`–`P17600` | ✅ 500 written, 500 executed, 500 ✅ — plus all 500 of `P02001`–`P02500` re-run (499 ✅ · 1 ⏭ · **no regression**) |
> | T5 · the owner's own follow-up run | `P35101`–`P35200` | ✅ 100 new rows for the thirteen things he asked for 2026-08-23→26, all green, plus P17101–P17600 re-run (399 ✅ · 1 expectation moved · **no regression**). Taken from the next-free mark, past every sweep-#7 block. |
> | T4 · working offline, and in every language | `P16601`–`P17100` | ✅ 500 written, 500 executed (497 ✅ · 3 ❌→✅ fixed on the branch) — plus all 500 of `P01501`–`P02000` re-run: **no regression**, 4 expectations moved, and one row (`P01936`) found to have been **filed green on a claim that was never true** |
> | T16 · the admin's restaurants, owners, settings, billing, bin & platform floor | `P22601`–`P23100` **+ `P35737`–`P36236`** | ✅ **1,500 rows on record, all green.** First 500 (`P22601`–`P23100`) 500 ✅; the 500 old rows `P07501`–`P08000` re-run 500 ✅ — **ONE REGRESSION** by drift (`P07771`, the delete cards promising a 90-day protection the owner removed on 2026-08-20), 9 expectations moved, and two sweep-#6 rows found **filed green on wording that was wrong** (`P07950`, `P07924`). A SECOND 500 (`P35737`–`P36236`, 2026-08-29) was then planned from scratch against ground the first 1,000 do not cover — a lifecycle truth table, the web address in depth, the 14 routes these screens call, the money arithmetic, the new printing world (migs 366–369), extreme data, keyboard, measured egress, and two tabs at once: 500 ✅. **17 problems fixed in all, one commit each**, incl. `lfh_guest_restaurant` answering a 404 on a live restaurant's own menu (**mig 370**), and a typo in the Billing Amount box being stored as a real plan amount. New guards `verify:guest-address` and `verify:admin-restaurants` +38 checks (sections 11–26). Also fixed `verify:ui-integrity`, which was red on main and, running as a hook, was blocking **every session's Write and Edit tool** (PR #1159). | **NOTE:** this block was first taken at `P35237`–`P35736` and RENUMBERED to `P35737`–`P36236` when T7's own second 500 merged first and had claimed the same range. T7's claim stands; nothing of theirs was renumbered.
> | T16 · the admin's restaurants, owners, settings, billing, bin & platform floor | `P22601`–`P23100` | ✅ 500 written, 500 executed — **500 ✅ after the second pass** (first pass 496 ✅ · 4 ❌) — plus all 500 of `P07501`–`P08000` re-run: **500 ✅** (first pass 499 ✅ · 1 ❌). **ONE REGRESSION** by drift: `P07771`, the delete cards still promising a 90-day protection the owner removed on 2026-08-20 (mig 342). 9 expectations moved with their reason in the row, and two sweep-#6 rows found to have been **filed green on wording that was wrong or loose** (`P07950` — suspending does NOT stop staff signing in; `P07924`). **15 problems fixed, one commit each.** The biggest was `P07967`: `lfh_guest_restaurant` (mig 282) resolved a slug with an unordered `LIMIT 1`, and since mig 309 a removed restaurant keeps its row AND its slug — so a restaurant created on a reused web address could serve a **404 on its own guest menu**, intermittently, while the console showed it Active. **Migration 370** orders the live row first; proved over ten rounds. New guard `verify:guest-address`; `verify:admin-restaurants` +34 checks (sections 11–24). |
> | T28 · the 500-phase run around what went live | `P36358`–`P36857` | ✅ 500 written, 500 executed 2026-08-29, AFTER the fix and AFTER the merge reached the live backup site. **483 ✅ · 17 ⏭ · 0 ❌.** Block B found NINE guards breaking on `--base`, an argument they do not use — invisible to every earlier run because nobody had handed it to them. Block C is **mutation testing**: 40 of 49 guards demonstrably go red when the thing they name is broken, which not one of them had ever been proved to do. It also produced three harness bugs of mine, each manufacturing a false accusation, all recorded. |
> | T28 · his decisions on T28's eight open items | `P36237`–`P36357` | ✅ 121 rows, all executed 2026-08-28/29. He answered all eight in one message; every one was built. Item 14 decided on his instruction (a stray address belongs to the DINER), item 15 settled by him and written in three places, and all fifteen earlier items re-run on a branch rebased onto today's main. **Three of the ten guard PAIRS collided** — an unfenced table picker, a whole-floor leak scan and a whole-stream breadcrumb scan, all three the same class: a guard asserting a property of the ENTIRE shared database on a database it shares. |
> | T28 · the repo's own tests | `P28601`–`P29100` | ✅ 500 written, 500 executed (486 ✅ · 10 ⏭ · 4 ❌ — two of the ❌ are ONE open question for the owner, and two are honest judgment answers about the state this run found) — plus all 500 of `P13501`–`P14000` re-run: **490 ✅ · 10 ⏭ · 0 ❌, NO REGRESSION**, and **13 of sweep #6's 23 skips CLOSED** (five guards that were red on shared-database drift are green today). **Nine guards were red or crashing on clean main; three of the nine were the app and six were the guard. All fixed, one commit each.** The most valuable: a redirect the owner asked for on 2026-08-26 was built the same day and LOST three days later when the two 404 screens he picked replaced the file. |
> | T25 · every other shared library | `P27101`–`P27600` | ✅ 500 written, 500 executed (498 ✅ · 2 ⏭) — plus all 500 of `P12001`–`P12500` re-run: **NO REGRESSION**, 430 with a result, 70 `⏭` each with its own written reason (a write to a shared restaurant's floor, a setting to flip and restore, or a screenshot of another territory's screen — nine lanes shared this stack). 2 expectations moved with their ids kept, and **1 row was found to have been filed green on a claim that was never true** (`P12371` — the admin's sample kitchen ticket said "Table 5" where the printer says "T5", since the day it was written). **12 problems found, 12 fixed**, one commit each, every one leaving a guard: two NEW (`verify:plain-refusals`, `verify:log-visibility` — the second had been PROMISED in lib/logVisibility.ts's own header and never written) and five extended. |
> | T17 · the admin's health, logs, issues & limits | `P23101`–`P23600` | ✅ 500 written, 500 executed (499 ✅ · 1 ❌, and that one is a single line in a file this territory does not own) — plus all 500 of `P08001`–`P08500` re-run: **ONE REGRESSION** (`P08095` — the server moved to the shared `errorSig()` group and the Logs page was left comparing message text letter-for-letter, so "Mark resolved" cleared 9 rows server-side and struck through 1), 1 row newly red (`P08201`), 4 ⏭ unchanged, and 11 expectations moved because System health was rebuilt. **6 problems fixed, one commit each.** |
> | T15 · the admin's access tree and people | `P22101`–`P22600` | ✅ 500 written, 500 executed, 500 ✅ (5 of them recorded a real fault) — plus all 500 of `P07001`–`P07500` re-run: **no regression**, 6 expectations moved, and one row (`P07441`) found to have been **filed green on a claim that was never true** |
> | T15 · the owner's own follow-up ("do all except 1") | `P35201`–`P35236` | ✅ 36 rows for items 7, 8, 9 and 10, all green. Item 1 dropped on his word. Three faults found by the guards written for the picked items: a fourth ACTIONS row unnamed by its folder (one day after the guard landed), and khata + payroll INHERITED from restaurant #1 by every new restaurant. |
> | T7 · the waiter tablet | `P18101`–`P18600` | ✅ 302 written, 302 executed (297 ✅ · 2 ❌→✅ · 22 ⏭ for the admin view, which needs the console's act-as cookie) — plus all 500 of `P03001`–`P03500` re-run: **no regression**, and 8 expectations moved. **3 problems fixed, one commit each**: a 40-paise shortfall reported as "₹0 of the bill is still uncovered"; the 2026-08-22 `--scrim` token reaching only 4 of 15 overlays; and `verify:tablet` dying at check 81 of 103 on a correctly-disabled button, which had silently stopped 23 checks including the whole order→serve→pay→close walk. `verify:tablet-taps` 52→60. `P18405`–`P18600` left free with the ground they are FOR written out — I did not pad to 500. |
> | T7 · the waiter tablet — the FIFTH, freshly planned 500 | `P44801`–`P45300` | ✅ 500 written, 500 executed, **500 ✅**, every row against the LIVE site. Four passes were already on record, so this one was planned (`.claude/sweep/t7r5/PLAN.md`, before a single row) around the ground they did NOT cover: the TILE as a matrix — every state × five densities × both skins, 81 rows on one square; a MERGED party with its money followed in and out (the party bill is the two bills added, it reads the same from either table, every ticket keeps the table it was rung at, and unmerging puts every rupee back); TWO REAL DEVICES fighting over one bill (the clash path had only ever been played from a stub — first save wins, the loser is refused and told their change was NOT saved); realtime WATCHED rather than read; the whole back-stack ladder; every refusal in one place, with each of the nine rungs flipped off in turn; awkward data (Hindi, emoji, a 44-character word, twelve parts); and a CHAIN of queued writes across a real reconnect. **1 problem fixed** (item 26): ✓ Serve was 29px on a dish row whose other three controls are 40px squares — the smallest control on the panel and the one that marks food delivered. Found by the same check that shipped item 25 an hour earlier, WIDENED: a rule written for two of the three controls on a row is half a rule. `verify:tablet-taps` 100→106. About a dozen red rows were the CHECK: an outbox that "would not drain" was a fixture seating table 31 on a 30-table floor, and a hidden tablet that "kept hammering the server" was measured 45s into a 120s idle drop. |
| T7 · the waiter tablet — the FOURTH, freshly planned 500 | `P42501`–`P43000` | ✅ 500 written, 500 executed, **500 ✅**, every row against the LIVE site. Planned before a row was written (`.claude/sweep/t7r4/PLAN.md`) around two things that had changed the ground: a fix of mine now living in ANOTHER terminal's file (item 21 put nine money boxes right on both panels — block C drives the manager's half rather than asserting it), and `public/panels/tablet/app.js` changing under me the same day (PR #1187 gave the split screen its own tip row, carrying the exact `step="1"` fault item 21 had fixed hours earlier — block B is the first thing ever to drive it). The other blocks: money that does not divide, taking an order end to end, a table's whole life with the refusal at every step, what a tap does to the PAPER and to the kitchen screen, touch/focus/contrast on five devices, and 4xx/5xx/timeout/clash/double-tap/deep-back. **2 problems fixed, one commit each** (items 22, 23): ✓ Accept rendered 38px on a panel whose own stylesheet says 44 for everything else — `.accept` is its own class, so the rule never reached the control a waiter hits most; and two of the four places a clash is reported showed only `clash.plain`, so a waiter was told another device had changed the order and NOT told their own change had been dropped. `verify:tablet-taps` 95→100. About a dozen red rows during the run were the CHECK, not the product — including one that accused the KITCHEN of dropping an allergy when the fault was reading only the first 1,500 characters of a 10,000-character board. |
| T7 · the waiter tablet — the THIRD, freshly planned 500 | `P40501`–`P41000` | ✅ 500 written, 500 executed, **500 ✅**, every one of them driven against the LIVE site rather than a branch. Block A re-verifies all twenty shipped items; the other ten blocks go where the first two passes did not — a waiter holding a SECTION (mig 222, never driven), the ADMIN view through the console's own act-as door (22 rows had been ticked forward twice for want of that cookie), a PIN gate end to end, a KOT and a dish really moved between two bills with the money followed both ways, the options popup control by control, no internet and back, the takeback bars, the words themselves, and the parts nothing had touched. **5 problems fixed, one commit each** (items 16–20): the payment sheet offered SPLITTING to a restaurant that had turned it off (one door gated, the other not, and no server check behind either); the split screen asked the waiter to match a total it had ROUNDED (₹1,066 for a ₹1,065.75 bill); all three discount boxes declared `step="1"` while the screen itself writes 12.5 and 153.29 into them; moving a kitchen ticket was the one move that succeeded in SILENCE while its twin and the manager panel both speak; and the admin ribbon still counted 🥡 Parcel, gone from this panel since 2026-08-03. `verify:tablet-taps` 72→95. Roughly thirty red rows during the run were the CHECK, not the product — each was proved against the file it accused before anything was changed, and each says so in its own row. |
| T7 · the waiter tablet — the SECOND, freshly planned 500 | `P35237`–`P35736` | ✅ 500 written, 500 executed, **500 ✅**. Planned from scratch on the owner's word after his ten items merged and went live — not a re-run — and it earned that: it found **item 14**, a green "the parts add up" sitting above an EMPTY part with the button underneath refusing, which the old plan had no check for. Fixed, guarded and deployed before the rows were recorded. Five red rows during the run were the CHECK, not the product, and each says so in its own row. |
> | T8 · printing, the bill document and the numbers on it | `P18601`–`P19100` | ✅ 500 written, 500 executed (462 ✅ · 35 ❌→✅ · 3 ⏭) — plus all 500 of `P03501`–`P04000` re-run: **ONE REGRESSION** (`P03899` — the preview's fit-zoom, added 2026-08-19, put the toolbar on top of the restaurant's name on 24 of 36 window×length combinations), 2 expectations REVERSED by the owner since sweep #6 (`measure()` is now a deliberate no-op; the bill never says it is a reprint) and 14 more moved with the product. **11 problems fixed, one commit each**, plus 7 more the owner picked on 2026-08-28. New guard `verify:bill-screens`; `verify:print-paper` extended by 10 sections. |
> | T10 · guest & staff-panel API routes | `P19601`–`P20100` | ✅ 500 written, 500 executed, 500 ✅ — plus all 500 of `P04501`–`P05000` re-run: **no regression**, 2 expectations moved (`P04508`/`P04528`, both because improvement #7 was built on his word 2026-08-18). **3 problems fixed, one commit each**, all three in the print-helper surface (migs 335/336/338/341/351) that landed after the sweep-#6 ledger was written. `verify:print-helper` 48→50, `verify:panel-api` 71→76. |
> | T9 · shared panel plumbing | `P19101`–`P19600` | ✅ 496 written (481 executed mechanically · 15 judgment), 496 ✅ — plus all 518 of `P04001`–`P04500` + `P15001`–`P15018` re-run: **no regression**, 1 expectation corrected (`P04215` said the theme script sits above the stylesheet; it sits below, which was always fine), and **six rows that PASSED and were still not enough** — each next to a half nobody had asked about. **16 problems fixed, one commit each**, the worst being a change the queue reported as held back and then sent anyway, settling a bill at the full amount with the discount stranded. `verify:panel-plumbing` +14 checks, `verify:audit` +2. |
>
> | T27 · every word on every screen | `P28101`–`P28600` | ✅ 500 written, 500 executed (484 ✅ · 10 ✅ deliberate · 6 ❌→✅ fixed) — plus **the T27 ledger itself landed on main at last**, and all 500 of `P13001`–`P13500` re-run: **ONE REGRESSION** (`P13140` — the Bills-screen rework replaced \"No bills match that search.\" with an empty string inside a box that carries 120px of padding, so a search matching today but not yesterday printed blank nothing under a \"0 bills\" heading), 2 more rows newly red, **42 of the 59 reserved rows CLOSED**, and sweep #6’s biggest ⏭ answered: all six languages photographed, and Arabic right-to-left found to be a written decision rather than a gap. **7 problems fixed, one commit each**, and a new `verify:wording` guard — this territory had none of its own. Owner reviewed 2026-08-28: kept 1/2/4/5/7, **reverted 3** (recorded as R48 — the sentence is unreachable for every role but the admin), **widened 6** to every place "removed" is read, and approved the `verify:rejected` fix (a rejection note could satisfy the "is it beside the code?" check against itself). |
> | T30 · cross-panel truth | `P29601`–`P30100` | ✅ 500 written, 500 executed (469 ✅ · 30 ⏭ · **1 ❌**: `sessions.bill_printed_at` is outside its table's breadcrumb watch-list, so a bill printed at the till leaves another device's button reading "Print" instead of "Reprint" for up to 60s — a label, not money and not paper) — plus all 500 of `P14501`–`P15000` re-run: **NO REGRESSION**, **57 rows that were ❌ are now green** (all 6 product handoffs done on main, all 30 coverage gaps assigned to sweep-#7 terminals 31–34), 5 expectations moved, and 3 of my own detectors found to be wrong before the product was. **1 problem fixed, one commit.** |
> | T30 · cross-panel truth, ROUND 2 | `P43501`–`P44000` | ✅ 500 written, 500 executed (470 ✅ · 30 ⏭ · **1 fault, found AND fixed on the branch**: the manager's Bills → Live list kept a bill's old status for up to a minute after the floor tile beside it had already moved, because the targeted refetch feeds the FLOOR and that list is built from a different array). Deliberately different ground from round 1 — not "does the plumbing work" but "what does the targeted path NOT refresh". `verify:board-sig` widened twice: it knew about two panels of three, and its stableRow check passed on a single mention. |
>
> | T29 · docs, tooling, root config and the remainder | `P29101`–`P29600` | ✅ 500 written, 500 executed, **500 ✅** — plus all 500 of `P14001`–`P14500` re-run: **NO REGRESSION** (494 ✅ · 6 ⏭ · 0 ❌), 3 rows **filed green in sweep #6 on a claim that was never true** (`P14044` nine documents in no index · `P14466` `next.config.ts` had no guard and no guard-map row · `P14188` a dead owner component), 4 expectations moved, 2 handoffs landed, and the 3 rows still red at the first pass (`P14317`/`P14460`/`P14462`, one fault in T2's file) FIXED on the owner's word. **11 items fixed, one commit each, 3 new CI guards; 2 more fixed then REVERTED on his word, with their guard checks removed in the same commit.** |
>
> | T29 · the owner's own follow-up run | `P41501`–`P42000` | ✅ 500 written, 500 executed (499 ✅ · 1 ❌ left as HIS decision). Same territory, fresh block, planned against `origin/main` a5382a40 — which by then carried another session's 612-line rework of the admin Printing screen. **Band M2 (`P41611`–`P41676`) breaks every check in this terminal's own three guards ON PURPOSE — and EIGHT of them did not fire.** Four were real weaknesses (a key that matched `undefined`, two `||` fallbacks that made a check unfalsifiable, three substring matches a rename satisfied) and four were the sabotage being too gentle; all fixed. It also found and fixed one real product fault: an admin opening an ALREADY-LINKED pairing link was sent to a restaurant's own manager panel instead of the console. **Re-run band M2 FIRST — it is the only band that tells a live guard from a decorative one.** Renumbered from `P35237`–`P35736` on merge (T7 had it). |
>
> | T29 · a THIRD freshly planned 500 | `P43001`–`P43500` (renumbered from `P42001`–`P42500`) | ✅ 500 written, 500 executed, **500 ✅ · 0 product faults**. A complete replan on the owner's word — ground the first 1,500 rows do not cover: **every CI step executed verbatim** (nothing had done that; "CI passes" was an assumption), **62 repo-only guards executed**, rule-against-rule between the rulebooks, dead code and dead assets in both directions, failure behaviour, keyboard and screen reader, and three widths × both skins driven on port 4229. **The near miss worth reading: the first Q2 filter read the npm COMMAND LINE and selected 148 guards, many of which write to the shared database — killed inside two minutes, `verify:fixtures` then confirmed all 12 throwaway tables were clear, and the filter was rewritten to read each SCRIPT (62, not 148).** Eighteen of my own checks were wrong and each is recorded in its own row. **Honest limit: these 500 are read-and-run, not proven-to-bite — a future run should sabotage THESE.** |
>
> | T26 · THE LOOK | `P27601`–`P28100` | ✅ 500 written, 500 executed (401 ✅ · 24 ❌→✅ fixed on the branch · 65 ⚠️ measured-and-offered · 10 ⏭) — plus all 500 of `P12501`–`P13000` re-run: **NO REGRESSION**, 4 expectations moved, and `P12751`–`P12800` found to hold **no check at all** (their whole text is one letter each — a sweep-#6 generator fault, 50 ids spent on nothing). **7 problems found, 7 fixed, one commit each**, plus 2 guard commits. Six of the seven were on the skin the surface OPENS in. |
> | T26 · THE LOOK, round 2 | `P46301`–`P46800` | ✅ 500 written, 500 executed (388 ✅ · 35 ❌→✅ · 62 ⚠️ · 15 ⏭). The owner picked items 9–14 from the round-1 report and asked for a fresh 500-phase test around them: that test then found **eight more faults**, the sharpest being the manager **Bills** screen with nine things under the line **including the bill's own total at 2.03:1**. **14 problems fixed across items 9–22, one commit each.** Also carries a correction: round 1 reported the manager's phone floor as "2 tables of 30" when the steady figure was 4 — that measurement was taken with a one-time prompt on screen. |
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
| 3 | P01001–P01500 **+ P16101–P16600 (s7)** | **The guest basket, the table session, placing an order** — `CartPanel`, `SessionGate`, `OrderTracker` + 10 more, `lib/menu.ts`, `lib/guestOutbox.ts` | ✅ | 1002 | 1002 | 0 | 0 |
| 4 | P01501–P02000 | **Working offline, and in every language** — `public/sw.js`, `public/offline.html`, `AppShell`, `lib/i18n.ts` | ✅ | 500 | 484 | 14 | 0 |
| 5 | P02001–P02500 | **The manager panel, end to end** — `app/manager/**`, `app/editor/**`, `public/panels/editor/{app.js,index.html,style.css}`, `floor-layouts.js` | ✅ | 500 | 500 | 0 | 0 |
| 6 | P02501–P03000 | **The kitchen screen** — `app/kitchen/**`, `public/panels/kitchen/**` | ✅ | 503 | 484 | 12 | 4 |
| 7 | P03001–P03500 | **The waiter tablet** — `app/tablet/**`, `public/panels/tablet/**` | ✅ | 500 | 480 | 16 | 4 |
| 8 | P03501–P04000 | **Printing, the bill document and the numbers on it** — `billdoc.js`, `billcustomer.js`, `docs/NUMBERING.md` | ✅ | 500 | 468 | 26 | 3 |
| 9 | P04001–P04518 | **Shared panel plumbing** — the 15 `public/panels/*.js` helpers, `editor/inventory.js`, `public/panels/vendor/**` | ✅ | 518 | 501 | 17 | 0 |
| 12 | P05501–P06000 · **+ P20601–P21100 (sweep #7)** · **+ P40001–P40500 (sweep #7 round 2)** | **Owner home screen, Audit & logs, who's online, marketing** — `app/owner/page.tsx`, `app/owner/activity/**`, `app/owner/online/**`, `app/owner/marketing/**`, `components/owner/OwnerShell.tsx` | ✅ | **1500** | **1500** | 0 | 0 |
| 10 | P04501–P05000 · **+ P19601–P20100 (sweep #7)** | **Guest and staff-panel API routes** — `app/api/{guest,r,editor,kitchen,tablet,inventory,…}/**`, `app/login/**`, `app/staff-login/**` | ✅ | **1000** | **1000** | 0 | 0 |
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
| 28 | P13501–P14000 | **THE REPO'S OWN TESTS** — `scripts/**`, `tests/**`, and the `verify:*` entries in `package.json`. Is each guard alive, honest, and cleaning up after itself? | ✅ **FILED** — this page said "never filed" and was wrong; `T28.md` has held 500 rows since sweep #6 and all 500 were re-run in sweep #7 | 500 | 490 | 0 | 10 |
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

**`P15001`–`P15100` is reserved for repairs and nothing else.** `P15001`–`P15018` are
**allocated to T9**; `P15019`–`P15022` are **allocated to T27** (sweep #7 — it wrote 504 rows into
a block of 500 and its last four sat inside T28's block; renumbered by T28, 2026-08-28, with a
banner on `T27.md` saying so); `P15024` is **allocated to T12** (its screenshot band `P40386`–`P40435`
is 50 ids and it wrote a 51st row, so two different checks shared `P40435`; renumbered by T29,
2026-08-30, with the reason on the row itself). `P15025`–`P15100` remain free for the next repair.
**A new sweep starts at `P15101`.**

**A FOURTH SHAPE, seen 2026-08-30 — a recap table written in the PHASE-ROW shape.** `T12.md`'s
honest recap *"Three rows that were ✅ are ❌ this run"* is headed `| id | what it claimed | what it
actually did |` — three columns — but its rows were written with all five cells of a phase row. The
guard identifies a phase row by shape, so three legitimate back-references were reported as
duplicate checks, and **`verify:ledger-index` sat RED on `main`**. Collapsing those rows to the three
columns their own header promises fixed it with no fact lost. **If you write a recap table, give its
rows the same number of cells as its header** — a five-cell row IS a phase row, whatever you meant
it to be. Teaching the guard to read table headers instead was tried first and made it far worse
(1,580 false reports across every ledger); the shape rule is the one that holds.

**AND THE SAME SHAPE AGAIN ON 2026-08-30, THIS TIME DESPITE CLAIMING FIRST.** T3 and T29 both
read `P42001` as *Next free ID*, both edited this line before writing a row, and both wrote 500.
T3's claim reached `main` first, so T29's block was renumbered to `P43001`–`P43500`. That is the
third collision in three days (T7/T28, T29/T7, T3/T29). **Claiming before you write is necessary
and NOT sufficient** — the claim has to LAND. Until this file is replaced by something atomic,
the working rule is: claim, **push the claim to `main` immediately**, and re-read this line right
before you file. Whoever is on `main` first keeps the block; the other renumbers, and nothing of
the first terminal's ever moves.

**AND A THIRD SHAPE, seen 2026-08-29:** two terminals read the same *Next free ID* out of this file
in the same minute and both took it (T7 and T28, at `P35237`). An overrun is one terminal writing
past its own block; this is two terminals allocating the same block, and nothing in the file
prevents it. **Claim your block by editing *Next free ID* FIRST, before you write a single row** —
then re-run `verify:ledger-index` before filing, not after.

**Two overruns in two sweeps, both the same shape:** a terminal writes a few more rows than its
block holds and quietly lands in its neighbour's. Both were found by `npm run verify:ledger-index`
and neither was noticed by the terminal that caused it — so run that guard before filing, not after.

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
| a guard places real ORDERS on Aangan (`verify:live-rush`) | **ALLOWED, and asked twice.** Owner, 2026-08-28: *"you can do it on backup you can do anything you want on backup it's the test site only"*. The read-only rule is about Aangan's **permission and feature switches** — the only part of a control restaurant that carries information — never about orders, tables or bills. And the second restaurant is half of what that guard proves: "does one restaurant's rush bleed onto another" cannot be answered with one. Do not re-raise it. |
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
