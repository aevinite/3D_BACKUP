// /api/admin/owners — the admin's OWNER manager (one owner ⇄ 1..N restaurants).
// The scoping source of truth is the restaurant_owners join table (migration 097);
// restaurants.owner_user_id stays in sync as the display/back-compat "primary".
//   GET   → every owner (incl. suspended) + the restaurants each one owns, plus the
//           live restaurant list (for attach pickers + the "no owner" warning).
//   POST  → { action:"create_owner", name, password?, restaurant_ids?[] } — mint the
//           login ONCE (password shown once) and attach any number of restaurants.
//   PATCH → { owner_id, action: "attach"|"detach" (+restaurant_id) |
//             "reset_password" (+password?) | "set_active" (+active) | "rename" (+name) }
//   GET ?id=<owner_id>  → one owner's ACTIVITY feed (staff_actions rows that name
//           them — their own logins/actions + admin actions done TO them).
//   DELETE ?id=<owner_id> → PERMANENT erase (owner rule 2026-07-06: suspend FIRST,
//           then delete; a deleted owner can never be restored). Restaurants they
//           owned fall back to a co-owner or to "no owner" (warning strip).
// Admin-gated (same cookie as the rest of /aevinite), service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { hashSecret, normalizeLoginName } from "@/lib/userAuth";
import { logAction, redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const ok = (d: unknown, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

// Owner logins live in the #1 "home" namespace (see /api/admin/restaurants
// create_owner) — so an owner name must not clash with anything already there.
async function ownerNameTaken(key: string): Promise<boolean> {
  const dup = await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", DEFAULT_RID).limit(1);
  return !!dup.data?.[0];
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);

  // ── ?id=<owner> → that owner's ACTIVITY (admin clicked into an owner card).
  // One-shot on open, never polled. Two match rules: rows THEY caused (actor =
  // their name/username — logins + owner-panel actions) and rows ABOUT them
  // (detail carries their uuid — owner_create/reset/suspend/attach…). Capped.
  const ownerId = new URL(req.url).searchParams.get("id");
  if (ownerId) {
    // Validate the id is a real UUID BEFORE it touches any query — stops a crafted value
    // from injecting PostgREST filter syntax into the .or() below, and returns a clean 400
    // instead of leaking a raw "invalid input syntax for type uuid" Postgres error.
    if (!isUuid(ownerId)) return bad("Invalid owner id.", 400);
    const o = (await sb.from("staff_users")
      .select("id, username, name, active, last_seen_at, created_at")
      .eq("id", ownerId).eq("role", "owner").limit(1)).data?.[0];
    if (!o) return bad("Owner not found.", 404);
    // Strip every char PostgREST's .or() grammar uses as a delimiter (, . ( ) %) so the
    // owner's display name can't break or alter the filter expression.
    const who = (o.name || o.username).replace(/[%,().]/g, "");
    const actQ = await sb.from("staff_actions")
      .select("id, panel, action, actor, detail, restaurant_id, created_at")
      .or(`actor.eq.${who},detail.ilike.%${ownerId}%`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (actQ.error) return bad(actQ.error.message, 500);
    // Restaurant names for the rows' restaurant_id chips (one scoped lookup).
    const rids = Array.from(new Set((actQ.data || []).map((a) => a.restaurant_id).filter(Boolean)));
    const restNames = rids.length
      ? new Map(((await sb.from("restaurants").select("id, name").in("id", rids)).data || []).map((r) => [r.id, r.name]))
      : new Map();
    return ok({
      owner: { id: o.id, username: o.username, name: o.name || o.username, active: o.active === true, lastSeenAt: o.last_seen_at, createdAt: o.created_at },
      activity: (actQ.data || []).map((a) => ({
        id: a.id, panel: a.panel, action: a.action, actor: a.actor, detail: redactMoney(a.detail),
        restaurant: a.restaurant_id ? (restNames.get(a.restaurant_id) || null) : null, at: a.created_at,
      })),
    });
  }

  const [ownersQ, linksQ, restQ] = await Promise.all([
    sb.from("staff_users")
      .select("id, username, name, active, last_seen_at, created_at")
      .eq("role", "owner").order("created_at", { ascending: true }),
    sb.from("restaurant_owners").select("restaurant_id, user_id"),
    sb.from("restaurants").select("id, slug, name, active, owner_user_id").is("deleted_at", null).order("name"),
  ]);
  if (ownersQ.error) return bad(ownersQ.error.message, 500);
  if (linksQ.error) return bad(linksQ.error.message, 500);
  if (restQ.error) return bad(restQ.error.message, 500);

  const restById = new Map((restQ.data || []).map((r) => [r.id, r]));
  const byOwner = new Map<string, { id: string; slug: string; name: string; active: boolean; primary: boolean }[]>();
  for (const l of linksQ.data || []) {
    const r = restById.get(l.restaurant_id);
    if (!r) continue; // deleted/binned restaurants don't show as owned
    const list = byOwner.get(l.user_id) || [];
    list.push({ id: r.id, slug: r.slug, name: r.name, active: r.active === true, primary: r.owner_user_id === l.user_id });
    byOwner.set(l.user_id, list);
  }
  const owners = (ownersQ.data || []).map((o) => ({
    id: o.id, username: o.username, name: o.name || o.username, active: o.active === true,
    lastSeenAt: o.last_seen_at || null, createdAt: o.created_at,
    restaurants: (byOwner.get(o.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const ownedIds = new Set((linksQ.data || []).map((l) => l.restaurant_id));
  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasOwner: ownedIds.has(r.id),
  }));
  return ok({ owners, restaurants });
}

// Attach ONE restaurant to an owner: join-table membership + become the primary
// if the restaurant doesn't have one yet (so act-as/display always resolve).
async function attach(ownerId: string, rid: string): Promise<string | null> {
  const up = await sb.from("restaurant_owners")
    .upsert({ restaurant_id: rid, user_id: ownerId }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
  if (up.error) return up.error.message;
  const r = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
  if (r && !r.owner_user_id) {
    const set = await sb.from("restaurants").update({ owner_user_id: ownerId }).eq("id", rid);
    if (set.error) return set.error.message;
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  if (String(body?.action || "") !== "create_owner") return bad("Unknown action.");

  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (key.length < 2) return bad("Name must be at least 2 characters.");
  if (await ownerNameTaken(key)) return bad("That owner name is taken — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");

  const rids: string[] = Array.isArray(body?.restaurant_ids) ? body.restaurant_ids.map(String) : [];
  const ins = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: DEFAULT_RID, password_hash: await hashSecret(password), active: true })
    .select("id, name").single();
  if (ins.error) return bad(ins.error.message, 500);
  const ownerId = ins.data.id as string;

  // Attach every picked restaurant; report per-restaurant failures instead of
  // failing the whole create (the login itself already exists at this point).
  const attachErrors: string[] = [];
  for (const rid of rids) {
    const e = await attach(ownerId, rid);
    if (e) attachErrors.push(`${rid}: ${e}`);
  }
  await logAction("admin", "owner_create", {
    actor: "admin",
    detail: `created owner "${display}" · id ${ownerId}${rids.length ? ` · attached ${rids.length} restaurant(s)` : ""}`,
  });
  return ok({ ok: true, id: ownerId, name: display, password, attachErrors });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const ownerId = String(body?.owner_id || "");
  const action = String(body?.action || "");
  if (!ownerId) return bad("Missing owner_id.");
  const owner = (await sb.from("staff_users").select("id, name, username, role").eq("id", ownerId).limit(1)).data?.[0];
  if (!owner || owner.role !== "owner") return bad("That user isn't an owner.", 404);
  const who = owner.name || owner.username;

  if (action === "attach") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    const r = (await sb.from("restaurants").select("id, name").eq("id", rid).is("deleted_at", null).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    const e = await attach(ownerId, rid);
    if (e) return bad(e, 500);
    await logAction("admin", "owner_attach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r.name} attached to owner "${who}"` });
    return ok({ ok: true });
  }

  if (action === "detach") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    // SECURITY-CRITICAL revoke (same rule as /api/admin/restaurants PATCH): if this
    // delete fails the owner keeps seeing the restaurant — surface it, never swallow.
    const del = await sb.from("restaurant_owners").delete().eq("restaurant_id", rid).eq("user_id", ownerId);
    if (del.error) return bad(del.error.message, 500);
    // If they were the PRIMARY, hand primary to a remaining co-owner (or clear it)
    // so restaurants.owner_user_id never points at someone with no membership.
    const r = (await sb.from("restaurants").select("owner_user_id, name").eq("id", rid).limit(1)).data?.[0];
    if (r?.owner_user_id === ownerId) {
      const next = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).limit(1)).data?.[0];
      const set = await sb.from("restaurants").update({ owner_user_id: next?.user_id ?? null }).eq("id", rid);
      if (set.error) return bad(set.error.message, 500);
    }
    await logAction("admin", "owner_detach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r?.name || rid} detached from owner "${who}"` });
    return ok({ ok: true });
  }

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    // token_version bump = "log out everywhere" (same rule as /api/admin/users).
    const cur = (await sb.from("staff_users").select("token_version").eq("id", ownerId).limit(1)).data?.[0];
    const { error } = await sb.from("staff_users")
      .update({ password_hash: await hashSecret(password), token_version: ((cur?.token_version as number) || 0) + 1, failed_count: 0, locked_until: null })
      .eq("id", ownerId);
    if (error) return bad(error.message, 500);
    await logAction("admin", "owner_reset_password", { actor: "admin", detail: `reset password for owner "${who}"` });
    return ok({ ok: true, password });
  }

  if (action === "set_active") {
    const active = body?.active === true;
    const cur = (await sb.from("staff_users").select("token_version").eq("id", ownerId).limit(1)).data?.[0];
    // Suspending also bumps token_version so any live session dies immediately.
    const patch: Record<string, unknown> = { active };
    if (!active) patch.token_version = ((cur?.token_version as number) || 0) + 1;
    const { error } = await sb.from("staff_users").update(patch).eq("id", ownerId);
    if (error) return bad(error.message, 500);
    await logAction("admin", active ? "owner_restore" : "owner_suspend", { actor: "admin", detail: `${active ? "restored" : "suspended"} owner "${who}"` });
    return ok({ ok: true, active });
  }

  if (action === "delete_forever") {
    // Kept for API symmetry, but the real handler is DELETE below — reject here so
    // no one wires a PATCH to a destructive action by accident.
    return bad("Use DELETE /api/admin/owners?id=… for permanent deletion.", 405);
  }

  if (action === "rename") {
    const display = String(body?.name ?? "").trim().slice(0, 80);
    const key = normalizeLoginName(display);
    if (key.length < 2) return bad("Name must be at least 2 characters.");
    if (key !== owner.username && (await ownerNameTaken(key))) return bad("That owner name is taken — pick another.", 409);
    const { error } = await sb.from("staff_users").update({ name: display, username: key }).eq("id", ownerId);
    if (error) return bad(error.message, 500);
    await logAction("admin", "owner_rename", { actor: "admin", detail: `renamed owner "${who}" → "${display}"` });
    return ok({ ok: true });
  }

  return bad("Unknown action.");
}

// ── DELETE ?id=<owner_id> — PERMANENT, irreversible owner erase. ─────────────
// Owner's rule (2026-07-06): deletion is a TWO-STEP flow — the account must be
// SUSPENDED first (that's the reversible step), then delete forever. There is no
// restore: the staff_users row is gone, every live session dies with it, and the
// restaurants they owned hand primary to a co-owner or become "no owner" (the
// Owners page warning strip picks those up). Their activity rows in
// staff_actions are kept on purpose — the audit trail must outlive the account.
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const ownerId = new URL(req.url).searchParams.get("id") || "";
  if (!ownerId) return bad("Missing id.");
  const o = (await sb.from("staff_users").select("id, username, name, role, active").eq("id", ownerId).limit(1)).data?.[0];
  if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
  if (o.active) return bad("Suspend this owner first — deletion is permanent and only allowed on a suspended account.", 409);
  const who = o.name || o.username;

  // Hand off / clear the PRIMARY pointer on every restaurant they owned, then
  // revoke the memberships. Same rule as detach: owner_user_id must never point
  // at someone without a membership row.
  const links = (await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId)).data || [];
  for (const l of links) {
    const rid = l.restaurant_id as string;
    const r = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
    if (r?.owner_user_id === ownerId) {
      const next = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).neq("user_id", ownerId).limit(1)).data?.[0];
      const set = await sb.from("restaurants").update({ owner_user_id: next?.user_id ?? null }).eq("id", rid);
      if (set.error) return bad(set.error.message, 500);
    }
  }
  const delLinks = await sb.from("restaurant_owners").delete().eq("user_id", ownerId);
  if (delLinks.error) return bad(delLinks.error.message, 500);
  const delUser = await sb.from("staff_users").delete().eq("id", ownerId);
  if (delUser.error) return bad(delUser.error.message, 500);
  await logAction("admin", "owner_delete_forever", {
    actor: "admin",
    detail: `PERMANENTLY deleted owner "${who}" (${ownerId}) · ${links.length} restaurant(s) released`,
  });
  return ok({ ok: true, deleted: true });
}
