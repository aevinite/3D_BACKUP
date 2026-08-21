// GET/DELETE /api/admin/error-memory — problems recorded as FIXED (migs 218/219).
//
// This list hides nothing. The Repair page uses it for two read-only things:
//   1) an "Already fixed" reference list (with the link to each fix) that can be forgotten again;
//   2) labelling a live problem tile "came back after the fix on <date>" — a problem recorded as
//      fixed that is happening again means the fix did NOT hold, and that has to be visible.
//
// Admin-gated, bounded, newest first. Restaurant names are resolved in ONE map read (no N+1).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const rid = new URL(req.url).searchParams.get("restaurant_id");
  if (rid && !UUID.test(rid)) return err("invalid restaurant_id");

  let q = sb.from("error_signatures")
    .select("id, restaurant_id, panel, action, sig, fixed_at, fixed_by, pr_url, note")
    .order("fixed_at", { ascending: false }).limit(100);
  // A NULL-restaurant signature covers every restaurant, so it belongs in a scoped view too.
  if (rid) q = q.or(`restaurant_id.eq.${rid},restaurant_id.is.null`);
  const r = await q;
  if (r.error) return adminFail("the fixed-problem list", r.error, { action: "load" });
  const rows = (r.data ?? []) as { restaurant_id: string | null }[];

  const ids = [...new Set(rows.map((x) => x.restaurant_id).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length) {
    const n = await sb.from("restaurants").select("id, name").in("id", ids).limit(2000);
    names = new Map(((n.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  }
  return NextResponse.json({
    memories: rows.map((x) => ({ ...x, restaurant: x.restaurant_id ? names.get(x.restaurant_id) || "—" : "All restaurants" })),
  });
}

// DELETE ?id=… — forget one record ("Forget this"), so Fix-now treats the problem as new again.
// DELETE ?all=1 — forget ALL of them ("Forget all"), optionally scoped to one restaurant.
//
// ── WHAT FORGETTING ACTUALLY COSTS (owner, 2026-08-21, after asking what it meant) ─────────────
// These records hide nothing and never have: a problem that happens again lands on the Repair board
// like any other. Forgetting them costs exactly two things, and it is worth being precise because
// the first reason given for withholding this button was WRONG:
//   · Fix-now stops answering "already fixed on <date>" for an old report, so it will send Claude to
//     look at it again. That is the point of the button.
//   · a recurrence loses its red "came back after the fix" badge — the only thing that tells you a
//     problem is a REPEAT and that an earlier fix did not hold. That is the real loss.
// It does NOT throw away a link to the fix: on this platform every record so far was written by the
// owner pressing Resolve, and carries no pr_url at all.
//
// Scoped like every other bulk action in the console: with ?restaurant_id it clears that
// restaurant's records plus the platform-wide (NULL) ones that also cover it — the same set the
// scoped GET above returns, so the button can never clear more than the list it sits under shows.
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const url = new URL(req.url);

  if (url.searchParams.get("all") === "1") {
    const rid = url.searchParams.get("restaurant_id");
    if (rid && !UUID.test(rid)) return err("invalid restaurant_id");
    // THE SAME FILTER, ONCE. `.not("id","is",null)` is there because PostgREST refuses a delete with
    // no filter at all — deliberately, and this is the one place we mean "all of them", so it is
    // spelled out rather than switched off.
    const scoped = <T extends { or: (f: string) => T; not: (c: string, o: string, v: null) => T }>(q: T): T =>
      rid ? q.or(`restaurant_id.eq.${rid},restaurant_id.is.null`) : q.not("id", "is", null);

    // COUNTED BEFORE, NOT COUNTED FROM WHAT CAME BACK (caught by verify:admin-api-a). Asking the
    // delete to RETURN the rows it removed puts the answer under PostgREST's own row cap, so on a
    // long list the delete would remove everything and then report a smaller number — a screen
    // saying "forgot 1000" over an empty list. A head count moves no rows and cannot be shortened.
    const cnt = await scoped(sb.from("error_signatures").select("id", { count: "exact", head: true }));
    if (cnt.error) return adminFail("the fixed-problem list", cnt.error, { action: "load" });
    const n = cnt.count ?? 0;
    if (!n) return NextResponse.json({ ok: true, forgotten: 0 });

    const r = await scoped(sb.from("error_signatures").delete());
    if (r.error) return adminFail("the fixed-problem list", r.error, { action: "save" });
    await logAction("admin", "error_memory_cleared", {
      restaurant_id: rid ?? undefined, level: "info",
      detail: `Forgot ALL ${n} fix record(s)${rid ? " for one restaurant" : " (platform-wide)"} — Fix now will treat those problems as new again, and a recurrence will no longer be labelled "came back after the fix"`,
    });
    return NextResponse.json({ ok: true, forgotten: n });
  }

  const id = url.searchParams.get("id") || "";
  if (!UUID.test(id)) return err("invalid id");
  const r = await sb.from("error_signatures").delete().eq("id", id).select("panel, action, sig, restaurant_id").maybeSingle();
  if (r.error) return adminFail("the fixed-problem list", r.error, { action: "save" });
  if (!r.data) return err("that entry is already gone", 404);
  const gone = r.data as { panel: string; action: string; sig: string; restaurant_id: string | null };
  await logAction("admin", "error_memory_cleared", {
    restaurant_id: gone.restaurant_id ?? undefined, level: "info",
    detail: `Forgot fix record: ${gone.panel}/${gone.action} — ${gone.sig.slice(0, 90)}`,
  });
  return NextResponse.json({ ok: true });
}
