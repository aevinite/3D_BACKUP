// /api/owner/issues — the OWNER (their restaurants) + ADMIN (all restaurants)
// view of staff-raised issues / complaints.
//   GET   → list issues in scope (open first, newest first) with restaurant names
//   PATCH → resolve / reopen an issue (must be in the caller's scope)
//   POST  → owner/admin raises an issue against a restaurant they can see
// Manager/kitchen/tablet raise issues via /api/editor/issue instead (panel-scoped).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, inScope, type OwnerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";

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
    .select("id, restaurant_id, subject, body, raised_by, raised_role, status, created_at, resolved_at")
    .order("status", { ascending: true }).order("created_at", { ascending: false }).limit(300);
  if (!scope.all) {
    if (!scope.ids.length) return NextResponse.json({ issues: [] });
    q = q.in("restaurant_id", scope.ids);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach restaurant names via a separate small fetch (avoids a PostgREST embed).
  const list = (data || []) as Array<{ restaurant_id: string; status: string } & Record<string, unknown>>;
  const rids = [...new Set(list.map((i) => i.restaurant_id))];
  const names: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name").in("id", rids);
    for (const x of (r.data || []) as { id: string; name: string }[]) names[x.id] = x.name;
  }
  const issues = list.map((i) => ({ ...i, restaurantName: names[i.restaurant_id] || "—" }));
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
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gatedC = await gateIssuesScope(scope);
  if (!gatedC) return disabledResp();
  scope = gatedC;
  const body = await req.json().catch(() => ({}));
  const rid = String(body?.restaurant_id || "");
  const subject = String(body?.subject || "").trim();
  if (!rid || !subject) return NextResponse.json({ error: "restaurant and subject required" }, { status: 400 });
  if (!inScope(scope, rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // An admin raising an issue (all-view OR act-as) is stamped "admin", not the borrowed
  // owner — the act-as branch has scope.all=false, so key off scope.admin too (audit 2026-07-07).
  const { error } = await sb.from("issues").insert({
    restaurant_id: rid, subject, body: String(body?.body || "").trim(),
    raised_by: (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner"),
    raised_role: (scope.all || scope.admin) ? "admin" : "owner",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
