// POST /api/admin/oplog/ack — mark Everything-Log error rows SEEN and/or RESOLVED.
//
// Two INDEPENDENT states (owner 2026-07-24), both nullable timestamps on staff_actions (mig 179):
//   • seen     — drives the notification-bell badge. Opening the bell marks the shown errors
//                seen so they stop counting; "mark unread" clears it so they count again.
//   • resolved — drives the red styling in the log. The admin marks an error handled and it
//                stops showing red; "reopen" brings the red back.
//
// POST { action_ids: string[], seen?: boolean, resolved?: boolean }
//   Applies ONLY the fields present. seen/resolved true → set the timestamp to now; false → NULL.
//   Marking RESOLVED also marks SEEN (a handled error shouldn't keep nagging the bell) — but
//   reopening does NOT un-see, and mark-unread only touches `seen`.
//
// Admin-gated; ids UUID-validated + capped; idempotent (the write is naturally re-runnable, but
// we honour X-LFH-Action-Id per the offline-sync contract). Scoped update by id list — no scans.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

async function postHandler(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Validate + cap the id list (a bell open marks at most ~10 shown errors; 200 is a safe ceiling).
  const ids = Array.isArray(body.action_ids)
    ? Array.from(new Set((body.action_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)))).slice(0, 200)
    : [];
  if (ids.length === 0) return err("no valid action_ids");

  const hasSeen = typeof body.seen === "boolean";
  const hasResolved = typeof body.resolved === "boolean";
  if (!hasSeen && !hasResolved) return err("nothing to change (pass seen and/or resolved)");

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {};
  if (hasResolved) {
    patch.resolved_at = body.resolved ? now : null;
    if (body.resolved) patch.seen_at = now; // resolving also stops the bell nagging
  }
  if (hasSeen) patch.seen_at = body.seen ? now : null; // explicit seen wins (e.g. mark-unread)

  const r = await sb.from("staff_actions").update(patch).in("id", ids).select("id");
  if (r.error) return err(r.error.message, 500);
  return NextResponse.json({ ok: true, changed: r.data?.length ?? 0 });
}

export const POST = withIdempotency(postHandler, "admin");
