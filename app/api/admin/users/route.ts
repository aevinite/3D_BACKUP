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
import { hashSecret, normalizeLoginName, type Role } from "@/lib/userAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
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
  const [usersQ, restsQ] = await Promise.all([
    sb.from("staff_users")
      .select("id, username, role, name, phone, active, last_seen_at, created_at, pin_hash, can_self_reset, can_self_set_pin, restaurant_id")
      // Owners are a DIFFERENT lifecycle (multi-restaurant, primary/co-owner handoff)
      // and are managed ONLY on the Owners page. Never surface or touch them here —
      // editing/deleting an owner from this page was a side door that could orphan a
      // restaurant's ownership (admin audit 2026-07-06).
      .neq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(2000), // safety cap so this never becomes an unbounded whole-table read; true per-restaurant server scoping/pagination is a follow-up (audit 2026-07-08)
    sb.from("restaurants").select("id, name"),
  ]);
  if (usersQ.error) return bad(usersQ.error.message, 500);
  const nameById: Record<string, string> = Object.fromEntries((restsQ.data || []).map((r) => [r.id, r.name]));
  // Strip the PIN hash to a boolean; attach the restaurant name (mapped, not a
  // PostgREST embed) so the admin sees WHICH restaurant each user belongs to.
  const users = (usersQ.data || []).map(({ pin_hash, ...u }: any) => ({ ...u, hasPin: !!pin_hash, restaurantName: nameById[u.restaurant_id] || null }));
  return ok({ users });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {};
  try { body = await req.json(); } catch {}
  // ONE "Name" is the whole identity: stored as-typed for display (`name`) and as
  // a normalized, unique key for login (`username`). No separate username concept.
  const display = String(body?.name ?? body?.username ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  const role = String(body?.role || "") as Role;
  // WHICH restaurant this user works at. Admin picks it; defaults to #1 for back-compat.
  const restaurantId = String(body?.restaurant_id || "").trim() || DEFAULT_RESTAURANT_ID;
  if (key.length < 2) return bad("Name must be at least 2 characters.");
  if (!ROLES.includes(role)) return bad("Pick a valid role.");
  // Exclude binned restaurants — creating staff on a soft-deleted restaurant just makes
  // orphan rows the admin can never reach (login is blocked for binned restaurants).
  const rest = (await sb.from("restaurants").select("id").eq("id", restaurantId).is("deleted_at", null).limit(1)).data?.[0];
  if (!rest) return bad("Pick a valid restaurant.");
  // Names are unique PER restaurant (mig 091) — clash-check within this one only.
  const dup = (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", restaurantId).limit(1)).data?.[0];
  if (dup) return bad("That name is taken at this restaurant — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const row = {
    username: key, role, restaurant_id: restaurantId,
    password_hash: await hashSecret(password),
    name: display,
    phone: String(body?.phone || "").trim().slice(0, 20) || null,
  };
  const { data, error } = await sb.from("staff_users").insert(row).select("id, username, role, name").single();
  if (error) return bad(error.message, 500);
  await logAction("admin", "user_create", { actor: "admin", restaurant_id: restaurantId, detail: `created ${role} "${display}" · id ${data!.id}` });
  // Return the password ONCE so the admin can hand it over; it's only stored hashed.
  return ok({ ok: true, id: data!.id, username: key, name: display, role, password });
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
  // Owners are off-limits here — the only place they can be changed is the Owners
  // page, which keeps primary/co-owner state consistent. Block every write action.
  if (u.role === "owner") return bad("Owners are managed on the Owners page, not here.", 403);

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    // Bump token_version → kills all their existing logins immediately.
    await sb.from("staff_users").update({ password_hash: await hashSecret(password), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    await logAction("admin", "user_reset_password", { actor: "admin", restaurant_id: u.restaurant_id, detail: `reset password for "${u.username}" · id ${id}` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    const active = !!body?.active;
    // Disabling someone also invalidates their cookies (token_version bump).
    await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    await logAction("admin", active ? "user_enable" : "user_disable", { actor: "admin", restaurant_id: u.restaurant_id, detail: `${active ? "enabled" : "disabled"} "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    if (!ROLES.includes(role)) return bad("Pick a valid role.");
    // Role is part of the cookie signature, so this invalidates old cookies; bump
    // token_version too to be doubly sure.
    await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    await logAction("admin", "user_set_role", { actor: "admin", restaurant_id: u.restaurant_id, detail: `set "${u.username}" → ${role} · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_access") {
    // Grant/revoke the user's ability to change their OWN password and/or PIN.
    // Each flag is independent and only touched when present in the body. Admin can
    // always reset the password / set the PIN regardless of these.
    const patch: Record<string, unknown> = {};
    const notes: string[] = [];
    if (body?.can_self_reset !== undefined) { patch.can_self_reset = !!body.can_self_reset; notes.push(`${body.can_self_reset ? "granted" : "revoked"} self password-reset`); }
    if (body?.can_self_set_pin !== undefined) { patch.can_self_set_pin = !!body.can_self_set_pin; notes.push(`${body.can_self_set_pin ? "granted" : "revoked"} self PIN-change`); }
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    await sb.from("staff_users").update(patch).eq("id", id);
    await logAction("admin", "user_set_access", { actor: "admin", restaurant_id: u.restaurant_id, detail: `${notes.join(" & ")} for "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_pin") {
    // Admin sets or clears a user's PIN directly (e.g. a manager who can't self-set
    // it). Stored hashed, never returned. clear=true removes the PIN.
    if (body?.clear === true) {
      await sb.from("staff_users").update({ pin_hash: null }).eq("id", id);
      await logAction("admin", "user_set_pin", { actor: "admin", restaurant_id: u.restaurant_id, detail: `cleared PIN for "${u.username}" · id ${id}` });
      return ok({ ok: true });
    }
    const pin = String(body?.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return bad("PIN must be 4–8 digits.");
    await sb.from("staff_users").update({ pin_hash: await hashSecret(pin) }).eq("id", id);
    await logAction("admin", "user_set_pin", { actor: "admin", restaurant_id: u.restaurant_id, detail: `${u.pin_hash ? "changed" : "set"} PIN for "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "edit") {
    const patch: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      // Changing the Name also changes the login key — keep them in sync, unique.
      // The user's live session is keyed by id, so this never logs them out; their
      // next login just uses the new Name.
      const display = String(body.name || "").trim().slice(0, 80);
      const key = normalizeLoginName(display);
      if (key.length < 2) return bad("Name must be at least 2 characters.");
      // Names are unique PER restaurant (mig 091), so the clash-check MUST be scoped to
      // this user's restaurant — a global check wrongly rejected a name that's free at the
      // user's own restaurant just because another tenant uses it (bug M6, 2026-07-05).
      // Matches the create path, which already scopes by restaurant_id.
      const target = (await sb.from("staff_users").select("restaurant_id").eq("id", id).maybeSingle()).data;
      const clash = target ? (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", target.restaurant_id).neq("id", id).limit(1)).data?.[0] : null;
      if (clash) return bad("That name is taken — pick another.", 409);
      patch.name = display;
      patch.username = key;
    }
    if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    await sb.from("staff_users").update(patch).eq("id", id);
    return ok({ ok: true }); // intentionally NOT logged — admin edits stay out of the operation log
  }
  return bad("Unknown action.");
}

export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("Missing user id.");
  const u = (await sb.from("staff_users").select("username, role, restaurant_id").eq("id", id).limit(1)).data?.[0];
  // 404 on an unknown id instead of silently "succeeding" (deleting nothing but logging a
  // bogus 'deleted "?"' row and returning ok — audit 2026-07-07).
  if (!u) return bad("User not found.", 404);
  // Never delete an owner from here — deleting a PRIMARY owner would skip the
  // co-owner handoff and orphan the restaurant. Owners page only.
  if (u.role === "owner") return bad("Owners are managed on the Owners page, not here.", 403);
  await sb.from("staff_users").delete().eq("id", id);
  await logAction("admin", "user_delete", { actor: "admin", restaurant_id: u.restaurant_id, detail: `deleted "${u?.username || "?"}" · id ${id}` });
  return ok({ ok: true });
}
