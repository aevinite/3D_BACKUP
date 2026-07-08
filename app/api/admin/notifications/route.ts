// GET /api/admin/notifications — feed for the top-bar notification bell on every admin
// page. TWO things in ONE cheap round-trip (the bell polls this every 60s):
//   • tickets — the newest OPEN issues across all restaurants (subject, who/where
//     raised it, and any photo/voice-note URL), so the admin can act without opening
//     the full issues page.
//   • alerts  — system-health warnings derived from the same health RPC the
//     Restaurants list uses: a restaurant that's SUSPENDED, or DORMANT (no orders for
//     7+ days). No money, no per-order rows — just activity signals. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

const DORMANT_MS = 7 * 24 * 60 * 60 * 1000; // matches the Restaurants list "Dormant" rule
const TICKET_LIMIT = 30;                     // newest open tickets shown in the bell

type HealthRow = { restaurant_id: string; last_order_at: string | null; open_issues: number };

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Bounded, scoped reads only. Tickets: open, newest, capped, explicit columns.
  // A separate head-count gives the TRUE open total for the badge without pulling >30 rows.
  const [ticketsQ, countQ, healthQ, restQ] = await Promise.all([
    sb.from("issues")
      .select("id, restaurant_id, subject, body, raised_by, raised_role, created_at, image_url, audio_url")
      .eq("status", "open").order("created_at", { ascending: false }).limit(TICKET_LIMIT),
    sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.rpc("lfh_admin_restaurant_health"),
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null),
  ]);

  const restaurants = (restQ.data || []) as { id: string; name: string; slug: string; active: boolean }[];
  const nameOf: Record<string, string> = {};
  const slugOf: Record<string, string> = {};
  const activeOf: Record<string, boolean> = {};
  for (const r of restaurants) { nameOf[r.id] = r.name; slugOf[r.id] = r.slug; activeOf[r.id] = r.active; }

  const tickets = (ticketsQ.data || []).map((t) => ({ ...t, restaurantName: nameOf[t.restaurant_id] || "—", restaurantSlug: slugOf[t.restaurant_id] || "" }));

  // Build health alerts from the RPC (dormant) + the active flag (suspended). One row
  // per restaurant, most-urgent first (suspended before dormant).
  const health = (healthQ.error ? [] : (healthQ.data || [])) as HealthRow[];
  const now = Date.now();
  const alerts: Array<{ restaurant_id: string; restaurantName: string; restaurantSlug: string; kind: "suspended" | "dormant"; detail: string }> = [];
  for (const h of health) {
    const name = nameOf[h.restaurant_id];
    if (name === undefined) continue; // not in the live (non-deleted) set
    const slug = slugOf[h.restaurant_id] || "";
    if (activeOf[h.restaurant_id] === false) {
      alerts.push({ restaurant_id: h.restaurant_id, restaurantName: name, restaurantSlug: slug, kind: "suspended", detail: "Suspended — guest menu is off" });
      continue; // suspended supersedes dormant for the same restaurant
    }
    const last = h.last_order_at ? new Date(h.last_order_at).getTime() : 0;
    if (!last || now - last > DORMANT_MS) {
      const days = last ? Math.floor((now - last) / 86_400_000) : 0;
      alerts.push({
        restaurant_id: h.restaurant_id, restaurantName: name, restaurantSlug: slug, kind: "dormant",
        detail: last ? `No orders in ${days} day${days === 1 ? "" : "s"}` : "No orders yet",
      });
    }
  }
  alerts.sort((a, b) => (a.kind === b.kind ? a.restaurantName.localeCompare(b.restaurantName) : a.kind === "suspended" ? -1 : 1));

  return NextResponse.json({
    tickets,                                 // up to 30 newest open tickets (for the list)
    openTicketCount: countQ.count ?? tickets.length, // TRUE open total (for the badge)
    alerts,
    alertCount: alerts.length,
    healthOk: !healthQ.error,
    checkedAt: new Date().toISOString(),
  });
}
