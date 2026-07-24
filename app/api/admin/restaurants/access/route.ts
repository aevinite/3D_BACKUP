// GET/POST /api/admin/restaurants/access?restaurant_id=… — the admin's per-restaurant
// ACCESS controls that don't already have their own route: the manager powers
// (restaurants.manager_permissions), the tablet billing tri-states
// (settings.tablet_discount / tablet_mark_paid / tablet_invoice), and the OWNER
// entitlements (restaurants.owner_entitlements, mig 133 — which owner-panel sections
// and manager-power toggles even exist for this restaurant). Panels + guest features
// keep their existing routes (panels, features); this route is how the admin console
// "toggles every access bit" of the ladder. Admin-gated; service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { OWNER_ENTITLEMENT_KEYS, mergeOwnerEntitlements, MANAGER_POWER_FLAGS } from "@/lib/ownerEntitlements";
// CANONICAL access lists live in lib/accessConfig so the create-restaurant flow and this
// editor can never drift (they used to each carry their own copy — audit 2026-07-09).
import { TABLET_CAPS, FEATURE_SWITCHES, MP_DEFAULT, isTri } from "@/lib/accessConfig";

export const dynamic = "force-dynamic";

const MANAGER_POWERS = MANAGER_POWER_FLAGS;

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

async function gate(req: NextRequest) { return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value); }

export async function GET(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("restaurant_id required");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) return bad("Invalid restaurant_id.");
  // Check the read actually succeeded AND the restaurant exists — swallowing the error and
  // returning HTTP 200 with all-default toggles for a bad/unknown id was misleading (it
  // looked like a real restaurant with no permissions granted; audit 2026-07-06).
  const rq = await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle();
  if (rq.error) return bad(rq.error.message, 500);
  if (!rq.data) return bad("Restaurant not found.", 404);
  const r = rq.data;
  const s = (await sb.from("settings").select("tablet_discount, tablet_mark_paid, tablet_invoice, tablet_banquet, tablet_table_tags, tablet_khata, tablet_table_ops, tablet_take_orders, table_tags_allowed, table_tags_owner_control, table_tags_enabled, banquet_allowed, banquet_owner_control, banquet_enabled, table_ops_allowed, table_ops_owner_control, table_ops_enabled, take_orders_allowed, take_orders_owner_control, take_orders_enabled").eq("restaurant_id", rid).maybeSingle()).data as Record<string, unknown> | null;
  const manager = { ...MP_DEFAULT, ...(r?.manager_permissions && typeof r.manager_permissions === "object" ? r.manager_permissions : {}) };
  const tablet: Record<string, string> = {};
  for (const k of TABLET_CAPS) tablet[k] = isTri(s?.[k]) ? (s![k] as string) : "off";
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_SWITCHES) features[k] = s?.[k] === true;
  features.table_tags_enabled = s?.table_tags_enabled !== false; // the owners' toggles, shown read-only
  features.banquet_enabled = s?.banquet_enabled !== false;
  features.table_ops_enabled = s?.table_ops_enabled !== false;
  features.take_orders_enabled = s?.take_orders_enabled !== false;
  return NextResponse.json({ manager, tablet, owner: mergeOwnerEntitlements(r?.owner_entitlements), features });
}

export async function POST(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch {}
  const rid = String(body.restaurant_id || "");
  if (!rid) return bad("restaurant_id required");
  const r = (await sb.from("restaurants").select("id").eq("id", rid).maybeSingle()).data;
  if (!r) return bad("restaurant not found", 404);

  // Manager powers → restaurants.manager_permissions (merge only known boolean keys).
  if (body.manager && typeof body.manager === "object") {
    const cur = (await sb.from("restaurants").select("manager_permissions").eq("id", rid).maybeSingle()).data?.manager_permissions || {};
    const next: Record<string, boolean> = { ...MP_DEFAULT, ...cur };
    for (const k of MANAGER_POWERS) if (k in (body.manager as object)) next[k] = (body.manager as Record<string, unknown>)[k] === true;
    const up = await sb.from("restaurants").update({ manager_permissions: next }).eq("id", rid).select("manager_permissions");
    if (up.error) return bad(up.error.message, 500);
  }

  // Owner entitlements → restaurants.owner_entitlements (merge only known boolean keys).
  // Storing only explicit booleans keeps "absent = on" true for keys added later.
  if (body.owner && typeof body.owner === "object") {
    const cur = (await sb.from("restaurants").select("owner_entitlements").eq("id", rid).maybeSingle()).data?.owner_entitlements || {};
    const next: Record<string, unknown> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of OWNER_ENTITLEMENT_KEYS) if (k in (body.owner as object)) next[k] = (body.owner as Record<string, unknown>)[k] === true;
    const up = await sb.from("restaurants").update({ owner_entitlements: next }).eq("id", rid);
    if (up.error) return bad(up.error.message, 500);
  }

  // Tablet caps + feature-ladder switches → settings (upsert; clone #1's row cleanly if none).
  if ((body.tablet && typeof body.tablet === "object") || (body.features && typeof body.features === "object")) {
    const patch: Record<string, string | boolean> = {};
    if (body.tablet && typeof body.tablet === "object")
      for (const k of TABLET_CAPS) { const v = (body.tablet as Record<string, unknown>)[k]; if (isTri(v)) patch[k] = v; }
    if (body.features && typeof body.features === "object")
      for (const k of FEATURE_SWITCHES) { const v = (body.features as Record<string, unknown>)[k]; if (typeof v === "boolean") patch[k] = v; }
    if (Object.keys(patch).length) {
      const existing = (await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle()).data;
      if (existing) {
        const up = await sb.from("settings").update(patch).eq("restaurant_id", rid);
        if (up.error) return bad(up.error.message, 500);
      } else {
        const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
        const row = { ...cleanClonedSettings(template.data), id: rid.slice(0, 40), restaurant_id: rid, ...patch };
        const up = await sb.from("settings").upsert(row, { onConflict: "restaurant_id" });
        if (up.error) return bad(up.error.message, 500);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
