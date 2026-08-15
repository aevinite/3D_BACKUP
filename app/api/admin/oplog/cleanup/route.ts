// /api/admin/oplog/cleanup — admin-only MANUAL cleanup of the operations log
// (staff_actions), complementing the automatic per-restaurant nightly prune
// (lfh_prune_logs, migration 152). Admin-gated (STAFF_PASSWORD cookie, same as the
// rest of /aevinite), service role.
//
//   GET  ?restaurant_id=<uuid?>            → { count, threshold }
//        A HEAD row-count of staff_actions, scoped to ONE restaurant or the whole
//        platform when omitted. `head:true` means only the number crosses the wire,
//        never the rows — so the Logs page can decide whether to show its "logs are
//        getting full" banner without pulling any data (egress-safe).
//
//   POST { restaurant_id?: string|null, keepDays: number } → { removed }
//        Delete staff_actions older than `keepDays` days, scoped to that restaurant
//        (or ALL restaurants when restaurant_id is null/omitted). Returns how many
//        rows were removed.
//
// LOGS ARE NOT BILLS: this only ever touches staff_actions (the operations log). It
// never deletes from `orders` (sales history) or `customers` (saved profiles).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

// The row-count at/above which the Logs page warns the admin. ONE source of truth
// (server) so the banner threshold can't drift from what GET reports.
const FULL_THRESHOLD = 50000;
// Guard against a runaway window. 3650 days = 10 years; the UI offers at most 1 year.
const MAX_KEEP_DAYS = 3650;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rid = new URL(req.url).searchParams.get("restaurant_id");
  // Reject a malformed id before it hits a uuid column (else Postgres returns a raw
  // "invalid input syntax for type uuid" in the 500 body — every sibling route validates).
  if (rid && !UUID_RE.test(rid))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });

  // HEAD count only — uses the (restaurant_id, created_at) index when scoped.
  let q = sb.from("staff_actions").select("id", { count: "exact", head: true });
  if (rid) q = q.eq("restaurant_id", rid);
  const r = await q;
  if (r.error) return adminFail("the log cleanup", r.error, { action: "load" });
  return NextResponse.json({ count: r.count ?? 0, threshold: FULL_THRESHOLD });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { restaurant_id?: unknown; keepDays?: unknown } = {};
  try { body = await req.json(); } catch { /* empty/invalid body → validation below fails cleanly */ }

  const rid = body.restaurant_id == null || body.restaurant_id === "" ? null : String(body.restaurant_id);
  if (rid && !UUID_RE.test(rid))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });

  // keepDays must be a sane whole number of days. Guard HARD against 0 / negatives so
  // a bad client can never turn this into "delete everything" — the smallest window
  // the UI offers is 7 days, and there is always a created_at filter below.
  const keepDays = Number(body.keepDays);
  if (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > MAX_KEEP_DAYS)
    return NextResponse.json({ error: `keepDays must be a whole number between 1 and ${MAX_KEEP_DAYS}` }, { status: 400 });

  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();

  // Delete rows older than the cutoff, scoped to the chosen restaurant (or all). There
  // is ALWAYS a created_at filter, so this is never an unfiltered delete. count:"exact"
  // tells us how many went, so the admin sees a real number instead of a guess.
  let del = sb.from("staff_actions").delete({ count: "exact" }).lt("created_at", cutoff);
  if (rid) del = del.eq("restaurant_id", rid);
  const r = await del;
  if (r.error) return adminFail("the log cleanup", r.error, { action: "save" });
  const removed = r.count ?? 0;

  // Audit the cleanup itself (fire-and-forget). Counts only, no money — so no redaction
  // needed. When scoped, the audit row is tagged to that restaurant; for "all", it lands
  // on the default restaurant with an explicit "(all restaurants)" note.
  await logAction("admin", "logs_cleanup", {
    actor: "admin",
    restaurant_id: rid,
    detail: `removed ${removed} log ${removed === 1 ? "entry" : "entries"} older than ${keepDays} day${keepDays === 1 ? "" : "s"}${rid ? "" : " (all restaurants)"}`,
  });

  return NextResponse.json({ removed });
}
