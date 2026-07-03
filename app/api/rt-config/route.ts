// GET /api/rt-config — hands the static vanilla panels the PUBLIC Supabase url +
// anon key so they can open a Realtime WebSocket. These two values are already
// public (the guest React app ships them in its bundle); the powerful
// service-role key is NEVER exposed here.
//
// Also returns `restaurantId`: which restaurant THIS panel belongs to, so the panel
// can drop realtime breadcrumbs from OTHER restaurants (the rt:ops / rt:menu topic
// names are shared across all tenants — without this filter every restaurant's panel
// woke up and refetched on every other restaurant's activity; the owner's #1 scaling
// fear — egress). Resolution mirrors lib/panelScope.panelRestaurantId: a logged-in
// staff member → their own restaurant; the admin super-user → ?rid= (per-tab pin) or
// the act-as cookie, else the default. The id is not secret (it's already in panel URLs).
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let restaurantId = DEFAULT_RESTAURANT_ID;
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u) {
    // Real staff member → ALWAYS their own restaurant (a ?rid= can't move them).
    restaurantId = u.restaurant_id || DEFAULT_RESTAURANT_ID;
  } else if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    // Admin super-user → the per-tab pin wins over the browser-wide act-as cookie.
    restaurantId = req.nextUrl.searchParams.get("rid") || req.cookies.get(ADMIN_ACT_COOKIE)?.value || DEFAULT_RESTAURANT_ID;
  }
  return NextResponse.json({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    restaurantId,
  });
}
