// /api/admin/users — the ADMIN-only staff-user management API. Behind the admin
// gate (valid staff cookie); the menu and panels never touch this.
//
//   GET    → list all staff users (no hashes ever leave the server).
//   GET ?id → ONE person's whole PROFILE (identity, personal details, job, pay setup +
//            what has been paid, their permission overrides, what they did lately). This is
//            what components/admin/StaffProfile renders. Deliberately NOT the owner panel's
//            /api/owner/staff?staff= detail: that one refuses when the payroll module is off
//            and refuses kitchen outright, and the admin's profile must open for every person
//            in every restaurant — it just leaves the pay block out when the module is off.
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
import { newWaiterTables } from "@/lib/tableAssign";
import { PROFILE_FIELDS, mergeProfilePatch, jobPatchFrom } from "@/lib/staffProfile";
import { capsForRole, isCapValue } from "@/lib/staffCaps";

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

// The profile columns (migration 220/221). `profile` is one jsonb of soft personal details;
// anything a report FILTERS or SUMS is a real column.
const PROFILE_COLS =
  "profile, joined_on, left_on, designation, employment_type, shift_label, weekly_off, " +
  "pay_type, pay_amount, pay_day, pay_mode, pay_extras, can_see_own_pay, in_payroll";

// ── ONE person's whole profile ───────────────────────────────────────────────
// Every read is scoped to this one person / their one restaurant and column-listed; the
// heavy-ish extras (payments, what they did lately) are small, capped and fire in parallel.
async function detail(id: string) {
  const { data: rows, error } = await sb.from("staff_users")
    .select(`id, username, role, name, phone, active, restaurant_id, last_seen_at, created_at,
             pin_hash, permissions, can_self_reset, can_self_set_pin, ${PROFILE_COLS}`)
    .eq("id", id).limit(1);
  if (error) return bad("Couldn't open that person — please try again.", 500);
  const u = (rows || [])[0] as any;
  if (!u) return bad("User not found.", 404);

  const [restQ, payrollQ, paysQ, actsQ] = await Promise.all([
    sb.from("restaurants").select("id, name, slug").eq("id", u.restaurant_id).maybeSingle(),
    sb.from("settings").select("payroll_allowed, payroll_owner_control, payroll_enabled")
      .eq("restaurant_id", u.restaurant_id).maybeSingle(),
    // The pay ledger is append-only; the newest 40 entries are a year of salary plus advances.
    sb.from("staff_payments")
      .select("id, kind, amount, for_period, mode, paid_on, note, recorded_by, voided_at, void_reason")
      .eq("staff_id", id).eq("restaurant_id", u.restaurant_id)
      .order("paid_on", { ascending: false }).limit(40),
    sb.from("staff_actions").select("action, detail, created_at, panel")
      .eq("actor_id", id).order("created_at", { ascending: false }).limit(15),
  ]);

  // The module ladder, read the same way lib/tableTags does it: the admin allows it, and it
  // is enabled (either by the admin, or by the owner when control was handed over).
  const s: any = payrollQ.data || {};
  const payrollOn = !!s.payroll_allowed && (s.payroll_owner_control ? !!s.payroll_enabled : s.payroll_enabled !== false);

  const { pin_hash, ...safe } = u;
  return ok({
    person: { ...safe, hasPin: !!pin_hash },
    restaurant: restQ.data || null,
    payrollOn,
    payments: payrollOn ? (paysQ.data || []) : [],
    activity: actsQ.data || [],
  });
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const one = new URL(req.url).searchParams.get("id");
  if (one) return await detail(one);
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
  if (key.length < 2) return bad("Username must be at least 2 characters.");
  if (!ROLES.includes(role)) return bad("Pick a valid role.");
  // Exclude binned restaurants — creating staff on a soft-deleted restaurant just makes
  // orphan rows the admin can never reach (login is blocked for binned restaurants).
  const rest = (await sb.from("restaurants").select("id").eq("id", restaurantId).is("deleted_at", null).limit(1)).data?.[0];
  if (!rest) return bad("Pick a valid restaurant.");
  // Names are unique PER restaurant (mig 091) — clash-check within this one only.
  // Binned rows don't count: since mig 245 a recycle-bin name is free to re-use.
  const dup = (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", restaurantId).is("deleted_at", null).limit(1)).data?.[0];
  if (dup) return bad("That username is taken at this restaurant — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const row = {
    username: key, role, restaurant_id: restaurantId,
    password_hash: await hashSecret(password),
    name: display,
    phone: String(body?.phone || "").trim().slice(0, 20) || null,
    // EVERY new person starts on DEFAULT for every permission (owner, 2026-08-01). Empty
    // means "follow this restaurant's setting for my role", so a new manager has exactly
    // what Access & permissions gives managers — never a power nobody granted, and never
    // one silently missing. Stated here rather than relying on the column default.
    permissions: {},
  };
  // Waiter sections (migs 222-225) — same rule as the owner/manager create screen, so it
  // can't matter which screen the person was added from. See newWaiterTables().
  if (role === "tablet") {
    try { (row as Record<string, unknown>).assigned_tables = await newWaiterTables(restaurantId, body?.tables); }
    catch (e) { return bad(e instanceof Error ? e.message : "Pick at least one table."); }
  }
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
  // NAMED COLUMNS, NOT `*` (sweep 2026-08-04). `staff_users` holds password_hash, and this handler
  // never needs it — `select("*")` pulled every person's password hash into route memory on every
  // profile edit, one spread away from reaching a response body. These are exactly the fields the
  // branches below read (`pin_hash` for the PIN state, `token_version` for the invalidation bump);
  // password_hash is deliberately absent, so it cannot leak from here even by accident.
  const u = (await sb.from("staff_users")
    .select(`id, username, name, role, active, restaurant_id, permissions, pin_hash, token_version,
             can_self_reset, can_self_set_pin, ${PROFILE_COLS}`)
    .eq("id", id).limit(1)).data?.[0] as Record<string, any> | undefined;
  if (!u) return bad("User not found.", 404);
  // Owners keep a DIFFERENT lifecycle (multi-restaurant, primary/co-owner handoff), so the
  // account itself — role, name, active, delete — is still changed only on the Owners page.
  // Their PROFILE is not account state: an owner fills the same record as everybody else
  // (owner, 2026-08-01 "the same profile will be built for owner also"), so the three profile
  // actions below are allowed for them and nothing else is.
  const OWNER_OK = new Set(["set_profile", "set_job", "set_permissions"]);
  if (u.role === "owner" && !OWNER_OK.has(action))
    return bad("Owners are managed on the Owners page, not here.", 403);

  // ── the PROFILE actions (the panel in components/admin/StaffProfile) ───────
  if (action === "set_profile") {
    // Personal details → the `profile` jsonb. Every value goes through the shared sanitisers;
    // an unknown key is dropped rather than stored, and "" clears a field.
    const patch = body?.profile;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing profile.");
    const merged = mergeProfilePatch(u.profile, patch, PROFILE_FIELDS);
    const write: Record<string, unknown> = { profile: merged };
    // The phone lives in its own column, not the jsonb. It rides along here so an OWNER's
    // number can be corrected too — their NAME is still Owners-page-only (it is tied to the
    // login and the primary/co-owner handoff), but a phone number is just a detail.
    if (body?.phone !== undefined) write.phone = String(body.phone || "").trim().slice(0, 20) || null;
    const wr = await sb.from("staff_users").update(write).eq("id", id);
    if (wr.error) return bad("Couldn't save those details — please try again.", 500);
    return ok({ ok: true, profile: merged });
  }
  if (action === "set_job") {
    // Job + pay setup → real columns. jobPatchFrom validates every enum and the amount and
    // throws a user-safe message, so a typo can't skew a report later.
    let patch: Record<string, unknown>;
    try { patch = jobPatchFrom(body?.job || {}); }
    catch (e) { return bad(e instanceof Error ? e.message : "That value isn't valid."); }
    if (body?.in_payroll !== undefined) patch.in_payroll = !!body.in_payroll;
    if (body?.can_see_own_pay !== undefined) patch.can_see_own_pay = !!body.can_see_own_pay;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    const wr = await sb.from("staff_users").update(patch).eq("id", id);
    if (wr.error) return bad("Couldn't save the job details — please try again.", 500);
    await logAction("admin", "user_set_job", { actor: "admin", restaurant_id: u.restaurant_id, detail: `job/pay for "${u.username}" · ${Object.keys(patch).join(", ")}` });
    return ok({ ok: true });
  }
  if (action === "set_permissions") {
    // A person may only ever hold the rows that EXIST for their role in Access & permissions
    // (lib/staffCaps) — an unknown key is refused rather than stored, because a stored key no
    // enforcer reads is a permission that looks granted and isn't. "default"/"" REMOVES the
    // person's own value so they follow the restaurant again.
    const patch = body?.permissions;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing permissions.");
    const caps = capsForRole(u.role);
    const merged: Record<string, string> = { ...(u.permissions && typeof u.permissions === "object" ? u.permissions : {}) };
    const noted: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const cap = caps.find((c) => c.key === k && c.perPerson);
      if (!cap) return bad(`"${k}" isn't a permission a ${u.role} has.`);
      if (v === null || v === "" || v === "default") { delete merged[k]; noted.push(`${k}→default`); continue; }
      if (!isCapValue(v, cap.pin) || v === "default") return bad(`Bad value for "${k}".`);
      merged[k] = String(v); noted.push(`${k}→${v}`);
    }
    if (!noted.length) return bad("Nothing to change.");
    const wr = await sb.from("staff_users").update({ permissions: merged }).eq("id", id);
    if (wr.error) return bad("Couldn't save that permission — please try again.", 500);
    await logAction("admin", "user_set_permissions", { actor: "admin", restaurant_id: u.restaurant_id, detail: `"${u.username}": ${noted.join(", ")}` });
    return ok({ ok: true, permissions: merged });
  }

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    // Bump token_version → kills all their existing logins immediately.
    const wr = await sb.from("staff_users").update({ password_hash: await hashSecret(password), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500); // never hand out a password that didn't actually save
    await logAction("admin", "user_reset_password", { actor: "admin", restaurant_id: u.restaurant_id, detail: `reset password for "${u.username}" · id ${id}` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    const active = !!body?.active;
    // Disabling someone also invalidates their cookies (token_version bump).
    const wr = await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500); // don't report a lockout/enable that didn't save
    await logAction("admin", active ? "user_enable" : "user_disable", { actor: "admin", restaurant_id: u.restaurant_id, detail: `${active ? "enabled" : "disabled"} "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    if (!ROLES.includes(role)) return bad("Pick a valid role.");
    // Role is part of the cookie signature, so this invalidates old cookies; bump
    // token_version too to be doubly sure.
    const wr = await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500);
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
    const wr = await sb.from("staff_users").update(patch).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500);
    await logAction("admin", "user_set_access", { actor: "admin", restaurant_id: u.restaurant_id, detail: `${notes.join(" & ")} for "${u.username}" · id ${id}` });
    return ok({ ok: true });
  }
  if (action === "set_pin") {
    // Admin sets or clears a user's PIN directly (e.g. a manager who can't self-set
    // it). Stored hashed, never returned. clear=true removes the PIN.
    if (body?.clear === true) {
      const wr = await sb.from("staff_users").update({ pin_hash: null }).eq("id", id);
      if (wr.error) return bad(wr.error.message, 500);
      await logAction("admin", "user_set_pin", { actor: "admin", restaurant_id: u.restaurant_id, detail: `cleared PIN for "${u.username}" · id ${id}` });
      return ok({ ok: true });
    }
    const pin = String(body?.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return bad("PIN must be 4–8 digits.");
    const wr = await sb.from("staff_users").update({ pin_hash: await hashSecret(pin) }).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500);
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
      if (key.length < 2) return bad("Username must be at least 2 characters.");
      // Names are unique PER restaurant (mig 091), so the clash-check MUST be scoped to
      // this user's restaurant — a global check wrongly rejected a name that's free at the
      // user's own restaurant just because another tenant uses it (bug M6, 2026-07-05).
      // Matches the create path, which already scopes by restaurant_id.
      const target = (await sb.from("staff_users").select("restaurant_id").eq("id", id).maybeSingle()).data;
      const clash = target ? (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", target.restaurant_id).neq("id", id).is("deleted_at", null).limit(1)).data?.[0] : null;
      if (clash) return bad("That username is taken — pick another.", 409);
      patch.name = display;
      patch.username = key;
    }
    if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    const wr = await sb.from("staff_users").update(patch).eq("id", id);
    if (wr.error) return bad(wr.error.message, 500);
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
  const del = await sb.from("staff_users").delete().eq("id", id);
  if (del.error) return bad(del.error.message, 500);
  await logAction("admin", "user_delete", { actor: "admin", restaurant_id: u.restaurant_id, detail: `deleted "${u?.username || "?"}" · id ${id}` });
  return ok({ ok: true });
}
