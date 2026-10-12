# SWEEP #10 · T28 — the admin server routes, part 1 (positions 1–26): problems found and fixed

Run 2026-10-10 on `sweep10/t28-admin-server-routes-part`, dev server on :4428 from the worktree, zero
sign-ins, French House the only write target (Aangan read only). Ledger: `LEDGER/T28-S10.md` (650 new
checks, P197001–P197650) plus 2,664 existing rows re-run in place across 25 older ledgers.

Every item is its own commit with its number in the message, and is guarded by `verify:admin-api-a`
(rules 10–13, each sabotage-tested red and restored). Improvement ideas are NOT here — they were printed
in the chat report, as the S10 rules require.

| # | where | what was wrong | fix | guard |
|---|---|---|---|---|
| 1 | Admin console → Bills ledger → a bill → Delete / Restore | an order-less bill's tombstone / un-tombstone write was awaited and its answer thrown away (a refusal said "done"); a second press on an already-deleted / already-restored bill was reported as a fresh delete/restore with a second diary line; softDeleteOrders' throw had no catch, so a refusal after the orders were stamped left the Removals record without its rows | checked writes; 409 "already deleted / isn't deleted any more"; the throw is caught, what did go is recorded, the admin is told to press again | rules 10, 11 |
| 2 | Admin console → Printing → a restaurant → Unlink | the revoked_at write was unchecked: "unlinked" and the lines cleared while the computer kept its access | checked; second unlink 404; a line that cannot be cleared is named | rule 10 |
| 3 | Admin console → Owners (a stale tab) | PATCH never looked at deleted_at: a stale tab could switch a binned owner back on, so restore handed back a working login | PATCH refuses an owner in the recycle bin (409) | rule 11 |
| 4 | Admin console → Printing (overview) | 282 binned/purged restaurants listed beside the 11 live ones | `.is("deleted_at", null)` | rule 11 |
| 5 | Admin console → Platform analytics | a failed read answered a bare 500 ("Request failed (500)"); `?day=0000-01-01` did the same | adminFail around the cache; drill year 2020..next year | rule 12 |
| 6 | Bills ledger / Change log (typed address) | `?per=33.3` emptied the change log with a 200; `?limit=33.3` broke the ledger | Math.trunc before every clamp; page capped | rule 12 |
| 7 | Backend only, nothing on screen | an empty/unreadable maintenance POST switched the flagship menu ONLINE and logged it | `on` must be a boolean | rule 13 |
| 8 | Billing & plans → Manage billing (typed request) | 2026-02-31 passed the date check and answered "try again" | round-trip date check | rule 13 |

Four older rows went from ✅ to ❌ under a stricter reading (P53287, P53289, P53414, P09172) — the code
there had not changed; the earlier checks exempted writes. All four are ❌→✅ after items 1–2. No code
regression was found.

## Round 2 — 2026-10-12 (owner: "do all instead of 14 … 1000 phases")

Branch `sweep10/t28-round2`, rebased on main the same day. 1,000 new checks (P197651–P198000 +
P212001–P212650, the second block claimed on `main` first with the owner's yes) written by
`scripts/sweep/t28s10/checks2.mjs`; all 652 round-1 checks and the 51 write flows re-run on the rebased code.
Guarded by `verify:admin-api-a` rules 14–15 (sabotage-tested).

| # | where | what was wrong | fix | guard |
|---|---|---|---|---|
| 9 | Admin console → Rate limits → an alert → Dismiss | dismissing ONE alert wrote nothing to the admin's own log (Clear-all did) | one sentence line, admin panel only | rule 14 |
| 10 | Admin console → Repair → a request → Close / Dismiss / Re-open | the status change wrote nothing to the admin's own log | one sentence line, admin panel only | rule 14 |
| 11 | Admin console → Owners → Attach to a restaurant (stale list) | a restaurant already in the recycle bin could still get the owner attached | checked first; refused in words | rule 14 |
| 12 | Admin console → Platform analytics → orders by source | the card added up to more than the Orders tile with no reason given | a second line says the extra comes from delivery apps, website and parcels | rule 14 |
| 13 | (asked: restaurant names as JSON) | — `restaurants.name` is a plain text column, so it cannot happen | no change | — |
| 15a | Admin console → Rate limits → Block / Unblock / Approve / Clear | a database refusal still said done | the throttle writers report failure; the route says so (500, in words) | rule 14 |
| 15b | Admin console → Owners on a phone | the number boxes' names were cut off with "…" | they wrap | rule 14 |
| 15c | Admin console → Restaurants → create / assign owner | three writes (two roll-backs, one remembered default) were awaited and thrown away — one of them added on main while this ran | each answer looked at; a failed roll-back is logged | rule 10 |
| 15d | Backend only (guards) | two guard phases went red because their subject deliberately moved (toggles door retired; lists moved to paging) | the phases test the property, not the old spelling | — |
| 16 | Owner panel / manager panel → Removals card for a bill the admin restored | the card read "put back from the admin bill ledger" and the meta carried "from: admin bill ledger" — the admin's words on an owner/manager screen | the note is "bill restored"; the reader-side filter also scrubs older rows | rule 14 |
| 17 | Backend only, nothing on screen (except a list that silently stopped at 1,000) | 30+ reads asked for 2,000–20,000 rows; the database hands back at most 1,000, so the rest vanished without an error | `pagedRead` pages with `.range()`; name maps ask for exactly the ids they need | rule 15 |

**The owner's two rules, checked by reading code and driving it as the diag owner and diag manager:**
A — admin lines never reach the owner or manager log, owner lines never reach the manager log: holds
(owner log drops admin/db panels; manager log drops admin/owner/db; Removals withholds the admin's
identity). The one gap was item 16. B — the owner can never create, delete or restore an owner: holds
(`ASSIGNABLE` is manager/kitchen/tablet; no non-admin route writes `restaurant_owners` or makes a staff
login with role owner).

**Disclosed:** the round-1 test scripts cleaned their diary lines by a time window, which could take
another terminal's lines from the same minutes; they now clean by their own device id / amount only.
**Observed, not a code fault:** on two earlier runs the floor-for-all and System-health reads took 8–12 s
on the dev database (the same SQL plans at 28 ms; backup was slow too). On the re-run after rebasing they
answered in 0.2 s and 0.1 s — the dev box waking from idle. P212355 / P212359 ✅, first runs noted.

**Result:** 1,000 new — 988 ✅ · 0 ❌ · 12 ⏭ (log lines of an action nobody has done on the dev database
yet). Round 1 re-run: 652/652 ✅, write flows 51/51. Guards: verify:admin-api-a 664 ✅, verify:admin-sweep
445/445 ✅ (signed-out band not run — no login-less requests), verify:repair-sweep one ❌ (P72149, the
Repair page's tile font — another terminal's page; this branch does not touch it).
