// GET /api/staff-logout — clear the ADMIN gate cookies, then drop the user onto
// the open guest menu. Logging out only ends the ADMIN super-access; the staff
// panels each have their own per-user login now, so there's nothing to bounce a
// password screen for here. (GET so a simple link in the switcher can trigger it.)

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE } from "@/lib/staffAuth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/menu", req.url), 303);
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(FLAG_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
