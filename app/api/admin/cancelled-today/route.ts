// GET /api/admin/cancelled-today — the list of orders CANCELLED during today's
// business day, across the whole platform, for the admin "Today" tab's expandable
// "Cancelled today" section. Fetched ONLY when the section is opened (lazy), so it
// costs nothing on the normal floor snapshot.
//
// NO money (CLAUDE.md hard rule — admin sees no earnings): restaurant name, table,
// order/KOT number and time only. Scoped to the 05:00-IST business day and bounded.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" (item 15, owner-approved 2026-09-01).
// The same missing `.error` check has been hand-fixed in this territory eleven times across three
// sweeps, and each fix started from zero because there was nothing to reuse. lib/readGuard is that
// something. What it changes, beyond one line instead of three:
//   · every read gets ONE retry on a transient connection failure (lib/readRetry) — which is what
//     most of the "blips" these checks defend against actually are;
//   · a failure is logged once, OUR side, naming WHICH read went, instead of "something failed";
//   · a read the screen genuinely tolerates says so at the call site (rowsOr), so "this one may be
//     empty" is a visible decision rather than an accident.
// The console's answer is unchanged: still adminFail, still plain words with the raw text in `detail`.
import { ReadSet, rd } from "@/lib/readGuard";
import { businessDayStartIso } from "@/lib/businessDay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceIso = businessDayStartIso();
  const reads = new ReadSet("admin/cancelled-today", await Promise.all([
    // Explicit columns, scoped to today's cancelled orders, bounded — never SELECT *.
    rd("orders", () => sb.from("orders")
      .select("id, restaurant_id, table_number, kot_no, created_at")
      .eq("status", "cancelled")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500)),
    rd("restaurants", () => sb.from("restaurants").select("id, name").is("deleted_at", null).limit(2000)),
  ]));
  if (reads.failed("orders")) return adminFail("today's cancelled orders", reads.error("orders"), { action: "load" });
  // THE NAME READ IS NOT OPTIONAL HERE, and that is the whole point of this line.
  //
  // The filter below keeps an order only if its restaurant is in `nameById`. When the restaurants
  // read failed, `restsQ.data` was null, `|| []` made the map EMPTY, and every single order was
  // dropped — so the admin was shown "nothing was cancelled today" with a confident 200, on a day
  // when orders had been cancelled. An empty screen that means "we couldn't look" is worse than an
  // error, because there is nothing to retry and nothing to doubt.
  if (reads.failed("restaurants")) return adminFail("today's cancelled orders", reads.error("restaurants"), { action: "load" });

  // `rows()` THROWS for a read that failed rather than handing back [] — both of these are checked
  // one line above, so this is the shape that cannot silently become an empty screen.
  const nameById = new Map<string, string>(reads.rows<{ id: string; name: string }>("restaurants").map((r) => [r.id, r.name]));
  const rows = reads.rows<{ id: string; restaurant_id: string | null; table_number: string | null; kot_no: number | null; created_at: string }>("orders")
    // Drop orders from binned restaurants so this list matches the non-binned "Cancelled
    // today" count on the floor (they used to appear as "Unknown restaurant" — audit 2026-07-08).
    .filter((o): o is typeof o & { restaurant_id: string } => !!o.restaurant_id && nameById.has(o.restaurant_id))
    .map((o) => ({
      id: o.id,
      restaurantName: nameById.get(o.restaurant_id) || "—",
      table: o.table_number ?? null,
      kot: o.kot_no ?? null,
      at: o.created_at,
    }));

  return NextResponse.json({ orders: rows, generatedAt: new Date().toISOString() });
}
