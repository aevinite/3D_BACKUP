// Admin entitlements for STAFF-side features (owner 2026-06-30). Sibling of the guest
// /features and /panels admin routes, but for staff-operational toggles the ADMIN grants a
// restaurant. Currently: auto_print_kot_allowed (lets the restaurant's owner turn on
// auto-printing KOTs). Stored as real boolean COLUMNS on the settings row (mig 107), scoped
// by restaurant_id. The owner's own on/off (auto_print_kot) lives in the manager settings; the
// kitchen prints only when BOTH are true. Admin-gated, service role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";

export const dynamic = "force-dynamic";

// The staff-feature ENTITLEMENT columns the admin may flip (all default false = off).
const STAFF_FEATURE_KEYS = ["auto_print_kot_allowed", "banquet_allowed"];

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });

  const row = await sb.from("settings").select(STAFF_FEATURE_KEYS.join(", ")).eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  const flags: Record<string, boolean> = {};
  for (const k of STAFF_FEATURE_KEYS) flags[k] = !!(row.data as Record<string, unknown> | null)?.[k];
  return NextResponse.json({ flags, hasSettings: !!row.data });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { restaurant_id, key, value } = await req.json().catch(() => ({}));
  if (!isUuid(restaurant_id)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  if (!STAFF_FEATURE_KEYS.includes(key)) return NextResponse.json({ error: "unknown staff feature" }, { status: 400 });

  const rest = await sb.from("restaurants").select("id, slug").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  if (cur.data) {
    const r = await sb.from("settings").update({ [key]: value === true }).eq("restaurant_id", restaurant_id).select(STAFF_FEATURE_KEYS.join(", ")).maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    const flags: Record<string, boolean> = {};
    for (const k of STAFF_FEATURE_KEYS) flags[k] = !!(r.data as Record<string, unknown> | null)?.[k];
    return NextResponse.json({ flags });
  }

  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied
  // (mirrors the features/panels routes), then set id/restaurant_id + the flag.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data); // strip #1's identity/geo/tax so they don't leak into the new restaurant
  const newRow = { ...base, id: rest.data.slug, restaurant_id, [key]: value === true };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select(STAFF_FEATURE_KEYS.join(", ")).maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  const flags: Record<string, boolean> = {};
  for (const k of STAFF_FEATURE_KEYS) flags[k] = !!(ins.data as Record<string, unknown> | null)?.[k];
  return NextResponse.json({ flags, created: true });
}
