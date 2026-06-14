// GET/POST /api/panel-logout — clear the staff user cookie and return to /login.
import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE } from "@/lib/userAuth";

export const dynamic = "force-dynamic";

function clear(req: NextRequest, redirect: boolean) {
  const res = redirect
    ? NextResponse.redirect(new URL("/login", req.url), 303)
    : NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
export async function GET(req: NextRequest) { return clear(req, true); }
export async function POST(req: NextRequest) { return clear(req, false); }
