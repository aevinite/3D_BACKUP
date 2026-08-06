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
import { ownerScope, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse, type PartialKey } from "@/lib/ownerScope";
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
  // A half-read restaurant list would make "total outstanding" quietly too small, so it is
  // answered as a retryable failure rather than a wrong figure (T9 sweep, 2026-08-05).
  let ids: string[];
  try { ids = await scopedIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return incompleteListResponse(); throw e; }
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
  // A HALF-READ MONEY FIGURE IS THE THING THIS FILE ALREADY REFUSES TO PRINT (T9 sweep,
  // 2026-08-06). Only `outQ` was checked. `collMonthQ` / `collTodayQ` went straight into
  // `sumColl()`, which reduces `q.data || []` — so an errored collection read became a confident
  // "collected today ₹0" printed beside a correct "total outstanding". That is a cash-reconciliation
  // number: the owner compares it against the till, and ₹0 says "nobody paid off their khata today",
  // which is a different statement from "we couldn't read it". The same reasoning as this route's own
  // `scopedRestaurantIds` catch a few lines up ("answered as a retryable failure rather than a wrong
  // figure") and as `RestaurantListIncomplete` itself. All three reads are now one verdict.
  //
  // ── REFINED (T9 improvement 2, 2026-08-06) ────────────────────────────────────────────────────
  // Making ALL THREE one verdict removed the wrong number, but it threw away two correct ones: if a
  // collection read blips, "total outstanding" was perfectly readable and the owner lost the whole
  // page for it. Now only the OUTSTANDING read — the one this screen exists for — fails the request.
  // A failed collection figure is reported as ABSENT (null) and named in `partial`, so the page shows
  // what is owed and greys just the collected tiles. Still never a fabricated ₹0.
  if (outQ.error) {
    // The database's own words stay our side — the owner gets a sentence they can act on (the rule
    // /api/maintenance was fixed for on 2026-08-05).
    console.error("[owner/khata] outstanding read failed:", outQ.error.message);
    return NextResponse.json(
      { error: "Couldn't load the Pay Later figures just now — please try again.", transient: true },
      { status: 503 },
    );
  }
  const partial: PartialKey[] = [];
  if (collMonthQ.error) { console.error("[owner/khata] month collected failed:", collMonthQ.error.message); partial.push("collectedMonth"); }
  if (collTodayQ.error) { console.error("[owner/khata] today collected failed:", collTodayQ.error.message); partial.push("collectedToday"); }

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
  // NULL, not 0, when the read failed — `partial` above names it and the page greys that tile.
  // `q.data || []` reducing to 0 is exactly the fabricated figure this whole block exists to stop.
  const sumColl = (q: { data: unknown; error: unknown }): number | null =>
    q.error ? null
      : Math.round(((q.data || []) as Array<{ collected: number }>).reduce((s, c) => s + (Number(c.collected) || 0), 0) * 100) / 100;

  const summary = {
    totalOutstanding: Math.round(customers.reduce((s, c) => s + c.outstanding, 0) * 100) / 100,
    peopleCount: customers.length,
    billCount: customers.reduce((s, c) => s + c.billCount, 0),
    collectedMonth: sumColl(collMonthQ),
    collectedToday: sumColl(collTodayQ),
  };
  // `partial` rides along only when something is genuinely missing, so a healthy response is
  // byte-for-byte what it was before this change.
  return NextResponse.json({ summary, customers, ...(partial.length ? { partial } : {}) });
}
