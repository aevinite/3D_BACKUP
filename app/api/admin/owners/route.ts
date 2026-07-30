// /api/admin/owners — the admin's OWNER manager (one owner ⇄ 1..N restaurants).
// The scoping source of truth is the restaurant_owners join table (migration 097);
// restaurants.owner_user_id stays in sync as the display/back-compat "primary".
//   GET   → every owner (incl. suspended) + the restaurants each one owns, plus the
//           live restaurant list (for attach pickers + the "no owner" warning).
//   POST  → { action:"create_owner", name, password?, restaurant_ids?[] } — mint the
//           login ONCE (password shown once) and attach any number of restaurants.
//   PATCH → { owner_id, action: "attach"|"detach" (+restaurant_id) |
//             "reset_password" (+password?) | "set_active" (+active) | "rename" (+name) }
//   POST  → also { action:"restore_owner"|"purge_owner", owner_id } for the recycle bin.
//   GET ?id=<owner_id>  → one owner's ACTIVITY feed (staff_actions rows that name
//           them — their own logins/actions + admin actions done TO them).
//   GET ?deleted=1      → the RECYCLE BIN: owners that were soft-deleted (mig 208),
//           with the 90-day retention countdown + whether they're purge-eligible.
//   DELETE ?id=<owner_id> → move the owner to the RECYCLE BIN (soft-delete, mig 208;
//           owner rule 2026-07-06: suspend FIRST). Reversible via restore_owner for
//           90 days, then purge_owner erases it for good (that permanent step hands
//           their restaurants to a co-owner or to "no owner"). Mirrors restaurants.
// Admin-gated (same cookie as the rest of /aevinite), service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { hashSecret, normalizeLoginName } from "@/lib/userAuth";
import { logAction, redactMoney } from "@/lib/oplog";
import { resolveOwnerHomeRid, loginNameTaken } from "@/lib/ownerHome";

export const dynamic = "force-dynamic";
const RETENTION_DAYS = 90; // a binned owner is restorable for this long, then purgeable (matches restaurants)
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
    // Match by the owner's STABLE id: actor_id on their own panel actions (mig 156), plus the
    // owner id embedded in the detail of admin-on-owner actions + their login rows. Replaces the
    // old display-NAME match, which missed role-logged actions AND surfaced a same-named staff
    // member's rows under the wrong owner (audit 2026-07-09). ownerId is a validated UUID — safe
    // in the .or() filter (no delimiter chars to escape).
    const actQ = await sb.from("staff_actions")
      .select("id, panel, action, actor, detail, restaurant_id, created_at")
      .or(`actor_id.eq.${ownerId},detail.ilike.%${ownerId}%`)
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

  // ── ?deleted=1 → the RECYCLE BIN: only binned owners, with the retention
  // countdown + whether they're yet eligible to purge. Kept separate from the
  // main list so a binned owner never leaks back into the live table.
  if (new URL(req.url).searchParams.get("deleted") === "1") {
    const [binQ, linksQ] = await Promise.all([
      sb.from("staff_users").select("id, username, name, deleted_at, deleted_by, delete_reason")
        .eq("role", "owner").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      sb.from("restaurant_owners").select("user_id"),
    ]);
    if (binQ.error) return bad(binQ.error.message, 500);
    const owned = new Map<string, number>();
    for (const l of linksQ.data || []) owned.set(l.user_id, (owned.get(l.user_id) || 0) + 1);
    const now = Date.now();
    const trashed = (binQ.data || []).map((o) => {
      const deletedAt = o.deleted_at as string;
      const purgeEligibleAt = new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86400000).toISOString();
      const daysLeft = Math.max(0, Math.ceil((new Date(purgeEligibleAt).getTime() - now) / 86400000));
      return {
        id: o.id, username: o.username, name: o.name || o.username,
        deletedAt, deletedBy: o.deleted_by || null, reason: o.delete_reason || null,
        restaurants: owned.get(o.id) || 0,
        purgeEligibleAt, daysLeft, canPurge: now >= new Date(purgeEligibleAt).getTime(),
      };
    });
    return ok({ trashed, retentionDays: RETENTION_DAYS });
  }

  const [ownersQ, linksQ, restQ] = await Promise.all([
    // deleted_at IS NULL → the live/suspended list; binned owners are hidden here
    // (they live in the recycle bin above).
    sb.from("staff_users")
      .select("id, username, name, active, last_seen_at, created_at")
      .eq("role", "owner").is("deleted_at", null).order("created_at", { ascending: true }),
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
  const action = String(body?.action || "");

  // ── restore_owner — bring a binned owner back. They return SUSPENDED (active
  // stays false, exactly as they were before binning) so they can't silently sign
  // in; the admin flips Restore in the Owners list to reactivate. Their restaurant
  // links were kept intact, so ownership comes straight back. Clears bin fields. ──
  if (action === "restore_owner") {
    const ownerId = String(body?.owner_id || "");
    if (!ownerId) return bad("Missing owner_id.");
    const o = (await sb.from("staff_users").select("id, username, name, role, deleted_at").eq("id", ownerId).limit(1)).data?.[0];
    if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
    if (!o.deleted_at) return bad("That owner isn't in the recycle bin.", 409);
    const { error } = await sb.from("staff_users")
      .update({ deleted_at: null, deleted_by: null, delete_reason: null }).eq("id", ownerId);
    if (error) return bad(error.message, 500);
    await logAction("admin", "owner_restore_from_bin", { actor: "admin", restaurant_id: null, detail: `restored owner "${o.name || o.username}" from recycle bin (still suspended) · owner ${ownerId}` });
    return ok({ ok: true, restored: true });
  }

  // ── purge_owner — PERMANENT, irreversible erase of a binned owner. Allowed ONLY
  // once the 90-day retention window has elapsed (checked here — there is no early
  // override). This is the old permanent delete: hand each restaurant's primary to
  // a co-owner (or clear it), drop the join rows, delete the staff_users row. The
  // audit trail (staff_actions) is kept on purpose. ────────────────────────────
  if (action === "purge_owner") {
    const ownerId = String(body?.owner_id || "");
    if (!ownerId) return bad("Missing owner_id.");
    const o = (await sb.from("staff_users").select("id, username, name, role, deleted_at").eq("id", ownerId).limit(1)).data?.[0];
    if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
    if (!o.deleted_at) return bad("Only an owner in the recycle bin can be purged.", 409);
    const eligibleAt = new Date(o.deleted_at as string).getTime() + RETENTION_DAYS * 86400000;
    if (Date.now() < eligibleAt) {
      const daysLeft = Math.ceil((eligibleAt - Date.now()) / 86400000);
      return bad(`Locked for ${daysLeft} more day(s) — an owner can only be purged ${RETENTION_DAYS} days after deletion.`, 423);
    }
    const who = o.name || o.username;
    const res = await hardDeleteOwner(ownerId);
    if (res.error) return bad(res.error, 500);
    await logAction("admin", "owner_purge", { actor: "admin", restaurant_id: null, detail: `PERMANENTLY purged owner "${who}" (${ownerId}) · ${res.released} restaurant(s) released` });
    return ok({ ok: true, purged: true });
  }

  if (action !== "create_owner") return bad("Unknown action.");

  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (key.length < 2) return bad("Username must be at least 2 characters.");
  if (await loginNameTaken(key)) return bad("That username is taken — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");

  const rids: string[] = Array.isArray(body?.restaurant_ids) ? body.restaurant_ids.map(String) : [];
  // The owner's row still needs SOME restaurant in its NOT NULL + FK column; it's only
  // an anchor (real ownership = the restaurant_owners rows attached just below), so ask
  // the DB for one that exists instead of assuming #1 is there. See lib/ownerHome.ts.
  const home = await resolveOwnerHomeRid(rids);
  if (!home.rid) return bad(home.error || "Couldn't work out where to file this owner.", 500);
  const ins = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: home.rid, password_hash: await hashSecret(password), active: true })
    .select("id, name").single();
  // 23505 = the global unique index on lower(username) — the friendly version of
  // "that username is taken" for the rare race between the check above and this insert.
  if (ins.error) return bad(ins.error.code === "23505" ? "That username is taken — pick another." : ins.error.message, ins.error.code === "23505" ? 409 : 500);
  const ownerId = ins.data.id as string;

  // Attach every picked restaurant; report per-restaurant failures instead of
  // failing the whole create (the login itself already exists at this point).
  const attachErrors: string[] = [];
  for (const rid of rids) {
    const e = await attach(ownerId, rid);
    if (e) attachErrors.push(`${rid}: ${e}`);
  }
  await logAction("admin", "owner_create", {
    actor: "admin", restaurant_id: null, // platform-level: not tied to one restaurant (mig 156)
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
    await logAction("admin", "owner_attach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r.name} attached to owner "${who}" · owner ${ownerId}` });
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
    await logAction("admin", "owner_detach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r?.name || rid} detached from owner "${who}" · owner ${ownerId}` });
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
    await logAction("admin", "owner_reset_password", { actor: "admin", restaurant_id: null, detail: `reset password for owner "${who}" · owner ${ownerId}` });
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
    await logAction("admin", active ? "owner_restore" : "owner_suspend", { actor: "admin", restaurant_id: null, detail: `${active ? "restored" : "suspended"} owner "${who}" · owner ${ownerId}` });
    return ok({ ok: true, active });
  }

  if (action === "delete_forever") {
    // Kept for API symmetry — reject here so no one wires a PATCH to a destructive
    // action by accident. DELETE now moves to the recycle bin; POST purge_owner is
    // the permanent step (after 90 days).
    return bad("Use DELETE /api/admin/owners?id=… to bin, or POST purge_owner to remove permanently.", 405);
  }

  if (action === "rename") {
    const display = String(body?.name ?? "").trim().slice(0, 80);
    const key = normalizeLoginName(display);
    if (key.length < 2) return bad("Username must be at least 2 characters.");
    if (key !== owner.username && (await loginNameTaken(key))) return bad("That username is taken — pick another.", 409);
    const { error } = await sb.from("staff_users").update({ name: display, username: key }).eq("id", ownerId);
    if (error) return bad(error.message, 500);
    await logAction("admin", "owner_rename", { actor: "admin", restaurant_id: null, detail: `renamed owner "${who}" → "${display}" · owner ${ownerId}` });
    return ok({ ok: true });
  }

  return bad("Unknown action.");
}

// The old permanent-delete guts, now used ONLY by purge_owner (after the 90-day
// bin lock). Hands each restaurant's PRIMARY pointer to a remaining co-owner (or
// clears it — owner_user_id must never point at someone with no membership), drops
// the join rows, then deletes the staff_users row. Returns how many restaurants
// were released. staff_actions rows are kept on purpose (audit outlives account).
async function hardDeleteOwner(ownerId: string): Promise<{ error?: string; released: number }> {
  const links = (await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId)).data || [];
  for (const l of links) {
    const rid = l.restaurant_id as string;
    const r = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
    if (r?.owner_user_id === ownerId) {
      const next = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).neq("user_id", ownerId).limit(1)).data?.[0];
      const set = await sb.from("restaurants").update({ owner_user_id: next?.user_id ?? null }).eq("id", rid);
      if (set.error) return { error: set.error.message, released: 0 };
    }
  }
  const delLinks = await sb.from("restaurant_owners").delete().eq("user_id", ownerId);
  if (delLinks.error) return { error: delLinks.error.message, released: 0 };
  const delUser = await sb.from("staff_users").delete().eq("id", ownerId);
  if (delUser.error) return { error: delUser.error.message, released: 0 };
  return { released: links.length };
}

// ── DELETE ?id=<owner_id> — move the owner to the RECYCLE BIN (soft-delete). ──
// Owner's rule (2026-07-06): the account must be SUSPENDED first (the reversible
// step). Binning sets deleted_at so the owner drops out of the Owners list; their
// login is already dead (suspended). NOTHING is erased — restaurant links + primary
// pointers stay intact, so a Restore from the bin brings ownership straight back.
// After 90 days they can be permanently purged (POST purge_owner). Mirrors the
// restaurant recycle bin (soft_delete_restaurant, mig 128/208).
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const url = new URL(req.url);
  const ownerId = url.searchParams.get("id") || "";
  if (!ownerId) return bad("Missing id.");
  const o = (await sb.from("staff_users").select("id, username, name, role, active, deleted_at").eq("id", ownerId).limit(1)).data?.[0];
  if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
  if (o.active) return bad("Suspend this owner first — deleting only moves a suspended account to the recycle bin.", 409);
  if (o.deleted_at) return bad("That owner is already in the recycle bin.", 409);
  const reason = (url.searchParams.get("reason") || "").trim().slice(0, 300) || null;
  const who = o.name || o.username;
  const { error } = await sb.from("staff_users")
    .update({ deleted_at: new Date().toISOString(), deleted_by: "admin", delete_reason: reason }).eq("id", ownerId);
  if (error) return bad(error.message, 500);
  await logAction("admin", "owner_soft_delete", {
    actor: "admin", restaurant_id: null, // platform-level (mig 156)
    detail: `moved owner "${who}" to recycle bin${reason ? ` · reason: ${reason}` : ""} · owner ${ownerId}`,
  });
  return ok({ ok: true, deleted: true });
}
