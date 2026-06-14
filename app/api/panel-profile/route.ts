// /api/panel-profile — the logged-in staff user's own profile.
//   GET  → { username, role, name, phone, hasPin }   (401 if not logged in)
//   POST → set their own name/phone (first-login capture) and/or PIN.
// Scoped to the cookie's user id, so a user can only edit themselves.
import { NextRequest, NextResponse } from "next/server";
import { userFromCookie, USER_COOKIE } from "@/lib/userAuth";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sha256hex } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  return NextResponse.json({ username: u.username, role: u.role, name: u.name, phone: u.phone, hasPin: !!u.pin_hash });
}

export async function POST(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) patch.name = String(body.name || "").trim().slice(0, 80) || null;
  if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
  if (body?.pin !== undefined) {
    const pin = String(body.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–8 digits." }, { status: 400 });
    patch.pin_hash = await sha256hex(pin);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  await sb.from("staff_users").update(patch).eq("id", u.id);
  return NextResponse.json({ ok: true });
}
