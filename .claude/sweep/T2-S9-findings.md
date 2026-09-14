# T2 — SWEEP #9 findings (the 3D dish viewer & the dish page)

Terminal 2 of 40. Branch `sweep9/t2-dish-page-and-3d`, worktree `../wt-s9-t2`, production build on
port **4402**, against `origin/main` **b8d27f15**.

The four-part report for the owner is in the terminal, not here — that is where sweep #9 reports.
This file is the record of the problems found and fixed, as `S9-RULES.md` §6 asks.

| | |
|---|---|
| ledger rows re-run | **2,956** — 2,938 in `T2.md` (2,226 re-read, 695 re-driven) + 18 in `T1/T4/T27/T28/T30` |
| new checks written | **50** — `P101701`–`P101750`. `P101751`–`P101800` unused, free inside this block |
| REGRESSIONS | **0** — no row that was green has broken |
| rows found WRONG on re-run | **17** — sixteen that were never measured, and one that was fixed elsewhere |
| problems found | **3** · fixed **3** |
| improvements built | **0**, by the owner's instruction for this run |

## The foundation of the re-run, so it can be checked rather than believed

`git log --since=2026-09-02` over `app/item/**`, `app/view/**`, `components/PublicModelViewer.tsx`
and `lib/modelLoader.ts` is **empty** — all seven files are byte-identical to the commits at which
sweep #8 verified them. `app/globals.css` has taken four commits since; every selector this
territory depends on was diffed and none was touched. So the source-shape rows are true by
construction as well as by re-reading, and the run's effort went where the ledger had only ever
*read*.

## 1 — every triple-tap replay left another animation loop running

`app/view/[folder]/ViewerClient.tsx`. The hint pill on the 3D screen invites a diner to triple-tap
the dish to replay the reveal. Each replay started a fresh connector-line loop and never stopped the
previous one; `requestRef` only ever held the newest frame handle.

**Measured** at 360×780, counting real layout reads per second on the working 3D screen: **936 after
one reveal, 4,356 after three more triple-taps** — 4.65× the work per frame, for as long as the
diner stays. Ten replays is eleven loops. **After: 1,080 and 1,080.**

Sweep #7's item 1 fixed the half where a chain outlives the screen (`aliveRef`). This is the half
that was missing while the screen is still *on* screen. A generation counter retires the old chain;
the call site cancels the pending frame in the same breath as bumping it. Commit `item 1`.

## 2 — four guest screens were written in a language this app does not speak

`app/view/[folder]/ViewerClient.tsx` (three) and `components/PublicModelViewer.tsx` (one). The
"this menu isn't available", "3D preview isn't available", "3D view unavailable" and "3D view isn't
ready for this dish" screens were laid out entirely with Tailwind utility classes.

**`app/globals.css` is this app's only stylesheet and it never imports Tailwind**, so no utility is
generated and every one of those names matched nothing. Measured on the running 3D route: a fresh
`<div class="flex p-4 text-white">` computes `display:block`, `padding:0px`, `color:rgb(60,42,30)`.
All four rendered as unstyled text glued to the top-left corner in the page's inherited brown —
**1.39:1** against the viewer's near-black canvas. The "← Back" link, the only way off two of them,
was the same invisible brown.

They now wear `.try-again-card`, the card this same screen already shows when a model is slow.
**After: 13.75:1 dark, 13.62:1 light**, and every way out is a real accent pill that hit-tests to
itself. Commit `items 2 and 3`.

**Sixteen ledger rows asserted the opposite and were never measured** — `P96395`–`P96470`, each
saying a class's "rule comes from Tailwind, not the stylesheet", verified by *read*. All sixteen are
now ❌ in `T2.md` with the measurement, and retired by this fix. Both they and the guard's own
comment blamed Tailwind's layer order; there is no layer, because there are no utilities.

**It reaches seven more files outside this territory** — `app/owner/reports/page.tsx`,
`app/aevinite/staff-online/page.tsx`, `components/owner/{OwnerManagerMode,OwnerReportButton,reports/DishReports}.tsx`,
`components/admin/{StaffProfile,AccessTree}.tsx`. Not touched: not this terminal's files. Raised for
the owner as a decision.

## 3 — and that card had lost its own spacing, for a second reason

`app/globals.css` carries `.viewer-wrapper *{margin:0;padding:0;…}`, a universal reset at the same
specificity as `.try-again-card` and declared later in the file, so it wins every tie.

**Measured on the REAL slow-model overlay**, with every GLB held open so it arrives at 15s: card
padding **0px** against the stylesheet's 28px 24px, emoji/title/message margins all 0px, and
"Go back" — the only way off that screen — rendered **76×17px and clipped by the card's own bottom
edge**, against a 44px tap-target guideline. **After: 124×41px, inside a padded card.** That screen
is what a diner meets whenever a model is slow, which on restaurant wi-fi is often. This screen was
never written in Tailwind, so it is a genuinely separate cause from item 2.

Commit `items 2 and 3` — one commit, because the two causes touch the same lines of the same four
screens and cannot be un-picked separately.

## The guard

`verify:3d-viewer` grew **8 checks**, and each family was proven to bite by mutation (5 mutations,
5 reds; an emoji-only change stayed green). It also lost a block that had been asserting nothing —
`{ const code = src[ITEM_CLIENT]; }`, left behind when owner's item 12 deleted its subject on
2026-09-02 — and one pre-existing check was **widened**, not weakened: it was pinned to
`const _loop = () => {` and went red for item 1's new parameter while the behaviour it defends was
untouched.

Green on this branch: `verify:3d-viewer`, `verify:guest` (53/53 static, **124/124** live on 4402),
`verify:cache`, `verify:slow-load`, `verify:rejected`, `verify:clash-coverage`, `npm run typecheck`.

## Two ⏭ rows in another terminal's ledger were run rather than skipped again

`T27.md`'s `P28583` and `P28584` reserved "the dish page / the 3D chrome rendered in all six
languages, screenshotted, and LOOKED at". Both were driven at 390×844 dpr3 and the shots Read.
Arabic shapes correctly on the 3D screen and Devanagari on the dish page; nothing clipped, nothing
past the right edge, no sideways scroll, in any of the twelve. The dish name and hotspot cards stay
English — **R23, parked by the owner, not raised.**

## What was NOT fixed, and why

A 3D link for a restaurant that has closed, or whose address has changed, lands on a screen with
**0 tappable controls** — its two siblings on the same screen both have a way out. Not built: the
destination is only clean for one of the three reasons that screen appears, so which way out (or
none) is a product choice, and this run lists improvements rather than building them. `P101750`.
