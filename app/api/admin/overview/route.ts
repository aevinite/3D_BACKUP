// GET /api/admin/overview — the admin cockpit numbers + current settings.
// Aggregated server-side (service role) so the admin downloads one small summary:
// maintenance state, sessions on/off, table count, feature flags, and today's
// open tables / active orders / unpaid bills / order count.
// Behind the admin gate: there is NO middleware — every /api/admin/* handler checks the
// admin cookie itself (tokenIsValid on each method). A NEW admin route MUST call it too;
// don't assume a matcher covers you.
//
// NO MONEY here (bug H3, 2026-07-06): the admin panel must never receive per-restaurant
// or platform revenue (owner rule — admin gets counts + access, not earnings). The old
// `revenueToday` field was dropped even though the UI never rendered it: it still shipped
// a cross-tenant food-revenue figure in an admin-gated payload.
// EGRESS (bug #11): the counts are HEAD counts (count:"exact", head:true) instead of
// hauling every order row across all restaurants on a 60s poll just to length() them.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { businessDayStartIso } from "@/lib/businessDay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // "Today" = the 05:00-IST business day, the SAME boundary the Live-floor RPC
  // (lfh_admin_floor_stats) and the daily counters use — so the Dashboard's
  // "Orders today" and the Live floor's "Orders today" can never disagree.
  // (Was server-local midnight: on the UTC prod host that was ~05:30 IST, a third
  // definition of "today" that made the two screens diverge — audit 2026-07-06.)
  const sinceIso = businessDayStartIso();
  const head = { count: "exact" as const, head: true };
  const [settingsQ, openTablesQ, ordersTodayQ, activeQ, unpaidQ, maintQ, restNamesQ] = await Promise.all([
    sb.from("settings").select("*").eq("id", "site").maybeSingle(),
    sb.from("sessions").select("id", head).eq("status", "open"),
    sb.from("orders").select("id", head).neq("status", "cancelled").gte("created_at", sinceIso),
    sb.from("orders").select("id", head).gte("created_at", sinceIso).eq("archived", false).in("status", ["received", "preparing"]),
    sb.from("orders").select("id", head).gte("created_at", sinceIso).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid"),
    // ANY restaurant in maintenance, not just #1 (the `id='site'` read only ever saw
    // restaurant #1, so another tenant's menu could be down with no admin warning —
    // audit 2026-07-06). Scoped to live restaurants below.
    sb.from("settings").select("restaurant_id").eq("service_mode", true),
    sb.from("restaurants").select("id, name").is("deleted_at", null),
  ]);
  if (settingsQ.error) return NextResponse.json({ error: settingsQ.error.message }, { status: 500 });

  const settings: any = settingsQ.data || {};

  // Names of the LIVE restaurants currently in maintenance (a binned restaurant being in
  // service_mode is irrelevant — its menu isn't served anyway).
  const nameById = new Map<string, string>((restNamesQ.data || []).map((r) => [r.id, r.name]));
  const maintenanceNames = (maintQ.data || [])
    .map((s) => s.restaurant_id && nameById.get(s.restaurant_id))
    .filter((n): n is string => !!n);

  return NextResponse.json({
    maintenance: maintenanceNames.length > 0,
    maintenanceCount: maintenanceNames.length,
    maintenanceNames,
    sessionsEnabled: settings.sessions_enabled === true,
    tableCount: Number(settings.table_count) || 0,
    features: settings.features || {},
    openTables: openTablesQ.count || 0,
    activeOrders: activeQ.count || 0,
    unpaidOrders: unpaidQ.count || 0,
    ordersToday: ordersTodayQ.count || 0,
  });
}
