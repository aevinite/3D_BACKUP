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

Not fixed, with the reason (in the chat report): `verify:db-parity` (reads the client stack; its repo-only
red is migration 388's same-number pair, T35's), the six `verify:t14-live` Reports reds (T21), the
intermittent Back-button dish jump on the guest menu (P15332, T1/T2), French House's sessions switch
(a restaurant setting with no recorded owner — the owner's call).
