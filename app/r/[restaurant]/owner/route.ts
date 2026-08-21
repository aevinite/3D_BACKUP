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
  const r = await getRestaurantBySlug(restaurant);
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
