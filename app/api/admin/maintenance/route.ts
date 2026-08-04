// /api/admin/maintenance — the guest-menu "we'll be right back" screen (settings.service_mode).
//   GET  ?restaurant_id=<uuid> → { maintenance } for ONE restaurant (omit rid = the flagship
//         `id='site'` row for back-compat with the Settings page).
//   POST { on: boolean, restaurant_id?: <uuid> } → flip it. Omit restaurant_id = flagship.
// Admin-gated. Before the write took a restaurant_id, the admin could ONLY control the
// flagship, so when another tenant's menu was in maintenance the Settings toggle showed the
// wrong state and did nothing (audit 2026-07-07). Now it can read/write any restaurant.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rid = new URL(req.url).searchParams.get("restaurant_id");
  if (rid && !isUuid(rid)) return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  const q = rid
    ? await sb.from("settings").select("service_mode").eq("restaurant_id", rid).maybeSingle()
    : await sb.from("settings").select("service_mode").eq("id", "site").maybeSingle();
  if (q.error) return NextResponse.json({ error: q.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (q.data || {}).service_mode === true });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  const rid = typeof body?.restaurant_id === "string" ? body.restaurant_id : null;
  if (rid && !isUuid(rid)) return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  const r = rid
    ? await sb.from("settings").update({ service_mode: on }).eq("restaurant_id", rid).select("service_mode")
    : await sb.from("settings").update({ service_mode: on }).eq("id", "site").select("service_mode");
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  if (!r.data?.length) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
  // Same record as the manager-side route (sweep 2026-08-04) — stopping every guest from ordering
  // must be traceable whichever panel did it. `rid` is null for the legacy flagship row.
  await logAction("admin", on ? "maintenance_on" : "maintenance_off", {
    restaurant_id: rid ?? undefined, actor: "admin", device_id: deviceIdFrom(req),
    detail: on ? "admin took the guest menu OFFLINE" : "admin put the guest menu back online",
  });
  return NextResponse.json({ maintenance: (r.data[0] || {}).service_mode === true });
}
