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
// BEFORE vs AFTER, and the bill as it stood — see lib/auditDetail.ts for why "after" is read live.
import { auditAfter, auditBillHtml } from "@/lib/auditDetail";
import { rd } from "@/lib/readGuard";
import { restaurantNames } from "@/lib/restaurantNames";

export const dynamic = "force-dynamic";

// `made` is the ONE scalar out of meta (owner, 2026-08-18) — never meta itself, which carries a whole
// order snapshot; 200 of those for rows nobody opened is the board-wide read the egress rules exist to
// prevent. It is what lets the row wear its "food lost / nothing lost / not answered" tag.
const COLS = "id, at, kind, reason_code, reason_note, actor, actor_role, table_number, bill_no, invoice_no, kot_no, item_title, qty, amount, restaurant_id, order_id, made:meta->>made";

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
    // The two boxes the card draws, and the bill itself (owner, 2026-08-12). Both are lazy — they
    // only ever run when somebody opens ONE removal, never for the list.
    const meta = (one.meta || {}) as Record<string, unknown>;
    const was = (meta.was || null) as Record<string, unknown> | null;
    const rid2 = String(one.restaurant_id || "");
    const [after, billHtml] = await Promise.all([
      auditAfter(rid2, one.order_id ? String(one.order_id) : null),
      auditBillHtml(rid2, was),
    ]);
    return NextResponse.json({
      removal: forReader({ ...one, restaurant_name: rn } as { actor?: string | null; actor_role?: string | null }, !!scope.admin),
      after, billHtml,
      canRestore: false,
    });
  }

  // ── PAGED, like the Activity log beside it (owner, 2026-08-12) ─────────────────────────────────
  // The Removals record showed the newest 200-300 and stopped. On the screen whose entire purpose is
  // "prove nothing quietly disappeared", a list that itself quietly stops is the wrong shape. The
  // count rides along so the footer can say how many removals there really are.
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
  const start = (page - 1) * limit;
  let q = sb.from("deletion_audit").select(COLS, { count: "exact" })
    // A REMOVALS record shows REMOVALS. 'removal_classified' is the answer to "was the food made?",
    // not a thing taken out of the system, so it would put "Cancellation answered" rows into a list
    // headed "what was removed and why" and count them in its total. The current answer rides on the
    // cancellation row itself (see `made` in COLS); the trail of who answered stays in the table.
    .neq("kind", "removal_classified")
    .order("at", { ascending: false }).range(start, start + limit - 1);
  // Optional ?rid= — narrow to ONE selected restaurant. Only honoured when that id is already
  // in the caller's scope, so it can only NARROW, never widen (mirrors /api/owner/oplog).
  // ── ONE TYPE ONLY, FILTERED IN THE DATABASE (owner, 2026-08-12) ────────────────────────────────
  // The chips count every page (below), so filtering by type had to move here too: a chip reading
  // "Bill deleted 14" that then showed only the deleted bills ON THIS PAGE would be the count and the
  // list disagreeing — the exact fault this whole area has been cleaned of. Now the chip's number and
  // the rows behind it are the same query. Validated against the recorder's own list so an unknown
  // value narrows to nothing rather than being interpolated into the filter.
  const kind = (url.searchParams.get("kind") || "").trim();
  if (kind) {
    if (!/^[a-z_]{3,40}$/.test(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
    q = q.eq("kind", kind);
  }
  const pinRid = url.searchParams.get("rid");
  if (pinRid) {
    if (!inScope(scope, pinRid)) return NextResponse.json({ removals: [], page: 1, pageSize: limit, total: 0, pages: 1 });
    q = q.eq("restaurant_id", pinRid);
  } else if (!scope.all) {
    if (!scope.ids.length) return NextResponse.json({ removals: [], page: 1, pageSize: limit, total: 0, pages: 1 });
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
  const total = r.count ?? removals.length;
  // ── THE CHIP COUNTS MUST SPAN EVERY PAGE, NOT THIS ONE (owner, 2026-08-12) ────────────────────
  // The Audit grew a chip per removal type with a count. That was honest while the screen held every
  // row — and it now holds a PAGE, so "Bill deleted 10" would silently mean "10 on this page". A
  // number that reads as the whole record and is not is worse than no number. Counted in the database
  // over the same scope (mig 311's grouped read, one row per kind, indexed).
  // Measured on the dev data the day this went in: 220 cancelled tickets and 14 deleted bills existed
  // where a 200-row page showed 178 and 10.
  const countScope = pinRid ? [pinRid] : (scope.all ? null : scope.ids);
  let kindCounts: { kind: string; n: number; amount: number; risk?: string; tags?: string[] }[] | null = null;
  if (countScope && countScope.length) {
    const kc = await sb.rpc("lfh_audit_kind_counts", { p_restaurant_ids: countScope, p_from: null, p_to: null });
    // A failed count is reported ABSENT, never as zeroes: the screen then counts what it holds and
    // labels the chips as this-page-only, which is the honest fallback. Fabricating totals on the one
    // screen built to prove nothing disappeared is exactly the wrong failure (this route's own rule).
    if (kc.error) console.error("[owner/audit] kind counts failed:", kc.error.message);
    // `risk` (mig 314) rides along: money / record / data, decided ONCE in the database
    // (lfh_audit_risk) so the strip on the screen cannot classify a row differently from the manager
    // panel's copy of the same record. An older database without the column simply sends nothing and
    // the screen falls back to auditsort.js's map, which is the same map.
    // `tags` (mig 336) rides along the same way, from lfh_audit_tags — one answer for all three
    // screens. And 'removal_classified' is dropped to MATCH THE LIST: the list excludes it because it
    // is an answer, not a removal, so leaving it in the counts would offer a chip that filters to
    // nothing — the "never a 0 chip to tap" rule this screen already keeps.
    else kindCounts = ((kc.data || []) as { kind: string; n: number; amount: number; risk?: string; tags?: string[] }[])
      .filter((x) => x.kind !== "removal_classified")
      .map((x) => ({ kind: x.kind, n: Number(x.n) || 0, amount: Number(x.amount) || 0, ...(x.risk ? { risk: x.risk } : {}), ...(Array.isArray(x.tags) ? { tags: x.tags } : {}) }));
  }
  return NextResponse.json({
    removals,
    page, pageSize: limit, total, pages: Math.max(1, Math.ceil(total / limit)),
    ...(kindCounts ? { kindCounts } : {}),
    ...(names.partial ? { partial: ["restaurantNames"] } : {}),
  });
}
