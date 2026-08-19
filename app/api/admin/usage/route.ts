// GET /api/admin/usage — per-restaurant USAGE (order volume, staff, tables) from the
// lfh_admin_usage RPC (mig 153). A cost/egress PROXY for the operator (which restaurants
// are heavy to serve) — counts only, NO food money (admin sees no earnings). One aggregated
// RPC round-trip, no per-restaurant fan-out.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [usageQ, restsQ] = await Promise.all([
    sb.rpc("lfh_admin_usage"),
    sb.from("restaurants").select("id, name, slug").is("deleted_at", null),
  ]);
  const anyErr = usageQ.error || restsQ.error;
  // THE CONSOLE GETS A SENTENCE, NOT A POSTGRES ERROR (T20 sweep, 2026-08-19). This answered the
  // database's own words verbatim, so the toast read something like `relation "lfh_admin_usage" does
  // not exist`. adminFail keeps BOTH halves — a plain sentence in `error` (which lib/adminFetch is
  // what every screen surfaces) and the raw text in `detail` plus the server log, which is where it
  // is actually useful. Rolled out to forty-odd handlers on 2026-08-14; this one was missed.
  if (anyErr) return adminFail("the usage figures", anyErr, { action: "load" });

  const meta = new Map<string, { name: string; slug: string }>((restsQ.data || []).map((r) => [r.id, { name: r.name, slug: r.slug }]));
  const rows = ((usageQ.data as { restaurant_id: string; orders_7d: number; orders_30d: number; staff_total: number; table_count: number }[]) || [])
    // Keep only LIVE restaurants: if the RPC ever returns a binned tenant it would otherwise
    // show as a nameless "—" row AND inflate the totals below (every sibling route filters to
    // live ids — usage was trusting the RPC; audit 2026-07-23).
    .filter((u) => meta.has(u.restaurant_id))
    .map((u) => ({
    id: u.restaurant_id,
    name: meta.get(u.restaurant_id)?.name || "—",
    slug: meta.get(u.restaurant_id)?.slug || "",
    orders7d: Number(u.orders_7d) || 0,
    orders30d: Number(u.orders_30d) || 0,
    staff: Number(u.staff_total) || 0,
    tables: Number(u.table_count) || 0,
  }));
  const totals = {
    orders7d: rows.reduce((s, r) => s + r.orders7d, 0),
    orders30d: rows.reduce((s, r) => s + r.orders30d, 0),
    staff: rows.reduce((s, r) => s + r.staff, 0),
    restaurants: rows.length,
  };
  return NextResponse.json({ rows, totals, generatedAt: new Date().toISOString() });
}
