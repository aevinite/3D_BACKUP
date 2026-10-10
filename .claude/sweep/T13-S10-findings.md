# Sweep #10 · T13 — problems found and fixed (the waiter tablet's server route + the shared floor logic)

The owner-facing report (four parts, the six lines per item) is in terminal 13's chat window, by rule.
This file is the engineering record only: one line per fixed problem, its commit subject and its guard.

| # | problem | fixed in | guard |
|---|---|---|---|
| 1 | ✓ Accept / a dish's status tap revived a CANCELLED ticket (status back to preparing/served, unlogged) — the manager's twin had the refusal (T10 item 1), the tablet did not | `app/api/tablet/[...path]/route.ts` orders/:id/accept, items/:id/status | `verify:tablet-twins` §1 |
| 2 | the handheld changed a bill whose invoice was PRINTED (dish delete, qty, ticket + whole-bill discount, add-a-dish) — owner's rule 10, COMPLIANCE §3.0b; the lock lives only in the routes | same file — byte-for-byte copy of the manager's invoiceLockedByOrder/ByItem + a session form | `verify:tablet-twins` §2 (incl. "the copy is still identical") |
| 3 | any waiter's "Delete order" soft-deleted the ticket (and an emptied bill's session) out of every report — R27 / COMPLIANCE §3.0 rule 4: nobody at the restaurant removes a bill | orders/:id/delete now CANCELS (status + cancelled_at + order_cancel log + order_cancelled audit + watchCancellations) | `verify:tablet-twins` §3; `verify:audit-coverage` row moved |
| 4 | a stale tap on something already gone told the waiter "That table isn't in your section — ask your manager to add it" (every route 404 unreachable for a waiter) | `lib/tableOfAction.ts` — three answers: table / couldn't-tell (incl. a FAILED read) / gone | `verify:tablet-twins` §4 |
| 5 | a waiter could discount a ticket already PAID (or cancelled) | orders/:id/discount refuses with the edit functions' own sentences | `verify:tablet-twins` §5 |
| 6 | one failed floor read was SHARED with every device for 1.5 s (supabase-js resolves `{error}`; the share only drops a throw) | the shared floor/joins computes now throw (pgError keeps the SQLSTATE) | `verify:tablet-twins` §6 |
| 7 | a manager/owner on the waiter panel was shown "Generate invoice" and refused on tap (the never-list was re-applied to non-waiters) | tabletPerm reads the stored value for a non-waiter's never-list key — what overlayUserPerms shows | `verify:tablet-twins` §7 |

Twin note (outside this territory, not changed here): the manager route's whole-floor share has the same
`{error}`-is-a-success shape as item 6 (app/api/editor → GET /summary); the kitchen route's accept / dish-status
lack item 1's refusal.
