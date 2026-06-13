// GET /api/staff-logout — clear the staff login cookies, then drop the user into
// the EDITOR (which is open to everyone). Logging out only ends the ADMIN gate;
// it shouldn't bounce you to a password screen, because the editor/kitchen/tablet
// panels aren't gated. (GET so a simple link in the switcher can trigger it.)

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE } from "@/lib/staffAuth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/editor", req.url), 303);
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(FLAG_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
