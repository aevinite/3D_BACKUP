// POST /api/staff-logout — clear the ADMIN gate cookies, then drop the user onto
// the open guest menu. Logging out only ends the ADMIN super-access; the staff
// panels each have their own per-user login now, so there's nothing to bounce a
// password screen for here.
//
// POST, NOT GET (sweep 2026-08-05). It used to be a GET "so a simple link in the switcher can
// trigger it" — but a GET that changes state fires from anything that merely POINTS at the URL
// (a link, a redirect, an embedded resource), so the admin could be dropped back to the guest menu
// mid-work with no explanation. Nothing here touches data, so it was an annoyance rather than a
// fault — but the sibling /api/panel-logout already offers both shapes and the switcher only ever
// needed one. components/admin/AdminShell.tsx now submits a tiny form, so it still works with no
// JavaScript and still lands on /menu.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE } from "@/lib/staffAuth";

export async function POST(req: NextRequest) {
  // 303 so the browser follows with a GET — a form POST must not re-post to /menu.
  const res = NextResponse.redirect(new URL("/menu", req.url), 303);
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(FLAG_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("aevidine_admin_rid", "", { path: "/", maxAge: 0 }); // drop any "view as restaurant" context
  return res;
}
