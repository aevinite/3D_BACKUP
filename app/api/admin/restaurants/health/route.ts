// GET /api/admin/restaurants/health — one-glance activity health for EVERY restaurant,
// for the admin Restaurants list. Wraps lfh_admin_restaurant_health() (migration 146):
// ONE round-trip, aggregated server-side, activity signals only — NO earnings (CLAUDE.md
// hard rule). Admin-cookie gated, service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

type HealthRow = {
  restaurant_id: string;
  last_order_at: string | null;
  orders_24h: number;
  open_issues: number;
  staff_online: number;
};

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin.rpc("lfh_admin_restaurant_health");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ health: (data || []) as HealthRow[] });
}
