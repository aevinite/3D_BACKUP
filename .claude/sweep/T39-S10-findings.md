# Sweep #10 · T39 — the repo's own guards, CI and the dependencies · findings

Problems found AND fixed on `sweep10/t39-repo-s-own-guards-ci-and-the`, one commit each, number in the
message. Improvements were not built; they are in the chat report only. Ledger: `LEDGER/T39-S10.md`.

| # | where | what was wrong | guard left behind |
|---|---|---|---|
| 1 | CI on main | verify-owner-reports matched an old spelling of "today is excluded" — main red 4 days | the check accepts both spellings, sabotaged |
| 2 | Owner → Dashboard → tile pop-up | "Orders a day" drew one lonely bar / a flat line with one spike for a restaurant with one day of trade | 3 new checks in verify:owner-reports |
| 3 | backend (packages) | two new high-rated advisories: sharp <0.35.5, source-map-js <1.2.2 | verify:deps (green) |
| 4 | CI | a red step hid every later step, so item 3 never showed | verify-root-config: every step runs after an earlier failure |
| 5 | (guard) | verify:owner-screen red on a sentence that moved into TileDocket | re-pinned to the rule, sabotaged |
| 6 | Admin → Recycle bin → Remove permanently | loyalty_config / loyalty_ledger were left behind by a purge | verify:purge (migration 412) |
| 7 | (tests, seeders) | fixtures wrote order lines by `slug` (a shape no real order has); two teardowns hard-deleted orders and left them live; seed-today wrote stamps without times | verify:test-safety §14 (reads .ts too) |
| 8 | (guard) | verify:admin-health: 3 "regressions" on Repair that were deliberate changes | re-pinned, each sabotaged |
| 9 | Manager → Tables (French House) | 44 weeks-old test parties: 23 phantom tiles, 4 guards blind, "44 tables open" | verify:fixtures widened; cleanup tool --rid + empty sessions; live-rush says "could not run" |
| 10 | Admin → Recycle bin → Remove permanently | REGRESSION I introduced in item 6 (built it on mig 380, not 384) — broke Remove permanently on dev for ~40 min | verify:purge now checks every table it deletes from exists |
| 11 | (guard) | verify:floor-limits compared the Live floor with a read taken minutes earlier — a race on a shared DB | judges the page against the data the page was sent |
| 12 | (guard) | verify:owner-shell: dots keyed by restaurantColor(r.id, ids) since 2026-10-04 | accepts both, sabotaged |
| 13 | (guard) | verify:panel-dialogs demanded two buttons retired on 2026-09-14 | passes while retired, fails if one returns as a browser dialog |
| 14 | (guard) | verify:busy's diner checks were refused on the phone before reaching the stub | real stub id + "no restaurant → nothing sent" check |
| 15 | (guard) | verify:panel-scope / panel-names did not know shrinkimg.js's LFH_IMG / createImageBitmap | added with reason, sabotaged |
| 16 | Manager → bill → ⭐ Use points | offline: "₹0 off — undefined points used" | verify:queued-truth (green) |
| 17 | (guard) | verify:guest R29 banned the bell float the owner asked to have back on 2026-09-21 | float REQUIRED, dodging still banned |
| 18 | (guard) | verify:printing-sweep phase 463: printer row now via SELF_TITLED | predicate proved both ways |
| 19 | Admin → Restaurants / Live floor | every print-scenarios run left a live zz-scen-… restaurant; Ctrl-C skipped cleanup | verify:test-safety §14(c) |
| 20 | (guard) | verify:tax-rate-is-a-rate stripped block comments before line comments | kitchen P99916 (green) |
| 21 | Kitchen → 🖨 sheet | with printing stopped, the sheet said slips print on "this screen" | verify:kitchen P62827 |
| 22 | (guard) | six verify:kitchen rows behind deliberate changes | re-pinned, two sabotaged |
| 23 | (guard) | verify:tablet-taps read a fixed 3,000 chars and missed a section check that exists twice | reads the whole branch, sabotaged |
| 24 | (guard) | verify:merge-keeps-mark read migration 369 after the file it meant landed as 374 | verify:guards-alive: a number lookup must match exactly one file |
| 25 | Owner → Customers → erase | an erased guest's phone stayed in the loyalty points book | verify:personal-data (green) |
| 26 | (guard) | verify:admin-money assumed page 2 was past the end of the guest list | measures the last page from the server's own count |
| 27 | (guard) | verify:owner-s7-live read "printing allowed" as "printing on" | agrees via the route's printingOk contract |
| 28 | Admin → Repair & support → Resolve | the green Resolve buttons were white on light green, 1.92:1 | verify:css-tokens (fill tokens) |
| 29 | (guard) | verify:repair-sweep: nine checks behind deliberate Repair changes | re-pinned; regenerated T18-S8 result |
| 30 | (billing, dev data) | MY clean-up closed four invoiced test bills → issued invoices cancelled with no credit note | 4 credit notes issued; tool skips invoiced bills; verify:invoice-is-final static check |
| 31 | backend | loyalty tables kept Supabase's default public grant | migration 413; verify:server-only-tables 27/27 |
| 32 | (guard) | verify:own-hero did not know the restaurant's own translated hero words | re-pinned, sabotaged |
| 33 | (guard) | verify:t5s9: the guest 404's "no restaurant" decision now shares a line | re-pinned, sabotaged |
| 34 | (tool) | password backfill would have reset 78 passwords after the v2 vault change | imports the real vault; refuses on unreadable; verify:test-safety §15 |
| 35 | (guard) | verify:t12-live crashed on the redesigned tile pop-up | reads the docket; live-only leftover count |
| 36 | (guard) | verify:guest searched a binned restaurant | uses live restaurants |
| 37 | (guard) | verify:repair-r2 pressed the wrong Resolve, read a 2.6 s toast at 3 s, sent no hasReport | fixed; green 923 s |
| 38 | Admin console → every toast | white on light green / light red in the dark skin (1.92 / 2.77:1) | verify:css-tokens covers the toast |
| 39 | (guard) | verify:t14-live expected inventory OFF and a discount every period | honest skips; 6 Reports reds left for T21 |
| 40 | (guards) | session-ux / edge-cases blind: French House sessions are OFF; party chip; p_device | precondition exit 2; fixed; proved with sessions on, restored |
| 41 | Manager → Settings → Printing → Show the code | the code box drew with no frame (undeclared --accent) | verify:look-ink re-pinned to the tablet's replacement bars |
| 42 | (guard) | verify:ledger-index refused a first-time terminal number's ledger | accepts the sweep-10 row that names the file |
| 43 | Owner → Settings (backup) | printing ALLOWED but no paper line listed → no card drawn, yet the page asked /api/owner/printing every 15s (~1,200 reads an hour per open tab); verify:owner-live500 P52830 caught it on backup after the merge | refresh gated on the card's own condition; verify:owner-s7 P21201b, sabotaged |
| 44 | (CI) | 33 code-only guards ran nowhere automatically — 7 of 2026-10-08's reds were among them | all 33 in verify:static (67), inventory-window its own CI step; sabotaged |
| 45 | (guards) | session-ux / edge-cases stopped on the NORMAL setting (dining sessions are off at every restaurant) | switch it on for the run, put back on finish/Ctrl-C/crash; proved both |
| 47 | (manager panel CSS) | two styles for the retired six-digit code nobody draws | removed; panel hash refreshed |
| 48 | (load tests) | stress-tenant run on its own checked no database | dev-only lock + verify:test-safety §16; sabotaged |
| 49 | (CI) | migration-number collisions/holes were caught only by a by-hand run (2026-10-08: two 411s) | verify:migration-numbers in verify:static, no database; sabotaged |
| 50 | (guard) | one slow page ended the whole owner-live500 run | each band records one failure and the next runs; planted-throw proof |
| 51 | (guard) | owner-live500 skip said "printing switched off" when it was allowed with no printer line | says either |
| 52 | (CI) | the site's Node version lived only in Vercel's dashboard | engines.node 24.x + verify-root-config match check; sabotaged |
| 53 | (guard) | verify:staff-accounts sent four requests just to watch them be refused | read from the code instead (house rule); four sabotages → four reds |
| 54 | Guest menu → open a dish → Back | Back hid the row the diner was reading (both restaurants; 8 of 8 at French House) | remembers dish + offset; verify:guest P15611/P15332, both restaurants; sabotaged |
| 55 | (guard) | hourly charts "missing hours" — Recharts draws no bar for a zero hour | judged by bar spacing on a 24-slot scale; proved both ways |
| 56 | (guard) | a 477-row % column summed to 98.0 from rounding alone | each cell = its own share; proved both ways |
| 57 | (guard) | the Reports path check read the whole top strip, too early | reads .owx-path after the report settles (no app change needed — one tried and reverted) |
| 58 | Owner → Reports → Menu (French House) | print-speed left 5,265 fake orders on French House for ever (a removed order still counts) | its own zz-speed restaurant, binned + purged; owner chose: the 5,265 were CANCELLED |
| 59 | (guard) | dashboard tooltip check hovered after a fixed 11s | waits for the chart and the tooltip; sabotaged |
| 60 | (guards) | owner live checks red on a dev server (StrictMode mounts twice) | isDevServer(); 2 on dev, 1 on the site |
| 61 | (guard) | owner-s7-live demanded the printing refresh even with no card — item 43's own fix turned it red on backup | asks the card it got; old version red on backup, new green |
| 62 | (ledger) | 780 T28 rows labelled "names no guard" | 159 claimed by verify:split-payment, 132 split rows honestly unclaimed, 489 one-time judgments |
| 63 | (guard) | Reports bar-hover check read after a fixed 700ms | waits for the tooltip |
| 64 | (tests) | printing-sweep (1,478) and stuck-test (43) leftovers also counted as French House sales | cancelled (owner's rule); every order-inserting test must cancel — verify:test-safety §17; sabotaged |
| 65 | (lint) | 1,132 ESLint warnings (31 of them from T17 round 5, merged the same day) had piled up with nothing stopping the next | --max-warnings=1132 (can only go down) + verify-root-config guards the cap; sabotaged |
| 66 | (lint) | 1,061 warnings in scripts/, tests/, .github/ | 630 were the guards' own result shorthand (rule option, scripts only); 431 removed by an AST pass that keeps every side effect + by hand; 0 left in this area; cap 1,132 → 115 |
| 67 | (guard) | verify-table-ownership read the order builder's heading and threw it away (could never fail) | asserted: the builder names THIS table ("T26") |
| 68 | (guards) | three checks that could not fail: print-speed's printer phase, t13's ☰ menu, shrink-help-shots' failure count | each now asserts or reports |
| 69 | (packages) | the shared folder ran packages older than the lock (#1441 never re-installed) | npm ci in the shared folder; verify:installed-packages in verify:static |
| 70 | Owner → Reports (Pizza Palace, French House) | table-ownership put 167 fake PAID orders (₹37,074) on Pizza Palace; verify:customers drew 53 invoice numbers for fake bills | both tests fixed; owner chose cancel — 260 cancelled; §17 reads both write styles |
| 71 | (guards) | two t9s10 runners ended with a bare process.exit() | superseded — sweep #10 T9 made the same fix on main first; mine dropped on rebase |
| 72 | (guards) | the two tax-mode checks crashed on a web-page answer from the database service | "could not run" with the status, exit 2 |
| 73 | Waiter tablet → floor at 360px | a table with a waiter call cut 3px off ＋ Take order | the gaps (not the buttons) shrink on the smallest tiles; 104/104 |
| 74 | (guard) | the KOT ▾ check waited a fixed 2.2s | waits for the button; green on dev and backup |
| 75 | (guards) | two double-tap password checks expected the password repeated, which the safer store no longer keeps | first tap has it, the duplicate does not, the database holds the first |
| 76 | (guard) | Payments vs Sales compared across other sessions' writes | steady read |
| 77 | (guard) | "Payments reconciles to Sales" compared two snapshots taken minutes apart | both recomputed (refresh=1) on a steady read — the owner's 5-minute snapshot rule is by design |
| 78 | Admin → Repair → Resolve all | a garbled restaurant id cleared EVERY restaurant's open problems; the test did it every run | the route refuses a bad scope (fail closed); the test asserts the refusal and that nothing is cleared |

Not fixed, with the reason: `verify:db-parity` (reads the client stack — not run; its folder half now runs
as verify:migration-numbers, where 388 is a listed, explained pair). Payments vs Sales: both use the same
change-detector; a momentary difference is two reads seconds apart while tests wrote — not a fault.
Data 2026-10-09: 72 practice restaurants' stale tables closed; 6,808 fake test orders cancelled (owner's
choice); Aangan (the untouched control) and Green Bowl's 5 finished orders deliberately left.
