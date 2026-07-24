// Per-restaurant feature switches for the admin super-panel (Phase 5).
//
//   GET  /api/admin/restaurants/features?restaurant_id=<uuid>
//        → the merged feature map for THAT restaurant (defaults from
//          lib/features.ts overlaid with its settings.features overrides).
//   POST /api/admin/restaurants/features  { restaurant_id, key, value }
//        → flip ONE guest-facing switch on THAT restaurant's settings row.
//
// This is the multi-tenant sibling of /api/admin/features (which is hard-wired to
// the single `id='site'` row). Everything here is scoped by `restaurant_id`, the
// SAME column the guest read path uses (lib/menu.ts getSettings → eq('restaurant_id'),
// lib/features.ts getFeatures), so a write here changes ONLY that restaurant's
// guest menu. A restaurant with no settings row yet gets one created on first
// toggle (cloned from restaurant #1's row so every NOT NULL column is satisfied —
// the same shape the demo seeder uses). Admin-gated, service role.
//
// Only the TEN guest switches (or a chip_<slug> visibility flag) are editable —
// the four backend-only flags (verification/payments/aggregators/gst_invoice)
// stay invisible/by-hand, exactly like the single-tenant handler.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";

export const dynamic = "force-dynamic";

// The ten guest-facing switches editable from the admin UI (same list the
// single-tenant handler allows). The backend-only flags are deliberately absent.
// NOTE: we DON'T import FEATURE_DEFAULTS from lib/features.ts here — that module
// pulls in React hooks (useState/useEffect) and can't load in a server route. All
// ten guest switches default ON, matching FEATURE_DEFAULTS, so we build the
// default map locally from this key list.
const GUEST_FEATURE_KEYS = [
  "ratings", "reviews", "model3d", "allergies", "favorites",
  "waiter_calls", "search", "languages", "currency",
  "diet_filter", // Veg / Non-Veg filter group (off for pure-veg restaurants)
];
const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(GUEST_FEATURE_KEYS.map((k) => [k, true]));

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Keep only honest boolean overrides so a malformed stored value can't poison the
// guest app's gating (mirrors the single-tenant handler + getSettings).
function cleanBooleans(stored: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// GET — the merged feature map (defaults overlaid with this restaurant's saved
// overrides). The UI uses this to show each switch's real ON/OFF state.
export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId))
    return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });

  const row = await sb.from("settings").select("features").eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });

  const overrides = cleanBooleans(row.data?.features);
  // Merge over defaults so every switch has a concrete boolean, exactly like the
  // guest's getFeatures(). hasSettings tells the UI whether a row exists yet.
  const features = { ...FEATURE_DEFAULTS, ...overrides } as Record<string, boolean>;
  return NextResponse.json({ features, overrides, hasSettings: !!row.data });
}

// POST — flip ONE switch on this restaurant's settings row (create the row first
// if it doesn't exist yet).
export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { restaurant_id, key, value } = await req.json().catch(() => ({}));
  if (!isUuid(restaurant_id))
    return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  // Allow the ten guest features OR a menu-chip visibility flag (chip_<slug>).
  if (!GUEST_FEATURE_KEYS.includes(key) && !/^chip_[a-z-]+$/.test(key))
    return NextResponse.json({ error: "unknown or non-editable feature" }, { status: 400 });

  // Make sure the restaurant exists, and grab its slug (used as the settings `id`
  // when we have to create the row — matches the demo seeder's convention).
  const rest = await sb.from("restaurants").select("id, slug").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  // Current settings row for THIS restaurant (one per restaurant_id, migration 079).
  const cur = await sb.from("settings").select("id, features").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  const features = cleanBooleans(cur.data?.features);
  features[key] = value === true;

  if (cur.data) {
    // Row exists → just update its features JSONB, scoped by restaurant_id.
    const r = await sb.from("settings").update({ features }).eq("restaurant_id", restaurant_id).select("features").maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    return NextResponse.json({ features: { ...FEATURE_DEFAULTS, ...(r.data?.features as Record<string, boolean> || features) } });
  }

  // No row yet → clone restaurant #1's row as a template so every NOT NULL column
  // is satisfied (same shape the demo seeder uses), then override id/restaurant_id
  // /features. Falls back to a minimal row if #1 is somehow missing.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data); // strip #1's identity/geo/tax so they don't leak into the new restaurant
  const newRow = { ...base, id: rest.data.slug, restaurant_id, features };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select("features").maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  return NextResponse.json({ features: { ...FEATURE_DEFAULTS, ...(ins.data?.features as Record<string, boolean> || features) }, created: true });
}
