// /api/owner/staff — staff management scoped to the restaurants the caller owns.
//
// WHO can call (resolved by `scope()` below):
//   • ADMIN super-user (AUTH_COOKIE)  → every restaurant.
//   • OWNER (role=owner)              → every restaurant they're a member of in
//                                       restaurant_owners (migration 097).
//   • MANAGER (role=manager)          → ONLY their own restaurant, and ONLY if the
//     owner enabled manager_permissions.manage_staff for it (else 403).
//
//   GET    → { restaurants:[{id,name,slug,accentColor,managerPermissions}], staff:[…] }
//   POST   → create {name, role(manager|kitchen|tablet), restaurant_id, password?}
//            (password returned ONCE; stored hashed). Owners can't mint other owners.
//   PATCH  → {id, action}: reset_password | set_active | set_role | edit  (staff must be in scope)
//   DELETE → ?id=<uuid>  (staff must be in scope)
//
// Every staff row is created/looked-up WITH its restaurant_id, so one restaurant's
// manager can never see or touch another restaurant's people.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, hashSecret, normalizeLoginName, type Role } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";
import { mergeOwnerEntitlements } from "@/lib/ownerEntitlements";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";

export const dynamic = "force-dynamic";

// Roles an owner/manager may CREATE (never 'owner' — only the admin assigns owners).
const ASSIGNABLE: Role[] = ["manager", "kitchen", "tablet"];
// HIERARCHY RULE (owner, 2026-07-03 — "a lower role must NEVER control its own level
// or above"): what each actor may see/create/edit/delete here. A MANAGER manages only
// kitchen + tablet — never other managers (peer level) and never owners. This is the
// server truth; the panels' UIs merely reflect it.
const assignableFor = (actor: "admin" | "owner" | "manager"): Role[] =>
  actor === "manager" ? ["kitchen", "tablet"] : ASSIGNABLE;
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Count REAL characters (Unicode letters/digits), not UTF-16 code units — a single
// emoji is one glyph but two code units, so the old `key.length < 2` let one emoji
// pass as a login name. Require at least this many alphanumerics to be a valid name.
const realCharCount = (s: string) => (String(s).match(/[\p{L}\p{N}]/gu) || []).length;

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

type Restaurant = { id: string; name: string; slug: string; accent_color: string | null; manager_permissions: Record<string, boolean>; owner_entitlements: Record<string, boolean> | null; owner_user_id: string | null };
type Scope =
  | { ok: true; actor: "admin" | "owner" | "manager"; actorId: string | null; restaurants: Restaurant[] }
  | { ok: false; resp: NextResponse };

// Resolve which restaurants this caller may manage staff for (see header).
async function scope(req: NextRequest): Promise<Scope> {
  // owner_entitlements rides along for the mig-133 ladder checks below.
  const cols = "id, name, slug, accent_color, manager_permissions, owner_entitlements, owner_user_id";
  // Prefer a logged-in OWNER/MANAGER over a stray admin cookie in the SAME browser —
  // this mirrors lib/ownerScope + app/owner/layout (owner cookie → owner chrome). Before,
  // this checked the admin cookie FIRST, so a browser holding BOTH cookies rendered owner
  // chrome but listed EVERY restaurant's staff (inconsistent scoping, found 2026-07-06).
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u?.role === "owner") {
    // Multi-owner (migration 097): the restaurants an owner may staff are EVERY
    // restaurant they're a member of in restaurant_owners — not just the one where
    // they're the primary owner. Resolve the ids first, then fetch those rows.
    // Mig 133: a restaurant whose "staff" section the admin removed drops out here,
    // so the section dies server-side too, not just in the nav.
    // Only LIVE restaurants whose owner panel the admin still allows (audit 2026-07-07) —
    // a binned or owner-panel-disabled restaurant drops out here, matching lib/ownerScope.
    const ownedIds = await enabledOwnedRestaurantIds(u.id);
    if (!ownedIds.length) return { ok: true, actor: "owner", actorId: u.id, restaurants: [] };
    // A pinned context — e.g. the manager panel viewing ONE restaurant via ?rid= — narrows
    // to just that restaurant (if the owner actually owns it), so a multi-restaurant owner
    // sees/adds staff for the restaurant they're looking at, not a mixed list. The owner
    // panel sends no pin (or scope=all) and keeps the full set. (Mirrors the admin branch.)
    const osp = req.nextUrl?.searchParams;
    const opin = osp?.get("scope") || osp?.get("rid");
    const scopeIds = (opin && opin !== "all" && ownedIds.includes(opin)) ? [opin] : ownedIds;
    const { data } = await sb.from("restaurants").select(cols).in("id", scopeIds).order("name");
    const rows = ((data || []) as Restaurant[]).filter((r) => mergeOwnerEntitlements(r.owner_entitlements).staff !== false);
    if (!rows.length)
      // `disabled` = a legitimate "not turned on" state → the page shows a calm info card,
      // not the scary red "Something went wrong" error (audit 2026-07-07).
      return { ok: false, resp: NextResponse.json({ error: "Staff management isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 }) };
    return { ok: true, actor: "owner", actorId: u.id, restaurants: rows };
  }
  if (u?.role === "manager") {
    const { data } = await sb.from("restaurants").select(cols).eq("id", u.restaurant_id).limit(1);
    const r = (data || [])[0] as Restaurant | undefined;
    // The full ladder: the admin must still entitle the power (mig 133) AND the
    // owner must have granted it — same rule as managerCan() in the editor route.
    if (!r || mergeOwnerEntitlements(r.owner_entitlements).power_manage_staff === false || !r.manager_permissions?.manage_staff)
      return { ok: false, resp: bad("Your owner hasn't given you staff management.", 403) };
    return { ok: true, actor: "manager", actorId: u.id, restaurants: [r] };
  }
  // Admin super-user (no owner/manager session) → all restaurants, UNLESS a per-tab scope
  // pin (?scope=/?rid=) says the admin is viewing ONE restaurant (bug C1): then show only
  // that owner's set, so two admin tabs on different restaurants don't cross-list staff.
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    const sp = req.nextUrl?.searchParams;
    const pin = sp?.get("scope") || sp?.get("rid");
    if (pin && pin !== "all") {
      // Resolve the pinned restaurant's OWNER via the restaurant_owners JOIN (the scoping
      // source of truth, mig 097) — prefer the primary owner_user_id when it's a member,
      // else any co-owner — then widen to every restaurant that owner owns. Keying off
      // owner_user_id alone (the old code) missed hand-attached co-ownerships and could
      // list a stale set for a reassigned restaurant (audit 2026-07-07). Mirrors lib/ownerScope.
      const [primaryQ, membersQ] = await Promise.all([
        sb.from("restaurants").select("owner_user_id").eq("id", pin).maybeSingle(),
        sb.from("restaurant_owners").select("user_id").eq("restaurant_id", pin),
      ]);
      const members = (membersQ.data || []).map((m) => m.user_id as string);
      const primary = primaryQ.data?.owner_user_id as string | null | undefined;
      const ownerId = primary && members.includes(primary) ? primary : (members[0] ?? null);
      let ids: string[] = [];
      if (ownerId) ids = ((await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId)).data || []).map((x) => x.restaurant_id as string);
      if (!ids.includes(pin)) ids.push(pin); // never lose the entered restaurant
      const { data } = await sb.from("restaurants").select(cols).in("id", ids).order("name");
      return { ok: true, actor: "admin", actorId: null, restaurants: (data || []) as Restaurant[] };
    }
    const { data } = await sb.from("restaurants").select(cols).order("name");
    return { ok: true, actor: "admin", actorId: null, restaurants: (data || []) as Restaurant[] };
  }
  if (!u) return { ok: false, resp: bad("Not authorised — please log in.", 401) };
  return { ok: false, resp: bad("Not authorised.", 403) };
}

// ownerEntitlements rides along so the Staff & powers page can HIDE an unentitled
// power toggle from the real owner and TINT it for the admin (mig 133).
const slim = (r: Restaurant) => ({ id: r.id, name: r.name, slug: r.slug, accentColor: r.accent_color || "#e3c06f", managerPermissions: r.manager_permissions || {}, ownerEntitlements: mergeOwnerEntitlements(r.owner_entitlements) });

export async function GET(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  const ids = s.restaurants.map((r) => r.id);
  let staff: any[] = [];
  if (ids.length) {
    // Hierarchy: a manager's list contains ONLY the roles they may manage (kitchen +
    // tablet) — they never even SEE other managers' or owners' accounts.
    const { data, error } = await sb.from("staff_users")
      .select("id, username, role, name, phone, active, restaurant_id, last_seen_at, created_at, pin_hash, permissions")
      .in("restaurant_id", ids).in("role", assignableFor(s.actor)).order("created_at", { ascending: true }).limit(2000);
    if (error) return bad("Something went wrong, please try again.", 500);
    // Never ship hashes; expose only whether a PIN exists.
    staff = (data || []).map(({ pin_hash, ...u }) => ({ ...u, hasPin: !!pin_hash }));
  }
  return ok({ actor: s.actor, restaurants: s.restaurants.map(slim), staff });
}

export async function POST(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  let body: any = {}; try { body = await req.json(); } catch {}
  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  const role = String(body?.role || "") as Role;
  const rid = String(body?.restaurant_id || "");
  if (realCharCount(key) < 2) return bad("Username must be at least 2 characters.");
  // Hierarchy: a manager may only create BELOW their level (kitchen/tablet).
  if (!assignableFor(s.actor).includes(role)) return bad(s.actor === "manager" ? "Managers can only add kitchen or tablet logins." : "Pick a valid role (manager, kitchen, or tablet).");
  if (!s.restaurants.some((r) => r.id === rid)) return bad("That restaurant isn't yours to staff.", 403);
  // Names are unique PER restaurant (mig 091) — only clash-check within this one.
  const dup = (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", rid).limit(1)).data?.[0];
  if (dup) return bad("That username is taken at this restaurant — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  if (password.length > 128) return bad("Password is too long (max 128 characters).");
  const row = { username: key, role, restaurant_id: rid, password_hash: await hashSecret(password), name: display, phone: String(body?.phone || "").trim().slice(0, 20) || null };
  const { data, error } = await sb.from("staff_users").insert(row).select("id, username, role, name, restaurant_id").single();
  if (error) {
    // The pre-check above and this insert aren't atomic — two staff added at once (or a
    // fast double-click) can both pass the check and race here. Postgres code 23505 =
    // unique_violation on (restaurant_id, username): show the SAME friendly 409, never the
    // raw "duplicate key value violates unique constraint …" DB message. Any other DB error
    // is unexpected → a generic message, not the internals.
    if ((error as { code?: string }).code === "23505") return bad("That username is taken at this restaurant — pick another.", 409);
    return bad("Something went wrong, please try again.", 500);
  }
  await logAction("owner", "staff_create", { restaurant_id: rid, actor: s.actor, actor_id: s.actorId, detail: `created ${role} "${display}"` });
  return ok({ ok: true, id: data!.id, name: display, role, restaurant_id: rid, password });
}

export async function PATCH(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  let body: any = {}; try { body = await req.json(); } catch {}
  const id = String(body?.id || ""); const action = String(body?.action || "");
  if (!id) return bad("Missing staff id.");
  const ids = s.restaurants.map((r) => r.id);
  const u = (await sb.from("staff_users").select("*").eq("id", id).in("restaurant_id", ids).limit(1)).data?.[0];
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: the TARGET must be below the actor's level — a manager can never
  // touch another manager's (or an owner's) account, in any way.
  if (!assignableFor(s.actor).includes(u.role)) return bad("You can't manage accounts at or above your own level.", 403);

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    if (password.length > 128) return bad("Password is too long (max 128 characters).");
    // Capture the write error: without this, a failed UPDATE (row lock / timeout) still
    // returned {ok:true, password} — the owner read out a password the DB never saved, so
    // the staffer couldn't log in and the OLD password still worked (audit 2026-07-07).
    const { error } = await sb.from("staff_users").update({ password_hash: await hashSecret(password), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    if (error) return bad("Couldn't reset the password — please try again.", 500);
    await logAction("owner", "staff_reset_password", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `reset "${u.username}"` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    // Must be a REAL boolean — the old `!!body?.active` silently coerced junk (e.g.
    // active:"false" is a truthy string → enabled), flipping state the wrong way.
    if (typeof body?.active !== "boolean") return bad("`active` must be true or false.");
    const active = body.active;
    const { error } = await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't update that account — please try again.", 500);
    await logAction("owner", active ? "staff_enable" : "staff_disable", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `${active ? "enabled" : "disabled"} "${u.username}"` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    // Hierarchy: the NEW role must also stay below the actor (a manager can't
    // promote someone up to manager).
    if (!assignableFor(s.actor).includes(role)) return bad("Pick a valid role.");
    const { error } = await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't change the role — please try again.", 500);
    await logAction("owner", "staff_set_role", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `set "${u.username}" → ${role}` });
    return ok({ ok: true });
  }
  // set_permissions — per-user capability overrides (migration 115). Body:
  //   { id, action:"set_permissions", permissions: { tablet_mark_paid: "on"|"pin"|"off"|null, … } }
  // null (or absent-after-merge) deletes the key → the user goes back to "Default"
  // (inherits the restaurant-wide tri-state). Keys/values are strictly validated so a
  // buggy client can never write junk into the JSONB.
  if (action === "set_permissions") {
    // Canonical per-user override keys = the tablet_* caps that tabletPerm actually enforces
    // (mig 115 + the KOT/khata/take-orders additions). Keep in lockstep with TABLET_PERM_KEYS
    // in app/api/tablet/[...path]/route.ts — a key the enforcer doesn't read would be a dead grant.
    const PERM_KEYS = ["tablet_discount", "tablet_mark_paid", "tablet_invoice", "tablet_banquet", "tablet_table_tags", "tablet_khata", "tablet_table_ops", "tablet_take_orders"];
    const PERM_MODES = ["on", "pin", "off"];
    const patch = body?.permissions;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing permissions object.");
    const merged: Record<string, string> = { ...(u.permissions && typeof u.permissions === "object" ? u.permissions : {}) };
    const noted: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!PERM_KEYS.includes(k)) return bad(`Unknown permission "${k}".`);
      if (v === null || v === "" || v === "default") { delete merged[k]; noted.push(`${k}→default`); continue; }
      if (!PERM_MODES.includes(String(v))) return bad(`Bad value for "${k}" — use on, pin, off, or null.`);
      // Least-privilege (audit 2026-07-07): a MANAGER may REDUCE a junior's power (off) or
      // reset it to default, but may NOT GRANT (on/pin) a capability — otherwise a manager
      // given only "manage staff" could quietly hand a waiter discount/void/mark-paid powers
      // the owner deliberately withheld from the manager. Only the owner/admin grants powers.
      if (s.actor === "manager" && (v === "on" || v === "pin"))
        return bad("Only the owner can grant extra powers to staff.", 403);
      merged[k] = String(v); noted.push(`${k}→${v}`);
    }
    if (!noted.length) return bad("Nothing to change.");
    const { error } = await sb.from("staff_users").update({ permissions: merged }).eq("id", id);
    if (error) return bad("Couldn't update permissions — please try again.", 500);
    await logAction("owner", "staff_set_permissions", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `"${u.username}": ${noted.join(", ")}` });
    return ok({ ok: true, permissions: merged });
  }
  if (action === "edit") {
    const patch: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      const display = String(body.name || "").trim().slice(0, 80);
      const nkey = normalizeLoginName(display);
      if (realCharCount(nkey) < 2) return bad("Username must be at least 2 characters.");
      const clash = (await sb.from("staff_users").select("id").eq("username", nkey).eq("restaurant_id", u.restaurant_id).neq("id", id).limit(1)).data?.[0];
      if (clash) return bad("That username is taken at this restaurant.", 409);
      patch.name = display; patch.username = nkey;
    }
    if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    const { error } = await sb.from("staff_users").update(patch).eq("id", id);
    if (error) return bad("Couldn't save those changes — please try again.", 500);
    return ok({ ok: true });
  }
  return bad("Unknown action.");
}

export async function DELETE(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("Missing staff id.");
  const ids = s.restaurants.map((r) => r.id);
  const u = (await sb.from("staff_users").select("username, role, restaurant_id").eq("id", id).in("restaurant_id", ids).limit(1)).data?.[0];
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: can only delete accounts BELOW your level (see assignableFor).
  if (!assignableFor(s.actor).includes(u.role as Role)) return bad("You can't manage accounts at or above your own level.", 403);
  const { error } = await sb.from("staff_users").delete().eq("id", id);
  if (error) return bad("Couldn't remove that account — please try again.", 500);
  await logAction("owner", "staff_delete", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `deleted "${u.username}"` });
  return ok({ ok: true });
}
