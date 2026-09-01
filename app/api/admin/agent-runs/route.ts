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
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" — lib/readGuard (item 15, owner-approved
// 2026-09-01). One retry on a transient connection failure, one log line naming WHICH read went, and
// a tolerated read that says so at the call site.
import { ReadSet, rd } from "@/lib/readGuard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const reads = new ReadSet("admin/agent-runs", [await rd("runs", () => sb.from("agent_runs")
    .select("id, kind, title, request_id, status, report, started_at, ended_at")
    .order("started_at", { ascending: false })
    .limit(30))]);
  if (reads.failed("runs")) return adminFail("the working-session history", reads.error("runs"), { action: "load" });
  return NextResponse.json({ runs: reads.rows("runs") });
}
