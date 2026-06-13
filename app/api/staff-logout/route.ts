// GET /api/staff-logout — clear the staff login cookies and return to the login
// page. (GET so a simple link in the switcher can trigger it.)

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE } from "@/lib/staffAuth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/staff-login", req.url), 303);
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(FLAG_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
