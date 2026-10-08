// /r/<slug>/owner — a restaurant's OWN entrance to the owner cockpit.
//
// The cockpit itself stays at /owner (it is session-scoped and has many
// subroutes), so this route only VALIDATES the visitor against the slug and
// forwards them:
//   • an OWNER who is a member of THIS restaurant (restaurant_owners, mig 097,
//     or their primary staff row) → /owner;
//   • the ADMIN super-user → sets the act-as cookie to this restaurant (the
//     deliberate-entry step app/owner/layout.tsx requires) and → /owner;
//   • anyone else → this restaurant's own login.
// A route handler (not a page) because entering as admin must SET a cookie,
// which a server-component redirect cannot do.
import { NextRequest, NextResponse } from "next/server";
import { getRestaurantBySlug, slugMovedTo } from "@/lib/tenant";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await ctx.params;
  // A DATABASE BLIP HERE IS "TRY AGAIN", NOT A BARE SERVER ERROR (sweep #10 T17, item 5).
  // getRestaurantBySlug THROWS when it cannot read the restaurant (and has no recent answer cached).
  // In a page that throw reaches app/error.tsx; in a route handler like this one there is no error
  // boundary, so an owner opening their bookmark during a blip got the platform's plain
  // "Internal Server Error". Answer the same thing every other door does for a failed read: 503,
  // in words, with a way to try again — and nothing about the restaurant, since we could not read it.
  let r: Awaited<ReturnType<typeof getRestaurantBySlug>>;
  try {
    r = await getRestaurantBySlug(restaurant);
  } catch (e) {
    console.error("[r/owner] couldn't look the restaurant up:", e instanceof Error ? e.message : e);
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try again in a moment</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#dbe7ff;font-family:system-ui,sans-serif;padding:16px">` +
      `<div style="max-width:360px;text-align:center"><h1 style="font-size:20px;margin:0 0 8px">Can't reach the server</h1>` +
      `<p style="margin:0 0 16px;color:#8aa0c9;font-size:14px;line-height:1.5">This page couldn't load just now. It usually comes back by itself in a moment.</p>` +
      `<a href="" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none">Try again</a></div></body>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "5", "cache-control": "no-store" } },
    );
  }
  // An owner's bookmark of the old address still gets them in (mig 350).
  //
  // TEMPORARY (307), NOT PERMANENT (308) — and on this platform that is the important choice. A
  // web address here can be RE-TAKEN: freeing a binned restaurant's name is deliberate (mig 319),
  // so /r/<slug>/ may belong to a different restaurant next month. A 308 is cached hard by browsers
  // and is very difficult to clear, so one permanent redirect would keep sending that restaurant's
  // own owner to the wrong cockpit long after the address changed hands. Every other door here uses
  // Next's redirect(), which is a 307 for the same reason. Only when the address resolves to nothing.
  if (!r) {
    const moved = await slugMovedTo(restaurant);
    if (moved) return NextResponse.redirect(new URL(`/r/${moved}/owner`, req.url), 307);
    return new NextResponse("Not found", { status: 404 });
  }

  let u = null;
  try {
    u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  } catch {
    // DB blip while checking the cookie — fall through to the login door rather
    // than a 500; the login page will sort the session out once the DB is back.
  }
  if (u && u.role === "owner") {
    // An owner may co-own several restaurants (restaurant_owners join table) —
    // membership there, or their primary staff row, both count as "this is yours".
    const member =
      u.restaurant_id === r.id ||
      !!(await sb.from("restaurant_owners").select("restaurant_id")
        .eq("user_id", u.id).eq("restaurant_id", r.id).limit(1)).data?.length;
    if (member) return NextResponse.redirect(new URL("/owner", req.url));
  }

  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    // The redirect carries ?rid= so THIS tab stays pinned to the restaurant even if the
    // browser-wide act-as cookie later changes (a second admin tab opening another
    // restaurant overwrites the shared cookie). Without the pin, tab 1 silently repointed
    // to tab 2's restaurant — data AND writes on the wrong tenant. This matches the fix
    // already in /api/admin/act-as/go; this entry door was missed (audit 2026-07-07).
    const res = NextResponse.redirect(new URL(`/owner?rid=${encodeURIComponent(r.id)}`, req.url));
    // Same cookie shape as /api/admin/act-as (6h, HttpOnly).
    res.cookies.set(ADMIN_ACT_COOKIE, r.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 6 });
    return res;
  }

  return NextResponse.redirect(
    new URL(`/r/${restaurant}/login?next=${encodeURIComponent(`/r/${restaurant}/owner`)}`, req.url),
  );
}
