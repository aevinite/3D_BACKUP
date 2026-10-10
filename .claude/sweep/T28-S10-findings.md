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
