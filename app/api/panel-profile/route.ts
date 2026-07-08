// /api/panel-profile — the logged-in staff user's own profile.
//   GET  → { username, role, name, phone, hasPin, needsProfile, canSelfReset }
//          (401 if not logged in — e.g. admin super-access has no user profile).
//   POST → set their own name/phone (first-login capture), set/change PIN, and/or
//          change their own PASSWORD (only if canSelfReset; requires the current
//          password and bumps token_version so all sessions must re-login).
// Scoped to the cookie's user id, so a user can only edit themselves.
import { NextRequest, NextResponse } from "next/server";
import { userFromCookie, USER_COOKIE, hashSecret, verifySecret, normalizeLoginName } from "@/lib/userAuth";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  return NextResponse.json({
    username: u.username, role: u.role, name: u.name, phone: u.phone,
    hasPin: !!u.pin_hash,
    needsProfile: !u.profile_confirmed, // one-time setup card shown until confirmed once
    canSelfReset: u.can_self_reset,
    canSelfSetPin: u.can_self_set_pin, // may they set/change their own PIN? (managers)
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
    // Staff-initiated change → operation log (admin resets are logged separately).
    await logAction(u.role, "password_change", {
      restaurant_id: u.restaurant_id, actor: u.name || u.username, device_id: deviceIdFrom(req),
      detail: `${u.name || u.username} changed their own password`,
    });
    return NextResponse.json({ ok: true, passwordChanged: true });
  }

  // ── name / phone / PIN (the user editing their OWN profile) ─────────────────
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (body?.name !== undefined) {
    // The Name doubles as the unique login id. Store it as typed (display) and a
    // normalized copy in `username` (the matchable key); reject duplicates.
    const display = String(body.name || "").trim().slice(0, 80);
    const key = normalizeLoginName(display);
    if (!display || !key) return NextResponse.json({ error: "Your username can't be empty." }, { status: 400 });
    const clash = (await sb.from("staff_users").select("id").eq("username", key).neq("id", u.id).limit(1)).data?.[0];
    if (clash) return NextResponse.json({ error: "That username is already taken — please pick another." }, { status: 409 });
    patch.name = display;
    patch.username = key;
    if (key !== normalizeLoginName(u.name || u.username)) changes.push("name");
  }
  if (body?.phone !== undefined) {
    const phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (phone !== (u.phone ?? null)) changes.push("phone");
    patch.phone = phone;
  }
  if (body?.pin !== undefined) {
    // Honor the admin toggle: if they're not allowed to manage their own PIN, the
    // admin sets it for them (via /api/admin/users). Mirrors the password rule.
    if (!u.can_self_set_pin) {
      return NextResponse.json({ error: "Your admin manages your PIN. Ask them to set it." }, { status: 403 });
    }
    const pin = String(body.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–8 digits." }, { status: 400 });
    patch.pin_hash = await hashSecret(pin); // salted, slow hash (same as passwords)
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // Once they have BOTH a name and a phone, mark the one-time setup done so the
  // welcome card never auto-opens again. A MANAGER who is allowed to self-set a PIN
  // must also HAVE a PIN before setup is complete (matches the welcome card asking
  // for it). If they can't self-set (admin owns it), name+phone is enough.
  const effName = patch.name !== undefined ? patch.name : u.name;
  const effPhone = patch.phone !== undefined ? patch.phone : u.phone;
  const willHavePin = patch.pin_hash !== undefined || !!u.pin_hash;
  const pinRequiredForSetup = u.role === "manager" && u.can_self_set_pin;
  const setupComplete = !!effName && !!effPhone && (!pinRequiredForSetup || willHavePin);
  const firstConfirm = !u.profile_confirmed && setupComplete;
  if (setupComplete) patch.profile_confirmed = true;

  await sb.from("staff_users").update(patch).eq("id", u.id);

  // Operation log — STAFF edits land here; the admin's edits in /api/admin/users
  // are deliberately NOT logged. actor = their (new) name.
  const who = (patch.name as string) || u.name || u.username;
  const dev = deviceIdFrom(req);
  if (patch.pin_hash !== undefined) {
    await logAction(u.role, "pin_set", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} ${u.pin_hash ? "changed" : "set"} their PIN` });
  }
  if (firstConfirm) {
    await logAction(u.role, "profile_setup", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} completed their profile${changes.length ? " (" + changes.join(" & ") + ")" : ""}` });
  } else if (changes.length) {
    await logAction(u.role, "profile_update", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} updated their ${changes.join(" & ")}` });
  }
  return NextResponse.json({ ok: true });
}
