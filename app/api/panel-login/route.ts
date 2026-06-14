// POST /api/panel-login — staff log in with the username + password the admin
// created for them. On success sets the role-scoped USER_COOKIE and tells the
// client which panel to go to (+ whether first-login profile capture is needed).
import { NextRequest, NextResponse } from "next/server";
import { loginUser, USER_COOKIE } from "@/lib/userAuth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const r = await loginUser(String(body?.username || ""), String(body?.password || ""));
  if (!r.ok) return NextResponse.json({ ok: false, error: "Wrong username or password." }, { status: 401 });
  const needsProfile = !r.user.name || !r.user.phone;
  const res = NextResponse.json({ ok: true, role: r.user.role, needsProfile });
  res.cookies.set(USER_COOKIE, r.cookie, {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
