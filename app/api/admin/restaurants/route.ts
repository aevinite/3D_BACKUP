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
    sb.from("settings").select("restaurant_id"),
    sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true).order("name"),
  ]);
  if (restQ.error) return bad(restQ.error.message, 500);
  const withSettings = new Set((setQ.data || []).map((r) => r.restaurant_id).filter(Boolean));
  const owners = (ownersQ.data || []).map((o) => ({ id: o.id, name: o.name || o.username }));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    ownerName: r.owner_user_id ? (ownerName.get(r.owner_user_id) || "—") : null,
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
  if (String(body?.action || "") !== "create_owner") return bad("Unknown action.");
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
