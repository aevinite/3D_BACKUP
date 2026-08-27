# T18 findings — sweep #7, the admin's money view

**Branch** `sweep7/t18-admin-money` · **port** 4218 · **2026-08-27** · against `origin/main` 7390aaed

Ledger: `.claude/sweep/LEDGER/T18.md`. The four-part report went to the terminal window, not to a
file — that is the owner's instruction for this run.

**Re-run of `P08501`–`P09000`: 500 ✅ · 0 ❌ · NO REGRESSION.** Ten of the eleven reds on the first
live pass were my own assertions; the eleventh (`P08917`) turned out to be correct as written, with
the real fault one step past what it asserts. Two candidate findings were WITHDRAWN by reading
further — the `[object Object]` risk on the Change log (`restaurants.name` is `text`, migration 078,
never altered) and the near-lonely one-bar chart (both drill thresholds must hold; `emptyShare` 0.286
does not clear 0.50, and five of seven days had orders). Both are written up in the ledger so the
eighth sweep does not re-file them.

## Found and fixed — one commit each

| # | commit | where a person sees it | what was wrong | guard |
|---|---|---|---|---|
| 1 | `5b23c0cb` | Platform analytics → drill into a day → press ↻ Refresh | The button called `load(range, true)` with no third argument, so the server answered with the whole window while `drillDay` stayed set. Measured: drill into 24 Aug (0 orders that day) → tile read **"Orders · 24 Aug  1,047"**, both card hints "for 24 Aug", the heading alone correcting itself to "Orders per day". The fault the 2026-08-20 drill-labels fix closed, back through the one control it never covered. | `verify:admin-money` C(live) |
| 2 | `6c9db5b6` | Bills → press Running / Settled / Pay-later / On the house | Five of the six buckets are narrowed AFTER a page of sessions is read, so a newest page can hold none while older pages hold plenty — and the "Load older bills" footer was gated on `rows.length > 0`. All four came back empty on backup while the reply still carried a cursor. Bill **#644, My Little French House, T30, ₹441** sat three pages back, unreachable by pressing anything. | `verify:admin-money` D2(live) |
| 3 | `ea7486e8` | Platform analytics → the "Tables occupied now" tile | It read **8** above **"of 1,850 tables (0%)"** with a visible sliver of bar — three readings of one fact, one of them saying none. The bar has always kept a 2% floor; the words rounded 0.43% to a flat 0%. Now "under 1%". | `verify:admin-money` C2(live) |
| 4 | `14abf46e` | Customers → the grey line beside Refresh | It read **"counted today"** and could never read anything else: the line used this page's own `ago()`, which answers in days (`if (d <= 0) return "today"`). The tiles it stamps are a snapshot fresh for five minutes and re-read every sixty seconds. Now "counted 19m ago" with the exact IST time on hover, from the shared `timeAgo` its two siblings already use. | `verify:admin-money` C3 |
| 5 | `9c695c5f` | Dashboard → the "Working now" and "Open issues" headings | The endpoint deliberately sends a capped LIST (200 staff / 50 issues) plus an exact COUNT, and says so. The stat cards read the exact counts; these two headings read the list lengths. Past either cap the same screen states two numbers for one fact with a "View all" link between them. Driven with the reply shaped as it comes back past the cap: card 214 / heading "· 3 active" → both 214. | `verify:admin-money` C4 |
| 6 | `a94b87e2` | Platform revenue → Paying restaurants → "Next due", and the "Collected this year" tile's grey line | The column printed the database's own **`2027-07-04`** while the Customers table, the Bill ledger's Opened / Closed / Deleted lines and the invoice timeline all write "4 Jul 27". Read in both desktop screenshots. And the tile's line said "payments in 2026" from the BROWSER's clock, while the figure is counted against the IST calendar year — on 31 December west of IST the heading names one year over another year's money. Both now read one way: "4 Jul 27" (raw value on hover) and the year off the server's own `generatedAt`. | `verify:admin-money` C5 |

All six guard sections were **proved red by backing the fixes out** — the guard
reported nine ✗ and exited 1 — then green again on restore.

## Recorded, NOT fixed here (each is in the chat report as a decision)

| what | where it lives | why not here |
|---|---|---|
| The Change log still scrolls sideways at 360px; TABLE reads "TABLI" and By / Reason / When sit off the right edge | admin → Bills → Change log, the row grid (`minWidth: 720` + `overflowX: auto`) | It IS my file, but folding a six-column table is a visible redesign of a screen already signed off, and T26 owns the look this sweep. `P24064`. |
| The guest-spread card silently shows at most 8 restaurants | admin → Customers → "Where the guests are" | The `.slice(0, 8)` is in `/api/admin/customers`, which is **T19's** file. The page cannot know how many were dropped. Same class as the busiest-restaurants card fixed in sweep #6. |
| The 12-month "Collected" grid is built on UTC months while the year boundary is IST | admin → Platform revenue → the chart | `/api/admin/revenue` is **T20's** file (position 45 of 50). Bites for 5½ hours on the 1st of each IST month; on a process west of UTC it would also mislabel all twelve months, though Vercel functions run UTC so that half is not reachable today. |
| The "By" column reads "—" for every admin bill action | admin → Bills → Change log | `logAction("admin", …)` in `/api/admin/bills` passes no `actor`, so `staff_actions.actor` is NULL. **T19's** file. The reason line names the admin, so nothing is lost — but the column reads blank where every other row names a person. |
