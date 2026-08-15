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
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const SELECT = "banquet_allowed, banquet_owner_control, banquet_enabled, auto_print_kot_allowed, auto_print_kot, payroll_allowed, payroll_owner_control, payroll_enabled";
type Row = Record<string, unknown> | null;
const effective = (s: Row) => ({
  // moduleLadder formula (lib/tableTags.ts): enabled defaults to true unless explicitly false.
  banquet: s?.banquet_allowed === true && (s?.banquet_owner_control !== true || s?.banquet_enabled !== false),
  // kitchen route: autoPrintKot = auto_print_kot && auto_print_kot_allowed.
  auto_print_kot: s?.auto_print_kot_allowed === true && s?.auto_print_kot === true,
  // (No `platform` key any more — the parcel/delivery board became ONE PERMANENT feature on
  //  2026-08-03, so there is nothing to quick-switch. A quick toggle for something that cannot
  //  be off is the dead switch this screen's rebuild exists to remove. The delivery CHANNELS
  //  are still switchable, under Access → Main features → Parcel & delivery platforms.)
  // Staff profiles & pay — same moduleLadder formula (mig 220).
  payroll: s?.payroll_allowed === true && (s?.payroll_owner_control !== true || s?.payroll_enabled !== false),
});

// The column writes that make each feature effective-ON or effective-OFF.
const PATCH: Record<string, { on: Record<string, boolean>; off: Record<string, boolean> }> = {
  // ON: allow it AND set enabled true, so it's live even if the owner holds the switch. OFF: drop the entitlement.
  banquet: { on: { banquet_allowed: true, banquet_enabled: true }, off: { banquet_allowed: false } },
  // ON: allow it AND turn the capability on. OFF: drop the entitlement (kitchen then won't auto-print).
  auto_print_kot: { on: { auto_print_kot_allowed: true, auto_print_kot: true }, off: { auto_print_kot_allowed: false } },
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
  if (row.error) return adminFail("this restaurant's features", row.error, { action: "load" });
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
  if (rest.error) return adminFail("this restaurant's features", rest.error, { action: "save" });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle();
  if (cur.error) return adminFail("this restaurant's features", cur.error, { action: "save" });

  if (cur.data) {
    const r = await sb.from("settings").update(patch).eq("restaurant_id", rid).select(SELECT).maybeSingle();
    if (r.error) return adminFail("this restaurant's features", r.error, { action: "save" });
    await logAction("admin", "quick_feature", { detail: `${feature} → ${on ? "on" : "off"}`, restaurant_id: rid });
    return NextResponse.json(effective(r.data as Row));
  }
  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied, then apply.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data);
  // Keyed by the restaurant id, not its slug — same reason as the create route (T20, 2026-08-16):
  // `settings.id` is a primary key and a binned restaurant keeps its row, so a slug that is free in
  // `restaurants` can still be taken in `settings`.
  const newRow = { ...base, id: rid, restaurant_id: rid, ...patch };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select(SELECT).maybeSingle();
  if (ins.error) return adminFail("this restaurant's features", ins.error, { action: "save" });
  await logAction("admin", "quick_feature", { detail: `${feature} → ${on ? "on" : "off"}`, restaurant_id: rid });
  return NextResponse.json(effective(ins.data as Row));
}
