// /api/owner/ratings — the OWNER (their restaurants) + ADMIN (all) view of GUEST
// star-ratings (the `feedback` table, mig 037; management columns added mig 138).
//   GET   → { summary{avg,total,dist,unhandled}, ratings[] } for the caller's scope
//   PATCH → mark a rating handled / add an internal note (must be in scope)
// Gated by the per-restaurant "ratings" entitlement (admin-controlled, mig 138).
// Egress-safe: explicit columns, scoped by restaurant_id, .limit — never SELECT *.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, inScope, type OwnerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";

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
async function scopedIds(scope: OwnerScope): Promise<string[]> {
  if (!scope.all) return scope.ids;
  const r = await sb.from("restaurants").select("id");
  return (r.data || []).map((x) => x.id as string);
}

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gated = await gateRatingsScope(scope);
  if (!gated) return disabledResp();
  scope = gated;

  const onlyUnhandled = req.nextUrl.searchParams.get("filter") === "unhandled";
  const ids = await scopedIds(scope);
  if (!ids.length) return NextResponse.json({ summary: { total: 0, avg: 0, dist: [0, 0, 0, 0, 0], unhandled: 0 }, ratings: [] });

  // Summary (pre-aggregated in the DB — never scans another tenant, mig 138).
  const sum = await sb.rpc("lfh_ratings_summary", { p_ids: ids });
  if (sum.error) return NextResponse.json({ error: sum.error.message }, { status: 500 });
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach restaurant names (one small fetch, avoids a PostgREST embed).
  const list = (data || []) as Array<{ restaurant_id: string } & Record<string, unknown>>;
  const rids = [...new Set(list.map((r) => r.restaurant_id))];
  const names: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name").in("id", rids);
    for (const x of (r.data || []) as { id: string; name: string }[]) names[x.id] = x.name;
  }
  const ratings = list.map((r) => ({ ...r, restaurantName: names[r.restaurant_id] || "—" }));
  return NextResponse.json({ summary, ratings });
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

  const who = scope.all ? "admin" : "owner";
  const patch: Record<string, unknown> = {};
  if (hasAck) {
    patch.acknowledged = body.acknowledged;
    patch.acknowledged_at = body.acknowledged ? new Date().toISOString() : null;
    patch.acknowledged_by = body.acknowledged ? who : null;
  }
  if (hasNote) patch.staff_note = body.note.trim() || null;
  const { error } = await sb.from("feedback").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
