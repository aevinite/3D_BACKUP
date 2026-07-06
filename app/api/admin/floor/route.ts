// GET /api/admin/floor — the live floor, straight from the ONE brain.
//
// This calls lfh_floor_state() (migration 041), which decides every table's
// status in one place. Because every staff/admin screen reads THIS, they can
// never disagree. Runs on the server with the service-role key (the function is
// staff-only / revoked from the public key).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

// Always fetch fresh — the floor is live, never cached.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?all=1 — EVERY restaurant's floor at once (owner 2026-07-04: the admin live
  // floor must show the whole platform "like a year calendar", not just one
  // restaurant). One fan-out on the pooled server connection; the payload is
  // trimmed to the 4 fields the mini-tiles render so 12 × 300 tables stays tiny.
  // The PAGE decides when to call this (first load + manual Refresh only —
  // owner 2026-07-06); no per-event realtime — a platform-wide firehose would
  // refetch the fan-out on every order anywhere.
  if (req.nextUrl.searchParams.get("all") === "1") {
    // Order counts come pre-summed from Postgres (lfh_admin_floor_stats,
    // migration 134) — one tiny row per restaurant, never today's order rows
    // themselves. Counts only, NO revenue (owner 2026-07-03: the admin panel
    // shows no earnings anywhere).
    const [restsQ, statsQ] = await Promise.all([
      // Exclude recycle-bin restaurants (bug H4, 2026-07-06): a soft-deleted restaurant
      // must not render a live floor tile — the deleted_at filter matches the Restaurants
      // list, which was the only read that had it. Also trims the per-restaurant floor
      // fan-out (egress #4) to live tenants only.
      supabaseAdmin.from("restaurants").select("id, name, slug, active").is("deleted_at", null).order("name"),
      supabaseAdmin.rpc("lfh_admin_floor_stats"),
    ]);
    if (restsQ.error) return NextResponse.json({ error: restsQ.error.message }, { status: 500 });
    const rests = restsQ.data ?? [];
    type StatRow = { restaurant_id: string; orders_today: number; active_orders: number; unpaid_orders: number };
    const statsBy = new Map(((statsQ.data as StatRow[] | null) ?? []).map((s) => [s.restaurant_id, s]));
    const floors = await Promise.all(rests.map(async (r) => {
      const { data, error } = await supabaseAdmin.rpc("lfh_floor_state", { p_restaurant_id: r.id });
      type Row = { table_number: string; state: string; pay: string; has_call: boolean };
      const tables = error ? [] : ((data as Row[] | null) ?? []).map((t) => ({
        n: t.table_number, s: t.state, p: t.pay || "", c: !!t.has_call,
      }));
      const st = statsBy.get(r.id);
      return {
        id: r.id, name: r.name, slug: r.slug, active: !!r.active, tables,
        ordersToday: Number(st?.orders_today) || 0,
        activeOrders: Number(st?.active_orders) || 0,
        unpaidOrders: Number(st?.unpaid_orders) || 0,
        error: error?.message || null,
      };
    }));
    // Never fake zeros: if the stats RPC failed (e.g. a DB missing migration
    // 129), say so instead of silently rendering 0 orders everywhere.
    return NextResponse.json({
      restaurants: floors,
      generatedAt: new Date().toISOString(),
      statsError: statsQ.error?.message || null,
    });
  }

  const { data, error } = await supabaseAdmin.rpc("lfh_floor_state");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // lfh_floor_state returns a JSON array of per-table objects.
  return NextResponse.json({ tables: data ?? [] });
}
