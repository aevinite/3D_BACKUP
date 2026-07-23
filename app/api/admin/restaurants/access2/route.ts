// GET/POST /api/admin/restaurants/access2?restaurant_id=… — the SINGLE read/write
// endpoint for the redesigned access panel (design #1). It returns/accepts the WHOLE
// access ladder in one call, mapped through lib/accessModel.ts onto the existing
// canonical storage so the app's proven enforcement applies the moment it saves:
//   settings.features · settings.enabled_panels · settings.tablet_* · module ladders ·
//   auto_print_kot_allowed · restaurants.manager_permissions · owner_entitlements ·
//   restaurants.access_config (new granular sub-options only).
// Sibling of the existing /access route — that one is left untouched. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { mergeOwnerEntitlements } from "@/lib/ownerEntitlements";
import { PERMISSIONS, GROUPS } from "@/lib/accessModel";

export const dynamic = "force-dynamic";

// Guest-feature defaults (mirror lib/features.ts FEATURE_DEFAULTS — kept inline so this
// server route never imports the React-y features hook module).
const FEATURE_DEFAULTS: Record<string, boolean> = {
  ratings: true, reviews: true, model3d: true, allergies: true, favorites: true,
  waiter_calls: true, diet_filter: true, languages: true, currency: true, scrollspy: true,
};
const PANEL_KEYS = ["manager", "kitchen", "tablet", "owner"] as const;
const FEATURE_KEYS = PERMISSIONS.filter((p) => p.feature).map((p) => p.feature!) as string[];
const SECTION_KEYS = PERMISSIONS.filter((p) => p.section).map((p) => p.section!) as string[];
const POWER_KEYS = PERMISSIONS.filter((p) => p.power).map((p) => p.power!) as string[];
const TABLET_COLS = PERMISSIONS.filter((p) => p.tablet && !p.tabletNew).map((p) => p.tablet!) as string[];
const ADMIN_SWITCH_COLS = PERMISSIONS.filter((p) => p.adminSwitch).map((p) => p.adminSwitch!) as string[];
const MODULES = Array.from(new Set(PERMISSIONS.filter((p) => p.module).map((p) => JSON.stringify(p.module))))
  .map((s) => JSON.parse(s) as { allowed: string; control: string; enabled: string });
const MODULE_COLS = MODULES.flatMap((m) => [m.allowed, m.control, m.enabled]);
const moduleName = (allowedCol: string) => allowedCol.replace("_allowed", "");

// Every settings column this route touches (for the select + a safe upsert).
const SETTINGS_COLS = ["features", "enabled_panels", ...TABLET_COLS, ...MODULE_COLS, ...ADMIN_SWITCH_COLS];

const isTri = (v: unknown): v is "off" | "on" | "pin" => v === "off" || v === "on" || v === "pin";
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function gate(req: NextRequest) { return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value); }

export async function GET(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!uuid(rid)) return bad("Invalid restaurant_id.");

  const rq = await sb.from("restaurants").select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle();
  if (rq.error) return bad(rq.error.message, 500);
  if (!rq.data) return bad("Restaurant not found.", 404);
  const r = rq.data as Record<string, any>;
  const s = (await sb.from("settings").select(SETTINGS_COLS.join(", ")).eq("restaurant_id", rid).maybeSingle()).data as Record<string, any> | null;

  const featOverrides = (s?.features && typeof s.features === "object") ? s.features : {};
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) features[k] = k in featOverrides ? featOverrides[k] === true : (FEATURE_DEFAULTS[k] ?? true);

  const ep = (s?.enabled_panels && typeof s.enabled_panels === "object") ? s.enabled_panels : {};
  const panels: Record<string, boolean> = {};
  for (const k of PANEL_KEYS) panels[k] = ep[k] !== false; // absent = on

  const tablet: Record<string, string> = {};
  for (const k of TABLET_COLS) tablet[k] = isTri(s?.[k]) ? s![k] : (k === "tablet_take_orders" ? "on" : "off");

  const modules: Record<string, { allowed: boolean; control: boolean; enabled: boolean }> = {};
  for (const m of MODULES) modules[moduleName(m.allowed)] = {
    allowed: s?.[m.allowed] === true, control: s?.[m.control] === true, enabled: s?.[m.enabled] !== false,
  };

  const adminSwitches: Record<string, boolean> = {};
  for (const k of ADMIN_SWITCH_COLS) adminSwitches[k] = s?.[k] === true;

  return NextResponse.json({
    groups: GROUPS,
    features,
    panels,
    owner: mergeOwnerEntitlements(r.owner_entitlements),
    manager: (r.manager_permissions && typeof r.manager_permissions === "object") ? r.manager_permissions : {},
    tablet,
    modules,
    adminSwitches,
    config: (r.access_config && typeof r.access_config === "object") ? r.access_config : {},
  });
}

export async function POST(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  let body: Record<string, any> = {}; try { body = await req.json(); } catch {}
  const rid = String(body.restaurant_id || "");
  if (!uuid(rid)) return bad("Invalid restaurant_id.");
  const exists = (await sb.from("restaurants").select("id").eq("id", rid).maybeSingle()).data;
  if (!exists) return bad("Restaurant not found.", 404);

  const patch = body.patch && typeof body.patch === "object" ? body.patch : body;

  // ---- restaurants columns (owner_entitlements / manager_permissions / access_config) ----
  const restUpdate: Record<string, any> = {};
  if (patch.owner && typeof patch.owner === "object") {
    const cur = (await sb.from("restaurants").select("owner_entitlements").eq("id", rid).maybeSingle()).data?.owner_entitlements || {};
    const next: Record<string, boolean> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of Object.keys(patch.owner)) {
      if (SECTION_KEYS.includes(k) || POWER_KEYS.map((f) => `power_${f}`).includes(k)) next[k] = patch.owner[k] === true;
    }
    restUpdate.owner_entitlements = next;
  }
  if (patch.manager && typeof patch.manager === "object") {
    const cur = (await sb.from("restaurants").select("manager_permissions").eq("id", rid).maybeSingle()).data?.manager_permissions || {};
    const next: Record<string, boolean> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of Object.keys(patch.manager)) if (POWER_KEYS.includes(k)) next[k] = patch.manager[k] === true;
    restUpdate.manager_permissions = next;
  }
  if (patch.config && typeof patch.config === "object") {
    const cur = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config || {};
    const merged: Record<string, any> = { ...(typeof cur === "object" ? cur : {}) };
    for (const permId of Object.keys(patch.config)) {
      merged[permId] = { ...(merged[permId] || {}), ...patch.config[permId] };
    }
    restUpdate.access_config = merged;
  }
  if (Object.keys(restUpdate).length) {
    const up = await sb.from("restaurants").update(restUpdate).eq("id", rid);
    if (up.error) return bad(up.error.message, 500);
  }

  // ---- settings columns (features / panels / tablet / modules / adminSwitches) ----
  const setPatch: Record<string, any> = {};
  if (patch.features && typeof patch.features === "object") {
    const cur = (await sb.from("settings").select("features").eq("restaurant_id", rid).maybeSingle()).data?.features || {};
    const next: Record<string, boolean> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of Object.keys(patch.features)) if (FEATURE_KEYS.includes(k)) next[k] = patch.features[k] === true;
    setPatch.features = next;
  }
  if (patch.panels && typeof patch.panels === "object") {
    const cur = (await sb.from("settings").select("enabled_panels").eq("restaurant_id", rid).maybeSingle()).data?.enabled_panels || {};
    const next: Record<string, boolean> = { ...(typeof cur === "object" ? cur : {}) };
    for (const k of Object.keys(patch.panels)) if ((PANEL_KEYS as readonly string[]).includes(k)) next[k] = patch.panels[k] === true;
    setPatch.enabled_panels = next;
  }
  if (patch.tablet && typeof patch.tablet === "object")
    for (const k of Object.keys(patch.tablet)) if (TABLET_COLS.includes(k) && isTri(patch.tablet[k])) setPatch[k] = patch.tablet[k];
  if (patch.modules && typeof patch.modules === "object")
    for (const m of MODULES) {
      const mv = patch.modules[moduleName(m.allowed)];
      if (!mv || typeof mv !== "object") continue;
      if (typeof mv.allowed === "boolean") setPatch[m.allowed] = mv.allowed;
      if (typeof mv.control === "boolean") setPatch[m.control] = mv.control;
      if (typeof mv.enabled === "boolean") setPatch[m.enabled] = mv.enabled;
    }
  if (patch.adminSwitches && typeof patch.adminSwitches === "object")
    for (const k of Object.keys(patch.adminSwitches)) if (ADMIN_SWITCH_COLS.includes(k) && typeof patch.adminSwitches[k] === "boolean") setPatch[k] = patch.adminSwitches[k];

  if (Object.keys(setPatch).length) {
    const existing = (await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle()).data;
    if (existing) {
      const up = await sb.from("settings").update(setPatch).eq("restaurant_id", rid);
      if (up.error) return bad(up.error.message, 500);
    } else {
      const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
      const row = { ...cleanClonedSettings(template.data), id: rid.slice(0, 40), restaurant_id: rid, ...setPatch };
      const up = await sb.from("settings").upsert(row, { onConflict: "restaurant_id" });
      if (up.error) return bad(up.error.message, 500);
    }
  }

  return NextResponse.json({ ok: true });
}
