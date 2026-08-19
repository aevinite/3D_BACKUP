// Admin entitlements for STAFF-side features (owner 2026-06-30). Sibling of the guest
// /features and /panels admin routes, but for staff-operational toggles the ADMIN grants a
// restaurant. Currently: auto_print_kot_allowed (lets the restaurant's owner turn on
// auto-printing KOTs). Stored as real boolean COLUMNS on the settings row (mig 107), scoped
// by restaurant_id. The owner's own on/off (auto_print_kot) lives in the manager settings; the
// kitchen prints only when BOTH are true. Admin-gated, service role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { logAction, deviceIdFrom } from "@/lib/oplog";

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
  if (row.error) return adminFail("this restaurant's staff features", row.error, { action: "load" });
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

  // A FEATURE FLIP IS AUDITED (sweep 2026-08-04). These three routes wrote a per-restaurant switch
  const audit = () => logAction("admin", "staff_feature", {
    restaurant_id: restaurant_id as string, device_id: deviceIdFrom(req),
    detail: `staff feature "${key}" → ${value === true ? "on" : "off"}`,
  });
  const rest = await sb.from("restaurants").select("id").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return adminFail("this restaurant's staff features", rest.error, { action: "save" });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return adminFail("this restaurant's staff features", cur.error, { action: "save" });

  if (cur.data) {
    const r = await sb.from("settings").update({ [key]: value === true }).eq("restaurant_id", restaurant_id).select(STAFF_FEATURE_KEYS.join(", ")).maybeSingle();
    if (r.error) return adminFail("this restaurant's staff features", r.error, { action: "save" });
    await audit();
    const flags: Record<string, boolean> = {};
    for (const k of STAFF_FEATURE_KEYS) flags[k] = !!(r.data as Record<string, unknown> | null)?.[k];
    return NextResponse.json({ flags });
  }

  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied
  // (mirrors the features/panels routes), then set id/restaurant_id + the flag.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data); // strip #1's identity/geo/tax so they don't leak into the new restaurant
  // THE SETTINGS ROW IS KEYED BY THE RESTAURANT'S OWN ID, NOT ITS SLUG (T20 sweep, 2026-08-19).
  // `settings.id` is that table's PRIMARY KEY (mig 003). Migration 319 frees a restaurant's slug the
  // moment it goes to the recycle bin — but a binned restaurant KEEPS its settings row, so a slug can
  // be free in `restaurants` and still taken in `settings`. Keyed by slug, the upsert below (whose
  // conflict target is restaurant_id, not id) would then hit `settings_pkey` and hand the admin a raw
  // "duplicate key value violates unique constraint" for flipping a switch. The uuid cannot collide,
  // and nothing anywhere looks a settings row up by slug — every read is `.eq("restaurant_id", …)`
  // except the four legacy `id='site'` reads, which are restaurant #1's own row.
  //
  // The create route and the quick-features route were both given this on 2026-08-16 and these were
  // left on the old key. Unreachable today (every restaurant on both stacks has a settings row, so
  // this clone branch never runs) — closed now because the symptom is a database sentence on his
  // screen, and it is invisible until the day it happens.
  const newRow = { ...base, id: restaurant_id, restaurant_id, [key]: value === true };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select(STAFF_FEATURE_KEYS.join(", ")).maybeSingle();
  if (ins.error) return adminFail("this restaurant's staff features", ins.error, { action: "save" });
  await audit();
  const flags: Record<string, boolean> = {};
  for (const k of STAFF_FEATURE_KEYS) flags[k] = !!(ins.data as Record<string, unknown> | null)?.[k];
  return NextResponse.json({ flags, created: true });
}
