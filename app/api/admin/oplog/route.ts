// GET /api/admin/oplog — recent staff actions across all panels, for the admin's
// "Recent activity" feed (the combined who-did-what view). Admin-gated.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // ?limit lets the Overview feed ask for a few (30) and the Logs page ask for more
  // (up to 200). The admin sees ALL panels including admin actions (unlike the manager).
  const limit = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("limit") || "30", 10) || 30, 1), 200);
  const r = await sb.from("staff_actions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ actions: r.data ?? [] });
}
