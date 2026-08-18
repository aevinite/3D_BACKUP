# T14 findings — the owner's Customers, Pay Later, Inventory, Complaints & Manager mode

Territory: `app/owner/{customers,khata,inventory,issues,manager}/**`. 500 phases (P06501–P07000).
Eight problems, all fixed in this branch, one commit each. Seven of the eight are the same shape:
**the route did the careful thing and the screen ignored it.**

| # | severity | who is worse off | confirmed? | fixed in |
|---|---|---|---|---|
| 1 | medium | the owner — a wrong headcount he cannot correct | **watched happen** | `app/owner/customers/page.tsx` |
| 2 | medium | the owner — a tap that does nothing | **watched happen** | `app/owner/customers/page.tsx` |
| 3 | medium | the owner — believes he has read every rating | **watched happen** (381 exist, 200 shown) | `app/owner/issues/page.tsx` |
| 4 | low-medium | the owner — a false reassurance about money | code-read | `app/owner/khata/page.tsx` |
| 5 | low | the owner — a screen goes quiet with no reason given | code-read | customers + issues pages |
| 6 | low | the owner — thinks a debtor has paid | code-read | `app/owner/khata/page.tsx` |
| 7 | low | the owner — one heading looks wrong | code-read | `app/owner/manager/page.tsx` |
| 8 | medium (tooling) | everyone — a guard that is always red gets ignored | **watched happen** on clean `main` | `scripts/verify-customer-erase.mjs` |

---

**F1 · "Total customers" could be wrong and nothing on the screen could fix it.**
The four tiles ride the compute-on-view snapshot cache. Its change-detector is
`MAX(last_seen_at)` over `customers` (mig 229), which cannot move when a guest is ERASED, nor when
one is added with an older date — so the cache reports "nothing changed", bumps its own timestamp
and serves the previous counts, indefinitely. The route has always accepted `?refresh=1` to
recompute live, and this was the one owner screen whose Refresh button never sent it.
*Reachable:* erase any guest who is not the most-recently-seen one. *Measured 2026-08-18:* the list
showed 24 guests while the tile read 23, and stayed 23; `?refresh=1` returned 24.
*Fixed:* Refresh forces a live recount, and so does a successful erase.

**F2 · Closing the guest record while it was still loading did nothing.**
The drawer is on screen from the moment a row is tapped, but Escape, the ✕, the backdrop and the
phone's Back all cleared only the loaded record, not the "still loading" state. So for the second or
two the record takes to arrive — the whole of the interaction on a restaurant's wifi — none of them
did anything visible, and the record then opened on top of the owner who had just dismissed it.
*Reachable:* every open, on any connection slower than instant. *Measured 2026-08-18.*
*Fixed:* closing clears the loading state and invalidates the reply already in flight; there is a ✕
while it loads. (The related "two guests' replies crossing" path was checked and is **not**
reachable — the drawer is modal and covers the table from the same tick.)

**F3 · The complaints badge counted the page, and neither list admitted its limit.**
`/api/owner/issues` computes `openCount` as one indexed head-count over the whole scope — added in
August precisely so a restaurant with over 300 complaints could not understate how many are open —
and the page threw it away and counted its own rows. Separately, the ratings list caps at 200 and
the complaints list at 300, with nothing saying so: on French House **381 ratings exist and 200 are
shown**, so an owner who scrolls to the bottom believes he has reached the bottom. The two sister
screens in the same panel have said this for months. *Fixed:* the badge is the server's number
(with the server's own fallback honoured), and both lists say when they are showing part.

**F4 · Pay Later said "No one owes anything right now" when pay-later was switched OFF.**
The route answers `moduleOff: true` when none of the owner's restaurants has the module effective;
the page ignored it. *Reachable:* a bookmark, a typed address or an open tab after the admin
switches the module off — the nav item disappears, the page does not. *Fixed:* it now says "Pay
Later isn't enabled for your restaurant — contact Aevidine", matching the Customers screen.

**F5 · Two screens ignored the "couldn't read this" list the route sends.**
Both routes report `partial` when one of their reads fails; Pay Later has shown that note since
August. On Customers a failed brand lookup turned every row's restaurant into "—" with no reason
given and nothing to press; on Complaints a failed head-count silently fell back to counting the
page. *Fixed:* the same sentence, same wording, same Try again button, on both.

**F6 · A Pay Later search that found nobody claimed more than it knew.**
The box filters the list already loaded, and that list is the 500 biggest debts. On a longer book
"No one matches that search" is a statement about the whole book that this screen cannot make — and
an owner reads it as "they have already paid". *Fixed:* when the list really is capped it names
both numbers; on an ordinary book the old sentence is the true one and still appears.

**F7 · The Manager-mode fallback heading used a CSS class that does not exist.**
`adm-page-title` is declared in no stylesheet, so the heading fell back to the browser's default h1
(~32px with browser margins) in a cockpit whose headings are 22px. *Fixed here* for
`app/owner/manager/page.tsx`. **🔗 HANDOFF** — the same dead class is used in
`app/owner/menu/page.tsx` (line 52) and `app/aevinite/access/page.tsx` (line 94); both need
`adm-page-title` → `adm-page-h`. Not touched: they are not in this territory.

**F8 · `npm run verify:customer-erase` had been failing on a clean `main`.**
Three of its five static checks were looking for a route shape that was replaced in August: the
handler now walks the declared list in `lib/personalData.ts` instead of naming three tables inline,
and logs through `ownerLogPanel(scope)` instead of the literal `"owner"`. Nothing was wrong with the
code. A guard that is always red gets ignored — or worse, someone "fixes" the route backwards to
make it green, and this is the guard standing over the one rule the business depends on (erasing a
guest must never take a sale with it). *Fixed:* the checks describe the code as it is, and that one
rule is now checked in **two** places — the deletes in the handler AND the declared list itself,
which is where a forbidden table would realistically arrive now. 10 checks, all green.

---

## 🔗 HANDOFF rows

| file | change needed | why |
|---|---|---|
| `app/owner/menu/page.tsx` (line 52) | `className="adm-page-title"` → `"adm-page-h"` | the class is declared in no stylesheet; the heading falls back to the browser's 32px h1 |
| `app/aevinite/access/page.tsx` (line 94) | same | same |

## Checked and clean

The erase itself (its confirmation wording, its refusal while money is owed, its two audit trails,
its last-4-only records), the khata aggregates, the ratings summary, the scope pins, the entitlement
gates on all five screens, every 60s backstop, the back-button registration, both skins on all five
screens, and the whole of Manager mode's estate resolution — including the paged sibling lookup —
came back clean.

---

## Round 2 & 3 — what he asked for after reading the above (2026-08-18)

His verdicts first: **item 4 is not a real problem** (reverted, R31) and **item 13 is not wanted** (R32).
Both are recorded in `docs/REJECTED-IDEAS.md` and as `REJECTED (owner, …)` comments at the code site,
and item 4's guard rule is inverted so it now fails if the hiding branch comes back.

Five more faults were found while building what he asked for. All are guarded by
`npm run verify:owner-money` (items 14–18).

**F9 · A 1-star rating drew five gold stars** (item 16) — `--border` is declared as a whole border,
not a colour, so `1px solid var(--border)` was invalid and dropped. Measured: the Customers table had
**no row separators**, the ratings bars had **no track**, and the empty half of every star row
computed to the same amber as the filled half. `aria-label` said "1 out of 5" throughout, which is
why five sweeps of text assertions never caught it. Person worse off: the owner, who could not tell a
complaint from a compliment at a glance. **confirmed, screenshotted before and after.**

**F10 · Raw database dates on the Inventory screen** (item 17) — `2026-08-18` printed in a panel where
every other date reads "18 Aug".

**F11 · Nothing on the Inventory screen tied a card back to the figure above it** (item 17) — every
card was headed with a count and no money, so an owner had to add the rows up himself to check they
agreed. Each card now carries the DATABASE's month total, never a sum of the rows it is holding.

**F12 · Capped lists that never said they were capped** (item 17) — 300 expense slips, 100 bills. The
route was already being told the true counts by `lfh_inv_report_summary` and was throwing them away.

**F13 · A stored snapshot kept serving an OLD payload shape** (item 17) — the payload gained three
fields; snapshots are served as-is until their fingerprint moves, so every restaurant already opened
once kept handing the screen the previous shape and the new "showing 100 of 412" line never appeared
— on exactly the busy restaurants that need it. Caught only by checking the CACHED reply rather than
the forced one. Fixed by bumping the cache key to `v2`; the guard now requires the bump.

**F14 · Two database round-trips were paid before the cache was even consulted** (item 18) — "which
restaurants have stock on" and "what are they called" were answered on the way past, on every open,
including ones then served from the snapshot in one row read. Both answers are already in the
snapshot. **Median estate open: 1362ms → 419ms.**

### Verified against the running app — every instruction he gave, 21/21

Pay Later never hides itself · the pay-later option is absent on a restaurant with the module off and
present on one with it on (checked on two real restaurants, nothing switched) · 7 boxes, each matching
`lfh_inv_report_summary` exactly, totals equal to the sum of the boxes · one request per open, served
from the snapshot · tap into a restaurant and back out · no raw dates anywhere · the phone card list
with the dates moved into the guest's record (which now shows first AND last visit) · a tapped figure
showing exactly the people it counted.
