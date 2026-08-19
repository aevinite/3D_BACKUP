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
import { ownerScope, ownerScopeOr503, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse, type PartialKey } from "@/lib/ownerScope";
import { khataLadder } from "@/lib/tableTags";
import { businessDayStartIso } from "@/lib/businessDay";
import { restaurantNames } from "@/lib/restaurantNames";

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
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;
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
  // Shared lookup (finding F17) — checks its own error rather than silently rendering every debt's
  // restaurant as "—", which on a multi-restaurant estate makes "who owes what" unreadable.
  const names = await restaurantNames(moduleIds);

  const nowIso = new Date().toISOString();
  // HOW MANY PEOPLE THE LIST SHOWS. Bounded by PERSON (mig 309), biggest debt first, so everyone
  // shown has all of their own bills and their figure is complete — bounding by BILL would cut a
  // customer's smaller bills and understate that person. The HEADLINE never depends on this.
  const PEOPLE_SHOWN = 500;
  const [outQ, sumQ, collMonthQ, collTodayQ] = await Promise.all([
    sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: moduleIds, p_limit: PEOPLE_SHOWN }),
    // THE HEADLINE COMES FROM AN AGGREGATE, NOT FROM SUMMING THE ROWS (2026-08-11, T7 finding F13).
    // `lfh_khata_outstanding` returns one row per open BILL and this route summed those rows in JS.
    // PostgREST caps a set-returning rpc at db-max-rows exactly as it caps a select — this project's
    // DB has such a cap and the Z-report pages around it for the same reason, in its own words:
    // "silently computed the till on a truncated sample → understated cash". Pay-later bills pile up
    // until someone pays, so a khata-heavy restaurant crosses that cap over months and "TOTAL
    // OUTSTANDING" quietly goes small — on the one figure that says how much the restaurant is owed.
    // This returns ONE row computed in SQL, so there is nothing left for a row cap to truncate.
    sb.rpc("lfh_khata_outstanding_summary", { p_restaurant_ids: moduleIds }),
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
  // The SUMMARY read fails the request for the same reason the outstanding read does: it IS the
  // "how much are we owed" figure now, and a wrong one is worse than none (this route's own rule).
  if (sumQ.error) {
    console.error("[owner/khata] outstanding summary failed:", sumQ.error.message);
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
      c = { id: r.khata_customer_id, restaurant_id: r.restaurant_id, restaurantName: names.get(r.restaurant_id) || "—",
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

  // The three headline figures, counted in the DATABASE over EVERY open bill — never summed from
  // the rows above, which are bounded to the biggest `PEOPLE_SHOWN` people (T7 finding F13).
  const agg = (Array.isArray(sumQ.data) ? sumQ.data[0] : sumQ.data) as
    { total_outstanding?: number; people_count?: number; bill_count?: number } | null;
  const summary = {
    totalOutstanding: Math.round((Number(agg?.total_outstanding) || 0) * 100) / 100,
    peopleCount: Number(agg?.people_count) || 0,
    billCount: Number(agg?.bill_count) || 0,
    collectedMonth: sumColl(collMonthQ),
    collectedToday: sumColl(collTodayQ),
  };
  // SAY SO WHEN THE LIST IS SHORTER THAN THE TOTALS. The figures above always count everyone, so a
  // capped list must not read as if it were the whole book — the page shows a line naming both
  // numbers rather than letting an owner conclude that 500 people is all there is.
  const listCapped = summary.peopleCount > customers.length;
  // `partial` / `listCapped` ride along only when genuinely true, so a healthy response on an
  // ordinary restaurant is byte-for-byte what it was before this change.
  return NextResponse.json({
    summary, customers,
    ...(listCapped ? { listCapped, peopleShown: customers.length } : {}),
    ...(partial.length ? { partial } : {}),
  });
}
