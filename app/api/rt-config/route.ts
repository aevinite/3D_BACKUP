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
  // ── SAY SO WHEN LIVE UPDATES CANNOT START (T9 improvement 6, 2026-08-06) ────────────────────────
  // With the two public values missing this used to answer 200 with empty strings. The panel then
  // opened a WebSocket to nowhere, silently never received a breadcrumb, and looked completely
  // normal — so "the board isn't updating" had no visible cause anywhere. A 503 with a plain reason
  // lets the connection badge tell the truth, and is the honest status for a dependency that isn't
  // configured. Not a secret: it only reveals that an env var is unset on this deployment.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    console.error("[rt-config] live updates are not configured — NEXT_PUBLIC_SUPABASE_URL/ANON_KEY missing");
    // ── A CODE, NOT JUST A SENTENCE (improvement I11, owner 2026-08-12) ──────────────────────────
    // "Live updates aren't set up on this server" and "your wifi dropped" look identical to a waiter
    // — the badge could only say "offline" — and they need completely different responses: one is
    // "wait, it'll come back", the other is "call Aevidine, nobody's coming". `reason` is a CODE the
    // connection badge branches on (the house rule: branch on codes, never on prose), so the panel
    // can show a distinct state instead of lumping a configuration fault in with a bad signal.
    return NextResponse.json(
      {
        error: "Live updates aren't set up on this server.",
        reason: "rt_unconfigured",
        unconfigured: true,
        /** Nothing the staff member can do — this one needs Aevidine, and the badge should say so. */
        selfFixable: false,
        restaurantId,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ url, anonKey, restaurantId }, { headers: { "Cache-Control": "no-store" } });
}
