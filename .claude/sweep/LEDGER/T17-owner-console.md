# SWEEP #8 · TERMINAL 17 (wave 3) — the owner's Settings, Menu editor, Manager mode and the console shell

> ### ⚠️ WHY THIS FILE IS NOT CALLED `T17.md`, AND WHY THAT MATTERS
>
> **`T17.md` is already taken, by a different territory.** It is sweep #6's terminal 17 — the
> ADMIN's health, logs, issues and limits (`P08001`–`P08500` plus a second round, 1,035 rows) — and
> `T17-R2.md` is sweep #8's *earlier* terminal 17, the ADMIN CONSOLE (`P98201`–`P98727`) — a suffixed
> name that terminal chose for exactly this reason. Sweep #8
> re-cut the territories from the real file structure, so **the terminal NUMBER no longer identifies
> a territory**: three different runs have been "terminal 17" and none of them owned the same files.
>
> This file was very nearly written straight over `T17.md`, which would have destroyed 1,035
> permanent numbered checks belonging to a territory this terminal has never even opened. Caught
> before the commit. `verify:ledger-index` would have caught it too — it keeps a per-file row floor
> in `ROW-COUNTS.json` and fails on a SHRINK with the words *"A sweep APPENDS its section; it never
> overwrites the file."* **Run that guard before committing a ledger, every time.**
>
> So: **name a ledger for its TERRITORY, not for the terminal number that happened to draw it.**

Sweep #8, wave 3, terminal 17 of 40, 2026-09-04, against `origin/main` **7c154754**.
Phase IDs **P70701–P71700** are pre-allocated to this terminal and are permanent: the next sweep
re-runs these rows first and only then adds new ones. **Never renumber one. Never reuse one.**
562 of the 1,000 are used (`P70701`–`P71275`); `P71276`–`P71700` are free for the next round.

**Branch** `sweep8/t17-owner-settings-and-shell` · **worktree** `../wt-s8-t17` · **port** 4317.

## The territory this ledger covers

Re-derived from the file tree, not inherited from the prompt:

```
app/owner/manager/page.tsx              components/owner/OwnerShell.tsx
app/owner/menu/page.tsx                 components/owner/OwnerManagerMode.tsx
app/owner/settings/page.tsx             components/owner/OwnerMenuEditor.tsx
components/owner/AnimatedNumber.tsx     components/owner/OwnerReconnecting.tsx
components/owner/ownerProfileHost.ts    components/owner/OwnerReportButton.tsx
components/owner/ownerReportDoc.ts      components/owner/useOwnerSkin.ts
components/owner/ownerRestaurantSort.ts (NEW this run — see finding 3)
```

**Deliberately NOT mine, and left alone:** `components/owner/Charts.tsx` and
`components/owner/reports/**` (T14 — owner reports and charts), and
`components/owner/OwnerInventory.tsx` (the Inventory module's own screen). `app/globals.css` is
shared and was not edited — the one CSS-shaped fault found here was fixed by changing the class the
component asks for, not by adding a rule to a file nine other terminals are reading.

**The owner console has its own light mode and its key is `aevidine_skin`** — not `lfh_theme` (the
guest menu's) and not `lfh_panel_theme` (the staff panels'). Rows below assert that in both
directions, including the one thing that looks alarming and is not: `lfh_panel_theme` DOES appear in
localStorage after a visit to `/owner/menu`, because the embedded panel boots
`public/panels/theme.js` on the same origin and that script materialises the staff default. The
owner's own choice never reaches it — measured both ways (see `P71214`, `P71215`).

## What this run did

| | |
|---|---|
| earlier sweeps' rows re-run | **183**, updated in place across 16 ledger files · **0 regressions** |
| new rows filed | the 562 below, generated FROM the run, never typed |
| problems found | 4, all fixed on this branch, one commit each |
| new guard | `npm run verify:owner-shell` — 98 static checks, sabotage-tested 26 for 26 |

Full write-up: `.claude/sweep/T17-owner-console-findings.md` — **not** `T17-findings.md`, which is
sweep #6's admin-health territory and was very nearly overwritten too. The owner's four-part report went into the terminal
window, which is where he reads it.

## How to re-run every row in this file

```sh
cd <this worktree> && PORT=4317 npx next dev -p 4317      # the app, on THIS terminal's port
npm run verify:owner-shell                                # the static half (no server needed)
node scripts/sweep/t17/report-checks.mjs                  # the report document, pure, no server
node scripts/sweep/t17/live.mjs                           # every page × role × skin × size
node scripts/sweep/t17/interact.mjs                       # taps, toggles, Back presses, the dialog
node scripts/sweep/t17/rows.mjs --write                   # re-generate the table below FROM the run
```

`rows.mjs` is the only thing that writes the table below. A hand-edited result column is a lie
waiting to be believed, and the whole point of a ledger is that "re-run P70942" means something.

## New rows

<!-- ROWS:START -->
| id | what it checks | how | result | note |
|---|---|---|---|---|
| P70701 | §1 nothing uses `adm-page-title`, a class no stylesheet declares | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70702 | §1 the Manager-mode launcher heads itself with the console's own heading class | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70703 | §1 …and that class is really declared in the stylesheet | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70704 | §1 …while `adm-page-title` still is not (do not add it — remove the usage) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70705 | §2 the Manager-mode launcher colours its dot by restaurant ID | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70706 | §2 …and never by the restaurant's brand accent | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70707 | §2 the Manager-mode page reads no brand-accent column it does not use | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70708 | §2 both of the shell's restaurant dots (sidebar + top switcher) are keyed by ID | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70709 | §2 …and no restaurant dot anywhere here is painted a fixed colour instead | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70710 | §2 …and the shell keeps no brand-accent field it never reads | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70711 | §3 there is one sorter for the cockpit's restaurant lists | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70712 | §3 …and it orders "Branch 2" before "Branch 10" | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70713 | §3 the sidebar + top switcher calls it | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70714 | §3 the Menu picker calls it | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70715 | §3 the Manager-mode launcher calls it | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70716 | §3 …and BOTH of the Manager-mode page's branches do (a real owner and the admin act-as) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70717 | §3 the Menu page's default restaurant is taken from the SORTED list, so `ids[0]` means something | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70718 | §4 no useState initializer writes to storage (React may run it twice) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70719 | §4 the reconnect card counts an attempt at the moment it retries | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70720 | §4 …and BOTH the timer and the Retry-now button go through it | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70721 | §5 no file in this territory touches `lfh_theme` or `lfh_panel_theme` | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70722 | §5 the header toggle writes the skin to localStorage AND to the cookie the server reads | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70723 | §5 the Settings screen's Light/Dark buttons write both, the same way | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70724 | §5 dark stays the default when no choice has been made | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70725 | §5 the Menu page reads the skin cookie with the shell's own default | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70726 | §5 the Manager mode page reads the skin cookie with the shell's own default | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70727 | §6 the live skin reaches an embed by message | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70728 | §6 the Menu embed's address carries only the skin it was BORN with | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70729 | §6 …and interpolates that, not the live value (which would reload the panel) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70730 | §6 the Manager-mode embed does the same | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70731 | §6 a frame that finishes loading after a toggle is told again | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70732 | §6 …and so is the shared embed mount | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70733 | §6 the skin message is addressed to this origin, not to "*" | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70734 | §7 Manager mode renders no JSX <iframe> (React assigns src after insertion → a history entry) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70735 | §7 the Menu editor renders no JSX <iframe> (React assigns src after insertion → a history entry) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70736 | §7 Manager mode builds its frame in code | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70737 | §7 the shared mount sets src BEFORE insertion | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70738 | §7 …and only then puts the element in the page | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70739 | §7 both embeds pass the phone's notch/gesture insets into the panel | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70740 | §8 the shell's "owner-xray-zones" overlay closes on the phone's Back button | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70741 | §8 the shell's "owner-nav" overlay closes on the phone's Back button | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70742 | §8 the shell's "owner-rest-switch" overlay closes on the phone's Back button | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70743 | §8 Back inside the floor peels back to the launcher | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70744 | §8 Back closes the Generate-report dialog | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70745 | §8 the owner's person profile registers NO layer — it is a real page with its own address (two layers = a dead first Back press) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70746 | §9 the Menu page awaits searchParams (Next 16 async params) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70747 | §9 the Menu page awaits cookies() | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70748 | §9 the Menu page names its columns, never select("*") | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70749 | §9 the Menu page stays a server component | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70750 | §9 every restaurants read on the Menu page is scoped by id | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70751 | §9 the Menu page identifies the caller before its first database call | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70752 | §9 the Manager mode page awaits searchParams (Next 16 async params) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70753 | §9 the Manager mode page awaits cookies() | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70754 | §9 the Manager mode page names its columns, never select("*") | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70755 | §9 the Manager mode page stays a server component | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70756 | §9 every restaurants read on the Manager mode page is scoped by id | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70757 | §9 the Manager mode page identifies the caller before its first database call | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70758 | §9 Manager mode re-checks the admin's section switch on the server, not only in the sidebar | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70759 | §9 the Menu page re-checks the admin's Menu switch on the server too | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70760 | §9 the Menu page answers a FAILED READ separately — "I couldn't ask" is never "it is switched off" | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70761 | §9 a section he has not been given sends him home instead of naming it (R36) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70762 | §10 the What's-enabled card lists what is ON, absent meaning ON like the server | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70763 | §10 …and shows no off-state at all (R36 — the owner never sees what is withheld) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70764 | §10 …and no "6 of 9" count, which would disclose the same thing | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70765 | §10 a failed printing read says so, instead of looking like printing being off | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70766 | §10 the printing poll does not run when there is no printing card on screen | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70767 | §10 …and it stops while the tab is in the background | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70768 | §10 the Settings screen has exactly ONE repeating timer | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70769 | §10 a printing row only shows the answer that is about ITS restaurant | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70770 | §10 the printer setup guide is reachable from here | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70771 | §10 the password form checks the match and the length before asking the server | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70772 | §10 …and a changed password lands the owner on the sign-in screen | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70773 | §10 every gated sidebar section has a chip on the What's-enabled card | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70774 | §10 the Guest-ratings chip says which screen it lives on, because it is not a sidebar row | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70775 | §11 BOTH scope chips (the switcher's and the single-restaurant pill) still read "Owner overview" — R20 says do not name the page | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70776 | §11 signing out is a POST form, not a link a prefetch could follow | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70777 | §11 a one-restaurant owner gets no restaurant list and no switcher | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70778 | §11 a restaurant whose Reports are off says "hidden", never a confident ₹0 | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70779 | §11 a withheld section disappears for the real owner and is only tinted for the admin | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70780 | §11 the switcher re-scopes Dashboard, Reports/Audit and Manager mode in place | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70781 | §11 the crumb's section tap reaches Manager mode's own channel too (a tap must never vanish in silence) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70782 | §11 the sidebar's figures refresh on the activity-gated 60s cadence, once | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70783 | §11 …and the shell starts no bare interval of its own | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70784 | §12 the printed sheet escapes at the sink, and tolerates a null label | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70785 | §12 a negative figure reads −₹, never ₹- | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70786 | §12 every figure is grouped the Indian way | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70787 | §12 …including the count-up numbers on screen | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70788 | §12 the money flow's "total collected" is COMPUTED on the page, so the printed sum adds up | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70789 | §12 the Excel sheet escapes every title, header and cell | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70790 | §12 the CSV is quoted and carries a byte-order mark so ₹ survives Excel | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70791 | §12 a blocked pop-up is reported into the dialog, not swallowed | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70792 | §12 …and so is a failed download, which has no tab to apologise in | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70793 | §12 Escape closes the dialog, but never while a report is compiling | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70794 | §12 the print tab is opened inside the click, before any await (or the blocker eats it) | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70795 | §12 the period list offers the financial year, 12 months and this week | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70796 | §12 no custom date can be set in the future | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70797 | §12 an incomplete statement says so on the paper itself | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70798 | §13 no screen in this territory writes the settings table directly | `npm run verify:owner-shell` — static, comments stripped | ✅ |  |
| P70801 | moneyInHand = gross − discount | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70802 | moneyInHand is null when gross is unknown | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70803 | moneyInHand is null when the discount is unknown | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70804 | the printed money flow states the taxable amount | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70805 | the printed money flow ends on MONEY IN HAND | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70806 | total collected = gross − discount + GST, printed | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70807 | the sheet prints Indian grouping, never American | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70808 | the discount rate is a percentage of gross | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70809 | a restaurant name with & and < is escaped in the printed sheet | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70810 | a tax-component label with < > is escaped in the printed sheet | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70811 | a dish title with & is escaped in the printed sheet | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70812 | the spreadsheet tables carry the RAW name, not HTML entities | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70813 | the spreadsheet tax label is raw too | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70814 | the printed sheet contains no undefined / NaN / [object Object] / ${ | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70815 | the printed sheet contains no undefined / NaN / [object Object] / ${ | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70816 | the printed sheet contains no undefined / NaN / [object Object] / ${ | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70817 | a negative figure prints as −₹, never ₹- | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70818 | an incomplete statement says so on the paper | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70819 | one omitted restaurant reads 'it is', not 'they are' | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70820 | two omitted restaurants read 'they are' | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70821 | the spreadsheet leads with the INCOMPLETE table | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70822 | …and does not when nothing was omitted | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70823 | a 120-day window caps the printed day table and says so | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70824 | …and prints exactly 92 day rows | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70825 | the spreadsheet carries the COMPLETE series, uncapped | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70826 | a 1-row day series prints no day table at all | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70827 | day-of-week needs day grain | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70828 | day-of-week needs at least a week of rows | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70829 | a 30-day day-grain window does print day-of-week | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70830 | the best weekday is starred | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70831 | dayparts print when the hours are spread | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70832 | dayparts stay away when every hour is empty | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70833 | hours 0–5 fold into the late-night band, not out of every band | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70834 | slow movers stay away on a small menu (<8 sold) | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70835 | slow movers appear on a menu of 12 | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70836 | the slow-mover sheet lists the WEAKEST first | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70837 | the slow-mover sheet lists five | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70838 | every top-dish row carries a verdict | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70839 | the verdicts come from the four named buckets only | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70840 | the printed sheet explains what a verdict means | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70841 | the day sheet's money column is headed 'Collected' in both places | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70842 | the day sheet also carries 'In hand' | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70843 | 'In hand' per day = gross − discount | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70844 | every day row has as many cells as the header | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70845 | table "Aevidine business performance repo" rows match its header width | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70846 | table "Settlement | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | all" rows match its header width |
| P70847 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | billing &" rows match its header width |
| P70848 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | settlemen" rows match its header width |
| P70849 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | top dishe" rows match its header width |
| P70850 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | slow move" rows match its header width |
| P70851 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | dayparts" rows match its header width |
| P70852 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | day-of-we" rows match its header width |
| P70853 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | category " rows match its header width |
| P70854 | table "My Little French House | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | day-by-da" rows match its header width |
| P70855 | the Pay Later block stays away when nothing is outstanding | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70856 | …and appears with a point-in-time caveat when there is | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70857 | the spreadsheet carries the same Pay Later block | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70858 | two restaurants get a comparison table | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70859 | …and each section is numbered | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70860 | …and each starts on a new printed page | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70861 | one restaurant gets NO comparison table | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70862 | one restaurant's section is not numbered | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70863 | two restaurants get a whole-scope day sheet | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70864 | one restaurant does NOT (its own sheet covers it) | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70865 | the group slow-mover sheet names WHO serves each dish | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70866 | a 30-day window names the best and the weakest day | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70867 | a 5-day window names neither | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70868 | an hour-grain window names neither | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70869 | a period with no sales still produces a document | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70870 | …and says so instead of an empty dish table | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70871 | …with no divide-by-zero anywhere | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70872 | …and the discount rate is not printed on zero gross | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70873 | …and the spreadsheet is still built | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70874 | growth prints ▲ with a + | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70875 | a fall prints ▼ | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70876 | no previous figure prints no comparison, and says what the number is instead | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70877 | a previous figure of 0 prints no comparison (no divide by zero) | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70878 | the document prints itself once it has loaded | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70879 | …after a settle delay, not instantly | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70880 | the footnote defines Total collected and Money in hand | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70881 | the sheet is A4-margined for a real printer | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70882 | the document declares its charset | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70883 | the tab title names the scope and the period | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70884 | settlement totals to 100% | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70885 | settlement is absent when no payment method is known | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70886 | a share of a zero total reads | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ | rather than 0% |
| P70887 | the spreadsheet summary states the active-day count | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70888 | …and the average collected per active day | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70889 | …and neither appears for a single-day window | `node scripts/sweep/t17/report-checks.mjs` — the report document as a pure builder | ✅ |  |
| P70901 | Settings · owner · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P70902 | Settings · owner · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70903 | Settings · owner · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70904 | Settings · owner · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70905 | Settings · owner · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70906 | Settings · owner · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P70907 | Settings · owner · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P70908 | Settings · owner · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70909 | Settings · owner · desktop · dark: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70910 | Settings · owner · desktop · dark: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70911 | Settings · owner · desktop · dark: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70912 | Settings · owner · desktop · dark: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70913 | Settings · owner · desktop · dark: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70914 | Settings · owner · desktop · dark: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70915 | Settings · owner · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Settings |
| P70916 | Menu · owner · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P70917 | Menu · owner · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70918 | Menu · owner · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70919 | Menu · owner · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70920 | Menu · owner · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70921 | Menu · owner · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P70922 | Menu · owner · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P70923 | Menu · owner · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70924 | Menu · owner · desktop · dark: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70925 | Menu · owner · desktop · dark: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark |
| P70926 | Menu · owner · desktop · dark: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark |
| P70927 | Menu · owner · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Menu |
| P70928 | Manager mode · owner · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P70929 | Manager mode · owner · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70930 | Manager mode · owner · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70931 | Manager mode · owner · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70932 | Manager mode · owner · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70933 | Manager mode · owner · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P70934 | Manager mode · owner · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P70935 | Manager mode · owner · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70936 | Manager mode · owner · desktop · dark: the live floor is embedded straight away | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&ownermode=1&skin=dark |
| P70937 | Manager mode · owner · desktop · dark: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70938 | Manager mode · owner · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Manager mode My Little French House |
| P70939 | Settings · owner · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P70940 | Settings · owner · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70941 | Settings · owner · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70942 | Settings · owner · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70943 | Settings · owner · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70944 | Settings · owner · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P70945 | Settings · owner · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P70946 | Settings · owner · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70947 | Settings · owner · desktop · light: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70948 | Settings · owner · desktop · light: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70949 | Settings · owner · desktop · light: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70950 | Settings · owner · desktop · light: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70951 | Settings · owner · desktop · light: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70952 | Settings · owner · desktop · light: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70953 | Settings · owner · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Settings |
| P70954 | Menu · owner · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P70955 | Menu · owner · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70956 | Menu · owner · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70957 | Menu · owner · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70958 | Menu · owner · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70959 | Menu · owner · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P70960 | Menu · owner · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P70961 | Menu · owner · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70962 | Menu · owner · desktop · light: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70963 | Menu · owner · desktop · light: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=light |
| P70964 | Menu · owner · desktop · light: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=light |
| P70965 | Menu · owner · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Menu |
| P70966 | Manager mode · owner · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P70967 | Manager mode · owner · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70968 | Manager mode · owner · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70969 | Manager mode · owner · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P70970 | Manager mode · owner · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70971 | Manager mode · owner · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P70972 | Manager mode · owner · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P70973 | Manager mode · owner · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70974 | Manager mode · owner · desktop · light: the live floor is embedded straight away | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&ownermode=1&skin=light |
| P70975 | Manager mode · owner · desktop · light: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70976 | Manager mode · owner · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Manager mode My Little French House |
| P70977 | Settings · owner · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P70978 | Settings · owner · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70979 | Settings · owner · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70980 | Settings · owner · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P70981 | Settings · owner · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70982 | Settings · owner · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P70983 | Settings · owner · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P70984 | Settings · owner · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70985 | Settings · owner · A35 phone · dark: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70986 | Settings · owner · A35 phone · dark: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70987 | Settings · owner · A35 phone · dark: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70988 | Settings · owner · A35 phone · dark: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70989 | Settings · owner · A35 phone · dark: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70990 | Settings · owner · A35 phone · dark: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70991 | Settings · owner · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerSettings |
| P70992 | Menu · owner · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P70993 | Menu · owner · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70994 | Menu · owner · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70995 | Menu · owner · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P70996 | Menu · owner · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P70997 | Menu · owner · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P70998 | Menu · owner · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P70999 | Menu · owner · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71000 | Menu · owner · A35 phone · dark: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71001 | Menu · owner · A35 phone · dark: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark |
| P71002 | Menu · owner · A35 phone · dark: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark |
| P71003 | Menu · owner · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerMenu |
| P71004 | Manager mode · owner · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71005 | Manager mode · owner · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71006 | Manager mode · owner · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71007 | Manager mode · owner · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71008 | Manager mode · owner · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71009 | Manager mode · owner · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71010 | Manager mode · owner · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71011 | Manager mode · owner · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71012 | Manager mode · owner · A35 phone · dark: the live floor is embedded straight away | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&ownermode=1&skin=dark |
| P71013 | Manager mode · owner · A35 phone · dark: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71014 | Manager mode · owner · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerManager modeMy Little French House |
| P71015 | Settings · owner · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P71016 | Settings · owner · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71017 | Settings · owner · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71018 | Settings · owner · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71019 | Settings · owner · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71020 | Settings · owner · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71021 | Settings · owner · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71022 | Settings · owner · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71023 | Settings · owner · A35 phone · light: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71024 | Settings · owner · A35 phone · light: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71025 | Settings · owner · A35 phone · light: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71026 | Settings · owner · A35 phone · light: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71027 | Settings · owner · A35 phone · light: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71028 | Settings · owner · A35 phone · light: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71029 | Settings · owner · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerSettings |
| P71030 | Menu · owner · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P71031 | Menu · owner · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71032 | Menu · owner · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71033 | Menu · owner · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71034 | Menu · owner · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71035 | Menu · owner · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71036 | Menu · owner · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71037 | Menu · owner · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71038 | Menu · owner · A35 phone · light: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71039 | Menu · owner · A35 phone · light: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=light |
| P71040 | Menu · owner · A35 phone · light: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=light |
| P71041 | Menu · owner · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerMenu |
| P71042 | Manager mode · owner · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71043 | Manager mode · owner · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71044 | Manager mode · owner · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71045 | Manager mode · owner · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71046 | Manager mode · owner · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71047 | Manager mode · owner · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71048 | Manager mode · owner · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71049 | Manager mode · owner · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71050 | Manager mode · owner · A35 phone · light: the live floor is embedded straight away | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&ownermode=1&skin=light |
| P71051 | Manager mode · owner · A35 phone · light: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71052 | Manager mode · owner · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerManager modeMy Little French House |
| P71053 | Settings · ownerMulti · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P71054 | Settings · ownerMulti · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71055 | Settings · ownerMulti · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71056 | Settings · ownerMulti · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71057 | Settings · ownerMulti · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71058 | Settings · ownerMulti · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71059 | Settings · ownerMulti · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71060 | Settings · ownerMulti · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71061 | Settings · ownerMulti · desktop · dark: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71062 | Settings · ownerMulti · desktop · dark: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71063 | Settings · ownerMulti · desktop · dark: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71064 | Settings · ownerMulti · desktop · dark: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71065 | Settings · ownerMulti · desktop · dark: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71066 | Settings · ownerMulti · desktop · dark: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71067 | Settings · ownerMulti · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Settings |
| P71068 | Menu · ownerMulti · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P71069 | Menu · ownerMulti · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71070 | Menu · ownerMulti · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71071 | Menu · ownerMulti · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71072 | Menu · ownerMulti · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71073 | Menu · ownerMulti · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71074 | Menu · ownerMulti · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71075 | Menu · ownerMulti · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71076 | Menu · ownerMulti · desktop · dark: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71077 | Menu · ownerMulti · desktop · dark: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=dark |
| P71078 | Menu · ownerMulti · desktop · dark: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=dark |
| P71079 | Menu · ownerMulti · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Menu |
| P71080 | Manager mode · ownerMulti · desktop · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71081 | Manager mode · ownerMulti · desktop · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71082 | Manager mode · ownerMulti · desktop · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71083 | Manager mode · ownerMulti · desktop · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71084 | Manager mode · ownerMulti · desktop · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71085 | Manager mode · ownerMulti · desktop · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71086 | Manager mode · ownerMulti · desktop · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71087 | Manager mode · ownerMulti · desktop · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71088 | Manager mode · ownerMulti · desktop · dark: the launcher offers a restaurant to pick | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71089 | Manager mode · ownerMulti · desktop · dark: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71090 | Manager mode · ownerMulti · desktop · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Manager mode |
| P71091 | Settings · ownerMulti · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P71092 | Settings · ownerMulti · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71093 | Settings · ownerMulti · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71094 | Settings · ownerMulti · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71095 | Settings · ownerMulti · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71096 | Settings · ownerMulti · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71097 | Settings · ownerMulti · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71098 | Settings · ownerMulti · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71099 | Settings · ownerMulti · desktop · light: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71100 | Settings · ownerMulti · desktop · light: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71101 | Settings · ownerMulti · desktop · light: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71102 | Settings · ownerMulti · desktop · light: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71103 | Settings · ownerMulti · desktop · light: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71104 | Settings · ownerMulti · desktop · light: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71105 | Settings · ownerMulti · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Settings |
| P71106 | Menu · ownerMulti · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P71107 | Menu · ownerMulti · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71108 | Menu · ownerMulti · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71109 | Menu · ownerMulti · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71110 | Menu · ownerMulti · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71111 | Menu · ownerMulti · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71112 | Menu · ownerMulti · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71113 | Menu · ownerMulti · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71114 | Menu · ownerMulti · desktop · light: the sidebar is the sidebar at desktop width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71115 | Menu · ownerMulti · desktop · light: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=light |
| P71116 | Menu · ownerMulti · desktop · light: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=light |
| P71117 | Menu · ownerMulti · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Menu |
| P71118 | Manager mode · ownerMulti · desktop · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71119 | Manager mode · ownerMulti · desktop · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ⚠️ | ONE 404 on the console, on the FIRST desktop-light load of this route in the suite. Re-driven 3× immediately after: clean every time, no 4xx of any kind. The URL was NOT captured, so it cannot be named — which is the honest limit of this row. Most consistent with the standing pre-empt \"the dev server compiles each route on first hit\" (LEDGER/INDEX.md): Next answers 404 for a chunk it has not emitted yet, and a production build has no per-route compile. `live.mjs` now logs `http <status> <url>` for every 4xx so a repeat of this row can answer it instead of guessing. NOT filed as a product fault. |
| P71120 | Manager mode · ownerMulti · desktop · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71121 | Manager mode · ownerMulti · desktop · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 1280 vs 1280 |
| P71122 | Manager mode · ownerMulti · desktop · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71123 | Manager mode · ownerMulti · desktop · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71124 | Manager mode · ownerMulti · desktop · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71125 | Manager mode · ownerMulti · desktop · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71126 | Manager mode · ownerMulti · desktop · light: the launcher offers a restaurant to pick | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71127 | Manager mode · ownerMulti · desktop · light: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71128 | Manager mode · ownerMulti · desktop · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | Owner Manager mode |
| P71129 | Settings · ownerMulti · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P71130 | Settings · ownerMulti · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71131 | Settings · ownerMulti · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71132 | Settings · ownerMulti · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71133 | Settings · ownerMulti · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71134 | Settings · ownerMulti · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71135 | Settings · ownerMulti · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71136 | Settings · ownerMulti · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71137 | Settings · ownerMulti · A35 phone · dark: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71138 | Settings · ownerMulti · A35 phone · dark: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71139 | Settings · ownerMulti · A35 phone · dark: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71140 | Settings · ownerMulti · A35 phone · dark: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71141 | Settings · ownerMulti · A35 phone · dark: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71142 | Settings · ownerMulti · A35 phone · dark: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71143 | Settings · ownerMulti · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerSettings |
| P71144 | Menu · ownerMulti · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P71145 | Menu · ownerMulti · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71146 | Menu · ownerMulti · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71147 | Menu · ownerMulti · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71148 | Menu · ownerMulti · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71149 | Menu · ownerMulti · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71150 | Menu · ownerMulti · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71151 | Menu · ownerMulti · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71152 | Menu · ownerMulti · A35 phone · dark: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71153 | Menu · ownerMulti · A35 phone · dark: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=dark |
| P71154 | Menu · ownerMulti · A35 phone · dark: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=dark |
| P71155 | Menu · ownerMulti · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerMenu |
| P71156 | Manager mode · ownerMulti · A35 phone · dark: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71157 | Manager mode · ownerMulti · A35 phone · dark: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71158 | Manager mode · ownerMulti · A35 phone · dark: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71159 | Manager mode · ownerMulti · A35 phone · dark: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71160 | Manager mode · ownerMulti · A35 phone · dark: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71161 | Manager mode · ownerMulti · A35 phone · dark: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | dark |
| P71162 | Manager mode · ownerMulti · A35 phone · dark: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(10, 12, 16) |
| P71163 | Manager mode · ownerMulti · A35 phone · dark: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71164 | Manager mode · ownerMulti · A35 phone · dark: the launcher offers a restaurant to pick | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71165 | Manager mode · ownerMulti · A35 phone · dark: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71166 | Manager mode · ownerMulti · A35 phone · dark: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerManager mode |
| P71167 | Settings · ownerMulti · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/settings |
| P71168 | Settings · ownerMulti · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71169 | Settings · ownerMulti · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71170 | Settings · ownerMulti · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71171 | Settings · ownerMulti · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71172 | Settings · ownerMulti · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71173 | Settings · ownerMulti · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71174 | Settings · ownerMulti · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71175 | Settings · ownerMulti · A35 phone · light: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71176 | Settings · ownerMulti · A35 phone · light: the Appearance card offers Light and Dark | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71177 | Settings · ownerMulti · A35 phone · light: the What's-enabled card is headed as what is switched ON | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71178 | Settings · ownerMulti · A35 phone · light: …and shows no crossed-out section (R36) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71179 | Settings · ownerMulti · A35 phone · light: the Change-password card is offered | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71180 | Settings · ownerMulti · A35 phone · light: the page says who decides taxes, branding and billing | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71181 | Settings · ownerMulti · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerSettings |
| P71182 | Menu · ownerMulti · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/menu |
| P71183 | Menu · ownerMulti · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71184 | Menu · ownerMulti · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71185 | Menu · ownerMulti · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71186 | Menu · ownerMulti · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71187 | Menu · ownerMulti · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71188 | Menu · ownerMulti · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71189 | Menu · ownerMulti · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71190 | Menu · ownerMulti · A35 phone · light: the sidebar is the sidebar at phone width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71191 | Menu · ownerMulti · A35 phone · light: the menu editor is embedded, menu-only, pinned to one restaurant | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=light |
| P71192 | Menu · ownerMulti · A35 phone · light: the embed was born on this skin, so it never re-navigates on a toggle | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000002&menuonly=1&skin=light |
| P71193 | Menu · ownerMulti · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerMenu |
| P71194 | Manager mode · ownerMulti · A35 phone · light: the page answers on its own address | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | /owner/manager |
| P71195 | Manager mode · ownerMulti · A35 phone · light: nothing threw and the console stayed quiet | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71196 | Manager mode · ownerMulti · A35 phone · light: no code text leaked onto the screen | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71197 | Manager mode · ownerMulti · A35 phone · light: no sideways scroll | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | 360 vs 360 |
| P71198 | Manager mode · ownerMulti · A35 phone · light: nothing is rendered past the right edge | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71199 | Manager mode · ownerMulti · A35 phone · light: the shell wears the skin that was asked for | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | light |
| P71200 | Manager mode · ownerMulti · A35 phone · light: …and paints it (the shell's own background, not the body's) | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | rgb(246, 247, 249) |
| P71201 | Manager mode · ownerMulti · A35 phone · light: signing out is a POST form, not a link | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71202 | Manager mode · ownerMulti · A35 phone · light: the launcher offers a restaurant to pick | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71203 | Manager mode · ownerMulti · A35 phone · light: the sidebar is the ☰ drawer here at every width | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ |  |
| P71204 | Manager mode · ownerMulti · A35 phone · light: the crumb names the section you are on | `node scripts/sweep/t17/live.mjs` — headless on port 4317, both roles, both skins, 1280×900 and 360×780 dpr3 | ✅ | OwnerManager mode |
| P71205 | the header's light/dark button really changes the console's skin | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | dark → light |
| P71206 | …and remembers it in localStorage | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light |
| P71207 | …and in the cookie the server reads on the next load | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light |
| P71208 | …and shouts it exactly ONCE, not twice | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["light"] |
| P71209 | …and does NOT re-navigate the embedded editor (its address is unchanged) | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark vs /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=dark |
| P71210 | …and the embedded editor itself changed skin | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | nav-rail menu-only skin-light |
| P71211 | the chosen skin is already right on the FIRST painted frame after a reload | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light |
| P71212 | …and the embed is born on it too | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /panels/editor/index.html?rid=00000000-0000-0000-0000-000000000001&menuonly=1&skin=light |
| P71213 | the owner console's choice leaves the guest menu's theme alone | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | null |
| P71214 | …and does not write the owner's choice into the staff panels' remembered theme | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light |
| P71215 | …and switching the console to dark still does not make the staff panels remember dark | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | console dark, panel key light |
| P71216 | Settings marks the active skin with more than a colour (aria-pressed) | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | [["Light","false"],["Dark","true"]] |
| P71217 | tapping Light on Settings repaints the whole console | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light |
| P71218 | …and stores it in both places, exactly like the header does | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | light/light |
| P71219 | …and the dashboard opens light on its first frame too | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71220 | Dashboard: a two-restaurant owner is offered the switcher | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71221 | Dashboard: the switcher lists All restaurants plus each one | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["All restaurants","My Little French House","Pizza Palace"] |
| P71222 | Dashboard: …in the same order the sidebar uses | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["My Little French House","Pizza Palace"] |
| P71223 | Dashboard: picking a restaurant re-scopes this page in place | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner |
| P71224 | Dashboard: …and the pill in the bar now names the restaurant on screen | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | My Little French House |
| P71225 | Manager mode: a two-restaurant owner is offered the switcher | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71226 | Manager mode: the switcher lists All restaurants plus each one | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["All restaurants","My Little French House","Pizza Palace"] |
| P71227 | Manager mode: …in the same order the sidebar uses | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["My Little French House","Pizza Palace"] |
| P71228 | Manager mode: picking a restaurant re-scopes this page in place | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner/manager |
| P71229 | Manager mode: …and the pill in the bar now names the restaurant on screen | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | My Little French House |
| P71230 | Settings: a two-restaurant owner is offered the switcher | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71231 | Settings: the switcher lists All restaurants plus each one | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["All restaurants","My Little French House","Pizza Palace"] |
| P71232 | Settings: …in the same order the sidebar uses | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["My Little French House","Pizza Palace"] |
| P71233 | Settings: picking a restaurant takes you somewhere that answers | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner |
| P71234 | phone: the sidebar is off-screen until you ask for it | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71235 | phone: ☰ slides the menu in | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71236 | phone: …with a backdrop behind it | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71237 | phone: the Back button closes the menu instead of leaving the page | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner/settings |
| P71238 | phone: tapping a section from the drawer lands on it | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner/menu |
| P71239 | phone: …and the drawer closed itself after the route committed | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71240 | Manager mode: the launcher offers one card per restaurant | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["My Little French House","Pizza Palace"] |
| P71241 | Manager mode: each card says what tapping it does | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71242 | Manager mode: tapping a card opens that restaurant's live floor | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71243 | Manager mode: …and the crumb in the bar names the restaurant on the floor | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | OwnerManager modeMy Little French House |
| P71244 | Manager mode: mounting the floor adds no browser history entry of its own | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | 2 → 3 |
| P71245 | Manager mode: Back from the floor returns to the launcher, not out of the site | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | /owner/manager |
| P71246 | the Reports hub carries a Report button | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71247 | the report dialog opens | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71248 | …and is announced as a dialog with a name | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | dialog/Generate report |
| P71249 | …offering eleven periods including the financial year | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["Today","Yesterday","Last 7 days","Last 30 days","This week","This month","Last month","12 months","FY (Apr–Mar)","All time","Custom dates…"] |
| P71250 | …with exactly one selected to start with | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["Last 30 days"] |
| P71251 | …and the footer states which period the report will cover | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | Report for: Last 30 days |
| P71252 | …and offers Print, CSV and Excel | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["Print","CSV","Excel"] |
| P71253 | …and a calendar to browse instead of typing dates | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71254 | the calendar reaches back as far as All time does (2020) | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["2026","2025","2024","2023","2022","2021","2020"] |
| P71255 | …and offers no future year | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["2026","2025","2024","2023","2022","2021","2020"] |
| P71256 | a year opens its twelve months | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] |
| P71257 | …and a month that has not happened yet cannot be picked | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | ["Oct","Nov","Dec"] |
| P71258 | …and a whole year can be taken in one tap | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71259 | a month opens its days | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | 31 |
| P71260 | picking one exact day names that day in the footer, in words | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | Report for: 1 Jan 2026 |
| P71261 | Escape closes the report dialog | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71262 | asking for CSV really produces a file | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | aevidine-report-2026-09-04.csv |
| P71263 | …named for the report, not "download" | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | aevidine-report-2026-09-04.csv |
| P71264 | …starting with a byte-order mark so ₹ survives Excel | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71265 | …headed with the scope, the period and when it was made — Aevidine business performance report — My Little French House — 1 Jan 2026 | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | generated 4 |
| P71266 | …and carrying the money-flow calculation, not just a total | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71267 | …and the GST line | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71268 | …with no machine text in it | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71269 | two passwords that do not match are refused on screen | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71270 | …without asking the server at all | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | [] |
| P71271 | a password under six characters is refused on screen | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71272 | …without asking the server either | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | [] |
| P71273 | the three password boxes are real password fields, not plain text | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ |  |
| P71274 | Settings asks about printing once when it opens | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | 2 |
| P71275 | …and asks nothing more while the tab is behind another one | `node scripts/sweep/t17/interact.mjs` — driven headless on port 4317 as a person would | ✅ | 2 → 2 over 35s |
<!-- ROWS:END -->
