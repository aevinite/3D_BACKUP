// Per-restaurant PANEL entitlements for the admin super-panel (owner 2026-06-29).
//
//   GET  /api/admin/restaurants/panels?restaurant_id=<uuid>
//        → the merged enabled-panels map for THAT restaurant (manager/kitchen/tablet/owner,
//          defaults all-ON overlaid with its settings.enabled_panels overrides).
//   POST /api/admin/restaurants/panels  { restaurant_id, panel, enabled }
//        → flip ONE panel on THAT restaurant's settings row.
//
// Panel-axis sibling of /api/admin/restaurants/features. A panel turned OFF blocks that
// role's login (see lib/panelAccess.ts + panel-login + panelGate). Scoped by restaurant_id;
// a restaurant with no settings row yet gets one created (cloned from #1 so every NOT NULL
// column is satisfied — same shape the features route + seeder use). Admin-gated, service role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";

export const dynamic = "force-dynamic";

const PANEL_KEYS = ["manager", "kitchen", "tablet", "owner"];
const PANELS_DEFAULT: Record<string, boolean> = { manager: true, kitchen: true, tablet: true, owner: true };

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Keep only the four known panel keys as honest booleans (a malformed stored value can't
// poison the login gate).
function cleanPanels(stored: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (stored && typeof stored === "object") {
    for (const k of PANEL_KEYS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId))
    return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });

  const row = await sb.from("settings").select("enabled_panels").eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });

  const overrides = cleanPanels(row.data?.enabled_panels);
  const panels = { ...PANELS_DEFAULT, ...overrides };
  return NextResponse.json({ panels, hasSettings: !!row.data });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { restaurant_id, panel, enabled } = await req.json().catch(() => ({}));
  if (!isUuid(restaurant_id))
    return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  if (!PANEL_KEYS.includes(panel))
    return NextResponse.json({ error: "unknown panel" }, { status: 400 });

  const rest = await sb.from("restaurants").select("id, slug").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id, enabled_panels").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  // Merge over the all-ON default so the saved bag always has all four explicit booleans.
  const panels = { ...PANELS_DEFAULT, ...cleanPanels(cur.data?.enabled_panels) };
  panels[panel] = enabled === true;

  if (cur.data) {
    const r = await sb.from("settings").update({ enabled_panels: panels }).eq("restaurant_id", restaurant_id).select("enabled_panels").maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    return NextResponse.json({ panels: { ...PANELS_DEFAULT, ...cleanPanels(r.data?.enabled_panels) } });
  }

  // No settings row yet → clone #1's row as a template (every NOT NULL column satisfied),
  // then override id/restaurant_id/enabled_panels. cleanClonedSettings strips #1's tenant-
  // specific identity/geo/tax so they don't leak into the new restaurant. Mirrors the others.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data);
  const newRow = { ...base, id: rest.data.slug, restaurant_id, enabled_panels: panels };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select("enabled_panels").maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  return NextResponse.json({ panels: { ...PANELS_DEFAULT, ...cleanPanels(ins.data?.enabled_panels) }, created: true });
}
