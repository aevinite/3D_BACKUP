// POST /api/panel-login — staff log in with the username + password the admin
// created for them. On success sets the role-scoped USER_COOKIE and tells the
// client which panel to go to (+ whether first-login profile capture is needed).
import { NextRequest, NextResponse } from "next/server";
import { loginUser, USER_COOKIE } from "@/lib/userAuth";
import { isPanelEnabled } from "@/lib/panelAccess";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const r = await loginUser(String(body?.username || ""), String(body?.password || ""));
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 401 });
  const u = r.user;
  // Per-restaurant PANEL entitlement (mig 106): if the admin turned this role's panel OFF
  // for the user's restaurant, they can't sign in here. (The admin reaches panels via the
  // separate staff gate / act-as, not this route, so this never blocks the admin.)
  if (!(await isPanelEnabled(u.role, u.restaurant_id))) {
    return NextResponse.json({ ok: false, error: "This panel isn't enabled for your restaurant. Ask your admin to turn it on." }, { status: 403 });
  }
  // Audit the login in the operation log: who (name), their username, and the
  // generated user-id all land in `detail`; `actor` is the friendly name. The
  // log row is tagged with the role's panel so it shows under that panel.
  await logAction(u.role, "login", {
    actor: u.name || u.username,
    device_id: deviceIdFrom(req),
    detail: `${u.name || "(no name yet)"} logged in · user "${u.username}" · id ${u.id}`,
  });
  // Show the one-time setup card until the user has confirmed their profile ONCE
  // (even if the admin pre-filled everything). After that it never auto-opens.
  const needsProfile = !u.profile_confirmed;
  const res = NextResponse.json({ ok: true, role: u.role, needsProfile });
  res.cookies.set(USER_COOKIE, r.cookie, {
    path: "/", httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    maxAge: 60 * 60 * 24 * 7, // 7 days (server also enforces this age in the signature)
  });
  return res;
}
