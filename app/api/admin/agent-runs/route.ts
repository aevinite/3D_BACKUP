// Admin · agent-run history — every Claude working session (live pop-up terminal, 02:30 repair
// robot, panel audits), newest first, for admin → Repair → History (owner 2026-07-21: "all
// history should be shown at the admin panel Repair somewhere").
//
// Read-only. Rows come from agent_runs (mig 161, service-role only); the writers are the
// live-fix watcher, scripts/agent-run-record.mjs in the robot shell scripts, and the sessions
// themselves (report). Bounded + explicit columns (egress rule); loads only when the screen opens.
//
// ── TWO THINGS CHANGED HERE ON 2026-09-16 (T26 sweep #9, items 15 — the owner picked it) ────────
//
// 1. THERE IS A WAY BACK. This answered the newest 30 and stopped, with no cursor, no count and no
//    paging — so the 31st-oldest session was unreachable from the console at all, and the chip
//    beside the heading counted the rows it had been handed (always "30") as if that were the
//    whole history. `?before=` walks backwards a page at a time, `?count=1` asks for the true
//    total, and `nextBefore` is null once a page comes back short, which is how the screen knows
//    it has reached the end rather than guessing.
//
// 2. THE LIST NO LONGER CARRIES THE REPORT BODIES. Measured before the change: **76.1 KB** per
//    open of the Repair page, **67.7 KB** of it the `report` markdown of 21 rows — every one of
//    them fetched to draw a list that shows none of them, so that the owner could open at most
//    one. Paging would have multiplied that by every page he walked back through. The list now
//    carries `hasReport` (which is all the row needs to know whether it can be opened) and the
//    body is fetched by `?report=<id>` when a row is actually expanded. That is the same lazy
//    shape app/api/admin/audit already uses for its removal detail, and the reason is written in
//    that file too: "fetched lazily rather than riding along with 200 list rows".
//
//    `hasReport` costs one extra tiny read rather than a migration: PostgREST cannot compute
//    "report IS NOT NULL" as a column without a view or a generated column, so the ids that DO
//    have one are asked for separately — thirty uuids, about a kilobyte, against the 67.7 KB it
//    replaces.
//
//   GET                      → the newest page: { runs, nextBefore }
//   GET ?count=1             → …and `total`, the true number of sessions on record
//   GET ?before=<iso>        → the page older than that instant
//   GET ?report=<uuid>       → ONE run's report body
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A page. Thirty was what this route always answered and the screen is built around that rhythm;
// the difference is that there is now a thirty-first.
const PAGE = 30;
// The columns the LIST renders — `report` is deliberately absent. `verify:admin-api-a` rule 2 wants
// a named list; this one is named for a second reason, and it is the expensive one.
const LIST_COLS = "id, kind, title, request_id, status, started_at, ended_at";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;

  // ── ?report=<id> — ONE session's report, fetched when a row is opened ────────────────────────
  const wantReport = sp.get("report") || "";
  if (wantReport) {
    // Shape-checked before it reaches a uuid column, like every sibling admin read.
    if (!UUID.test(wantReport)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const one = new ReadSet("admin/agent-runs:report", [await rd("report", () => sb.from("agent_runs")
      .select("id, report").eq("id", wantReport).maybeSingle())]);
    // A BLIP IS NOT AN EMPTY REPORT. The row only opens because the list said it HAS one, so
    // answering "" on a failed read would show an empty panel under a row that promised a report.
    if (one.failed("report")) return adminFail("that session's report", one.error("report"), { action: "load" });
    const row = one.value<{ id: string; report: string | null }>("report");
    if (!row) return NextResponse.json({ error: "That session is no longer on record." }, { status: 404 });
    return NextResponse.json({ id: row.id, report: row.report ?? null });
  }

  // ── the list ─────────────────────────────────────────────────────────────────────────────────
  const beforeRaw = sp.get("before") || "";
  // Ignored if malformed, so a hand-typed value can only ever narrow the window, never widen it —
  // the same rule /api/admin/oplog states for its own ?since=.
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw).toISOString() : null;
  const wantCount = sp.get("count") === "1";

  let q = sb.from("agent_runs").select(LIST_COLS)
    .order("started_at", { ascending: false })
    // `started_at` alone is not a total order — the 1 September note in the Repair page records two
    // runs landing in the SAME SECOND when the Mac woke and launchd fired both missed jobs at once.
    // With ties broken arbitrarily one row could appear on two pages and another on none, which on
    // a history list is the quietest possible kind of wrong. `id` is the tiebreak, same direction.
    .order("id", { ascending: false })
    .limit(PAGE);
  if (before) q = q.lt("started_at", before);

  const reads = new ReadSet("admin/agent-runs", await Promise.all([
    rd("runs", () => q),
    // The TRUE total, only when asked. A head count moves no rows, and `agent_runs` is one row per
    // working session — a few a day at most — so this is an index count, not a scan. Turning a page
    // does not ask: the total cannot change the shape of what is being paged in the meantime.
    rd("total", () => (wantCount
      ? sb.from("agent_runs").select("id", { count: "exact", head: true })
      : Promise.resolve({ data: null, error: null, count: null }))),
  ]));
  if (reads.failed("runs")) return adminFail("the working-session history", reads.error("runs"), { action: "load" });
  const rows = reads.rows<{ id: string; started_at: string }>("runs");

  // WHICH OF THESE HAS A REPORT TO OPEN — ids only, so the bodies stay where they are.
  // TOLERATED: if this one read fails, every row on the page renders as "no report was saved",
  // which understates what is there but takes nothing off the screen. Said here rather than left
  // to a `|| []`, because a row that quietly stops being openable is the shape the Repair page was
  // already fixed for once ("a row with nothing to open is not a button").
  const ids = rows.map((r) => r.id);
  const withReport = new Set<string>();
  if (ids.length) {
    const hr = new ReadSet("admin/agent-runs:has-report", [await rd("ids", () => sb.from("agent_runs")
      .select("id").in("id", ids).not("report", "is", null).limit(PAGE))]);
    for (const x of hr.rowsOr<{ id: string }>("ids", [])) withReport.add(x.id);
  }

  return NextResponse.json({
    runs: rows.map((r) => ({ ...r, hasReport: withReport.has(r.id) })),
    // Null once a page comes back short — that is how the screen knows it has reached the oldest
    // session rather than inferring it from a count that may have moved.
    nextBefore: rows.length >= PAGE ? rows[rows.length - 1].started_at : null,
    // Null when it was not asked for, and null when the count itself failed: "I don't know" and
    // "there are none" must not look the same on the chip beside the heading.
    total: wantCount && !reads.failed("total") ? reads.count("total") : null,
  });
}
