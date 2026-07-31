// Which staff apps a restaurant has — now a CONSTANT, not a setting (owner, 2026-07-31).
//
//   GET  /api/admin/restaurants/panels?restaurant_id=<uuid>
//        → always all four (manager/kitchen/tablet/owner). Read by the Enter card to decide
//          which doors to offer.
//   POST → 410 Gone. The per-restaurant switches were removed; see the note on the handler.
//
// The old behaviour (a panel switched OFF blocked that role's login) is gone with the switches:
// lib/panelAccess.ts answers all-on whatever settings.enabled_panels still holds, so no restaurant
// can be stranded by a switch that no screen can reach any more. Admin-gated, service role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

const PANELS_DEFAULT: Record<string, boolean> = { manager: true, kitchen: true, tablet: true, owner: true };

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId))
    return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });

  const row = await sb.from("settings").select("enabled_panels").eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });

  // ALL FOUR, ALWAYS (owner, 2026-07-31: "remove it completely, all panels always on"). The stored
  // overrides are deliberately NOT merged in any more: lib/panelAccess.ts answers all-on whatever is
  // stored, and the only caller left is the Enter card deciding which doors to offer. Merging a stale
  // `false` would hide a door into a panel that actually opens — the screen disagreeing with the gate.
  return NextResponse.json({ panels: { ...PANELS_DEFAULT }, hasSettings: !!row.data });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // REFUSED, on purpose. The four staff-app switches were removed (owner, 2026-07-31: "remove it
  // completely, all panels always on") and the login gate now answers all-on whatever is stored — so
  // a write here would save a value that changes NOTHING while looking like it worked. A control
  // that silently does nothing is worse than no control, so this says so out loud. The whole route
  // can go once the Enter card stops calling its GET.
  return NextResponse.json({
    error: "Staff apps are always on for every restaurant now — this switch was removed and has no effect.",
  }, { status: 410 });
}
