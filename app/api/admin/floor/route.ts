// GET /api/admin/floor — the live floor, straight from the ONE brain.
//
// This calls lfh_floor_state() (migration 041), which decides every table's
// status in one place. Because every staff/admin screen reads THIS, they can
// never disagree. Runs on the server with the service-role key (the function is
// staff-only / revoked from the public key).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

// Always fetch fresh — the floor is live, never cached.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.rpc("lfh_floor_state");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // lfh_floor_state returns a JSON array of per-table objects.
  return NextResponse.json({ tables: data ?? [] });
}
