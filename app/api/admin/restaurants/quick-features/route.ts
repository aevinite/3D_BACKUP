// Admin quick on/off for a restaurant's MAIN operational features, surfaced in the restaurant
// detail panel (owner 2026-07-25) as a shortcut so you don't have to open the full Access screen
// for the common ones. Currently: banquet billing + auto-print KOT.
//
// SINGLE SOURCE OF TRUTH: this writes the SAME settings columns the Access screen reads, so the
// two are automatically linked — flip it here and the Access screen shows it, and vice-versa.
// There's no copy to keep in sync; there is only one underlying value per feature.
//
// The toggle shows/sets the EFFECTIVE state (is the feature actually live for staff), matching
// how the app itself decides:
//   banquet         = banquet_allowed AND (NOT banquet_owner_control OR banquet_enabled)   (moduleLadder)
//   auto_print_kot  = auto_print_kot_allowed AND auto_print_kot                            (kitchen route)
// Turning ON writes the columns that guarantee "effective on"; turning OFF drops the admin
// entitlement (<x>_allowed=false), which makes it effective-off regardless of the lower rungs.
// Admin-gated, service role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const SELECT = "banquet_allowed, banquet_owner_control, banquet_enabled, auto_print_kot_allowed, auto_print_kot, takeaway_allowed, takeaway_owner_control, takeaway_enabled, payroll_allowed, payroll_owner_control, payroll_enabled";
type Row = Record<string, unknown> | null;
const effective = (s: Row) => ({
  // moduleLadder formula (lib/tableTags.ts): enabled defaults to true unless explicitly false.
  banquet: s?.banquet_allowed === true && (s?.banquet_owner_control !== true || s?.banquet_enabled !== false),
  // kitchen route: autoPrintKot = auto_print_kot && auto_print_kot_allowed.
  auto_print_kot: s?.auto_print_kot_allowed === true && s?.auto_print_kot === true,
  // Platform board — same moduleLadder formula (mig 209). takeaway_* = PLATFORMS only
  // (Zomato / Swiggy / own website). The counter parcel is a DIFFERENT feature on parcel_*
  // (mig 259) and is not a quick switch — it lives in Access → Main features.
  platform: s?.takeaway_allowed === true && (s?.takeaway_owner_control !== true || s?.takeaway_enabled !== false),
  // Staff profiles & pay — same moduleLadder formula (mig 220).
  payroll: s?.payroll_allowed === true && (s?.payroll_owner_control !== true || s?.payroll_enabled !== false),
});

// The column writes that make each feature effective-ON or effective-OFF.
const PATCH: Record<string, { on: Record<string, boolean>; off: Record<string, boolean> }> = {
  // ON: allow it AND set enabled true, so it's live even if the owner holds the switch. OFF: drop the entitlement.
  banquet: { on: { banquet_allowed: true, banquet_enabled: true }, off: { banquet_allowed: false } },
  // ON: allow it AND turn the capability on. OFF: drop the entitlement (kitchen then won't auto-print).
  auto_print_kot: { on: { auto_print_kot_allowed: true, auto_print_kot: true }, off: { auto_print_kot_allowed: false } },
  // Platform board — ON: allow + enabled; OFF: drop the entitlement (delivery side of the board
  // hidden, webhooks refused). Writes takeaway_* (mig 235's column name); it does NOT touch the
  // counter parcel, which keeps its tiles and its half of the board (mig 259).
  platform: { on: { takeaway_allowed: true, takeaway_enabled: true }, off: { takeaway_allowed: false } },
  // Staff profiles & pay — ON: allow + enabled; OFF: drop the entitlement, which hides profiles,
  // salary records and the performance report everywhere and makes the server refuse them too.
  payroll: { on: { payroll_allowed: true, payroll_enabled: true }, off: { payroll_allowed: false } },
};

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const row = await sb.from("settings").select(SELECT).eq("restaurant_id", rid).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  return NextResponse.json(effective(row.data as Row));
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rid = body?.restaurant_id;
  const feature = String(body?.feature || "");
  const on = body?.on === true;
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  if (!PATCH[feature]) return NextResponse.json({ error: "unknown feature" }, { status: 400 });

  const patch = on ? PATCH[feature].on : PATCH[feature].off;
  const rest = await sb.from("restaurants").select("id, slug").eq("id", rid).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  if (cur.data) {
    const r = await sb.from("settings").update(patch).eq("restaurant_id", rid).select(SELECT).maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    await logAction("admin", "quick_feature", { detail: `${feature} → ${on ? "on" : "off"}`, restaurant_id: rid });
    return NextResponse.json(effective(r.data as Row));
  }
  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied, then apply.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data);
  const newRow = { ...base, id: rest.data.slug, restaurant_id: rid, ...patch };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select(SELECT).maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  await logAction("admin", "quick_feature", { detail: `${feature} → ${on ? "on" : "off"}`, restaurant_id: rid });
  return NextResponse.json(effective(ins.data as Row));
}
