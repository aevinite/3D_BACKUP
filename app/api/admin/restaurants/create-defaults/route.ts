// GET /api/admin/restaurants/create-defaults — the remembered "New restaurant" setup
// (panels + sample-menu + access ladder) the admin last used, so the create form can
// auto-fill from it. Written by the create_restaurant action (app/api/admin/restaurants).
// Returns { defaults: null } the first time (no row yet) → form uses system defaults.
// Admin-gated; service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const CREATE_DEFAULTS_KEY = "restaurant_creation_defaults";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = (await sb.from("app_config").select("value").eq("key", CREATE_DEFAULTS_KEY).maybeSingle()).data;
  return NextResponse.json({ defaults: (row?.value as unknown) ?? null });
}
