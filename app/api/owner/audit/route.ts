// GET /api/owner/audit — the owner's Removals record: everything taken out of the system
// across THEIR restaurant(s) — a cancelled KOT, a deleted bill, a dish off an order or off
// the menu — with the reason and the person (deletion_audit, mig 251). This is the "Audit"
// half of the owner's Audit & logs page; the Activity half is /api/owner/oplog.
//
// SCOPE (ownerScope, lib/ownerScope): a real OWNER sees only the restaurants they own; the
// ADMIN act-as sees the one restaurant they've entered. The page is a listed switch
// (Access → Owner's menu → Audit & logs → Removals record), so hiding the view is never the
// only guard — a restaurant whose switch is off is refused here too. Money is NOT redacted:
// it's the owner's own restaurant data (same rule as /api/owner/oplog).
//
// Egress-safe (data-cost-guard): scoped by restaurant_id, an explicit column list, and a
// hard limit — never a whole-table read. deletion_audit is indexed (restaurant_id, at DESC).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, inScope } from "@/lib/ownerScope";
import { entitledSubset, logViewSubset } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

const COLS = "id, at, kind, reason_code, reason_note, actor, actor_role, table_number, bill_no, invoice_no, kot_no, item_title, qty, amount, restaurant_id";

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Section switch ("logs") first, then this view's own sub-option ("removals").
  if (!scope.all && !scope.admin) {
    const allowed = await logViewSubset(await entitledSubset(scope.ids, "logs"), "removals");
    if (!allowed.length)
      return NextResponse.json({ error: "The removals record isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope = { ...scope, ids: allowed };
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 300);

  let q = sb.from("deletion_audit").select(COLS).order("at", { ascending: false }).limit(limit);
  // Optional ?rid= — narrow to ONE selected restaurant. Only honoured when that id is already
  // in the caller's scope, so it can only NARROW, never widen (mirrors /api/owner/oplog).
  const pinRid = url.searchParams.get("rid");
  if (pinRid) {
    if (!inScope(scope, pinRid)) return NextResponse.json({ removals: [] });
    q = q.eq("restaurant_id", pinRid);
  } else if (!scope.all) {
    if (!scope.ids.length) return NextResponse.json({ removals: [] });
    q = q.in("restaurant_id", scope.ids);
  }

  const r = await q;
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const rows = r.data ?? [];

  // Stamp each row with its restaurant NAME so a multi-restaurant owner can tell them apart
  // (one batched lookup, no N+1). Single-restaurant owners simply ignore it.
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, x.name);
  }
  const removals = rows.map((a) => ({ ...a, restaurant_name: a.restaurant_id ? nameById.get(a.restaurant_id) ?? null : null }));
  return NextResponse.json({ removals });
}
