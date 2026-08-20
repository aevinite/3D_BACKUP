// /api/owner/issues — the OWNER (their restaurants) + ADMIN (all restaurants)
// view of staff-raised issues / complaints.
//   GET   → list issues in scope (open first, newest first) with restaurant names
//   PATCH → resolve / reopen an issue (must be in the caller's scope)
//   POST  → owner/admin raises an issue against a restaurant they can see
// Manager/kitchen/tablet raise issues via /api/editor/issue instead (panel-scoped).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { signRows } from "@/lib/mediaLinks";
import { ownerScopeOr503, inScope, type OwnerScope, dbFail , ownerLogPanel } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { logAction } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";
import { rd } from "@/lib/readGuard";
import { restaurantNames } from "@/lib/restaurantNames";

export const dynamic = "force-dynamic";

// Mig 133: a REAL owner loses restaurants whose "issues" section the admin removed
// (null = section fully off for them). The admin's own session (scope.admin — set on
// every admin branch, incl. an act-as pin that borrows the real owner's id) is never
// gated — admin = top power, the X-ray shows removed sections tinted-but-working.
async function gateIssuesScope(scope: OwnerScope): Promise<OwnerScope | null> {
  if (scope.all || scope.admin) return scope;
  const allowed = await entitledSubset(scope.ids, "issues");
  if (!allowed.length) return null;
  return { ...scope, ids: allowed };
}
const disabledResp = () =>
  NextResponse.json({ error: "Feedback & issues aren't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  let scope = sc.scope;
  const gated = await gateIssuesScope(scope);
  if (!gated) return disabledResp();
  scope = gated;

  // ONE EMPTY SHAPE, NOT TWO (T9 finding F18, fixed 2026-08-12). The two early returns disagreed —
  // `{issues:[]}` here and `{issues:[],openCount:0}` below — so a client reading `openCount` for its
  // badge got `undefined` on one of the two paths.
  const empty = () => NextResponse.json({ issues: [], openCount: 0 });

  let q = sb.from("issues")
    .select("id, restaurant_id, subject, body, raised_by, raised_role, status, created_at, resolved_at, resolved_by, image_url, audio_url")
    .order("status", { ascending: true }).order("created_at", { ascending: false }).limit(300);
  if (!scope.all) {
    if (!scope.ids.length) return empty();
    q = q.in("restaurant_id", scope.ids);
  }
  // Optional ?rid= (or legacy ?restaurant_id=) filter — narrow to ONE selected restaurant:
  // the owner's top-strip restaurant pick / an admin act-as one restaurant (mirrors
  // /api/owner/reports), and the admin restaurant DETAIL view. Only honoured when that id is
  // already in the caller's scope (an admin's scope is every restaurant), so it can only
  // NARROW, never widen.
  const oneRid = req.nextUrl.searchParams.get("rid") || req.nextUrl.searchParams.get("restaurant_id");
  if (oneRid) {
    if (!inScope(scope, oneRid)) return empty();
    q = q.eq("restaurant_id", oneRid);
  }
  // ── THE BADGE IS COUNTED IN THE DATABASE NOW (T9 finding F19, fixed 2026-08-12) ─────────────────
  // `openCount` was `issues.filter(i => i.status === "open").length` over the CAPPED 300-row page,
  // so a restaurant with more than 300 complaints understated how many were open — on a number whose
  // entire job is to be trusted at a glance. One cheap indexed head-count instead, over exactly the
  // same scope the list uses, which is the same correction `/api/owner/khata` was given for its
  // "total outstanding" (T7 F13: never sum the shown page).
  const countScope = oneRid ? [oneRid] : (scope.all ? null : scope.ids);
  let openHead = sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open");
  if (countScope) openHead = openHead.in("restaurant_id", countScope);

  const [listRes, openRes] = await Promise.all([q, rd("openCount", () => openHead)]);
  const { data, error } = listRes;
  if (error) return dbFail("owner/issues", error, { message: "Couldn't load your complaints just now — please try again." });
  // signRows turns the stored value into a short-lived link on the way out (lib/mediaLinks.ts).
  const signed = await signRows("issue-media", (data || []) as Record<string, unknown>[], ["image_url", "audio_url"]);

  // Attach restaurant names via a separate small fetch (avoids a PostgREST embed).
  const list = signed as unknown as Array<{ restaurant_id: string; status: string } & Record<string, unknown>>;
  // Shared lookup — checks its own error, handles a JSONB name, pages past the row cap (finding F17).
  const names = await restaurantNames(list.map((i) => i.restaurant_id));
  const issues = list.map((i) => ({
    ...i,
    restaurantName: names.get(i.restaurant_id) ?? "—",
    restaurantSlug: names.slug(i.restaurant_id) ?? "",
  }));
  // Fall back to counting the shown page ONLY if the head-count failed, and say so — an undercounted
  // badge is better than no page, but the screen should know not to trust it.
  const openCount = openRes.error
    ? issues.filter((i) => i.status === "open").length
    : (openRes.count ?? 0);
  const partial = [
    ...(names.partial ? ["restaurantNames"] : []),
    ...(openRes.error ? ["openCount"] : []),
  ];
  return NextResponse.json({ issues, openCount, ...(partial.length ? { partial } : {}) });
}

export async function PATCH(req: NextRequest) {
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  let scope = sc.scope;
  const gatedP = await gateIssuesScope(scope);
  if (!gatedP) return disabledResp();
  scope = gatedP;
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const status = body?.status === "open" ? "open" : "resolved";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const issue = (await sb.from("issues").select("id, restaurant_id").eq("id", id).maybeSingle()).data as { restaurant_id: string } | null;
  if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!inScope(scope, issue.restaurant_id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Record WHO resolved it: "admin" for the super-user OR an admin act-as session, else the
  // concrete owner id (traceable when several co-own a restaurant). Keying off scope.admin
  // (not just scope.all) stops an admin act-as being logged as the borrowed owner (audit 2026-07-07).
  const who = (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner");
  const patch = status === "resolved"
    ? { status, resolved_at: new Date().toISOString(), resolved_by: who }
    : { status, resolved_at: null, resolved_by: null };
  const { error } = await sb.from("issues").update(patch).eq("id", id);
  if (error) return dbFail("owner/issues.update", error, { message: "Couldn't update that complaint — please try again." });
  // The issue ROW already carries resolved_by/at, so this was never untraceable — it just never
  // reached the unified Activity log (sweep 2026-08-04).
  await logAction(ownerLogPanel(scope), status === "resolved" ? "issue_resolved" : "issue_reopened", {
    restaurant_id: issue.restaurant_id, actor: who,
    detail: status === "resolved" ? "marked a complaint resolved" : "reopened a complaint",
  });
  return NextResponse.json({ ok: true });
}

// AT MOST ONCE. Nothing in the app POSTs here today — the real path a panel uses is raiseIssue()
// from the tablet/kitchen routes, which are wrapped. But this endpoint DOES insert an issue row,
// so the day someone wires a button to it, a double-tap or a retry after a lost reply would post
// the same complaint twice. Wrapping an insert costs nothing when no header is sent (it passes
// straight through) and removes the trap in advance. (Found by the skipped-phase audit 2026-08-04.)
export const POST = withIdempotency(postImpl, "owner");
async function postImpl(req: NextRequest) {
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  let scope = sc.scope;
  const gatedC = await gateIssuesScope(scope);
  if (!gatedC) return disabledResp();
  scope = gatedC;
  const body = await req.json().catch(() => ({}));
  const rid = String(body?.restaurant_id || "");
  // Cap subject/body server-side — a direct API call could otherwise store huge blobs that
  // then re-load on every issues list fetch (.limit(300)) inflating egress (audit 2026-07-07).
  const subject = String(body?.subject || "").trim().slice(0, 200);
  if (!rid || !subject) return NextResponse.json({ error: "restaurant and subject required" }, { status: 400 });
  if (!inScope(scope, rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // An admin raising an issue (all-view OR act-as) is stamped "admin", not the borrowed
  // owner — the act-as branch has scope.all=false, so key off scope.admin too (audit 2026-07-07).
  const { error } = await sb.from("issues").insert({
    restaurant_id: rid, subject, body: String(body?.body || "").trim().slice(0, 4000),
    raised_by: (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner"),
    raised_role: (scope.all || scope.admin) ? "admin" : "owner",
  });
  if (error) return dbFail("owner/issues.raise", error, { message: "Couldn't raise that complaint — please try again." });
  await logAction(ownerLogPanel(scope), "issue_raised", {
    restaurant_id: rid, actor: (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner"),
    detail: `raised: ${subject.slice(0, 80)}`,
  });
  return NextResponse.json({ ok: true });
}
