// Admin · agent-run history — every Claude working session (live pop-up terminal, 02:30 repair
// robot, panel audits), newest first, for admin → Repair → History (owner 2026-07-21: "all
// history should be shown at the admin panel Repair somewhere").
//
// Read-only. Rows come from agent_runs (mig 161, service-role only); the writers are the
// live-fix watcher, scripts/agent-run-record.mjs in the robot shell scripts, and the sessions
// themselves (report). Bounded + explicit columns (egress rule); loads only when the page opens.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await sb.from("agent_runs")
    .select("id, kind, title, request_id, status, report, started_at, ended_at")
    .order("started_at", { ascending: false })
    .limit(30);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ runs: r.data ?? [] });
}
