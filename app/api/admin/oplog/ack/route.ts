// POST /api/admin/oplog/ack — mark Everything-Log error rows SEEN / unseen for the notification
// bell (owner 2026-07-24: "stop showing in the notification when it has been seen").
//
// `seen_at` (mig 182) is INDEPENDENT of `resolved_at` (mig 181, the red-in-the-log state handled by
// /api/admin/resolve-error). This endpoint only ever touches SEEN:
//   • opening the bell marks the shown errors seen → the badge clears;
//   • a per-error "mark unread" clears seen_at → the badge shows that one again.
//
// POST { action_ids: string[], seen: boolean }  — mark those rows seen/unseen.
// POST { all: true, seen: true }                 — mark EVERY still-unseen error in the last 24h
//                                                   seen in one shot (what opening the bell does, so
//                                                   the badge fully clears even past the 10 shown).
// Admin-gated; ids UUID-validated + capped; idempotent (naturally re-runnable, but we honour
// X-LFH-Action-Id per the offline-sync contract). Scoped update — the `all` path is bounded to the
// 24h window and rides the partial idx_staff_actions_error_unseen index, never a full scan.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

async function postHandler(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (typeof body.seen !== "boolean") return err("seen (boolean) is required");
  const nowIso = new Date().toISOString();

  // "Mark all seen" — clears the whole bell badge on open (bounded to the 24h badge window).
  if (body.all === true) {
    if (!body.seen) return err("all-mode only marks seen");
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // COUNTED BEFORE, NOT COUNTED FROM WHAT CAME BACK (T19 sweep #7, 2026-09-01). This ended
    // `.select("id")` and reported `data.length`, which stops at PostgREST's own row cap: on a day
    // with more unseen errors than that, every one would be marked seen and the reply would say a
    // smaller number. A head count with the SAME filter cannot be shortened.
    const seenCount = sb.from("staff_actions").select("id", { count: "exact", head: true })
      .eq("level", "error").is("seen_at", null).gte("created_at", since24h);
    const before = await seenCount;
    if (before.error) return adminFail("the notification state", before.error, { action: "load" });
    const r = await sb.from("staff_actions").update({ seen_at: nowIso })
      .eq("level", "error").is("seen_at", null).gte("created_at", since24h);
    // Both branches of this route WRITE (see the rule 4b note in scripts/verify-admin-api-a.mjs):
    // reporting a failed update as "couldn't load" told the admin the wrong thing about whether the
    // bell had changed. "save" promises nothing was changed, which is what actually happened.
    if (r.error) return adminFail("the notification state", r.error, { action: "save" });
    return NextResponse.json({ ok: true, changed: before.count ?? 0 });
  }

  // Validate + cap the id list (per-row toggles, e.g. "mark unread"; 200 is a safe ceiling).
  const ids = Array.isArray(body.action_ids)
    ? Array.from(new Set((body.action_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID.test(x)))).slice(0, 200)
    : [];
  if (ids.length === 0) return err("no valid action_ids");

  // The id list is capped at 200 above, well under PostgREST's own cap, so counting the returned
  // rows is safe here — unlike the all-mode branch above.
  const r = await sb.from("staff_actions").update({ seen_at: body.seen ? nowIso : null }).in("id", ids).select("id");
  if (r.error) return adminFail("the notification state", r.error, { action: "save" });
  return NextResponse.json({ ok: true, changed: r.data?.length ?? 0 });
}

export const POST = withIdempotency(postHandler, "admin");
