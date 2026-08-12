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
import { ownerScope, inScope, dbFail } from "@/lib/ownerScope";
import { entitledSubset, logViewSubset } from "@/lib/ownerEntitlements";
// The admin stays invisible to an owner, in the AUDIT as it already is in the Activity log.
import { auditForReader, forReader } from "@/lib/auditActor";
import { rd } from "@/lib/readGuard";
import { restaurantNames } from "@/lib/restaurantNames";

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

  // ── ?detail=<id> — ONE removal, in full (owner, 2026-08-04) ─────────────────────────────────
  // "Click and view the full — how it was and what he changed, which KOT he deleted and what was
  // the item, with time, day, everything, who has done it." The list deliberately does NOT carry
  // `meta` (it holds the item-by-item snapshot, so 200 of them would be a heavy payload for rows
  // nobody has opened yet — the same lazy shape as the admin bill ledger's ?trail=). Read-only,
  // and scoped exactly like the list: an owner can only ever open a removal from a restaurant
  // they own. The OWNER CANNOT CHANGE ANYTHING HERE — this route is GET-only by design; putting
  // a bill back is the admin's alone (/api/admin/bills).
  const detailId = url.searchParams.get("detail");
  if (detailId) {
    if (!/^\d+$/.test(detailId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    let dq = sb.from("deletion_audit").select(`${COLS}, session_id, order_id, item_id, device_id, meta`).eq("id", Number(detailId)).limit(1);
    if (!scope.all) {
      if (!scope.ids.length) return NextResponse.json({ error: "not found" }, { status: 404 });
      dq = dq.in("restaurant_id", scope.ids);
    }
    // "I COULDN'T ASK" IS NOT "IT DOESN'T EXIST" (T9 finding F8, fixed 2026-08-12). The error was
    // never inspected, so a database blip was indistinguishable from a removal that isn't there and
    // the owner was told the record was gone — about the one screen whose whole job is proving that
    // nothing quietly disappears. The LIST read three lines below already used `dbFail`; this half
    // was missed.
    const detailRead = await rd("removal", () => dq);
    if (detailRead.error) {
      return dbFail("owner/audit.detail", detailRead.error, { message: "Couldn't open that removal just now — please try again." });
    }
    const one = (detailRead.data || [])[0] as Record<string, unknown> | undefined;
    if (!one) return NextResponse.json({ error: "not found" }, { status: 404 });
    const rn = one.restaurant_id ? (await restaurantNames([String(one.restaurant_id)])).get(String(one.restaurant_id)) : null;
    // The detail CARD names the person in its own "Who" row, so it needs the same treatment as the
    // list — otherwise hiding the admin in the feed only moved the leak one tap deeper.
    return NextResponse.json({
      removal: forReader({ ...one, restaurant_name: rn } as { actor?: string | null; actor_role?: string | null }, !!scope.admin),
      canRestore: false,
    });
  }

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
  if (r.error) return dbFail("owner/audit", r.error, { message: "Couldn't load the removals record just now — please try again." });
  const rows = r.data ?? [];

  // Stamp each row with its restaurant NAME so a multi-restaurant owner can tell them apart
  // (one batched lookup, no N+1). Single-restaurant owners simply ignore it.
  // One shared lookup (lib/restaurantNames) — it checks its own error, handles a JSONB name, and
  // pages past PostgREST's row cap. All three were wrong in this local copy (T9 finding F17).
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const names = await restaurantNames(ids);
  const removals = auditForReader(
    rows.map((a) => ({ ...a, restaurant_name: names.get(a.restaurant_id) })),
    // An admin acting AS this owner keeps the full record; a real owner never learns Aevidine was
    // here (CLAUDE.md's standing rule, and the same call /api/owner/oplog makes). The ROW, its
    // reason and its amount are untouched either way — only the identity is withheld.
    !!scope.admin,
  );
  return NextResponse.json({ removals, ...(names.partial ? { partial: ["restaurantNames"] } : {}) });
}
