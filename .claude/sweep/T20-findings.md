# T20 — findings · admin server routes (part B) + the owner routes

Territory: the last 24 `app/api/admin/**/route.ts` · all 12 `app/api/owner/**/route.ts` (36 files, 8,076 lines).
Phases P09501–P10000. Branch `sweep6/t20-admin-api-b`.

**Five real problems, all fixed and guarded. Zero of them were data-separation faults** — every
handler gates before its first database call, and 49/49 admin routes check the sign-in (the CLAUDE.md
invariant holds, re-counted handler by handler).

---

## F1 · A blip in "which restaurants may you see" answered a blank 500 on every owner screen
**confirmed** (code-read + `grep` proving zero callers) · severity: medium · **FIXED** (item 1)

`lib/ownerScope.ts` throws `OwnerScopeUnavailable` when the admin act-as widen read fails. That throw
is deliberate: the alternative — a PARTIAL scope — silently hides restaurants an owner owns (T9 F22).
The same change wrote `ownerScopeOr503()` to turn it into a retryable 503 with a plain sentence.
**It had zero callers.** All twelve owner routes resolved the scope bare, so the throw reached Next
unhandled.

- Who is worse off: the admin opening an owner's cockpit (Dashboard, Reports, Pay Later, Customers,
  Audit & logs, Team, Settings, Complaints, Ratings, Inventory) while that read hiccups.
- Reachable: any transient failure of the `restaurant_owners` widen read.
- Fix: eleven routes wired to the helper; `app/api/owner/staff` already had its own `transient()`.
  The 401 body is byte-for-byte unchanged.
- Guard: `npm run verify:owner-scope` (new, `scripts/verify-owner-scope-503.mjs`) — walks
  `app/api/owner` rather than holding a list.

## F2 · Erasing a guest could destroy the record of a small unpaid pay-later debt
**confirmed on real rows** · severity: HIGH (money/record) · **FIXED** (item 2)

`DELETE /api/owner/customers` refuses while a pay-later bill is outstanding. It computed that from
`lfh_khata_outstanding(p_restaurant_ids, p_limit: 500)`, which is bounded BY PERSON over
`row_number() OVER (ORDER BY sum(bill_amount) DESC)` (mig 309) — the 500 biggest debtors and nobody
else. A guest ranked 501st read as owing ₹0 and was erased, their khata record anonymised with the
debt standing.

- Reproduced live: two debtors seeded on French House (₹5,000 and ₹40); the ranked read at a cap of 1
  computed ₹0 for the small one. Both fixtures deleted by id in the same run.
- Fix: an exact per-person read of their own open orders, mig 309's predicate, mig 301's arithmetic
  (`total − disc_gross`), on `orders_khata_open_live_ix`. The pointless summary probe above it is
  gone — its `.data` was never read.
- Guard: five new checks in `npm run verify:customer-erase`. Verified it goes RED with the fault back.

## F3 · The owner's Settings page could go silently empty
**code-read** · severity: medium · **FIXED** (item 3)

`GET /api/owner/settings` builds its whole answer from one restaurant list — the feature switches,
each row's name and the kitchen-printing rows all read it — and never inspected that read's error.
A blip returned a page with no restaurants, no switches, no printing, and nothing saying why.

This is finding F16 in the branch F16 did not cover: that fix (2026-08-12) filled the list for the
ADMIN's `scope.all` view and left the real owner's `else` branch — the majority case — as it was.

- Guard: three checks in `npm run verify:read-guards`, covering BOTH branches.

## F4 · A banquet bill series could be renumbered because a count hiccuped
**code-read** · severity: medium (audit trail) · **FIXED** (item 4)

`POST /api/admin/restaurants/settings` refuses a new `banquet_bill_next` once banquet bills exist.
Neither read behind the refusal checked its error, and a failed count is null, so
`Number(issued.count) || 0` came out 0 — "none issued yet" — and the lock opened. A bill series that
can move backwards is what an audit checks.

- Guard: `npm run verify:admin-refusals` (new), plus a sweep of my half of the admin API for any other
  gate deciding from an unchecked count. Verified it goes RED with the fault back.

## F5 · Access & permissions said "Saved" for a change it had thrown away
**confirmed live** · severity: medium (a dead switch wearing a green tick) · **FIXED** (item 5)

Two of the four allow-list branches counted survivors and left their column alone when nothing
survived; `features` and `channels`/`creds` wrote the column back with its own current value, so the
handler's own "did anything land?" test said yes, the screen went green, the switch snapped back on
the next load — and the guest menu cache was purged for a write that changed nothing.

- Reachable whenever a screen is a version behind the model (a retired row on a tab left open across
  a deploy).
- Proven live: `{features:{not_a_feature:true}}` and `{channels:{not_a_channel:true}}` now both answer
  400 "Nothing in that change could be saved".
- Guard: one check per branch in `npm run verify:admin-refusals`.

---

## 🔗 HANDOFF — real, but the fix is in another terminal's files

### H1 · Two log rows read "System › Other" instead of naming their screen
`components/admin/shared.tsx` declares `cancel_classified` and `cancel_classify_failed` in
`ACT_LABEL` (added with migration 337), and `lib/logTrail.ts` has no place for either. `placeOf()`
falls through to "System", so the two rows written when someone answers "was the food made?" on a
cancellation lose their restaurant › panel › area › screen path in the Activity log's detail card —
against the owner's standing 2026-08-12 rule that every row must say where it happened.

**This makes `npm run verify:read-guards` RED on a clean `origin/main`, before any of my work.**
Written by `app/api/editor/[...path]/route.ts` lines 3177 and 5215, so both are the manager panel.

Exact change, in `lib/logTrail.ts`, beside `order_cancel`:
```ts
  cancel_classified:      { area: "Orders & bills", screen: "Kitchen tickets" },
  cancel_classify_failed: { area: "Orders & bills", screen: "Kitchen tickets" },
```

### H2 · Two admin screens disagree about how to CLEAR a delivery-channel key
Both write `settings.platform_channels`. `app/api/admin/restaurants/platform-channels` treats `""` as
"clear it" and ignores `null`; `app/api/admin/restaurants/access-tree` treats `null` as "remove it"
and `""` as "leave it alone" — the opposite convention on the same column. Both are in MY territory,
so I could have changed one; I did not, because each screen's own UI matches its own route and no
person is worse off today. It is the same family as T17's finding F4 (one column, two field names)
and it is a decision about which convention wins. Listed as 🟡 item 12 in the chat report.

---

## Checked and deliberately NOT reported as faults

- **`/api/admin/users` payroll formula differs from `moduleLadder`** — only when
  `payroll_owner_control` is true and `payroll_enabled` is NULL, and mig 220 declares that column
  `NOT NULL DEFAULT true`. Unreachable; editing a working money gate to satisfy a shape argument is
  the worse trade.
- **`/api/owner/audit` POST has no `withIdempotency`** — mig 337's `lfh_cancel_classify` states, and
  is, idempotent; the manager twin is wrapped only because its whole dispatcher is.
- **Branding/logo writes do not bust `menuTag`** — `lib/menuDataServer` caches dishes + categories
  only; accent and logo are read outside it. Would have been a wrong fix.
- **Admin settings writes do not call `invalidateFloor`** — the shared floor window is 1500ms and
  `settings` is not a floor table.
- **Hand-rolled `restaurants.name` reads in `/api/owner/reports`** — `name` is `text NOT NULL`
  (mig 078) and all 17 dev rows are plain strings, so the "[object Object]" case the shared helper
  guards is unreachable.
- **`cleanClonedSettings` leaking a channel key into a new restaurant** — it replaces
  `platform_channels` wholesale from `CHANNEL_DEFAULTS`, which carries no key. Checked because
  `select("*")` on `settings` is how the template is read.
- **`bill-preview` handing the whole settings row to `billPreviewHtml`** — that function reads named
  fields and never serialises the row, so the channel key cannot reach the page.
- **The bill and parcel preview documents have no literal `<html>` tag** — valid HTML5, the element is
  implied. My first assertion was wrong, not the route.
- **`audit_retention_years` missing from the admin Settings screen** — it is offered on Audit & logs
  (`/aevinite/logs`), which is its right home.
