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
// Read every row of a one-row-per-restaurant table, past PostgREST's cap — see lib/pageAll.ts.
import { pageAll } from "@/lib/pageAll";

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
    // Paged: past PostgREST's cap an online staffer's restaurant rendered as null, and the filter
    // picker below (built from the same rows) lost its entry (T20 sweep #7, 2026-08-27).
    pageAll<{ id: string; name: string }>("restaurants", (from, to) =>
      sb.from("restaurants").select("id, name").is("deleted_at", null).order("name").range(from, to)),
  ]);

  if (staffQ.error) return adminFail("who is online", staffQ.error, { action: "load" });

  // The name lookup is not worth refusing the page for — "who is online" is the answer, and a
  // missing restaurant name renders as null, which the page already handles.
  if (restQ.error) console.error("[admin/staff-online] restaurant names unread:", (restQ.error as { message?: string })?.message);
  const nameByRid = new Map((restQ.rows || []).map((r) => [r.id, r.name]));

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
  const restaurants = (restQ.rows || [])
    .filter((r) => liveRids.has(r.id))
    .map((r) => ({ id: r.id, name: r.name }));

  return NextResponse.json({ staff, restaurants, generatedAt: new Date().toISOString() });
}
