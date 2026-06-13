// ADMIN GATE — protection for the ADMIN panel only (owner's choice).
//
// Only /admin (and its /api/admin/*) is locked: nobody can reach the admin by
// just typing the URL. The other staff panels (/editor, /kitchen, /tablet) and
// the guest menu are OPEN for now — the owner asked for the password to be on
// the admin alone. (Re-lock the staff panels here before hosting publicly.)
//
// Not signed in → browser visits to /admin redirect to /staff-login; /api/admin
// calls get a clean 401. The login itself (/staff-login + /api/staff-login) is
// public so you can actually sign in.

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

// Only run on the ADMIN routes — everything else (menu, the other staff panels,
// the panel static files, login, assets) is untouched and open for now.
export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
