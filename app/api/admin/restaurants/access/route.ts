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
import { OWNER_ENTITLEMENT_KEYS, mergeOwnerEntitlements } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

// The five manager powers (restaurants.manager_permissions) + their safe defaults.
const MANAGER_POWERS = ["manage_staff", "edit_menu", "give_discounts", "view_dashboard", "void_bills"] as const;
const MP_DEFAULT: Record<string, boolean> = { manage_staff: false, edit_menu: true, give_discounts: true, view_dashboard: true, void_bills: false };
// The three tablet billing capabilities (settings.*), tri-state off|on|pin.
const TABLET_CAPS = ["tablet_discount", "tablet_mark_paid", "tablet_invoice"] as const;
const isTri = (v: unknown): v is "off" | "on" | "pin" => v === "off" || v === "on" || v === "pin";

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

async function gate(req: NextRequest) { return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value); }

export async function GET(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("restaurant_id required");
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data;
  const s = (await sb.from("settings").select("tablet_discount, tablet_mark_paid, tablet_invoice").eq("restaurant_id", rid).maybeSingle()).data as Record<string, string> | null;
  const manager = { ...MP_DEFAULT, ...(r?.manager_permissions && typeof r.manager_permissions === "object" ? r.manager_permissions : {}) };
  const tablet: Record<string, string> = {};
  for (const k of TABLET_CAPS) tablet[k] = isTri(s?.[k]) ? (s![k] as string) : "off";
  return NextResponse.json({ manager, tablet, owner: mergeOwnerEntitlements(r?.owner_entitlements) });
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
    const next: Record<string, boolean> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of OWNER_ENTITLEMENT_KEYS) if (k in (body.owner as object)) next[k] = (body.owner as Record<string, unknown>)[k] === true;
    const up = await sb.from("restaurants").update({ owner_entitlements: next }).eq("id", rid);
    if (up.error) return bad(up.error.message, 500);
  }

  // Tablet caps → settings tri-states (upsert; clone #1's row cleanly if this restaurant has none).
  if (body.tablet && typeof body.tablet === "object") {
    const patch: Record<string, string> = {};
    for (const k of TABLET_CAPS) { const v = (body.tablet as Record<string, unknown>)[k]; if (isTri(v)) patch[k] = v; }
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
