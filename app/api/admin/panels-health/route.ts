// GET /api/admin/panels-health — per-restaurant PANEL CONNECTIVITY: for each restaurant's
// ENABLED panels (Manager/Kitchen/Tablet/Owner), when was that panel last active (a proxy
// for "is that screen/device connected & in use"). Derived from staff_users.last_seen_at +
// settings.enabled_panels — NO new table, NO food money. Lets the operator spot a restaurant
// whose enabled panel has gone quiet (device down / nobody logged in).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

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
    sb.from("staff_users").select("restaurant_id, role, last_seen_at").eq("active", true).in("role", ROLES as unknown as string[]).limit(3000),
  ]);
  if (restsQ.error) return NextResponse.json({ error: restsQ.error.message }, { status: 500 });

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

  // Attention count: enabled panels that are offline or never-seen (a device/login likely down).
  const attention = rows.reduce((n, r) => n + r.panels.filter((p) => p.status === "offline" || p.status === "never").length, 0);

  return NextResponse.json({ rows, roles: ROLES, attention, generatedAt: new Date().toISOString() });
}
