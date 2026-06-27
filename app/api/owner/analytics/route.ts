// GET /api/owner/analytics — drill-down data for the owner dashboard charts.
//   ?range=today|yesterday|7d|30d|all  (window; default today)
//   &rid=<uuid>              (optional: restaurant scope; omit = group scope)
//
// Group scope  → { scope:'group', restaurantRevenue[], timeseries[] }
// Restaurant   → { scope:'restaurant', restaurant{}, kpis{}, timeseries[], dishes[], categories[], hourly[] }
//
// All aggregation is server-side via the lfh_owner_* RPCs (migration 089) — one
// round-trip per chart, tiny pre-summed rows, never order scanning in JS. Service-
// role only, behind the ADMIN_PASSWORD cookie gate (same as /api/owner/overview).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
// Window for a range. "today" = since 05:00 IST business-day start (matches the
// counters + lfh_owner_overview). Others are rolling windows ending now.
function windowFor(range: string): { from: string; to: string; bucket: string } {
  const now = Date.now();
  const to = new Date(now).toISOString();
  if (range === "all") return { from: "2020-01-01T00:00:00Z", to, bucket: "day" };
  if (range === "7d") return { from: new Date(now - 7 * DAY).toISOString(), to, bucket: "day" };
  if (range === "30d") return { from: new Date(now - 30 * DAY).toISOString(), to, bucket: "day" };
  // today's 05:00 IST business-day start (shift to IST, step back 5h, floor to the day).
  const biz = new Date(now + 5.5 * 3600_000 - 5 * 3600_000);
  const todayStart = Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), biz.getUTCDate(), 5, 0, 0) - 5.5 * 3600_000;
  // yesterday: the full previous business day [yesterday 05:00 IST, today 05:00 IST).
  if (range === "yesterday") return { from: new Date(todayStart - DAY).toISOString(), to: new Date(todayStart).toISOString(), bucket: "hour" };
  // today (default): 05:00 IST business-day start → now.
  return { from: new Date(todayStart).toISOString(), to, bucket: "hour" };
}

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const range = sp.get("range") || "today";
  const rid = sp.get("rid");
  const { from, to, bucket } = windowFor(range);

  try {
    if (!rid) {
      // Group scope — the "who earns more" bar + multi-line trend.
      const [rev, ts] = await Promise.all([
        sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to }),
        sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: null, p_from: from, p_to: to, p_bucket: bucket }),
      ]);
      if (rev.error) throw rev.error;
      if (ts.error) throw ts.error;
      // An owner only ever sees their OWN restaurants; admin sees all. The RPCs sum
      // across every restaurant, so we filter the tiny pre-summed rows here.
      const allow = scope.all ? null : new Set(scope.ids);
      const restaurantRevenue = (rev.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          id: r.restaurant_id, slug: r.slug, name: r.name, accentColor: (r.accent_color as string) || "#e3c06f",
          revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      const timeseries = (ts.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          bucket: r.bucket, restaurantId: r.restaurant_id, revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      return NextResponse.json({ scope: "group", range, restaurantRevenue, timeseries });
    }

    // Restaurant scope — KPIs + per-dish/category/hourly + this restaurant's trend.
    // An owner may only drill into a restaurant they actually own.
    if (!scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const [meta, ts, dishes, cats, hourly, openT] = await Promise.all([
      sb.from("restaurants").select("id, slug, name, accent_color, hero_title").eq("id", rid).maybeSingle(),
      sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: from, p_to: to, p_bucket: bucket }),
      sb.rpc("lfh_owner_dish_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_hourly", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "open"),
    ]);
    if (meta.error) throw meta.error;
    if (!meta.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });
    for (const e of [ts, dishes, cats, hourly]) if (e.error) throw e.error;

    const dishRows = (dishes.data ?? []).map((r: Record<string, unknown>) => ({
      title: r.title, qty: Number(r.qty) || 0, revenue: num(r.revenue),
    }));
    const tsRows = (ts.data ?? []).map((r: Record<string, unknown>) => ({
      bucket: r.bucket, revenue: num(r.revenue), orders: Number(r.orders) || 0,
    }));
    const revenue = num(tsRows.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0));
    const orders = tsRows.reduce((a: number, r: { orders: number }) => a + r.orders, 0);

    return NextResponse.json({
      scope: "restaurant", range,
      restaurant: { id: meta.data.id, slug: meta.data.slug, name: meta.data.name, accentColor: meta.data.accent_color || "#e3c06f", heroTitle: meta.data.hero_title || "" },
      kpis: { revenue, orders, avgOrder: orders ? num(revenue / orders) : 0, openTables: openT.count || 0, topDish: dishRows[0]?.title || "—" },
      timeseries: tsRows,
      dishes: dishRows,
      categories: (cats.data ?? []).map((r: Record<string, unknown>) => ({ category: r.category, qty: Number(r.qty) || 0, revenue: num(r.revenue) })),
      hourly: (hourly.data ?? []).map((r: Record<string, unknown>) => ({ hour: Number(r.hour) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
