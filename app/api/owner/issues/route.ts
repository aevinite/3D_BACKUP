// /api/owner/issues — the OWNER (their restaurants) + ADMIN (all restaurants)
// view of staff-raised issues / complaints.
//   GET   → list issues in scope (open first, newest first) with restaurant names
//   PATCH → resolve / reopen an issue (must be in the caller's scope)
//   POST  → owner/admin raises an issue against a restaurant they can see
// Manager/kitchen/tablet raise issues via /api/editor/issue instead (panel-scoped).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { signRows } from "@/lib/mediaLinks";
import { ownerScope, inScope, type OwnerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { logAction } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";

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
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gated = await gateIssuesScope(scope);
  if (!gated) return disabledResp();
  scope = gated;

  let q = sb.from("issues")
    .select("id, restaurant_id, subject, body, raised_by, raised_role, status, created_at, resolved_at, resolved_by, image_url, audio_url")
    .order("status", { ascending: true }).order("created_at", { ascending: false }).limit(300);
  if (!scope.all) {
    if (!scope.ids.length) return NextResponse.json({ issues: [] });
    q = q.in("restaurant_id", scope.ids);
  }
  // Optional ?rid= (or legacy ?restaurant_id=) filter — narrow to ONE selected restaurant:
  // the owner's top-strip restaurant pick / an admin act-as one restaurant (mirrors
  // /api/owner/reports), and the admin restaurant DETAIL view. Only honoured when that id is
  // already in the caller's scope (an admin's scope is every restaurant), so it can only
  // NARROW, never widen.
  const oneRid = req.nextUrl.searchParams.get("rid") || req.nextUrl.searchParams.get("restaurant_id");
  if (oneRid) {
    if (!inScope(scope, oneRid)) return NextResponse.json({ issues: [], openCount: 0 });
    q = q.eq("restaurant_id", oneRid);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // signRows turns the stored value into a short-lived link on the way out (lib/mediaLinks.ts).
  const signed = await signRows("issue-media", (data || []) as Record<string, unknown>[], ["image_url", "audio_url"]);

  // Attach restaurant names via a separate small fetch (avoids a PostgREST embed).
  const list = signed as unknown as Array<{ restaurant_id: string; status: string } & Record<string, unknown>>;
  const rids = [...new Set(list.map((i) => i.restaurant_id))];
  const names: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name, slug").in("id", rids);
    for (const x of (r.data || []) as { id: string; name: string; slug: string }[]) { names[x.id] = x.name; slugs[x.id] = x.slug; }
  }
  const issues = list.map((i) => ({ ...i, restaurantName: names[i.restaurant_id] || "—", restaurantSlug: slugs[i.restaurant_id] || "" }));
  return NextResponse.json({ issues, openCount: issues.filter((i) => i.status === "open").length });
}

export async function PATCH(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The issue ROW already carries resolved_by/at, so this was never untraceable — it just never
  // reached the unified Activity log (sweep 2026-08-04).
  await logAction("owner", status === "resolved" ? "issue_resolved" : "issue_reopened", {
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
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAction("owner", "issue_raised", {
    restaurant_id: rid, actor: (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner"),
    detail: `raised: ${subject.slice(0, 80)}`,
  });
  return NextResponse.json({ ok: true });
}
