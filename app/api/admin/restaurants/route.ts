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
import { logAction } from "@/lib/oplog";
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "@/lib/starterMenu";
import { cleanClonedSettings } from "@/lib/settingsClone";

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

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const [restQ, setQ, ownersQ] = await Promise.all([
    sb.from("restaurants").select("id, slug, name, active, owner_user_id").order("name"),
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
    // 1) the restaurant row (id auto-uuid, active).
    const rest = await sb.from("restaurants").insert({ slug, name, active: true }).select("id, slug, name").single();
    if (rest.error) return bad(rest.error.message, 500);
    const rid = rest.data.id as string;
    // 2) its settings row — clone #1 as a template, then override id/restaurant_id/enabled_panels
    //    and start with a modest table_count (a new restaurant shouldn't inherit #1's big floor).
    const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RID).maybeSingle();
    // cleanClonedSettings strips #1's tenant-specific identity/geo/tax (and sets table_count:10)
    // so a new restaurant never inherits #1's invoice name/GSTIN or café geofence coordinates.
    const baseRow = cleanClonedSettings(template.data);
    const settingsRow = { ...baseRow, id: slug, restaurant_id: rid, enabled_panels: panels };
    const setRes = await sb.from("settings").upsert(settingsRow, { onConflict: "restaurant_id" });
    if (setRes.error) return bad(setRes.error.message, 500);
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
    for (const panel of ["manager", "kitchen", "tablet", "owner"] as const) {
      if (!panels[panel]) continue;
      const pw = genPassword();
      const ins = await sb.from("staff_users")
        .insert({ username: panel, name: `${name} ${panel}`, role: panel, restaurant_id: rid, password_hash: await hashSecret(pw), active: true })
        .select("id").single();
      if (ins.error) continue; // don't fail the whole create over one login; report what we made
      logins.push({ panel, role: panel, username: panel, password: pw });
      if (panel === "owner") {
        await sb.from("restaurants").update({ owner_user_id: ins.data.id }).eq("id", rid);
        await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: ins.data.id }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
      }
    }
    const onPanels = (Object.keys(panels) as (keyof typeof panels)[]).filter((k) => panels[k]);
    await logAction("admin", "restaurant_create", { actor: "admin", detail: `created restaurant "${name}" (${slug}) · panels ${onPanels.join("+")}${seedMenu ? (menuSeeded ? " · menu seeded" : " · menu seed FAILED") : " · no menu"}` });
    return ok({ ok: true, id: rid, slug, name, panels, logins, menuSeeded, seedError });
  }

  if (action !== "create_owner") return bad("Unknown action.");
  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (key.length < 2) return bad("Name must be at least 2 characters.");
  // An owner's "home" restaurant_id is #1; their OWNED restaurants come from
  // restaurants.owner_user_id (assigned via PATCH). Names are unique per-restaurant,
  // so clash-check owners within #1.
  const dup = (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", DEFAULT_RID).limit(1)).data?.[0];
  if (dup) return bad("That owner name is taken — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const { data, error } = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: DEFAULT_RID, password_hash: await hashSecret(password), active: true })
    .select("id, name").single();
  if (error) return bad(error.message, 500);
  await logAction("admin", "owner_create", { actor: "admin", detail: `created owner "${display}" · id ${data!.id}` });
  return ok({ ok: true, id: data!.id, name: display, password });
}
