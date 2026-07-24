// GET /api/admin/dashboard — ONE call that returns everything the admin home screen needs,
// so the dashboard makes a single round-trip instead of six (audit 2026-07-07). This cuts
// repeated egress on the 60s refresh: notably it returns ONLY the currently-online staff
// (a small, time-filtered list, ≤200) instead of hauling the whole staff_users table every
// cycle, and it reuses the pre-aggregated lfh_owner_overview RPC for per-restaurant open counts.
// Admin-gated (each admin route checks the cookie itself — there is no middleware).
// NO food money anywhere (hard rule): only counts, and lfh_owner_overview's revenue columns
// are deliberately dropped here. Activity `detail` is redacted for money.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { businessDayStartIso } from "@/lib/businessDay";
import { redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceIso = businessDayStartIso();
  const onlineSinceIso = new Date(Date.now() - 180_000).toISOString(); // "online" = seen in last 3 min
  const head = { count: "exact" as const, head: true };

  const since24hIso = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [restQ, setQ, ownersQ, ordersTodayQ, maintQ, onlineQ, issuesQ, ovRpc, actQ, errQ, fixQ] =
    await Promise.all([
      sb.from("restaurants").select("id, slug, name, active, owner_user_id").is("deleted_at", null).order("name"),
      sb.from("settings").select("restaurant_id, enabled_panels"),
      sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true),
      sb.from("orders").select("id", head).neq("status", "cancelled").gte("created_at", sinceIso),
      sb.from("settings").select("restaurant_id").eq("service_mode", true),
      // Only the staff CURRENTLY online (seen in the last 3 min) — a small list, instead of
      // hauling the ENTIRE staff_users table every 60s just to filter it on the client.
      sb.from("staff_users").select("name, username, role, restaurant_id, last_seen_at", { count: "exact" }).eq("active", true).gte("last_seen_at", onlineSinceIso).limit(200),
      sb.from("issues").select("id, restaurant_id, subject, status, created_at", { count: "exact" }).eq("status", "open").order("created_at", { ascending: false }).limit(50),
      // Per-restaurant open-table counts from the pre-aggregated RPC (p_ids=null → all). We read
      // ONLY open_tables from it; its revenue columns are ignored (no money to admin).
      sb.rpc("lfh_owner_overview", { p_ids: null }),
      // Only the columns the activity feed renders (not select("*")) — trims wire size.
      sb.from("staff_actions").select("id, panel, action, actor, detail, table_number, restaurant_id, created_at").order("created_at", { ascending: false }).limit(18),
      // Two HEAD counts for the red "Fix problems" button (owner 2026-07-22): recent app
      // errors (partial error index, mig 159) + problems reported but not yet solved.
      sb.from("staff_actions").select("id", head).eq("level", "error").is("resolved_at", null).gte("created_at", since24hIso),
      sb.from("fix_requests").select("id", head).eq("status", "open"),
    ]);

  // Surface a failed read on any number/banner the home screen relies on — otherwise a backend
  // hiccup shows a confident "0 open tables / 0 orders / no maintenance" all-clear with a 200
  // (the anti-pattern the floor route avoids). The two soft LISTS below (online staff, issues)
  // may still degrade to empty; the notifications bell is the primary issues surface (audit 2026-07-09).
  const critErr = restQ.error || ovRpc.error || ordersTodayQ.error || maintQ.error;
  if (critErr) return NextResponse.json({ error: critErr.message }, { status: 500 });

  const withSettings = new Set((setQ.data || []).map((r) => r.restaurant_id).filter(Boolean));
  const panelsByRid = new Map((setQ.data || []).map((r) => [r.restaurant_id, (r as { enabled_panels?: Record<string, boolean> | null }).enabled_panels || null]));
  const ownerName = new Map((ownersQ.data || []).map((o) => [o.id, o.name || o.username]));
  const nameByRid = new Map((restQ.data || []).map((r) => [r.id, r.name]));

  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    ownerName: r.owner_user_id ? (ownerName.get(r.owner_user_id) || "—") : null,
    panels: panelsByRid.get(r.id) || null,
  }));

  // Per-restaurant open tables (revenue columns from the RPC are dropped). Filtered to restaurants
  // that still EXIST (not soft-deleted): the RPC counts open sessions even for recycle-binned
  // restaurants (soft-delete doesn't close their sessions), which would push the headline sum above
  // the rows shown + the /open-tables drill-down (audit 2026-07-09).
  const liveIds = new Set(restaurants.map((r) => r.id));
  const openByRid = ((ovRpc.data as { restaurant_id: string; open_tables: number }[] | null) || [])
    .map((r) => ({ id: r.restaurant_id, openTables: Number(r.open_tables) || 0 }))
    .filter((r) => liveIds.has(r.id));

  // Live restaurants currently in maintenance, by name.
  const maintenanceNames = (maintQ.data || [])
    .map((s) => s.restaurant_id && nameByRid.get(s.restaurant_id))
    .filter((n): n is string => !!n);

  const issues = (issuesQ.data || []).map((i) => ({
    id: i.id, restaurantName: (i.restaurant_id && nameByRid.get(i.restaurant_id)) || "—",
    subject: i.subject, status: i.status, created_at: i.created_at,
  }));

  const online = (onlineQ.data || []).map((u) => ({
    name: u.name, username: u.username, role: u.role,
    restaurantName: (u.restaurant_id && nameByRid.get(u.restaurant_id)) || null,
    last_seen_at: u.last_seen_at,
  }));

  const restMeta = new Map((restQ.data || []).map((r) => [r.id, { name: r.name, slug: r.slug }]));
  const activity = (actQ.data || []).map((a) => {
    const meta = a.restaurant_id ? restMeta.get(a.restaurant_id) : undefined;
    return { ...a, detail: redactMoney(a.detail), restaurant_name: meta?.name ?? null, restaurant_slug: meta?.slug ?? null };
  });

  return NextResponse.json({
    restaurants,
    openByRid,
    maintenance: maintenanceNames.length > 0,
    maintenanceNames,
    ordersToday: ordersTodayQ.count || 0,
    // Headline = SUM of the per-restaurant rows shown right below it (same lfh_owner_overview
    // source), so the card and the table can never disagree; also drops a separate sessions
    // COUNT query every 60s refresh (audit 2026-07-08). Both mean "open dining sessions" — the
    // /open-tables detail page counts occupied floor TILES, which can differ only for table-less
    // banquet/takeaway sessions or a cleared-not-yet-freed table (rare, documented, not a bug).
    openTables: openByRid.reduce((n, r) => n + r.openTables, 0),
    online,
    onlineCount: onlineQ.count ?? online.length, // exact total (list capped at 200) so the KPI can't under-report at scale
    issues,
    openIssuesCount: issuesQ.count ?? issues.length, // exact open total (list capped at 50)
    activity,
    // Red "Fix problems" button: soft counts — a failed read shows the quiet button, never a 500.
    errorCount24h: errQ.count ?? 0,
    openFixRequests: fixQ.count ?? 0,
  });
}
