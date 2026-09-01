# Sweep #7 · T19 — THE ADMIN SERVER ROUTES, PART A · findings

Territory: the first 25 `route.ts` files under `app/api/admin` (alphabetical) **plus
`rate-limits`**, which the alphabet pushed to position 26 and out of every territory's range.
**26 files · 4,531 lines · 201 database calls · 39 exported handlers.**

Ledger: `.claude/sweep/LEDGER/T19.md` — **1,503 rows**.
- `P09001`–`P09500` — sweep #6's block, re-run in place on 2026-08-27: **498 ✅ · 2 ⏭ · no regression.**
- `P24101`–`P24600` — the first fresh 500 of sweep #7.
- `P53201`–`P53700` — the SECOND fresh 500, planned on 2026-09-01 from an **inventory** of the
  boundary at the owner's instruction: one row per handler, per database call, per parameter, per
  refusal, per reply, plus 153 live calls.

Guards: `verify:admin-api-a` (324 checks, **five** rules now), `verify:read-guards` (88),
`verify:print-helper` (148).

**The happy paths are in good shape.** All 49 `/api/admin/*` handlers require the admin cookie
before their first database call. Every list read states a ceiling. Every aggregate rides the
snapshot cache. Nothing here can make a sale disappear. **Every fault found in three passes was in
a FAILURE path** — what a screen says when a read does not work — except two, which were a guard
whose coverage had silently narrowed and a parameter nobody had ever driven.

| # | severity | kind | who is worse off | where it lives |
|---|----------|------|------------------|----------------|
| 1 | HIGH | code-read + live | admin — a deleted restaurant's bills read "—" | admin → Bills ledger · Bills → Change log |
| 2 | HIGH | code-read | admin — a bill marked deleted while its orders stayed live, no record | admin → Bills ledger → Delete / Restore |
| 3 | MED | code-read | a suspended owner — their open panel could keep working | admin → Owners → Suspend · Reset password |
| 4 | MED | code-read + live | admin — the database's own sentence on four more screens | Live floor · Bills (credit note) · Audit & logs → Customers · Customers |
| 5 | LOW | code-read | admin — a newly overdue plan read "due soon" for 5.5h a night | admin → Billing & plans |
| 6 | LOW | code-read | admin — "couldn't save" naming no field for a typed date | admin → Billing & plans → Manage billing |
| 7 | MED | guard | admin — three "cleared N of them" numbers could read short | Rate limits · the bell · Repair |
| 8 | LOW | code-read | admin — two requests answered as if they had worked | admin → Printing · admin → Repair |
| 9 | LOW | code-read | admin — "restaurant not found" for a read that merely failed | any Quick-open button |
| 10 | LOW | improvement | admin — the money record did not say which payment went | admin → Billing & plans |
| 11 | LOW | improvement | nobody — one database read per bill expanded, answering nothing | admin → Bills ledger |
| 12 | LOW | improvement | the next reader — three comments promised a deleted rule | backend only, nothing on screen |
| 14 | LOW | code-read | admin — a row marked overdue on a different calendar from its own card | admin → Billing & plans |
| 15 | — | improvement | the next fault of this shape — 19 routes now name their failed read | backend only, nothing on screen |
| 17 | LOW | code-read | admin — "the date could not be moved" was hidden | admin → Billing & plans → Add payment |
| 18 | MED | code-read | admin — a failed guest count STORED in the snapshot as a confident zero | admin → Customers |
| 19 | LOW | code-read | admin — "not found" for a record that is there | Audit & logs → Removals · Repair → Fix now |
| 20 | MED | code-read | admin — a wrong picture of a shop's printing hardware | admin → Printing |
| 21 | LOW | code-read | admin — eleven refusals that could be a blip in a definite sentence | Owners · Rate limits · Printing |
| 22 | MED | live drive | admin — the Platform analytics page answered 500 | admin → Platform analytics |

Item 13 (a ceiling on the new Printing overview's restaurants read) was found on a rebase and then
**fixed upstream by another lane** (`a629fa34`) before this branch landed. Recorded, not re-applied.

## 🔗 HANDOFF — what is left, and to whom

- **Nothing is open in this territory.** The two handoffs the first 500 recorded are both closed:
  the Billing page's own date (done as item 14, on his instruction) and the guard's coverage of the
  other 24 admin routes (extended to all 49 by T20's sweep #7, upstream).
- **A JSONB restaurant name** would render as `[object Object]` on five admin screens; only
  `app/api/admin/customers` carries the fallback. No such row exists on this database, so nothing
  is broken today — the shared helper is one import if a translated name is ever stored.
- **`app/api/admin/rate-limits/route.ts` still belongs to no territory** by the roadmap's own
  `head -25` / `tail -24` arithmetic. This pass adopted it and the guard now names it; the next
  roadmap should say so out loud.
