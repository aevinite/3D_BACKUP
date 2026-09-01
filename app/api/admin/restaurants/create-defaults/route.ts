// GET /api/admin/restaurants/create-defaults — the remembered "New restaurant" setup
// (panels + sample-menu + access ladder) the admin last used, so the create form can
// auto-fill from it. Written by the create_restaurant action (app/api/admin/restaurants).
// Returns { defaults: null } the first time (no row yet) → form uses system defaults.
// Admin-gated; service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";
const CREATE_DEFAULTS_KEY = "restaurant_creation_defaults";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // `defaults: null` means "nothing remembered yet" and the form falls back to system defaults — which
  // is right for a missing row and WRONG for a failed read: the admin's remembered setup (panels +
  // sample menu) silently reverts, they don't notice, and the next restaurant is created on the wrong
  // shape. The two states are told apart now (T20 sweep #7, 2026-08-27); a retry is cheap and this
  // route is called once, when the form opens.
  const row = await sb.from("app_config").select("value").eq("key", CREATE_DEFAULTS_KEY).maybeSingle();
  if (row.error) return adminFail("the remembered new-restaurant setup", row.error, { action: "load" });
  return NextResponse.json({ defaults: (row.data?.value as unknown) ?? null });
}
