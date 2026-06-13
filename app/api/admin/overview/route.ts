// GET /api/admin/overview — the admin cockpit numbers + current settings.
// Aggregated server-side (service role) so the admin downloads one small summary:
// maintenance state, sessions on/off, table count, feature flags, and today's
// open tables / active orders / unpaid bills / revenue / order count.
// Behind the admin gate (middleware protects /api/admin/*).

import { NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [settingsQ, sessionsQ, ordersQ] = await Promise.all([
    sb.from("settings").select("*").eq("id", "site").maybeSingle(),
    sb.from("sessions").select("id,status").eq("status", "open"),
    sb.from("orders").select("status,payment_status,total,discount,archived,created_at").gte("created_at", since.toISOString()),
  ]);
  if (settingsQ.error) return NextResponse.json({ error: settingsQ.error.message }, { status: 500 });

   
  const settings: any = settingsQ.data || {};
  const openTables = (sessionsQ.data || []).length;
  const orders = ordersQ.data || [];
  const activeOrders = orders.filter((o) => !o.archived && (o.status === "received" || o.status === "preparing")).length;
  const revenueToday = orders
    .filter((o) => o.status !== "cancelled" && o.payment_status === "paid")
    .reduce((s, o) => s + (Number(o.total) || 0) - (Number(o.discount) || 0), 0);
  const unpaidOrders = orders.filter((o) => o.status !== "cancelled" && o.payment_status !== "paid" && !o.archived).length;

  return NextResponse.json({
    maintenance: settings.service_mode === true,
    sessionsEnabled: settings.sessions_enabled === true,
    tableCount: Number(settings.table_count) || 0,
    features: settings.features || {},
    openTables,
    activeOrders,
    unpaidOrders,
    revenueToday: Math.round(revenueToday * 100) / 100,
    ordersToday: orders.length,
  });
}
