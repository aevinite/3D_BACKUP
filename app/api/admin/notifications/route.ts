// GET /api/admin/notifications — feed for the top-bar notification bell on every admin
// page. TWO things in ONE cheap round-trip (the bell polls this every 60s):
//   • tickets — the newest OPEN issues across all restaurants (subject, who/where
//     raised it, and any photo/voice-note URL), so the admin can act without opening
//     the full issues page.
//   • alerts  — actionable system warnings: a restaurant that's SUSPENDED (guest menu
//     off). "Dormant" (no recent orders) was REMOVED from the bell (audit 2026-07-08):
//     it nagged constantly for normal new/demo/quiet restaurants. Dormancy still shows
//     on the Restaurants list, and real churn signals belong in account-health. No
//     money — just signals. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

const TICKET_LIMIT = 30; // newest open tickets shown in the bell

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Bounded, scoped reads only. Tickets: open, newest, capped, explicit columns.
  // A separate head-count gives the TRUE open total for the badge without pulling >30 rows.
  const [ticketsQ, countQ, restQ] = await Promise.all([
    sb.from("issues")
      .select("id, restaurant_id, subject, body, raised_by, raised_role, created_at, image_url, audio_url")
      .eq("status", "open").order("created_at", { ascending: false }).limit(TICKET_LIMIT),
    sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null),
  ]);

  const restaurants = (restQ.data || []) as { id: string; name: string; slug: string; active: boolean }[];
  const nameOf: Record<string, string> = {};
  const slugOf: Record<string, string> = {};
  for (const r of restaurants) { nameOf[r.id] = r.name; slugOf[r.id] = r.slug; }

  const tickets = (ticketsQ.data || []).map((t) => ({ ...t, restaurantName: nameOf[t.restaurant_id] || "—", restaurantSlug: slugOf[t.restaurant_id] || "" }));

  // Alerts = restaurants that are SUSPENDED (guest menu off) — the one actionable state.
  const alerts: Array<{ restaurant_id: string; restaurantName: string; restaurantSlug: string; kind: "suspended"; detail: string }> = [];
  for (const r of restaurants) {
    if (r.active === false) alerts.push({ restaurant_id: r.id, restaurantName: r.name, restaurantSlug: r.slug, kind: "suspended", detail: "Suspended — guest menu is off" });
  }
  alerts.sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));

  return NextResponse.json({
    tickets,                                          // up to 30 newest open tickets (for the list)
    openTicketCount: countQ.count ?? tickets.length,  // TRUE open total (for the badge)
    alerts,
    alertCount: alerts.length,
    healthOk: true,
    checkedAt: new Date().toISOString(),
  });
}
