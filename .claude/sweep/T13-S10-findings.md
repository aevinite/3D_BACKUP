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

| 8 | the waiter's "🗑 Delete order" button cancelled the ticket (item 3) but still said Delete | `public/panels/tablet/app.js` — "✕ Cancel order", confirm names the ₹0 + 30-minute restore; panel hash bumped | `verify:tablet-twins` §8, `verify:panel-cache` |
| 9 | the khata customer picker gated on a retired rule, not the waiter's tablet_khata power | khata/customers asks tabletMode("tablet_khata") | `verify:tablet-twins` §9 |
| 11 | "On the house" and spending loyalty points lowered a bill whose invoice was printed | both refuse with LOCKED_MSG (tablet + manager twin) | `verify:tablet-twins` §10 |
| 12 | a database blip handed out a power the admin had switched off (managerCan / tabletMode read errors as defaults) | every permission read throws pgError → busy | `verify:tablet-twins` §11 |
| 14 | verify:floor's "a write drops every shared read" check passed on the loop alone | `scripts/verify-floor-share.mjs` drives the real invalidate | itself, sabotage-tested |
| 15 | the MANAGER route shared one failed floor read with every manager device for 1.5 s (item 6's twin) | `app/api/editor` floor + joins computes throw pgError | `verify:floor` |
| 16 | during a blip, a PIN-protected action went through with no PIN (anyManagerHasPin read errors as "no PIN set") | pinIsSetUp() throws on a failed read | `verify:tablet-twins` §12 |
| 17 | three dead bits: an always-true gate, an optional scope nobody used, a read nobody read | removed | `verify:tablet-twins` §13 |
| 18 | a waiter's paid parcel stored its payment method unchecked (default lowercase "cash") | validated against PAYMENT_METHODS | `verify:tablet-twins` §14 |
| 19 | lib/liveBoard's full-board path was dead and disagreed with its live siblings | folded into one path | new-g-libs-deep |
| 20 | restarting a table wrote two rows by id alone; nine writes asked back rows nobody read | scoped by restaurant_id; `.select()` dropped | `verify:tablet-twins` §15 |
| 21 | every waiter floor refresh read the settings row twice, one after the other | one read, started in parallel | `verify:tablet-twins` §15 |
| 22 | every guest's phone and device id rode to every waiter's tablet, unused | MEMBER_COLS / request columns listed | `verify:tablet-twins` §16, new-h P169036–P169038 |
| 23 | moving a party to "table 0" was answered "outside your section" | normTable rejects 0 | `verify:tablet-twins` §17 |
| 24 | a standalone banquet ticket was refused as "not in your section" | NO_TABLE_ROW answer | `verify:tablet-twins` §18 |
| 25 | two lines that could never run | removed | new-e/f |
| 26 | sixteen branches (and lib/liveBoard) threw `new Error(msg)`, dropping the SQLSTATE → a timeout read as a crash | `throw pgError(x)` | `verify:tablet-twins` §19 |
| 27 | a blip made the owner's reports drop staff pay (profit too high) and call every stock box "off" | lib/tableTags batch readers throw | new-i P169101–P169107 |
| 28 | a blip read as "module switched off" → waiter taps refused 403 and dropped by the outbox | lib/tableTags ladders throw; owner nav, profile card and loyalty display/after-money paths stay soft on purpose | new-i P169108–P169128 |
| 29 | the "Parcel orders aren't switched on" refusal could never fire (Parcel is permanent) | removed | new-i P169129–P169131, grid P63999 |
| 30 | 34 route reads ignored `.error` — invoice lock "not printed", owns-row "gone", open party "none", accept-first "nothing waiting", parcel tax "defaults", khata phone "new person", table count 0 | every read through must(); manager invoice-lock twin too | new-i P169132–P169161 |
| 31 | a failed table lookup told a waiter "not in your section" about their own table (403, dropped) | lib/tableOfAction throws busy | `verify:tablet-twins`, new-b P182170–P182175 |
| 32 | the settle log asked `splits ?` after the split branch had returned | plain "bill_paid" | new-i |
| 33 | sixteen fallbacks that could never run (`b \|\| ""` ×11, `\|\| "/"` ×2, `?? ""` ×3) | removed | coverage.mjs |

| 34 | the cancel-order question offered "Cancel" beside "Cancel order" (seen on backup the day item 8 shipped) | confirmDialog names its close button per call; this one says "Keep order" | `verify:tablet-twins` §3, P169208–P169210 |
Not problems: **10** — the waiter/manager tile comparison, done on screen 2026-10-11 (ledger P11388). **13** — the three
Pay-later sub-switches of the retired Access panel: already deleted on main by another terminal (5a151f78, 2026-10-10).

Twin note (outside this territory, not changed here): the manager route's whole-floor share has the same
`{error}`-is-a-success shape as item 6 (app/api/editor → GET /summary); the kitchen route's accept / dish-status
lack item 1's refusal. Round 2 adds: lib/sessionClose's "is this table ours?" read ignores `.error`
(a blip after a khata park answers 404); lib/managerPin.verifyManagerPin ignores `.error` (a blip reads a right PIN
as wrong and counts a lockout try); lib/loyalty.loyaltyOnByRid has item 27's `rows || []`; lib/planTable fails open
by design; the manager route keeps item 29's dead parcel line.
