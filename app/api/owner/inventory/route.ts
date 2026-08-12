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
import { inventoryLadder } from "@/lib/tableTags";
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
      key: `inv:v1:${scopeKeyOf(rid, false, [rid])}:${month}`,
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
          },
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
