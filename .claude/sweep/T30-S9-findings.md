# Sweep #9 · terminal 30 — findings

**Territory:** `supabase/migrations/` at positions 81–160 of `ls | sort` — 80 files,
`079_tenant_uniqueness.sql` … `154_order_tip.sql`.
**Branch:** `sweep9/t30-migrations-81-160` · **port:** 4430 · **ids:** `P104501`–`P104550` of `P104501`–`P104600`.
**Ledger rows re-run:** 382 of 384 (T21.md 243, T22.md 141). Two are `⏭` with a written reason.
**New checks:** 50. **Problems found: 3. Fixed: 3. Improvements built: 0**, by the owner's instruction.

The four-part report went to the terminal window, not here — that is the whole point of sweep #9.
This file is the durable record of the three problems only.

---

## 1 · the admin Restaurants list called a restaurant "Healthy" on cancelled orders

`lfh_admin_restaurant_health` (migration 149) computed `orders_24h` and `last_order_at` over EVERY
order, cancelled ones included. On the dev stack: My Little French House read **"Healthy · 8
orders/24h"** when the honest count was **zero** — all eight were cancelled — and Green Bowl's
"last order" pointed at a cancelled order **seven days** newer than its last real one.

Migration 137 set this rule for the other three admin count functions and its header says why:
*"one restaurant shows two different order counts depending on which panel you look at… align admin
to the owner definition (exclude cancelled)."* Migration 139 applied it to 'orders today' and the
floor stats. 149 landed after both and never adopted it.

**Fixed:** migration `382_the_health_signal_counts_real_orders_only.sql`.
**Guard:** `npm run verify:admin-counts-cancelled` — both the folder and the installed bodies.
**Commit:** `91caefa4`.

## 2 · five fixtures wrote a bill that was paid but never paid

167 orders were `payment_status='paid'` with `paid_at` NULL. None from the product — all three
settle paths write the pair together. Five scripts did it: `seed-demo-orders`,
`verify-customer-erase`, `t9-fixture-test`, `stress`, `stress-max`.

No screen showed a wrong number, because every owner money figure resolves the date with
`CASE WHEN khata_at IS NOT NULL AND paid_at IS NOT NULL THEN paid_at ELSE created_at END`. But
`lfh_khata_collected` filters on `paid_at IS NOT NULL` outright, so a seeded bill vanished from a
collection report with no error anywhere — and the 167 rows had turned ledger row **P25413** red.

**Fixed:** all five scripts stamp `paid_at`; the 167 rows backfilled to their own `created_at`.
**Guard:** `verify:test-safety` section 13.
**Commit:** `ef36797d`.

## 3 · 127 removed restaurants were back in the owner's estate view, with their money

`GET /api/owner/overview?scope=all` returned **177** restaurant rows where **50** restaurants exist.
`totals.restaurantCount` read 177, and **₹7,30,621.50** of all-time takings from binned restaurants
was folded into the estate headline — ₹7,30,411.50 of it from one removed restaurant, OG'S CAFE.
Root cause: `scopedRestaurantIds()` paged `restaurants` with no `deleted_at` filter for the admin's
`{ all: true }` scope, and `lfh_owner_overview` — written in migration 088, before the recycle bin
existed, rewritten six times since — never gained one either.

**⚠️ Not the deleted-BILL rule.** `docs/COMPLIANCE-GUARDRAILS.md` §4 REQUIRES a soft-deleted bill to
stay in the owner's revenue (migration 309's asymmetry). That is `orders.deleted_at`. This is
`restaurants.deleted_at`. Proof it is a different thing: after the fix the live restaurants'
all-time total is unchanged at ₹3,15,10,540, to the paisa. **Sweep #10: do not reverse this.**

**Fixed:** `lib/ownerScope.ts` (the root) **and** migration
`383_a_restaurant_in_the_bin_leaves_the_estate.sql` (the rule in the RPC, per the SaaS rule).
**Guard:** `npm run verify:binned-restaurant-leaves` — four halves, both code halves proved able to fail.
**Commit:** `e0ec4b83`.

---

## Two rows left `⏭`, with what a later session should do

- **P10815** — the discount-shrink arithmetic WAS driven in the live database as a pure SELECT over
  six cases (one dish of three removed 90→60.00, all food removed 90→0, comp bigger than the food
  250→83.33 clamped, ₹111.11 on ₹555.55 →88.89), and `trg_resplit_bill_discount` is installed on the
  right events. **Not driven on screen:** that needs a live bill with a discount and a dish removal,
  on a table four other sweep terminals may be watching. Do it on a FREE French House table.
- **P10855** — `lfh_merge_cart` takes `SELECT … FOR UPDATE` on the session row before merging, proved
  by reading the installed body. **Not driven on screen:** two guest sessions joining one open table
  needs a party-head approval chain on a shared table. Do it on a FREE table and delete both members.
- **P10447** — the party-size prompt was not reachable from a bare click on an occupied tile.

## What the re-run cost, and the lesson worth keeping

**Nine of my first-pass "reds" were my own detector, not the product** — every one is written into
the row it belongs to so nobody re-files it. The two that mattered: a regex that expected the
`ANON_ALLOWED` keys to be quoted (parsed an empty allow-list, flagged six grant rows), and a
data-rewrite scan that did not strip `$$ … $$` function bodies (read an `UPDATE` inside a function
as a top-level rewrite). Three "missing index" reds were indexes a strictly LATER migration had
deliberately replaced — 245, 155 and 267 — with the successor present in every case.

**The guard I wrote nearly had the same disease.** `verify:admin-counts-cancelled` passed over a
migration whose two real `status <> 'cancelled'` clauses I had deleted, because that file's own
header explains the rule and says "cancelled" six times. It strips SQL comments now.
`verify:rejected` records the same trap from the other side.
