// /api/admin/users — the ADMIN-only staff-user management API. Behind the admin
// gate (valid staff cookie); the menu and panels never touch this.
//
//   GET    → list all staff users (no hashes ever leave the server).
//   POST   → create a user {username, role, password?, name?, phone?}; if no
//            password is given we generate one and return it ONCE (it's stored
//            hashed and can't be read back later).
//   PATCH  → {id, action}: "reset_password" (returns the new password),
//            "set_active" {active}, "set_role" {role}, "edit" {name,phone}.
//            Sensitive changes bump token_version → that user is logged out
//            everywhere immediately.
//   DELETE → ?id=<uuid> removes the user.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { hashSecret, type Role } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["manager", "tablet", "kitchen"];
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Reject anyone without a valid admin cookie.
async function admin(req: NextRequest): Promise<boolean> {
  return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
}

// A readable, reasonably strong auto-password (no ambiguous chars).
function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const { data, error } = await sb
    .from("staff_users")
    .select("id, username, role, name, phone, active, last_seen_at, created_at, pin_hash, can_self_reset")
    .order("created_at", { ascending: true });
  if (error) return bad(error.message, 500);
  // Strip the PIN hash to a boolean — never ship hashes to the browser.
  const users = (data || []).map(({ pin_hash, ...u }) => ({ ...u, hasPin: !!pin_hash }));
  return ok({ users });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const username = String(body?.username || "").trim().toLowerCase();
  const role = String(body?.role || "") as Role;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad("Username: 3–40 chars, letters/numbers/._- only.");
  if (!ROLES.includes(role)) return bad("Pick a valid role.");
  // Friendly duplicate check (there's also a unique index as the hard guarantee).
  const dup = (await sb.from("staff_users").select("id").eq("username", username).limit(1)).data?.[0];
  if (dup) return bad("That username is taken.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const row = {
    username, role,
    password_hash: await hashSecret(password),
    name: String(body?.name || "").trim().slice(0, 80) || null,
    phone: String(body?.phone || "").trim().slice(0, 20) || null,
  };
  const { data, error } = await sb.from("staff_users").insert(row).select("id, username, role").single();
  if (error) return bad(error.message, 500);
  await logAction("admin", "user_create", { actor: "admin", detail: `created ${role} "${username}" · id ${data!.id}` });
  // Return the password ONCE so the admin can hand it over; it's only stored hashed.
  return ok({ ok: true, id: data!.id, username, role, password });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id) return bad("Missing user id.");
  const u = (await sb.from("staff_users").select("*").eq("id", id).limit(1)).data?.[0];
  if (!u) return bad("User not found.", 404);

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    // Bump token_version → kills all their existing logins immediately.
    await sb.from("staff_users").update({ password_hash: await hashSecret(password), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    await logAction("admin", "user_reset_password", { actor: "admin", detail: `reset password for "${u.username}" · id ${id}` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    const active = !!body?.active;
    // Disabling someone also invalidates their cookies (token_version bump).
    await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    await logAction("admin", active ? "user_enable" : "user_disable", { actor: "admin", detail: `${active ? "enabled" : "disabled"} "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    if (!ROLES.includes(role)) return bad("Pick a valid role.");
    // Role is part of the cookie signature, so this invalidates old cookies; bump
    // token_version too to be doubly sure.
    await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    await logAction("admin", "user_set_role", { actor: "admin", detail: `set "${u.username}" → ${role} · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_access") {
    // Grant/revoke the user's ability to change their OWN password. Admin can
    // always reset it regardless.
    const can = !!body?.can_self_reset;
    await sb.from("staff_users").update({ can_self_reset: can }).eq("id", id);
    await logAction("admin", "user_set_access", { actor: "admin", detail: `${can ? "granted" : "revoked"} self password-reset for "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "edit") {
    const patch: Record<string, unknown> = {};
    if (body?.name !== undefined) patch.name = String(body.name || "").trim().slice(0, 80) || null;
    if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    await sb.from("staff_users").update(patch).eq("id", id);
    return ok({ ok: true });
  }
  return bad("Unknown action.");
}

export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("Missing user id.");
  const u = (await sb.from("staff_users").select("username").eq("id", id).limit(1)).data?.[0];
  await sb.from("staff_users").delete().eq("id", id);
  await logAction("admin", "user_delete", { actor: "admin", detail: `deleted "${u?.username || "?"}" · id ${id}` });
  return ok({ ok: true });
}
