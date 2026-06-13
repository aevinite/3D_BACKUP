// STAFF GATE — real protection for the admin/editor/kitchen/tablet panels.
//
// Anyone could previously open /admin (or /editor, /kitchen, /tablet) just by
// typing the URL. This middleware blocks every staff route unless the request
// carries a valid login cookie. The GUEST MENU (/, /menu, /item, /view) is NOT
// matched here, so it stays completely public — duplicating a tab into the menu
// still works with no login.
//
// Not signed in → browser visits get redirected to /staff-login; API calls get a
// clean 401. The login itself (/staff-login page + /api/staff-login) is public.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, sha256hex, staffPassword } from "@/lib/staffAuth";

export async function middleware(req: NextRequest) {
  const expected = staffPassword();
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  // Fail CLOSED: if no password is configured, staff routes stay blocked (safer
  // than accidentally exposing them). The owner sets STAFF_PASSWORD in .env.local.
  const okToken = expected ? await sha256hex(expected) : null;
  if (okToken && cookie && cookie === okToken) {
    return NextResponse.next();
  }
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/staff-login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

// Only run on staff routes — everything else (menu, item, view, login, static
// assets) is untouched and public.
export const config = {
  matcher: [
    "/admin", "/admin/:path*",
    "/editor", "/editor/:path*",
    "/kitchen", "/kitchen/:path*",
    "/tablet", "/tablet/:path*",
    "/panels/:path*",
    "/api/admin/:path*",
    "/api/editor/:path*",
    "/api/kitchen/:path*",
    "/api/tablet/:path*",
  ],
};
