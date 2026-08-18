// Owner · Inventory & expenses report API (mig 221, Stage 1). READ-ONLY aggregates —
// the owner's operational writes happen through the embedded manager engine, which
// enforces powers per call (/api/inventory). This route follows the two house rules:
//   • ownerScope: the caller only ever reaches restaurants they own (or admin act-as).
//   • compute-on-view snapshot cache (lib/ownerCache): a normal open returns the stored
//     JSON (one row read); recompute only when stale AND the fingerprint moved;
//     ?refresh=1 forces a live recompute. Response carries cachedAt for "updated X ago".
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { signRows } from "@/lib/mediaLinks";
import { ownerScope, dbFail, type PartialKey } from "@/lib/ownerScope";
import { cachedOwnerPayload, scopeKeyOf } from "@/lib/ownerCache";
import { inventoryLadder, inventoryEffectiveByRid } from "@/lib/tableTags";
import { scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse } from "@/lib/ownerScope";
import { restaurantNames } from "@/lib/restaurantNames";
import { rd, ReadSet, ReadFailed } from "@/lib/readGuard";
import { inventoryMonthWindow } from "@/lib/inventoryWindow";

export const dynamic = "force-dynamic";
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return err("Not authorised.", 401);

  const sp = req.nextUrl.searchParams;
  const force = sp.get("refresh") === "1";
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : istToday().slice(0, 7);
  // ── ONE MONTH, ONE DEFINITION (T9 finding F27, fixed 2026-08-12) ────────────────────────────────
  // This page and the Inventory REPORT both show "purchases / waste / expenses" for a month, and they
  // used to build that month two different ways — a plain calendar month here, and a business-day
  // window over there — so the same restaurant could read two different totals depending on which
  // screen it was opened from. lib/inventoryWindow.ts is now the single definition both use.
  const { from, to, fromIso, toIso } = inventoryMonthWindow(month);

  // ── ?estate=1 · ONE BOX PER RESTAURANT (owner, 2026-08-18) ──────────────────────────────────────
  // "when there are two or more restaurant, it should show boxes of restaurants — in which
  //  restaurant how much thing has been going on."
  // Everything below computes ONE restaurant. This branch computes the same seven figures for every
  // restaurant in the owner's scope that has the module on, and it obeys the same three rules the
  // rest of this file does, because they are the rules he restated as "it should not load every
  // time, so that egress can be saved… everything should be in the back end calculating… it should
  // not take time to load":
  //   · BACK END. Each restaurant's figures come from `lfh_inv_report_summary` — the same function
  //     the single-restaurant view uses, over the same window from `inventoryMonthWindow`. So a box
  //     and the screen you reach by tapping it can never disagree; they are one calculation asked
  //     twice, not two calculations that happen to look alike.
  //   · NOT EVERY TIME. The whole thing sits in ONE `cachedOwnerPayload`, so a normal open is a
  //     single row read. The fingerprint is the newest ledger id + newest expense stamp ACROSS the
  //     scope (two bounded reads), so nothing recomputes until someone actually moves stock or
  //     writes an expense somewhere in the estate.
  //   · NOT SLOW. On a recompute the per-restaurant summaries run in parallel, in chunks of 6, so
  //     twenty restaurants cost four round-trip waits rather than twenty — and never a fan-out of
  //     twenty at once, which is what the khata route was corrected for on 2026-08-04.
  if (sp.get("estate") === "1") return estate(req, scope, month, from, to, fromIso, toIso, force);

  // Inventory is per-restaurant (stock can't meaningfully sum across kitchens):
  // the page picks one restaurant; default = the owner's first entitled one.
  let rid = sp.get("rid") || "";
  if (scope.all) {
    if (!rid) return err("Pick a restaurant.", 400);
  } else {
    if (rid && !scope.ids.includes(rid)) return err("Not your restaurant.", 403);
    if (!rid) rid = scope.ids[0];
    if (!rid) return err("No restaurant available.", 400);
  }
  if (!(await inventoryLadder(rid)).effective) return err("Inventory isn't enabled for this restaurant.", 403);

  // Change detector: the ledger head + the newest expense row move on every relevant
  // write, so an unchanged fingerprint means the stored snapshot is still exact.
  const fingerprint = async () => {
    const [mv, ex] = await Promise.all([
      sb.from("inv_movements").select("id").eq("restaurant_id", rid).order("id", { ascending: false }).limit(1),
      sb.from("expenses").select("created_at, voided_at").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(1),
    ]);
    const m = (mv.data || [])[0]; const e = (ex.data || [])[0];
    return [m?.id ?? 0, e?.created_at ?? "", e?.voided_at ?? ""].join("|");
  };

  try {
    const payload = await cachedOwnerPayload({
      // ── v2, NOT v1 (2026-08-18) ──────────────────────────────────────────────────────────────
      // The payload gained `purchasesCount`, `wasteCount` and `caps` today. A stored snapshot is
      // served as-is until its fingerprint moves, so every restaurant that had been opened once kept
      // handing the screen the OLD shape — and the screen's new "showing 100 of 412" line silently
      // never appeared, on exactly the busy restaurants that need it. Caught by checking the cached
      // reply rather than the forced one. Bump this string whenever the shape changes; the old rows
      // age out on their own.
      key: `inv:v2:${scopeKeyOf(rid, false, [rid])}:${month}`,
      force,
      fingerprint,
      compute: async () => {
        // ── EVERY READ IS CHECKED (T9 findings F1 + F2, fixed 2026-08-12) ──────────────────────────
        // Not one of these seven inspected `.error`. A failed `lfh_inv_stock_summary` made `sum` an
        // empty object, so EVERY headline printed as a confident zero — "stock value ₹0", "0 items",
        // "₹0 purchases" — for a storeroom full of food. Worse, this whole compute sits inside
        // `cachedOwnerPayload`, which only refuses to STORE a payload that declares itself `partial`;
        // this branch declared nothing, so the invented zeros were written to the cache and served
        // for hours after the blip was over.
        //
        // Now: the SUMMARY is fatal (it is the page), and each optional list degrades to empty while
        // NAMING itself in `partial` — which both tells the screen to say so and stops the snapshot
        // being stored. `rd()` also retries each read once on a transient failure (lib/readRetry), so
        // most of these never become a visible failure at all.
        const reads = new ReadSet("owner/inventory", await Promise.all([
          // ── THE SAME FUNCTION THE REPORT USES (T9 finding F27, fixed 2026-08-12) ────────────────
          // This called `lfh_inv_stock_summary(uuid, date, date)` while the Inventory REPORT calls
          // `lfh_inv_report_summary(uuid, timestamptz, timestamptz)`. They are not two views of one
          // calculation — they read DIFFERENT SOURCES for the same words:
          //   · waste ₹ here came from `inv_waste_entries.waste_date` (the date on the slip);
          //   · waste ₹ there comes from `inv_movements.created_at` (when it was actually entered).
          // A slip dated yesterday but keyed in this morning therefore landed in one month on this
          // page and a different month on the report — and migration 294's business-day correction
          // was only ever applied to the report's function, so the edges differed too.
          //
          // Two screens showing one restaurant two different totals for "August waste" is the exact
          // thing the owner asked to be made exact. So the page now asks the SAME question of the
          // SAME function over the SAME window, and they agree by construction rather than by
          // coincidence. `lfh_inv_stock_summary` is left in the database untouched (other callers may
          // exist and it is nobody's job to break them) — it simply has no caller here any more.
          rd("summary", () => sb.rpc("lfh_inv_report_summary", { p_restaurant: rid, p_from: fromIso, p_to: toIso })),
          rd("lowItems", () => sb.from("inv_items")
            .select("id, name, category, qty_base, par_qty, purchase_uom, purchase_factor")
            .eq("restaurant_id", rid).eq("active", true).not("par_qty", "is", null).limit(500)),
          rd("negItems", () => sb.from("inv_items").select("id, name, qty_base, purchase_uom, purchase_factor")
            .eq("restaurant_id", rid).eq("active", true).lt("qty_base", 0).limit(50)),
          rd("expenses", () => sb.from("expenses")
            .select("id, category, title, amount, expense_date, note, photo_url, created_by, voided_at, void_reason")
            .eq("restaurant_id", rid).gte("expense_date", from).lte("expense_date", to)
            .order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(300)),
          rd("purchases", () => sb.from("inv_purchases").select("id, kind, vendor_name, bill_no, bill_date, total, created_by, voided_at")
            .eq("restaurant_id", rid).gte("bill_date", from).lte("bill_date", to)
            .order("bill_date", { ascending: false }).limit(100)),
          rd("waste", () => sb.from("inv_waste_entries").select("reason, qty_base, unit_cost_snap, voided_at")
            .eq("restaurant_id", rid).gte("waste_date", from).lte("waste_date", to).limit(500)),
          // Stage 2: month's per-ingredient movement totals (one SQL aggregate) — feeds
          // the owner's "used by orders / count corrections" card.
          // The bounds are the window's own INSTANTS now, not `${from}T00:00:00+05:30` rebuilt from
          // the document dates: this RPC filters `inv_movements.created_at`, which is an instant, so
          // handing it midnight-to-23:59:59 of the calendar month put the 00:00–05:00 slice of the
          // 1st and the last night's trade on the wrong side of the month's edge — the same
          // business-day mismatch F27 is about, one card further down the page.
          rd("usage", () => sb.rpc("lfh_inv_usage_report", { p_restaurant: rid, p_from: fromIso, p_to: toIso })),
        ]));
        // The hero band IS this page. Without it there is nothing honest to draw, so it throws and
        // the caller answers a retryable "please try again" — never a page of zeroes.
        const sum = (reads.one<Record<string, unknown>>("summary")) || {};
        const partial = reads.partial({
          lowItems: "lowStock", negItems: "lowStock", expenses: "expenses",
          purchases: "purchases", waste: "waste", usage: "usage",
        });
        const lowItems = { data: reads.rowsOr<Record<string, any>>("lowItems", []) };
        const negItems = { data: reads.rowsOr<Record<string, any>>("negItems", []) };
        const expenses = { data: reads.rowsOr<Record<string, any>>("expenses", []) };
        const purchases = { data: reads.rowsOr<Record<string, any>>("purchases", []) };
        const waste = { data: reads.rowsOr<Record<string, any>>("waste", []) };
        const usage = { data: reads.rowsOr<Record<string, any>>("usage", []) };
        const low = (lowItems.data || [])
          .filter((i) => Number(i.qty_base) < Number(i.par_qty))
          .map((i) => ({
            id: i.id, name: i.name, category: i.category,
            have: Math.round((Number(i.qty_base) / Number(i.purchase_factor)) * 100) / 100,
            par: Math.round((Number(i.par_qty) / Number(i.purchase_factor)) * 100) / 100,
            uom: i.purchase_uom,
          }));
        const negative = (negItems.data || []).map((i) => ({
          id: i.id, name: i.name,
          have: Math.round((Number(i.qty_base) / Number(i.purchase_factor)) * 100) / 100, uom: i.purchase_uom,
        }));
        // Expense monthly rollup by category (voided rows visible in the list, out of totals).
        const expTotals: Record<string, number> = {};
        for (const e of expenses.data || []) {
          if (e.voided_at) continue;
          expTotals[e.category] = (expTotals[e.category] || 0) + Number(e.amount);
        }
        const wasteByReason: Record<string, number> = {};
        for (const w of waste.data || []) {
          if (w.voided_at) continue;
          wasteByReason[w.reason] = (wasteByReason[w.reason] || 0) + Number(w.qty_base) * Number(w.unit_cost_snap);
        }
        // Names for the usage card resolve from the already-fetched low/neg pools plus
        // one extra scoped select for whatever's missing (still bounded + column-listed).
        const usageRows = ((usage.data || []) as Record<string, unknown>[])
          .map((u) => ({
            item_id: String(u.item_id),
            consumedVal: -Number(u.consumed_val || 0),
            adjustedVal: Number(u.adjusted_val || 0),
          }))
          .filter((u) => Math.abs(u.consumedVal) > 0.01 || Math.abs(u.adjustedVal) > 0.01)
          .sort((a, b) => Math.abs(b.adjustedVal) - Math.abs(a.adjustedVal))
          .slice(0, 10);
        let usageNamed: { name: string; consumedVal: number; adjustedVal: number }[] = [];
        if (usageRows.length) {
          const nm = await sb.from("inv_items").select("id, name").eq("restaurant_id", rid)
            .in("id", usageRows.map((u) => u.item_id)).limit(10);
          const byId = new Map((nm.data || []).map((n) => [n.id as string, n.name as string]));
          usageNamed = usageRows.map((u) => ({ name: byId.get(u.item_id) || "?", consumedVal: u.consumedVal, adjustedVal: u.adjustedVal }));
        }
        const usedByOrders = ((usage.data || []) as Record<string, unknown>[]).reduce((s, u) => s - Number(u.consumed_val || 0), 0);
        const corrections = ((usage.data || []) as Record<string, unknown>[]).reduce((s, u) => s + Number(u.adjusted_val || 0), 0);
        return {
          month, rid,
          summary: {
            // Field names follow `lfh_inv_report_summary` now (see the note on the summary read).
            // The two the switch renamed: `item_count` → `stock_items`, `waste_amt` → `wasted_val`.
            // The SHAPE this route returns is unchanged, so no screen has to know any of this.
            stockValue: Number(sum.stock_value || 0),
            itemCount: Number(sum.stock_items || 0),
            lowCount: Number(sum.low_count || 0),
            negativeCount: Number(sum.negative_count || 0),
            purchases: Number(sum.purchases_amt || 0),
            waste: Number(sum.wasted_val || 0),
            expenses: Number(sum.expenses_amt || 0),
            // ── HOW MANY THERE REALLY ARE (owner, 2026-08-18: "every number should match") ──────
            // The lists below are capped reads. `lfh_inv_report_summary` already counts the month's
            // bills and waste slips in the DATABASE, over the same window, and this route was
            // throwing both counts away — so a card headed "Purchases (100)" could not tell an owner
            // whether that was all of them or the first hundred of four hundred. The screen now
            // compares the true count against the rows it holds and says so when they differ.
            purchasesCount: Number(sum.purchases_count || 0),
            wasteCount: Number(sum.waste_count || 0),
          },
          // The caps this reply was built with, so the screen never has to guess them (and cannot
          // drift out of step with them the way a hard-coded 200 on a page always eventually does).
          caps: { expenses: 300, purchases: 100, low: 500, negative: 50 },
          low, negative,
          // Expense slips get a short-lived signed link, not the permanent public one
          // (lib/mediaLinks.ts). Figures above were summed from the raw rows.
          expenses: await signRows("inv-media", (expenses.data || []) as Record<string, unknown>[], ["photo_url"]),
          expTotals,
          purchases: purchases.data || [],
          wasteByReason,
          usage: { usedByOrders: Math.round(usedByOrders * 100) / 100, corrections: Math.round(corrections * 100) / 100, top: usageNamed },
          // Naming what couldn't be read does two jobs: the screen can say it, and
          // `cachedOwnerPayload` refuses to STORE a payload carrying `partial` — so a note can
          // never outlive the blip that caused it (lib/ownerCache).
          ...(partial.length ? { partial: partial as PartialKey[] } : {}),
        };
      },
    });
    return NextResponse.json(payload);
  } catch (e) {
    // ── NEVER THE DATABASE'S OWN WORDS (T9 finding F2, fixed 2026-08-12) ──────────────────────────
    // This used to be `err(e.message, 500)` — the raw PostgREST/Postgres sentence on the owner's
    // screen, with no `transient` flag, so the client could not tell a passing blip from a permanent
    // failure and offered no retry. `dbFail` was rolled out to nine owner endpoints on 2026-08-06 for
    // exactly this and this one was missed; it also carries the statement-timeout translation, which
    // is the one database condition an owner can actually act on.
    if (e instanceof ReadFailed) {
      return dbFail("owner/inventory", e.cause, { message: "Couldn't load your stock figures just now — please try again." });
    }
    return dbFail("owner/inventory", e, { message: "Couldn't load your stock figures just now — please try again." });
  }
}

// ── the estate roll-up ──────────────────────────────────────────────────────────────────────────
// Returns { month, estate: [ { rid, name, …the same seven figures… } ], totals, cachedAt }.
// `totals` is summed from the SAME rows the boxes are drawn from, in one place, so the header and
// the boxes cannot drift apart — that is the whole of "every number should match" here. Stock VALUE
// is summed because money adds up across kitchens; stock QUANTITIES deliberately are not, because
// 4 kg here and 4 kg there is not 8 kg of anything an owner can use.
async function estate(
  req: NextRequest, scope: Awaited<ReturnType<typeof ownerScope>>,
  month: string, from: string, to: string, fromIso: string, toIso: string, force: boolean,
) {
  if (!scope) return err("Not authorised.", 401);
  let ids: string[];
  try { ids = await scopedRestaurantIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return incompleteListResponse(); throw e; }
  if (!ids.length) return NextResponse.json({ month, estate: [], totals: emptyTotals() });

  // ── NOTHING BEFORE THE CACHE THAT DOES NOT HAVE TO BE (owner, 2026-08-18: "it should not load
  // every time, so that egress can be saved… it should not take time to load") ────────────────────
  // "Which restaurants have the module on" and "what are they called" used to be answered out here,
  // on the way past — two database round-trips paid on EVERY open, including the ones that go on to
  // be served from the snapshot in a single row read. Both answers are already IN the stored
  // payload, so both belong inside `compute`, where they are paid for only when the figures are
  // actually recalculated. The key and the change-detector work off the owner's whole scope instead
  // of the live subset: a superset only ever means we notice a change we could have ignored, which
  // is the safe direction, and it removes the last reason to look at `settings` up front.
  const fingerprint = async () => {
    const [mv, ex] = await Promise.all([
      sb.from("inv_movements").select("id").in("restaurant_id", ids).order("id", { ascending: false }).limit(1),
      sb.from("expenses").select("created_at, voided_at").in("restaurant_id", ids)
        .order("created_at", { ascending: false }).limit(1),
    ]);
    const m = (mv.data || [])[0]; const e = (ex.data || [])[0];
    return [ids.length, m?.id ?? 0, e?.created_at ?? "", e?.voided_at ?? ""].join("|");
  };

  try {
    const payload = await cachedOwnerPayload({
      key: `investate:v2:${scopeKeyOf(null, !!scope.all, ids)}:${month}`,
      force,
      fingerprint,
      compute: async () => {
        // Which of them actually have the module — ONE settings read for the whole estate.
        const eff = await inventoryEffectiveByRid(ids);
        const live = ids.filter((id) => eff[id]);
        // `offCount` is not decoration: an owner with seven restaurants and three boxes needs to be
        // told the other four are switched off, not left wondering where they went.
        const offCount = ids.length - live.length;
        if (!live.length) return { month, estate: [], totals: emptyTotals(), offCount, countedOf: { counted: 0, of: 0 } };
        const names = await restaurantNames(live);
        const rows: Record<string, unknown>[] = [];
        const unread: string[] = [];
        for (let i = 0; i < live.length; i += 6) {
          const batch = live.slice(i, i + 6);
          const got = await Promise.all(batch.map((rid) =>
            rd(`sum:${rid}`, () => sb.rpc("lfh_inv_report_summary", { p_restaurant: rid, p_from: fromIso, p_to: toIso }))));
          got.forEach((g, k) => {
            const rid = batch[k];
            // A RESTAURANT WHOSE FIGURES DID NOT READ IS NOT A RESTAURANT WITH ₹0 IN IT. It keeps its
            // box, with nulls, and names itself in `partial` — the screen draws dashes and says which
            // one. Printing ₹0 for a full storeroom is the exact fault this file was corrected for on
            // 2026-08-12, one level up.
            if (g.error) { unread.push(rid); rows.push({ rid, name: names.get(rid) || "—", unread: true }); return; }
            const d = (Array.isArray(g.data) ? g.data[0] : g.data) as Record<string, unknown> | null;
            const sum = d || {};
            rows.push({
              rid, name: names.get(rid) || "—", unread: false,
              stockValue: Number(sum.stock_value || 0),
              itemCount: Number(sum.stock_items || 0),
              lowCount: Number(sum.low_count || 0),
              negativeCount: Number(sum.negative_count || 0),
              purchases: Number(sum.purchases_amt || 0),
              waste: Number(sum.wasted_val || 0),
              expenses: Number(sum.expenses_amt || 0),
            });
          });
        }
        // Busiest first — the box an owner wants is the one where the most has happened this month.
        rows.sort((a, b) => (Number(b.purchases || 0) + Number(b.expenses || 0) + Number(b.waste || 0))
                          - (Number(a.purchases || 0) + Number(a.expenses || 0) + Number(a.waste || 0)));
        const totals = rows.reduce((t: EstateTotals, r) => {
          if (r.unread) return t;                    // never sum a figure nobody read
          t.stockValue += Number(r.stockValue || 0);
          t.purchases += Number(r.purchases || 0);
          t.waste += Number(r.waste || 0);
          t.expenses += Number(r.expenses || 0);
          t.lowCount += Number(r.lowCount || 0);
          t.negativeCount += Number(r.negativeCount || 0);
          t.itemCount += Number(r.itemCount || 0);
          return t;
        }, emptyTotals());
        const round = (n: number) => Math.round(n * 100) / 100;
        return {
          month,
          estate: rows,
          totals: { ...totals, stockValue: round(totals.stockValue), purchases: round(totals.purchases),
                    waste: round(totals.waste), expenses: round(totals.expenses) },
          offCount,
          // `countedOf` lets the screen say "5 of 7 restaurants" rather than implying the totals
          // cover an estate they do not.
          countedOf: { counted: rows.length - unread.length, of: rows.length },
          ...(unread.length ? { partial: ["inventory"] as PartialKey[] } : {}),
        };
      },
    });
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof ReadFailed) return dbFail("owner/inventory.estate", e.cause, { message: "Couldn't load your stock figures just now — please try again." });
    return dbFail("owner/inventory.estate", e, { message: "Couldn't load your stock figures just now — please try again." });
  }
}
type EstateTotals = { stockValue: number; purchases: number; waste: number; expenses: number; lowCount: number; negativeCount: number; itemCount: number };
const emptyTotals = (): EstateTotals => ({ stockValue: 0, purchases: 0, waste: 0, expenses: 0, lowCount: 0, negativeCount: 0, itemCount: 0 });
