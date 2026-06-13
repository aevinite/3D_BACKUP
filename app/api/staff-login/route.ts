// POST /api/staff-login — check the staff password, set the login cookie, and
// redirect back to where the user was headed. Public (not behind the gate) so
// login is possible. Stores a HASH of the password in an HttpOnly cookie, plus a
// readable flag cookie the UI uses to show the admin switcher.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE, sha256hex, staffPassword } from "@/lib/staffAuth";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") || "");
  const rawNext = String(form?.get("next") || "/admin");
  // Only allow same-site relative paths as the redirect target (no open redirect).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/admin";

  const expected = staffPassword();
  if (!expected || password !== expected) {
    return NextResponse.redirect(new URL(`/staff-login?bad=1&next=${encodeURIComponent(next)}`, req.url), 303);
  }

  const token = await sha256hex(expected);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(AUTH_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 604800 });
  res.cookies.set(FLAG_COOKIE, "1", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 604800 });
  return res;
}
