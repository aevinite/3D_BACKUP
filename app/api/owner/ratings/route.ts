// /api/owner/ratings — the OWNER (their restaurants) + ADMIN (all) view of GUEST
// star-ratings (the `feedback` table, mig 037; management columns added mig 138).
//   GET   → { summary{avg,total,dist,unhandled}, ratings[] } for the caller's scope
//   PATCH → mark a rating handled / add an internal note (must be in scope)
// Gated by the per-restaurant "ratings" entitlement (admin-controlled, mig 138).
// Egress-safe: explicit columns, scoped by restaurant_id, .limit — never SELECT *.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, inScope, type OwnerScope, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse, dbFail } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { logAction } from "@/lib/oplog";
import { expectClash, clashJson } from "@/lib/clash";
import { restaurantNames } from "@/lib/restaurantNames";

export const dynamic = "force-dynamic";

const COLS = "id, restaurant_id, order_id, table_number, rating, comment, name, created_at, acknowledged, acknowledged_at, acknowledged_by, staff_note";

// A REAL owner loses restaurants whose "ratings" section the admin removed. The
// admin's own session (scope.admin) is never gated — admin = top power.
async function gateRatingsScope(scope: OwnerScope): Promise<OwnerScope | null> {
  if (scope.all || scope.admin) return scope;
  const allowed = await entitledSubset(scope.ids, "ratings");
  if (!allowed.length) return null;
  return { ...scope, ids: allowed };
}
const disabledResp = () =>
  NextResponse.json({ error: "Guest ratings aren't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });

// The concrete id list for the current scope (admin-all → every restaurant id).
// The concrete id list for this scope. Shared helper (lib/ownerScope) because the
// admin all-restaurants read must be PAGED — three local copies each dropped restaurants
// past PostgREST's row cap (found 2026-08-04).
const scopedIds = scopedRestaurantIds;

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gated = await gateRatingsScope(scope);
  if (!gated) return disabledResp();
  scope = gated;

  const onlyUnhandled = req.nextUrl.searchParams.get("filter") === "unhandled";
  const empty = () => NextResponse.json({ summary: { total: 0, avg: 0, dist: [0, 0, 0, 0, 0], unhandled: 0 }, ratings: [] });
  // Optional ?rid= — narrow to ONE selected restaurant (the top-strip pick / an admin act-as
  // one restaurant), mirroring /api/owner/reports. Only honoured when that id is already in the
  // caller's scope, so it can only NARROW, never widen. Both the summary RPC (p_ids) and the
  // list read below scope off this same `ids` list, so the whole tab narrows together.
  // A half-read list would understate the star average and the "to handle" count, so it is a
  // retryable failure rather than a wrong summary (T9 sweep, 2026-08-05).
  let ids: string[];
  try { ids = await scopedIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return incompleteListResponse(); throw e; }
  const pinRid = req.nextUrl.searchParams.get("rid");
  if (pinRid) {
    if (!inScope(scope, pinRid)) return empty();
    ids = [pinRid];
  }
  if (!ids.length) return empty();

  // Summary (pre-aggregated in the DB — never scans another tenant, mig 138).
  const sum = await sb.rpc("lfh_ratings_summary", { p_ids: ids });
  if (sum.error) return dbFail("owner/ratings.summary", sum.error, { message: "Couldn't load your ratings just now — please try again." });
  const s = (sum.data?.[0] ?? {}) as Record<string, unknown>;
  const summary = {
    total: Number(s.total) || 0,
    avg: Number(s.avg) || 0,
    dist: [Number(s.s1) || 0, Number(s.s2) || 0, Number(s.s3) || 0, Number(s.s4) || 0, Number(s.s5) || 0],
    unhandled: Number(s.unhandled) || 0,
  };

  // The list: newest first, capped. Scoped by restaurant_id, explicit columns.
  let q = sb.from("feedback").select(COLS).in("restaurant_id", ids).order("created_at", { ascending: false }).limit(200);
  if (onlyUnhandled) q = q.eq("acknowledged", false);
  const { data, error } = await q;
  if (error) return dbFail("owner/ratings", error, { message: "Couldn't load your ratings just now — please try again." });

  // Attach restaurant names (one small fetch, avoids a PostgREST embed).
  const list = (data || []) as Array<{ restaurant_id: string } & Record<string, unknown>>;
  // Shared lookup (finding F17): it checks its own error, so a blip no longer renders every rating's
  // restaurant as "—" with nothing saying why — and it handles a JSONB name, which this local copy
  // would have printed as "[object Object]".
  const names = await restaurantNames(list.map((r) => r.restaurant_id));
  const ratings = list.map((r) => ({ ...r, restaurantName: names.get(r.restaurant_id) ?? "—" }));
  return NextResponse.json({ summary, ratings, ...(names.partial ? { partial: ["restaurantNames"] } : {}) });
}

export async function PATCH(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gated = await gateRatingsScope(scope);
  if (!gated) return disabledResp();
  scope = gated;

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Real booleans / strings only — never silently coerce junk (audit 2026-07-06).
  const hasAck = "acknowledged" in body;
  if (hasAck && typeof body.acknowledged !== "boolean") return NextResponse.json({ error: "acknowledged must be true/false" }, { status: 400 });
  const hasNote = "note" in body;
  if (hasNote && typeof body.note !== "string") return NextResponse.json({ error: "note must be text" }, { status: 400 });
  if (!hasAck && !hasNote) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const row = (await sb.from("feedback").select("id, restaurant_id").eq("id", id).maybeSingle()).data as { restaurant_id: string } | null;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!inScope(scope, row.restaurant_id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // NO SILENT OVERWRITES (T9 sweep, 2026-08-05). `staff_note` is a free-text box any co-owner can
  // open on the same rating, so the second save used to just win. Acknowledging is a transition and
  // sends no expectation, so it is unaffected — only the typed note is protected.
  {
    const overwrite = await expectClash(req, String(row.restaurant_id || ""));
    if (overwrite) return clashJson(overwrite);
  }

  // Record WHO handled it: "admin" for the super-user OR an admin act-as session, else the
  // concrete owner id (traceable when several co-own a restaurant) — matches issues.route,
  // and no longer logs the generic "owner" for a specific co-owner (audit 2026-07-07).
  const who = (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner");
  const patch: Record<string, unknown> = {};
  if (hasAck) {
    patch.acknowledged = body.acknowledged;
    patch.acknowledged_at = body.acknowledged ? new Date().toISOString() : null;
    patch.acknowledged_by = body.acknowledged ? who : null;
  }
  // Cap server-side too — the client limits to 500, but a direct API call could store a
  // multi-MB note that then re-loads on every list fetch (egress). (audit 2026-07-07)
  if (hasNote) patch.staff_note = body.note.trim().slice(0, 1000) || null;
  const { error } = await sb.from("feedback").update(patch).eq("id", id);
  if (error) return dbFail("owner/ratings.update", error, { message: "Couldn't save that — please try again." });
  // The feedback ROW already carries acknowledged_by/at, so this was never untraceable — but it
  // never reached the unified Activity log, so "what did the owner do today?" left it out. One line
  // so the log tells the whole story (sweep 2026-08-04).
  await logAction("owner", "rating_handled", {
    restaurant_id: row.restaurant_id, actor: who,
    detail: [hasAck ? (body.acknowledged ? "acknowledged a rating" : "un-acknowledged a rating") : null,
             hasNote ? (patch.staff_note ? "wrote a reply note" : "cleared the reply note") : null]
      .filter(Boolean).join(" · "),
  });
  return NextResponse.json({ ok: true });
}
