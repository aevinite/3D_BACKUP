// GET/POST /api/panel-logout — clear the staff user cookie and return to /login.
import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

async function clear(req: NextRequest, redirect: boolean) {
  // Audit the logout BEFORE we clear the cookie (so we still know who it was).
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u) {
    await logAction(u.role, "logout", {
      actor: u.name || u.username,
      device_id: deviceIdFrom(req),
      detail: `${u.name || "(no name)"} logged out · user "${u.username}" · id ${u.id}`,
    });
  }
  const res = redirect
    ? NextResponse.redirect(new URL("/login", req.url), 303)
    : NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
export async function GET(req: NextRequest) { return clear(req, true); }
export async function POST(req: NextRequest) { return clear(req, false); }
