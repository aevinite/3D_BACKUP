// GET /api/admin/panels-health — per-restaurant PANEL CONNECTIVITY: for each restaurant's
// ENABLED panels (Manager/Kitchen/Tablet/Owner), when was that panel last active (a proxy
// for "is that screen/device connected & in use"). Derived from staff_users.last_seen_at +
// settings.enabled_panels — NO new table, NO food money. Lets the operator spot a restaurant
// whose enabled panel has gone quiet (device down / nobody logged in).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";
const ROLES = ["manager", "kitchen", "tablet", "owner"] as const;

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [restsQ, setQ, staffQ] = await Promise.all([
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).order("name"),
    sb.from("settings").select("restaurant_id, enabled_panels"),
    // Active operational staff only, explicit columns, bounded — we just need the latest
    // last_seen per (restaurant, role); aggregated below in JS.
    sb.from("staff_users").select("restaurant_id, role, last_seen_at").eq("active", true).in("role", ROLES as unknown as string[]).order("last_seen_at", { ascending: false, nullsFirst: false }).limit(3000),
  ]);
  // Check ALL three — a failed settings/staff read would otherwise show every panel "Off"/"Never
  // seen" (false "device down" for everyone) with a confident 200 (audit). Order the staff read
  // by last_seen so at scale the 3000-row cap keeps the MOST-RECENTLY-ACTIVE staff, not random ones.
  const anyErr = restsQ.error || setQ.error || staffQ.error;
  // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). This answered with the database's own
  // sentence, so a failure here read as e.g. `relation "…" does not exist` in a red toast —
  // right for a developer, useless on the screen the owner runs his platform from. adminFail
  // keeps the raw text where it is actually useful (the response `detail` and the server log)
  // and gives the screen a sentence that names the thing and says whether anything changed.
  if (anyErr) return adminFail("the panel-connectivity list", anyErr, { action: "load" });

  const panelsByRid = new Map<string, Record<string, boolean> | null>((setQ.data || []).map((r) => [r.restaurant_id, (r as { enabled_panels?: Record<string, boolean> | null }).enabled_panels || null]));
  // Latest last_seen per "restaurant|role".
  const latest = new Map<string, string>();
  for (const s of staffQ.data || []) {
    if (!s.last_seen_at) continue;
    const key = `${s.restaurant_id}|${s.role}`;
    const cur = latest.get(key);
    if (!cur || s.last_seen_at > cur) latest.set(key, s.last_seen_at);
  }

  const now = Date.now();
  const status = (on: boolean, ls: string | null): "off" | "never" | "online" | "idle" | "offline" => {
    if (!on) return "off";
    if (!ls) return "never";
    const mins = (now - new Date(ls).getTime()) / 60000;
    return mins < 5 ? "online" : mins < 60 ? "idle" : "offline";
  };

  const rows = (restsQ.data || []).map((r) => {
    const enabled = panelsByRid.get(r.id) || null;
    const panels = ROLES.map((role) => {
      const on = !enabled || enabled[role] !== false; // enabled unless explicitly false
      const ls = latest.get(`${r.id}|${role}`) || null;
      return { role, on, lastSeen: ls, status: status(on, ls) };
    });
    return { id: r.id, name: r.name, slug: r.slug, active: r.active, panels };
  });

  // Attention count = enabled panels that are offline/never-seen. EXCLUDES the OWNER panel (an
  // owner has ONE cross-restaurant last-seen row, so co-owned restaurants falsely read "never
  // seen") and SUSPENDED restaurants (their panels are deliberately off) — avoids false alerts (audit).
  const attention = rows.filter((r) => r.active).reduce((n, r) => n + r.panels.filter((p) => p.role !== "owner" && (p.status === "offline" || p.status === "never")).length, 0);

  return NextResponse.json({ rows, roles: ROLES, attention, generatedAt: new Date().toISOString() });
}
