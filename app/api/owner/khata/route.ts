// GET /api/owner/khata — the OWNER's Pay Later (khata) liability view: who owes what
// across their restaurant(s), plus how much pay-later money was collected today and
// this month (by COLLECTION day, paid_at). READ-ONLY — collecting a debt happens in
// the manager panel; owners monitor here.
//
// Scoped to restaurants the owner owns (ownerScope) AND that still have the pay-later
// module effective (khataLadder) — so a restaurant without the module contributes
// nothing and the section shows a clean empty state, never dead UI. Uses the SAME
// mig-184 RPCs as the manager panel, so the two views can never disagree on what's owed.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, scopedRestaurantIds } from "@/lib/ownerScope";
import { khataLadder } from "@/lib/tableTags";
import { businessDayStartIso } from "@/lib/businessDay";

export const dynamic = "force-dynamic";

const emptySummary = () => ({ totalOutstanding: 0, peopleCount: 0, billCount: 0, collectedMonth: 0, collectedToday: 0 });
// IST calendar-month start as a UTC ISO instant (IST = UTC+5:30, no DST).
const istMonthStartIso = () => {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600e3).toISOString();
};

// The concrete id list for this scope. Shared helper (lib/ownerScope) because the
// admin all-restaurants read must be PAGED — three local copies each dropped restaurants
// past PostgREST's row cap (found 2026-08-04).
const scopedIds = scopedRestaurantIds;

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ids = await scopedIds(scope);
  if (!ids.length) return NextResponse.json({ summary: emptySummary(), customers: [] });

  // Keep only restaurants whose pay-later module is actually on.
  // Capped fan-out: on the admin's all-restaurants view this is one ladder read per
  // restaurant on the platform, and a bare Promise.all fires them all at once (2026-08-04).
  const ladders: Awaited<ReturnType<typeof khataLadder>>[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    ladders.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => khataLadder(id)))));
  }
  const moduleIds = ids.filter((_, i) => ladders[i].effective);
  if (!moduleIds.length) return NextResponse.json({ summary: emptySummary(), customers: [], moduleOff: true });

  // Restaurant names (a multi-restaurant owner tells brands apart).
  const names: Record<string, string> = {};
  { const r = await sb.from("restaurants").select("id, name").in("id", moduleIds);
    for (const x of (r.data || []) as { id: string; name: string }[]) names[x.id] = x.name; }

  const nowIso = new Date().toISOString();
  const [outQ, collMonthQ, collTodayQ] = await Promise.all([
    sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: moduleIds }),
    sb.rpc("lfh_khata_collected", { p_restaurant_ids: moduleIds, p_from: istMonthStartIso(), p_to: nowIso }),
    sb.rpc("lfh_khata_collected", { p_restaurant_ids: moduleIds, p_from: businessDayStartIso(), p_to: nowIso }),
  ]);
  if (outQ.error) return NextResponse.json({ error: outQ.error.message }, { status: 500 });

  const rows = (outQ.data || []) as Array<{
    restaurant_id: string; khata_customer_id: string; name: string; phone: string | null;
    note: string | null; bill_no: number | null; table_number: string | null;
    khata_at: string; bill_amount: number;
  }>;
  const byCust = new Map<string, any>();
  for (const r of rows) {
    let c = byCust.get(r.khata_customer_id);
    if (!c) {
      c = { id: r.khata_customer_id, restaurant_id: r.restaurant_id, restaurantName: names[r.restaurant_id] || "—",
            name: r.name, phone: r.phone, note: r.note, outstanding: 0, billCount: 0, oldestKhataAt: r.khata_at, bills: [] };
      byCust.set(r.khata_customer_id, c);
    }
    const amt = Number(r.bill_amount) || 0;
    c.bills.push({ bill_no: r.bill_no, table_number: r.table_number, khata_at: r.khata_at, amount: amt });
    c.outstanding = Math.round((c.outstanding + amt) * 100) / 100;
    c.billCount += 1;
    if (r.khata_at && r.khata_at < c.oldestKhataAt) c.oldestKhataAt = r.khata_at;
  }
  const customers = [...byCust.values()].sort((a, b) => b.outstanding - a.outstanding);
  const sumColl = (q: { data: unknown }) =>
    Math.round(((q.data || []) as Array<{ collected: number }>).reduce((s, c) => s + (Number(c.collected) || 0), 0) * 100) / 100;

  const summary = {
    totalOutstanding: Math.round(customers.reduce((s, c) => s + c.outstanding, 0) * 100) / 100,
    peopleCount: customers.length,
    billCount: customers.reduce((s, c) => s + c.billCount, 0),
    collectedMonth: sumColl(collMonthQ),
    collectedToday: sumColl(collTodayQ),
  };
  return NextResponse.json({ summary, customers });
}
