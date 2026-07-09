// GET /api/admin/health — read-only platform diagnostics for the System Health
// page. Deliberately cheap: a trivial round-trip for latency, planner ROW
// ESTIMATES (pg_class.reltuples via migration 119's RPC — zero table scan) for
// the big tables instead of exact COUNT(*), and small bounded queries for
// everything else. No food revenue, no secrets. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const pingQ = await sb.from("settings").select("restaurant_id").limit(1);
  const latencyMs = Date.now() - t0;
  if (pingQ.error) {
    return NextResponse.json({ latencyMs, dbOk: false, error: pingQ.error.message }, { status: 200 });
  }

  const [estimatesQ, restQ, staffQ, issuesQ] = await Promise.all([
    sb.rpc("lfh_admin_table_estimates"),
    // Live restaurants only (bug H4/#6, 2026-07-06): binned restaurants must not be
    // counted as "suspended". With deleted_at excluded, suspended = live-but-inactive.
    sb.from("restaurants").select("id, active").is("deleted_at", null),
    // Bounded read — this page auto-refreshes every 60s, so cap it so it can't grow
    // into a full-table pull as staff count climbs across all tenants (egress guard).
    sb.from("staff_users").select("id, last_seen_at").eq("active", true).limit(5000),
    sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const restaurants = restQ.data || [];
  const activeRestaurants = restaurants.filter((r) => r.active).length;
  const suspendedRestaurants = restaurants.length - activeRestaurants;

  const now = Date.now();
  const staffOnlineNow = (staffQ.data || []).filter((u) => u.last_seen_at && now - new Date(u.last_seen_at).getTime() < 180_000).length;

  let supaHost = "";
  try { supaHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").host; } catch {}

  // `restaurants` is a tiny, rarely-ANALYZEd table — pg_class.reltuples can sit at
  // 0 for it even though rows exist (a known reltuples quirk for small/low-churn
  // tables). We already have restQ's EXACT count for free, so use that instead of
  // the estimate for this one row only; the other (large, hot) tables keep using
  // the cheap planner estimate as intended.
  const tableEstimates = estimatesQ.error
    ? []
    : (estimatesQ.data || []).map((r: { table_name: string; est_rows: number }) =>
        r.table_name === "restaurants" ? { table: r.table_name, estRows: restaurants.length } : { table: r.table_name, estRows: Number(r.est_rows) || 0 }
      );

  return NextResponse.json({
    dbOk: true,
    latencyMs,
    tableEstimates,
    tableEstimatesError: estimatesQ.error?.message || null,
    restaurants: { active: activeRestaurants, suspended: suspendedRestaurants, total: restaurants.length },
    restaurantsError: restQ.error?.message || null, // so the page shows "unreadable", not a green "0 live"
    staffOnlineNow,
    staffTotal: (staffQ.data || []).length,
    staffError: staffQ.error?.message || null,
    realtime: { configuredHost: supaHost || null },
    openIssues: issuesQ.error ? null : (issuesQ.count || 0),
    issuesFeedWired: !issuesQ.error,
    checkedAt: new Date().toISOString(),
  });
}
