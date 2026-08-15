// GET /api/admin/staff-online — the staff currently ONLINE across every restaurant,
// for the admin "Staff online" detail page. Deliberately its own tiny call (not the
// whole dashboard payload): ONE scoped, time-filtered query on staff_users (seen in
// the last 3 min), explicit columns, capped — so opening this page is cheap.
// "online" here matches the dashboard's definition (last_seen_at within 180s), which is
// written by the auth heartbeat in lib/userAuth.ts. NO money anywhere (admin rule).
// Admin-gated by cookie (each admin route checks it itself — there is no middleware).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

// Same 3-minute window the dashboard uses for "online".
const ONLINE_MS = 180_000;

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const onlineSinceIso = new Date(Date.now() - ONLINE_MS).toISOString();

  const [staffQ, restQ] = await Promise.all([
    sb.from("staff_users")
      .select("id, name, username, role, restaurant_id, last_seen_at")
      .eq("active", true)
      .gte("last_seen_at", onlineSinceIso)
      .order("last_seen_at", { ascending: false })
      .limit(300),
    sb.from("restaurants").select("id, name").is("deleted_at", null).order("name"),
  ]);

  if (staffQ.error) return adminFail("who is online", staffQ.error, { action: "load" });

  const nameByRid = new Map((restQ.data || []).map((r) => [r.id, r.name]));

  const staff = (staffQ.data || []).map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    restaurant_id: u.restaurant_id || null,
    restaurantName: (u.restaurant_id && nameByRid.get(u.restaurant_id)) || null,
    last_seen_at: u.last_seen_at,
  }));

  // Only restaurants that actually HAVE someone online right now populate the filter,
  // so the picker never lists dozens of empty restaurants.
  const liveRids = new Set(staff.map((s) => s.restaurant_id).filter(Boolean));
  const restaurants = (restQ.data || [])
    .filter((r) => liveRids.has(r.id))
    .map((r) => ({ id: r.id, name: r.name }));

  return NextResponse.json({ staff, restaurants, generatedAt: new Date().toISOString() });
}
