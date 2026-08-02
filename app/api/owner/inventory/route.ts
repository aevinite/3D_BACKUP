// Owner · Inventory & expenses report API (mig 221, Stage 1). READ-ONLY aggregates —
// the owner's operational writes happen through the embedded manager engine, which
// enforces powers per call (/api/inventory). This route follows the two house rules:
//   • ownerScope: the caller only ever reaches restaurants they own (or admin act-as).
//   • compute-on-view snapshot cache (lib/ownerCache): a normal open returns the stored
//     JSON (one row read); recompute only when stale AND the fingerprint moved;
//     ?refresh=1 forces a live recompute. Response carries cachedAt for "updated X ago".
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";
import { cachedOwnerPayload, scopeKeyOf } from "@/lib/ownerCache";
import { inventoryLadder } from "@/lib/tableTags";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { expectClash, clashJson } from "@/lib/clash";

export const dynamic = "force-dynamic";
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return err("Not authorised.", 401);

  const sp = req.nextUrl.searchParams;
  const force = sp.get("refresh") === "1";
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : istToday().slice(0, 7);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);

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
        const [summary, lowItems, negItems, expenses, purchases, waste, usage] = await Promise.all([
          sb.rpc("lfh_inv_stock_summary", { p_restaurant: rid, p_from: from, p_to: to }),
          sb.from("inv_items")
            .select("id, name, category, qty_base, par_qty, purchase_uom, purchase_factor")
            .eq("restaurant_id", rid).eq("active", true).not("par_qty", "is", null).limit(500),
          sb.from("inv_items").select("id, name, qty_base, purchase_uom, purchase_factor")
            .eq("restaurant_id", rid).eq("active", true).lt("qty_base", 0).limit(50),
          sb.from("expenses")
            .select("id, category, title, amount, expense_date, note, photo_url, created_by, voided_at, void_reason")
            .eq("restaurant_id", rid).gte("expense_date", from).lte("expense_date", to)
            .order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
          sb.from("inv_purchases").select("id, kind, vendor_name, bill_no, bill_date, total, created_by, voided_at")
            .eq("restaurant_id", rid).gte("bill_date", from).lte("bill_date", to)
            .order("bill_date", { ascending: false }).limit(100),
          sb.from("inv_waste_entries").select("reason, qty_base, unit_cost_snap, voided_at")
            .eq("restaurant_id", rid).gte("waste_date", from).lte("waste_date", to).limit(500),
          // Stage 2: month's per-ingredient movement totals (one SQL aggregate) — feeds
          // the owner's "used by orders / count corrections" card. IST day bounds, so
          // the month's edges line up with the waste/expense cards beside it.
          sb.rpc("lfh_inv_usage_report", { p_restaurant: rid, p_from: `${from}T00:00:00+05:30`, p_to: `${to}T23:59:59+05:30` }),
        ]);
        const sum = (summary.data as Record<string, unknown>[] | null)?.[0] || {};
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
            stockValue: Number(sum.stock_value || 0),
            itemCount: Number(sum.item_count || 0),
            lowCount: Number(sum.low_count || 0),
            negativeCount: Number(sum.negative_count || 0),
            purchases: Number(sum.purchases_amt || 0),
            waste: Number(sum.waste_amt || 0),
            expenses: Number(sum.expenses_amt || 0),
          },
          low, negative,
          expenses: expenses.data || [],
          expTotals,
          purchases: purchases.data || [],
          wasteByReason,
          usage: { usedByOrders: Math.round(usedByOrders * 100) / 100, corrections: Math.round(corrections * 100) / 100, top: usageNamed },
        };
      },
    });
    // Read OUTSIDE the snapshot cache. It's one indexed column, and folding it into the
    // cached payload would mean flipping the toggle didn't show until the snapshot aged
    // out — a switch that appears not to have worked is worse than an extra tiny read.
    const cfg = await sb.from("settings").select("cancel_cost_mode").eq("restaurant_id", rid).maybeSingle();
    return NextResponse.json({ ...payload, cancelCostMode: (cfg.data?.cancel_cost_mode as string) || "stock" });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Couldn't load inventory.", 500);
  }
}

// ── PATCH: how a cancelled order is paid for (mig 252, owner 2026-08-02) ──────
//   { restaurant_id, cancel_cost_mode: "stock" | "bill" }
//
// The owner's own words: "whenever the inventory is on, it will cut from inventory; if
// the inventory is off, it will cut from total bill" — plus a toggle so he can choose.
// It lives on the Inventory page because that is where he asked for it, and because the
// choice only means anything for a restaurant that HAS stock to take the loss out of.
//
// Why this cannot be silently overwritten: it changes every past day's profit figure the
// moment it flips, so two owners on two devices must not quietly clobber each other. The
// house rule is first-save-wins with the loser TOLD — the client sends what it was
// looking at in X-LFH-Expect and the one gate below answers.
export async function PATCH(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return err("Not authorised.", 401);
  const body = await req.json().catch(() => ({}));
  const rid = String(body?.restaurant_id || "");
  const mode = String(body?.cancel_cost_mode || "");
  if (!rid || (mode !== "stock" && mode !== "bill"))
    return err("restaurant_id and cancel_cost_mode ('stock' or 'bill') are required.", 400);
  if (!scope.all && !scope.ids.includes(rid)) return err("Not your restaurant.", 403);
  // Same per-restaurant privacy rule the settings route applies: a REAL owner only
  // changes a restaurant whose "settings" section the admin still grants them.
  if (!scope.all && !scope.admin && !(await entitledSubset([rid], "settings")).length)
    return err("The admin hasn't given you settings for this restaurant.", 403);
  if (!(await inventoryLadder(rid)).effective)
    return err("Inventory isn't enabled for this restaurant, so cancelled orders always come off the bill.", 403);

  const clash = await expectClash(req, rid);
  if (clash) return clashJson(clash);

  const { error } = await sb.from("settings").update({ cancel_cost_mode: mode }).eq("restaurant_id", rid);
  if (error) return err(error.message, 500);
  return NextResponse.json({ ok: true, cancel_cost_mode: mode });
}
