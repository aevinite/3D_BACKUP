// Per-user staff auth (Phase 1). Each staff member has a row in `staff_users`
// with a role; login sets a tamper-checked cookie. The guest menu is unaffected.
// All DB access here is service-role (server only) via lib/supabaseAdmin.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sha256hex, safeEqual, AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const USER_COOKIE = "lfh_user";
export type Role = "manager" | "tablet" | "kitchen";

// Server secret used to sign the cookie. Reuse STAFF_PASSWORD (already required
// for the admin gate); a dedicated secret can replace it later.
const SECRET = () => process.env.STAFF_PASSWORD || process.env.ADMIN_PASSWORD || "lfh-dev-secret";

export type StaffUser = {
  id: string; username: string; role: Role;
  name: string | null; phone: string | null; active: boolean; pin_hash: string | null;
};

// Cookie value = "<id>.<sig>", sig = sha256hex(id:role:SECRET). Tamper-checked
// server-side; carries no secret. (A signed JWT is a future hardening.)
async function sign(id: string, role: string): Promise<string> {
  return `${id}.${await sha256hex(`${id}:${role}:${SECRET()}`)}`;
}
export const makeCookie = sign;

// Verify username+password against staff_users (active only). Constant-time hash
// compare. Returns the user + a ready-to-set cookie value on success.
export async function loginUser(
  username: string, password: string,
): Promise<{ ok: true; user: StaffUser; cookie: string } | { ok: false }> {
  const uname = String(username || "").trim().toLowerCase();
  if (!uname || !password) return { ok: false };
  const u = (await sb.from("staff_users").select("*").eq("username", uname).eq("active", true).limit(1)).data?.[0];
  if (!u) return { ok: false };
  if (!safeEqual(await sha256hex(String(password)), u.password_hash)) return { ok: false };
  await sb.from("staff_users").update({ last_seen_at: new Date().toISOString() }).eq("id", u.id);
  return { ok: true, user: u as StaffUser, cookie: await sign(u.id, u.role) };
}

// Resolve a USER_COOKIE value to its (active) user, verifying the signature.
export async function userFromCookie(value: string | undefined | null): Promise<StaffUser | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot), sig = value.slice(dot + 1);
  const u = (await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1)).data?.[0];
  if (!u) return null;
  if (!safeEqual(sig, await sha256hex(`${id}:${u.role}:${SECRET()}`))) return null;
  return u as StaffUser;
}

// Authoritative gate for a panel's API route handlers: allow if a valid ADMIN
// cookie is present (super-access) OR a valid user cookie whose role matches.
// Returns the acting user (null for admin super-access), or false if denied.
export async function requireRole(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  role: Role,
): Promise<{ ok: true; user: StaffUser | null } | { ok: false }> {
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { ok: true, user: null }; // admin super
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u && u.role === role) return { ok: true, user: u };
  return { ok: false };
}
