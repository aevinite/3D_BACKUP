// POST /api/panel-logout — clear the staff user cookie and return to /login.
//
// POST ONLY (T9 improvement 13, 2026-08-06). This used to answer GET as well, and GET was the shape
// every caller actually used. A GET that changes state fires from anything that merely POINTS at the
// URL — a stray link, a redirect, a browser prefetching what it thinks you might click — so a waiter
// could be signed out mid-service with no explanation. /api/staff-logout was moved to POST-only on
// 2026-08-05 for exactly this reason; this is its sibling and the same reasoning always applied.
//
// The POST now REDIRECTS (303) rather than answering JSON, because all four callers were navigations,
// not fetches: two `<a href>` links (the owner shell, the tablet drawer) and two `location.href`
// jumps (public/panels/maint.js). All four became a tiny form / a fetch-then-go, so they still work
// with no JavaScript and still land on /login. Nothing consumed the old `{ok:true}` body — checked
// before changing the shape.
import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Audit the logout BEFORE we clear the cookie (so we still know who it was).
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u) {
    await logAction(u.role, "logout", {
      restaurant_id: u.restaurant_id,
      actor: u.name || u.username,
      device_id: deviceIdFrom(req),
      detail: `${u.name || "(no name)"} logged out · user "${u.username}" · id ${u.id}`,
    });
  }
  // 303 so the browser follows with a GET — a form POST must not re-post to /login.
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
