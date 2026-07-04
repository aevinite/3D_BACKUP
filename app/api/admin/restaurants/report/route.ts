// GET /api/admin/restaurants/report?restaurant_id=<uuid>&range=today|7d|30d — the
// per-restaurant "Full report" (owner's words: "every single bit" of ONE
// restaurant). NO food revenue (CLAUDE.md hard rule) — everything here is a COUNT
// or an activity-volume proxy, clearly labelled as such. Every query is scoped
// `.eq("restaurant_id", rid)`, explicit columns, head-count where possible so we
// never pull raw rows just to know how many there are. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function rangeBounds(range: string): { from: Date; to: Date } {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const days = range === "30d" ? 29 : range === "7d" ? 6 : 0;
  const fromIst = istMidnight - days * 86400000;
  return { from: new Date(fromIst - IST_OFFSET_MS), to: now };
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const url = new URL(req.url);
  const rid = url.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("restaurant_id required");
  const range = url.searchParams.get("range") || "7d";
  const { from, to } = rangeBounds(["today", "7d", "30d"].includes(range) ? range : "7d");
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const restQ = await sb.from("restaurants").select("id, name, slug, active, created_at, owner_user_id").eq("id", rid).maybeSingle();
  if (restQ.error) return bad(restQ.error.message, 500);
  if (!restQ.data) return bad("restaurant not found", 404);

  const [
    ownerQ, billingQ, settingsQ,
    ordersCountQ, orderItemsCountQ, activityCountQ, callsCountQ, sessionsCountQ,
    openTablesQ, staffQ, menuItemsCountQ,
    trendQ,
  ] = await Promise.all([
    restQ.data.owner_user_id ? sb.from("staff_users").select("name, username").eq("id", restQ.data.owner_user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from("restaurant_billing").select("plan, status, cycle, next_due_on").eq("restaurant_id", rid).maybeSingle(),
    sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle(),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso),
    sb.from("order_items").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso),
    sb.from("staff_actions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso),
    sb.from("waiter_calls").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso),
    sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso),
    sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "open"),
    sb.from("staff_users").select("role").eq("restaurant_id", rid).eq("active", true),
    sb.from("menu_items").select("id", { count: "exact", head: true }).eq("restaurant_id", rid),
    sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: rid, p_from: fromIso, p_to: toIso }),
  ]);
  for (const q of [ordersCountQ, orderItemsCountQ, activityCountQ, callsCountQ, sessionsCountQ, openTablesQ, staffQ, menuItemsCountQ, trendQ]) {
    if (q.error) return bad(q.error.message, 500);
  }

  const staffByRole: Record<string, number> = {};
  for (const s of staffQ.data || []) staffByRole[s.role] = (staffByRole[s.role] || 0) + 1;

  const ordersInRange = ordersCountQ.count || 0;
  const orderItemsInRange = orderItemsCountQ.count || 0;
  const activityInRange = activityCountQ.count || 0;
  const sessionsInRange = sessionsCountQ.count || 0;
  // "Activity volume" — a clearly-labelled PROXY for per-tenant usage/egress (real
  // DB egress isn't queryable per-tenant): every write-shaped row this restaurant
  // produced in the range. NOT bytes, NOT a billing figure.
  const activityVolume = ordersInRange + orderItemsInRange + activityInRange + sessionsInRange;

  const b = billingQ.error ? null : billingQ.data;

  return NextResponse.json({
    restaurant: {
      id: restQ.data.id, name: restQ.data.name, slug: restQ.data.slug, active: restQ.data.active, createdAt: restQ.data.created_at,
      owner: ownerQ.data ? (ownerQ.data.name || ownerQ.data.username) : null,
      plan: b?.plan || null, planStatus: b?.status || null,
    },
    range,
    usage: {
      orders: ordersInRange,
      orderItems: orderItemsInRange,
      activityLogEvents: activityInRange,
      waiterCalls: callsCountQ.count || 0,
      sessions: sessionsInRange,
      tablesConfigured: Number(settingsQ.data?.table_count) || 0,
      tablesOpenNow: openTablesQ.count || 0,
      menuItemCount: menuItemsCountQ.count || 0,
      staffByRole,
      staffTotal: (staffQ.data || []).length,
      activityVolume,
    },
    trend: (trendQ.data || []).map((r: { bucket: string; orders: number }) => ({ day: r.bucket, orders: Number(r.orders) || 0 })),
  });
}
