// /api/panel-profile — the logged-in staff user's own profile.
//   GET  → { username, role, name, phone, hasPin, needsProfile, canSelfReset }
//          (401 if not logged in — e.g. admin super-access has no user profile).
//   POST → set their own name/phone (first-login capture), set/change PIN, and/or
//          change their own PASSWORD (only if canSelfReset; requires the current
//          password and bumps token_version so all sessions must re-login).
// Scoped to the cookie's user id, so a user can only edit themselves.
import { NextRequest, NextResponse } from "next/server";
import { userFromCookie, USER_COOKIE, hashSecret, verifySecret } from "@/lib/userAuth";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  return NextResponse.json({
    username: u.username, role: u.role, name: u.name, phone: u.phone,
    hasPin: !!u.pin_hash,
    needsProfile: !u.name || !u.phone, // first-login capture not done yet
    canSelfReset: u.can_self_reset,
  });
}

export async function POST(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}

  // ── password change (own) — most sensitive, handled first ──────────────────
  if (body?.newPassword !== undefined) {
    if (!u.can_self_reset) {
      return NextResponse.json({ error: "Your admin manages your password. Ask them to reset it." }, { status: 403 });
    }
    const current = String(body?.currentPassword || "");
    const next = String(body?.newPassword || "");
    // Fetch the stored hash explicitly (it's intentionally NOT on the StaffUser
    // type, so it can never leak through a serialized user object).
    const row = (await sb.from("staff_users").select("password_hash").eq("id", u.id).limit(1)).data?.[0];
    // Re-authenticate with the current password so a hijacked open session can't
    // silently lock the real owner out.
    if (!(await verifySecret(current, row?.password_hash ?? null))) {
      return NextResponse.json({ error: "Current password is wrong." }, { status: 403 });
    }
    if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
    if (next === current) return NextResponse.json({ error: "New password must be different." }, { status: 400 });
    // Bump token_version → every existing cookie (incl. this one) is invalidated;
    // the user re-logs in with the new password. That's the secure, expected flow.
    await sb.from("staff_users")
      .update({ password_hash: await hashSecret(next), token_version: (u.token_version || 0) + 1 })
      .eq("id", u.id);
    return NextResponse.json({ ok: true, passwordChanged: true });
  }

  // ── name / phone / PIN ─────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) patch.name = String(body.name || "").trim().slice(0, 80) || null;
  if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
  if (body?.pin !== undefined) {
    const pin = String(body.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–8 digits." }, { status: 400 });
    patch.pin_hash = await hashSecret(pin); // salted, slow hash (same as passwords)
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  await sb.from("staff_users").update(patch).eq("id", u.id);
  return NextResponse.json({ ok: true });
}
