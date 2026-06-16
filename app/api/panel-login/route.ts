// POST /api/panel-login — staff log in with the username + password the admin
// created for them. On success sets the role-scoped USER_COOKIE and tells the
// client which panel to go to (+ whether first-login profile capture is needed).
import { NextRequest, NextResponse } from "next/server";
import { loginUser, USER_COOKIE } from "@/lib/userAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const r = await loginUser(String(body?.username || ""), String(body?.password || ""));
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 401 });
  // Audit the login in the operation log: who (name), their username, and the
  // generated user-id all land in `detail`; `actor` is the friendly name. The
  // log row is tagged with the role's panel so it shows under that panel.
  const u = r.user;
  await logAction(u.role, "login", {
    actor: u.name || u.username,
    device_id: deviceIdFrom(req),
    detail: `${u.name || "(no name yet)"} logged in · user "${u.username}" · id ${u.id}`,
  });
  const needsProfile = !u.name || !u.phone;
  const res = NextResponse.json({ ok: true, role: u.role, needsProfile });
  res.cookies.set(USER_COOKIE, r.cookie, {
    path: "/", httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    maxAge: 60 * 60 * 24 * 7, // 7 days (server also enforces this age in the signature)
  });
  return res;
}
