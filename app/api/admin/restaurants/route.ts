// /api/admin/restaurants — the admin super-panel's Restaurants tab.
//   GET   → every restaurant {id, slug, name, active, hasSettings, ownerUserId, ownerName}
//           + the list of existing owners (to pick from). Admin-gated.
//   PATCH → { restaurant_id, owner_user_id|null }  assign / clear a restaurant's OWNER.
//   POST  → { action:"create_owner", name, password? }  mint a new owner login
//           (role=owner; returned password shown ONCE). Admin then assigns it above.
// Admin-gated (STAFF_PASSWORD cookie, same as the rest of /aevinite), service role.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { hashSecret, normalizeLoginName } from "@/lib/userAuth";
import { resolveOwnerHomeRid, loginNameTaken } from "@/lib/ownerHome";
import { logAction } from "@/lib/oplog";
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "@/lib/starterMenu";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { MANAGER_POWER_FLAGS, OWNER_ENTITLEMENT_KEYS } from "@/lib/ownerEntitlements";
import { TABLET_CAPS, FEATURE_SWITCHES, MP_DEFAULT, isTri } from "@/lib/accessConfig";

// The remembered "New restaurant" setup (panels + sample-menu + access), stored in
// app_config (mig 186) so the create form auto-fills from the admin's last choice.
const CREATE_DEFAULTS_KEY = "restaurant_creation_defaults";

export const dynamic = "force-dynamic";
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

// 90-day recycle-bin retention. Kept in ONE place (mirrored by the SQL guard in
// admin_purge_restaurant, migration 128) so the lock can't drift between UI + DB.
const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);

  // ?deleted=1 → the RECYCLE BIN: only trashed restaurants, with the retention
  // countdown + whether they're yet eligible to purge. Kept separate from the
  // main list so a deleted restaurant never leaks back into the live table.
  if (new URL(req.url).searchParams.get("deleted") === "1") {
    const binQ = await sb.from("restaurants").select("id, slug, name, deleted_at, deleted_by, delete_reason")
      .not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    if (binQ.error) return bad(binQ.error.message, 500);
    const now = Date.now();
    const trashed = (binQ.data || []).map((r) => {
      const deletedAt = r.deleted_at as string;
      const purgeEligibleAt = new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86400000).toISOString();
      const daysLeft = Math.max(0, Math.ceil((new Date(purgeEligibleAt).getTime() - now) / 86400000));
      return {
        id: r.id, slug: r.slug, name: r.name,
        deletedAt, deletedBy: r.deleted_by || null, reason: r.delete_reason || null,
        purgeEligibleAt, daysLeft, canPurge: now >= new Date(purgeEligibleAt).getTime(),
      };
    });
    return ok({ trashed, retentionDays: RETENTION_DAYS });
  }

  const [restQ, setQ, ownersQ] = await Promise.all([
    // deleted_at IS NULL → the live/suspended list; trashed restaurants are hidden
    // here (they live in the recycle bin above).
    sb.from("restaurants").select("id, slug, name, active, owner_user_id, created_at").is("deleted_at", null).order("name"),
    // enabled_panels rides along (tiny JSONB) so the admin home can show each
    // restaurant's M/K/T/O panel chips WITHOUT a per-row fetch. Read-only add.
    sb.from("settings").select("restaurant_id, enabled_panels"),
    sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true).order("name"),
  ]);
  if (restQ.error) return bad(restQ.error.message, 500);
  const withSettings = new Set((setQ.data || []).map((r) => r.restaurant_id).filter(Boolean));
  const panelsByRid = new Map((setQ.data || []).map((r) => [r.restaurant_id, (r as { enabled_panels?: Record<string, boolean> | null }).enabled_panels || null]));
  const owners = (ownersQ.data || []).map((o) => ({ id: o.id, name: o.name || o.username }));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    createdAt: r.created_at || null, // lets the list tell "New" (just set up) from long-Dormant
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    ownerName: r.owner_user_id ? (ownerName.get(r.owner_user_id) || "—") : null,
    // Panel flags: a panel is ON unless explicitly false (matches /panels route semantics).
    panels: panelsByRid.get(r.id) || null,
  }));
  return ok({ restaurants, owners });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");
  // owner_user_id may be a uuid (assign) or null/"" (clear the owner).
  const raw = body?.owner_user_id;
  const ownerId = raw == null || raw === "" ? null : String(raw);
  if (ownerId) {
    const owner = (await sb.from("staff_users").select("id, name").eq("id", ownerId).eq("role", "owner").limit(1)).data?.[0];
    if (!owner) return bad("That user isn't an owner.", 400);
  }
  // The PRIMARY owner is stored on the restaurant (display / back-compat); the
  // SCOPING source of truth is the restaurant_owners join table (migration 097).
  // This dropdown sets a SINGLE primary owner, so we must keep the two in sync:
  // read the CURRENT primary, swap it in the join table, and leave any hand-added
  // co-owners (a different user_id) untouched. Skipping this would let the OLD
  // primary keep seeing this restaurant after a reassign/clear — the exact
  // cross-owner leak we must prevent now that scope reads the join table.
  const prev = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
  const oldOwner = (prev?.owner_user_id as string | null) || null;
  const { error } = await sb.from("restaurants").update({ owner_user_id: ownerId }).eq("id", rid);
  if (error) return bad(error.message, 500);
  // Remove the PREVIOUS primary's membership if it's being replaced/cleared
  // (leave it if it's the same user we're re-assigning, and never touch co-owners).
  if (oldOwner && oldOwner !== ownerId) {
    // This delete is the SECURITY-CRITICAL write: it revokes the previous owner's
    // scope. If it silently fails the old owner keeps seeing this restaurant — the
    // cross-owner leak we must never ship — so surface the error instead of swallowing it.
    const del = await sb.from("restaurant_owners").delete().eq("restaurant_id", rid).eq("user_id", oldOwner);
    if (del.error) return bad(del.error.message, 500);
  }
  // Add the NEW primary's membership (idempotent — composite PK + ignoreDuplicates).
  if (ownerId) {
    await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: ownerId }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
  }
  await logAction("admin", "restaurant_set_owner", { restaurant_id: rid, actor: "admin", detail: ownerId ? `assigned owner ${ownerId}` : "cleared owner" });
  return ok({ ok: true, ownerUserId: ownerId });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const action = String(body?.action || "");

  // ── set_restaurant_active — the platform kill switch (owner 2026-07-04: "where is
  // the button to suspend?"). active=false stops the tenant resolver serving the
  // guest menu; the admin can still reach every panel via act-as to inspect/fix. ──
  if (action === "set_restaurant_active") {
    const rid = String(body?.restaurant_id || "");
    const active = !!body?.active;
    if (!rid) return bad("Missing restaurant_id.");
    const r = (await sb.from("restaurants").select("id, name").eq("id", rid).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    const { error } = await sb.from("restaurants").update({ active }).eq("id", rid);
    if (error) return bad(error.message, 500);
    await logAction("admin", active ? "restaurant_reactivate" : "restaurant_suspend", { restaurant_id: rid, actor: "admin", detail: `${r.name} ${active ? "reactivated" : "suspended"}` });
    return ok({ ok: true, active });
  }

  // ── soft_delete_restaurant — move a restaurant to the 90-day RECYCLE BIN. It
  // disappears from the guest menu (resolver returns null → 404) and staff can no
  // longer log in, but nothing is erased. Reversible via restore for 90 days, then
  // purgeable. Restaurant #1 (the default) can never be binned. ─────────────────
  if (action === "soft_delete_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    if (rid === DEFAULT_RID) return bad("The default restaurant can't be deleted.", 400);
    const reason = String(body?.reason ?? "").trim().slice(0, 300) || null;
    const r = (await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (r.deleted_at) return bad("That restaurant is already in the recycle bin.", 409);
    // deleted_at drives the resolver + login gates; active=false too so nothing
    // (e.g. a cached panel session) treats a binned restaurant as live.
    const { error } = await sb.from("restaurants")
      .update({ deleted_at: new Date().toISOString(), deleted_by: "admin", delete_reason: reason, active: false })
      .eq("id", rid);
    if (error) return bad(error.message, 500);
    await logAction("admin", "restaurant_soft_delete", { restaurant_id: rid, actor: "admin", detail: `${r.name} moved to recycle bin${reason ? ` · reason: ${reason}` : ""}` });
    return ok({ ok: true, deleted: true });
  }

  // ── restore_restaurant — bring a binned restaurant back. It returns SUSPENDED
  // by default (active=false) so it can't silently go live; pass activate:true to
  // reactivate it in one step. Clears the recycle-bin fields. ───────────────────
  if (action === "restore_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    const activate = body?.activate === true;
    const r = (await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (!r.deleted_at) return bad("That restaurant isn't in the recycle bin.", 409);
    const { error } = await sb.from("restaurants")
      .update({ deleted_at: null, deleted_by: null, delete_reason: null, active: activate })
      .eq("id", rid);
    if (error) return bad(error.message, 500);
    await logAction("admin", "restaurant_restore", { restaurant_id: rid, actor: "admin", detail: `${r.name} restored${activate ? " and reactivated" : " (suspended)"}` });
    return ok({ ok: true, restored: true, active: activate });
  }

  // ── purge_restaurant — PERMANENT, irreversible erase of a binned restaurant and
  // ALL its data. The atomic SQL function admin_purge_restaurant enforces the two
  // hard rules (never the default, never before 90 days) so a purge can't slip
  // through even if the UI check is bypassed. There is NO early-purge override. ──
  if (action === "purge_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    if (rid === DEFAULT_RID) return bad("The default restaurant can't be purged.", 400);
    const r = (await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (!r.deleted_at) return bad("Only a restaurant in the recycle bin can be purged.", 409);
    const eligibleAt = new Date(r.deleted_at).getTime() + RETENTION_DAYS * 86400000;
    if (Date.now() < eligibleAt) {
      const daysLeft = Math.ceil((eligibleAt - Date.now()) / 86400000);
      return bad(`Locked for ${daysLeft} more ${daysLeft === 1 ? "day" : "days"} — a restaurant can only be purged 90 days after deletion.`, 423);
    }
    // Atomic hard delete (children → parents → the row) in one transaction.
    const { error } = await sb.rpc("admin_purge_restaurant", { p_rid: rid });
    if (error) return bad(error.message, 500);
    await logAction("admin", "restaurant_purge", { actor: "admin", detail: `PERMANENTLY purged restaurant "${r.name}" (${rid})` });
    return ok({ ok: true, purged: true });
  }

  // ── create_restaurant — the admin onboards a NEW restaurant in one go (owner 2026-06-29):
  // make the restaurant row, its settings (cloned from #1 so every NOT NULL column is satisfied,
  // with the chosen enabled_panels), and ONE starter login per ENABLED panel (passwords shown
  // ONCE). Default panels: Manager+Kitchen+Tablet on, Owner OFF (owner's choice). ───────────────
  if (action === "create_restaurant") {
    const name = String(body?.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return bad("Restaurant name must be at least 2 characters.");
    // slug from the name (lowercase, hyphenated), made unique with a numeric suffix if taken.
    const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "restaurant";
    let slug = base, n = 1;
    while (((await sb.from("restaurants").select("id").eq("slug", slug).limit(1)).data || []).length) slug = `${base}-${++n}`;
    // Chosen panels (default M+K+T on, Owner off). Coerce to honest booleans.
    const wp = (body?.panels && typeof body.panels === "object") ? body.panels as Record<string, unknown> : {};
    const panels = {
      manager: wp.manager !== false, kitchen: wp.kitchen !== false,
      tablet: wp.tablet !== false, owner: wp.owner === true,
    };
    // Seed a starter menu unless the admin turned the toggle off (default ON).
    const seedMenu = body?.seedMenu !== false;
    // ACCESS config chosen at creation (owner 2026-07-24): the admin sets the new
    // restaurant's access ladder right here. Shape mirrors the access editor's body:
    //   access.owner    → owner_entitlements (sections + power_<flag>)
    //   access.manager  → manager_permissions (the owner's grant baseline)
    //   access.tablet   → tablet cap tri-states (settings.*)
    //   access.features → module allowed / owner_control switches (settings.*)
    // Absent = fall back to the system defaults (all-on owner sections, MP_DEFAULT
    // grants, modules off) exactly as before — so an old client still works.
    const access = (body?.access && typeof body.access === "object") ? body.access as Record<string, any> : {};
    const settingsAccessPatch: Record<string, string | boolean> = {};
    if (access.tablet && typeof access.tablet === "object")
      for (const k of TABLET_CAPS) { const v = access.tablet[k]; if (isTri(v)) settingsAccessPatch[k] = v; }
    if (access.features && typeof access.features === "object")
      for (const k of FEATURE_SWITCHES) { const v = access.features[k]; if (typeof v === "boolean") settingsAccessPatch[k] = v; }
    let managerPerms: Record<string, boolean> | null = null;
    if (access.manager && typeof access.manager === "object") {
      managerPerms = { ...MP_DEFAULT };
      for (const k of MANAGER_POWER_FLAGS) if (k in access.manager) managerPerms[k] = (access.manager as Record<string, unknown>)[k] === true;
    }
    let ownerEnts: Record<string, boolean> | null = null;
    if (access.owner && typeof access.owner === "object") {
      ownerEnts = {};
      for (const k of OWNER_ENTITLEMENT_KEYS) if (k in access.owner) ownerEnts[k] = (access.owner as Record<string, unknown>)[k] === true;
    }
    // 1) the restaurant row (id auto-uuid, active) + any chosen access entitlements.
    const rest = await sb.from("restaurants").insert({
      slug, name, active: true,
      ...(managerPerms ? { manager_permissions: managerPerms } : {}),
      ...(ownerEnts ? { owner_entitlements: ownerEnts } : {}),
    }).select("id, slug, name").single();
    if (rest.error) {
      // Slug uniqueness is a read-then-insert (not atomic), so two admins creating the same
      // name at the same instant can both pass the while-loop and collide on the UNIQUE
      // constraint. Turn Postgres's raw 23505 into a friendly "try again" instead of a 500.
      if (rest.error.code === "23505") return bad("That name was just taken — please try a slightly different name.", 409);
      return bad(rest.error.message, 500);
    }
    const rid = rest.data.id as string;
    // 2) its settings row — clone #1 as a template, then override id/restaurant_id/enabled_panels
    //    and start with a modest table_count (a new restaurant shouldn't inherit #1's big floor).
    const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RID).maybeSingle();
    // cleanClonedSettings strips #1's tenant-specific identity/geo/tax (and sets table_count:10)
    // so a new restaurant never inherits #1's invoice name/GSTIN or café geofence coordinates.
    const baseRow = cleanClonedSettings(template.data);
    // Fold the chosen tablet caps + module switches over the cleaned defaults.
    const settingsRow = { ...baseRow, id: slug, restaurant_id: rid, enabled_panels: panels, ...settingsAccessPatch };
    const setRes = await sb.from("settings").upsert(settingsRow, { onConflict: "restaurant_id" });
    if (setRes.error) {
      // Roll back the orphaned restaurant row (bug #5, 2026-07-06): without a settings
      // row the tenant is unusable, and leaving it made the admin — who just saw
      // "couldn't create" — retry and produce a duplicate with a "-2" slug.
      await sb.from("restaurants").delete().eq("id", rid);
      return bad(setRes.error.message, 500);
    }
    // 2b) Seed the starter menu (categories → filters → items), scoped to this restaurant.
    //     Best-effort: a seed failure must NOT orphan the already-created restaurant — we
    //     report it in the response so the admin knows, and the restaurant is still usable
    //     and editable from its manager panel. Egress-safe: scoped inserts, no reads.
    let menuSeeded = false;
    let seedError: string | null = null;
    if (seedMenu) {
      try {
        const menu = loadStarterMenu();
        const cats = toCategoryRows(menu, rid);
        const filters = toFilterRows(menu, rid);
        const items = toItemRows(menu, rid);
        if (cats.length) {
          const r1 = await sb.from("categories").upsert(cats, { onConflict: "restaurant_id,slug" });
          if (r1.error) throw new Error(r1.error.message);
        }
        if (filters.length) {
          const r2 = await sb.from("filters").upsert(filters, { onConflict: "restaurant_id,slug" });
          if (r2.error) throw new Error(r2.error.message);
        }
        if (items.length) {
          const r3 = await sb.from("menu_items").upsert(items, { onConflict: "restaurant_id,slug" });
          if (r3.error) throw new Error(r3.error.message);
        }
        menuSeeded = true;
      } catch (e) {
        seedError = e instanceof Error ? e.message : String(e);
      }
    }
    // 3) one starter login per ENABLED panel. Username = the panel name (unique PER restaurant),
    //    random password returned once. The owner login is also mapped as the restaurant's owner.
    const logins: { panel: string; role: string; username: string; password: string }[] = [];
    const loginErrors: string[] = []; // panels whose starter login failed (bug #5) — reported so the admin isn't left with an enabled panel nobody can sign into
    for (const panel of ["manager", "kitchen", "tablet", "owner"] as const) {
      if (!panels[panel]) continue;
      const pw = genPassword();
      const ins = await sb.from("staff_users")
        .insert({ username: panel, name: `${name} ${panel}`, role: panel, restaurant_id: rid, password_hash: await hashSecret(pw), active: true })
        .select("id").single();
      if (ins.error) { loginErrors.push(panel); continue; } // don't fail the whole create over one login; report what we made
      logins.push({ panel, role: panel, username: panel, password: pw });
      if (panel === "owner") {
        await sb.from("restaurants").update({ owner_user_id: ins.data.id }).eq("id", rid);
        await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: ins.data.id }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
      }
    }
    const onPanels = (Object.keys(panels) as (keyof typeof panels)[]).filter((k) => panels[k]);
    await logAction("admin", "restaurant_create", { actor: "admin", restaurant_id: rid, detail: `created restaurant "${name}" (${slug}) · panels ${onPanels.join("+")}${seedMenu ? (menuSeeded ? " · menu seeded" : " · menu seed FAILED") : " · no menu"}` });
    // Remember this setup (panels + sample-menu + access) so the next "New restaurant"
    // form auto-fills from it. Best-effort — a save failure must never fail the create.
    if (body?.saveDefaults !== false) {
      try {
        await sb.from("app_config").upsert(
          { key: CREATE_DEFAULTS_KEY, value: { panels, seedMenu, access }, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
      } catch { /* remembering defaults is a convenience, not critical */ }
    }
    return ok({ ok: true, id: rid, slug, name, panels, logins, loginErrors, menuSeeded, seedError });
  }

  if (action !== "create_owner") return bad("Unknown action.");
  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (key.length < 2) return bad("Username must be at least 2 characters.");
  // An owner's `restaurant_id` is only a "home" anchor for the NOT NULL + FK column;
  // their OWNED restaurants come from restaurants.owner_user_id / restaurant_owners
  // (assigned via PATCH). Login names are globally unique, so clash-check globally.
  if (await loginNameTaken(key)) return bad("That username is taken — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const home = await resolveOwnerHomeRid();
  if (!home.rid) return bad(home.error || "Couldn't work out where to file this owner.", 500);
  const { data, error } = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: home.rid, password_hash: await hashSecret(password), active: true })
    .select("id, name").single();
  if (error) return bad(error.code === "23505" ? "That username is taken — pick another." : error.message, error.code === "23505" ? 409 : 500);
  await logAction("admin", "owner_create", { actor: "admin", detail: `created owner "${display}" · id ${data!.id}` });
  return ok({ ok: true, id: data!.id, name: display, password });
}
