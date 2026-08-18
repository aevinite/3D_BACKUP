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
import { USER_COOKIE, userFromCookie, AuthDbError } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let restaurantId = DEFAULT_RESTAURANT_ID;
  // "THE DATABASE DIDN'T ANSWER" GETS ITS OWN CODE, LIKE EVERY OTHER ANSWER HERE (T10 sweep, F3).
  //
  // `userFromCookie` THROWS `AuthDbError` when the staff_users lookup fails after its own retry,
  // and this call was bare — so a sustained flap made this route the ONE panel API with no answer
  // for "the database is busy": it escaped as an unclassified 500. public/panels/realtime.js does
  // `await (await fetch(...)).json()`, which throws on that body, so the panel's live socket never
  // booted and it dropped to the 5-second catch-up poll.
  //
  // Answering 503 with a CODE puts this route back in step with the `rt_unconfigured` answer below
  // (the house rule: branch on codes, never on prose) and lets the connection badge say "busy, it
  // will come back" instead of lumping a passing blip in with a bad signal. `retryable` is the half
  // that differs from `rt_unconfigured`: this one genuinely does come back on its own.
  //
  // Deliberately NOT falling back to DEFAULT_RESTAURANT_ID here. `restaurantId` is what the panel
  // uses to DROP realtime breadcrumbs belonging to other restaurants, so guessing it would either
  // make a tenant's panel ignore its own events or make it wake on everyone else's — the exact
  // egress problem this field was added to fix. Refusing is the honest answer.
  //
  // ⚠️ There is a second half to this, and it is NOT in this file: after a failed boot,
  // realtime.js only retries on visibilitychange / focus / pageshow / online, none of which ever
  // fire on a wall-mounted kitchen display. See the HANDOFF row in .claude/sweep/T10-findings.md.
  let u;
  try {
    u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  } catch (e) {
    if (!(e instanceof AuthDbError)) throw e;
    console.error("[rt-config] couldn't resolve who is asking:", e.message);
    return NextResponse.json(
      {
        error: "The system is very busy right now — live updates will come back by themselves.",
        reason: "rt_busy",
        retryable: true,
        /** Nothing for the staff member to do, and nothing to call Aevidine about either. */
        selfFixable: false,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
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
