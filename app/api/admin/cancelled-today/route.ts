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
import { businessDayStartIso } from "@/lib/businessDay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceIso = businessDayStartIso();
  const [ordersQ, restsQ] = await Promise.all([
    // Explicit columns, scoped to today's cancelled orders, bounded — never SELECT *.
    sb.from("orders")
      .select("id, restaurant_id, table_number, kot_no, created_at")
      .eq("status", "cancelled")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
    sb.from("restaurants").select("id, name").is("deleted_at", null),
  ]);
  if (ordersQ.error) return adminFail("today's cancelled orders", ordersQ.error, { action: "load" });

  const nameById = new Map<string, string>((restsQ.data || []).map((r) => [r.id, r.name]));
  const rows = (ordersQ.data || [])
    // Drop orders from binned restaurants so this list matches the non-binned "Cancelled
    // today" count on the floor (they used to appear as "Unknown restaurant" — audit 2026-07-08).
    .filter((o) => o.restaurant_id && nameById.has(o.restaurant_id))
    .map((o) => ({
      id: o.id,
      restaurantName: nameById.get(o.restaurant_id) || "—",
      table: o.table_number ?? null,
      kot: o.kot_no ?? null,
      at: o.created_at,
    }));

  return NextResponse.json({ orders: rows, generatedAt: new Date().toISOString() });
}
