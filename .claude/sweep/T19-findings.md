# Sweep #6 · T19 — THE ADMIN SERVER ROUTES, PART A · findings

Territory: the first 25 `route.ts` files under `app/api/admin` (alphabetical).
Phases: P09001–P09500. Every row below is FIXED in `sweep6/t19-admin-api-a`, one commit per number.
Ledger: `.claude/sweep/LEDGER/T19.md`. Guard: `npm run verify:admin-api-a`.

**The gate itself is clean.** All 49 `/api/admin/*` routes require the admin cookie BEFORE their first
database call — checked handler by handler, not counted (`verify:admin-api-a` rule 1). Nothing here is
a gap in who can reach what.

| # | severity | kind | who is worse off | where it lives | phase |
|---|----------|------|------------------|----------------|-------|
| 1 | HIGH | code-read | admin — told "nothing was cancelled today" on a day things were | admin → Live floor → Today → Cancelled today | P09176 |
| 2 | HIGH | code-read | admin — the 🗑️ Deleted chip could read 0 while deleted bills existed | admin → Bills → the Deleted chip | P09166 |
| 3 | MED | code-read | admin — every row anonymous, filter empty | admin → Bills → Change log | P09153, P09154 |
| 4 | MED | code-read | a person locked out of the panel — their request to be let back in vanishes | admin → Rate limits → Unblock requests | P09295 |
| 5 | MED | code-read | admin — a guest's order/call count comes back short | admin → Audit & logs → Customers | P09184 |
| 6 | LOW | code-read | admin — "couldn't load" for a failed save | Repair (Fix now) · the notification bell | P09220, P09260 |
| 7 | LOW | code-read | admin — told a limit saved when the rule was gone | admin → Rate limits → The limits | P09294 |
| 8 | LOW | code-read | admin — a removal recorded that never happened | admin → Billing & plans → Manage billing | P09164 |
| 9 | LOW | code-read | admin — paid restaurant still reads as due; junk date → database prose | admin → Billing & plans → Add payment | P09160 |
| 10 | LOW | code-read | admin — Postgres prose in a red toast on eight screens | home · bell · Repair · Billing · Customers · Audit&logs · Owners · System health | P09076–P09100 |
| 11 | LOW | code-read | admin — silently short lists as the platform grows (24 reads) | backend only, nothing on screen | P09051–P09075 |
| 12 | LOW | code-read | admin — a page of anonymous phone numbers | admin → Customers | P09195 |

## 🔗 HANDOFF — the fix is in someone else's file

- **`components/admin/shared.tsx` + `lib/logTrail.ts`** — two action codes (`cancel_classified`,
  `cancel_classify_failed`) have a label but no place in the trail map, so those rows read
  "System › Other" in the admin's log detail card. **This already fails `npm run verify:read-guards`
  on `origin/main`** — both files are byte-identical to origin/main here and neither is in T19's
  territory. Fix: add the two codes to `lib/logTrail.ts` with their area/screen.

- **The other 24 `/api/admin/*` routes (T20's half)** — findings 10 and 11 are shapes, not one-offs.
  `verify:admin-api-a` runs rules 2–4 on the first 25 only; extend `PART_A` to all 49 once T20's half
  has had the same pass, and the guard covers the whole tree.

- **`scripts/verify-read-guards.mjs`** — its comment stripper takes block comments off before line
  comments. These files describe themselves in prose, and a LINE comment containing `/api/admin/*`
  opens a block comment that then swallows the code below it. `verify-admin-api-a.mjs` reverses the
  order and adds a sanity check that proves nothing was eaten; that fix belongs here too.
