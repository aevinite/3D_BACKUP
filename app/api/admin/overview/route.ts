// GET /api/admin/overview — the admin cockpit numbers + current settings.
// Aggregated server-side (service role) so the admin downloads one small summary:
// maintenance state, sessions on/off, table count, feature flags, and today's
// open tables / active orders / unpaid bills / order count.
// Behind the admin gate (middleware protects /api/admin/*).
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

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  const head = { count: "exact" as const, head: true };
  const [settingsQ, openTablesQ, ordersTodayQ, activeQ, unpaidQ] = await Promise.all([
    sb.from("settings").select("*").eq("id", "site").maybeSingle(),
    sb.from("sessions").select("id", head).eq("status", "open"),
    sb.from("orders").select("id", head).neq("status", "cancelled").gte("created_at", sinceIso),
    sb.from("orders").select("id", head).gte("created_at", sinceIso).eq("archived", false).in("status", ["received", "preparing"]),
    sb.from("orders").select("id", head).gte("created_at", sinceIso).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid"),
  ]);
  if (settingsQ.error) return NextResponse.json({ error: settingsQ.error.message }, { status: 500 });


  const settings: any = settingsQ.data || {};

  return NextResponse.json({
    maintenance: settings.service_mode === true,
    sessionsEnabled: settings.sessions_enabled === true,
    tableCount: Number(settings.table_count) || 0,
    features: settings.features || {},
    openTables: openTablesQ.count || 0,
    activeOrders: activeQ.count || 0,
    unpaidOrders: unpaidQ.count || 0,
    ordersToday: ordersTodayQ.count || 0,
  });
}
