// GET /api/admin/audit — the Removals record across ALL restaurants (deletion_audit,
// mig 251): every cancelled KOT, deleted bill, dish taken off an order or off the menu,
// with the reason and the person. This is the "Audit" tab of the admin's Audit & logs
// page; the activity feed is /api/admin/oplog. Admin-gated; the admin always sees every
// restaurant's rows — the Access screen's sub-options limit managers and owners, never
// the admin. Amounts are shown (same oversight rule as the admin Bills ledger).
//
// Egress-safe: explicit column list, optional restaurant scope, hard limit — never a
// whole-table read. deletion_audit is indexed (restaurant_id, at DESC).
// BEFORE vs AFTER, and the bill as it stood (owner, 2026-08-12) — see lib/auditDetail.ts.
import { auditAfter, auditBillHtml } from "@/lib/auditDetail";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { safeSearch } from "@/lib/searchText";

export const dynamic = "force-dynamic";

const COLS = "id, at, kind, reason_code, reason_note, actor, actor_role, table_number, bill_no, invoice_no, kot_no, item_title, qty, amount, restaurant_id";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 300);
  const restaurantId = url.searchParams.get("restaurant_id");
  if (restaurantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  // ?q= free-text search over the dish title, the person and the typed reason.
  const qText = (url.searchParams.get("q") || "").trim().slice(0, 80);

  // ── ?detail=<id> — ONE removal, in full (owner, 2026-08-04) ─────────────────────────────────
  // Click a row and see how it was: which KOT, every item on it with its quantity and price, the
  // totals, the customer, the time and day, who did it and from which restaurant. `meta` holds the
  // item-by-item snapshot (lib/removalAudit.ts), so it is fetched lazily rather than riding along
  // with 200 list rows — the same shape as the bill ledger's ?trail=.
  //
  // `canRestore` tells the UI whether to offer putting it back. TRUE only here, on the admin's own
  // route: the owner's identical view (/api/owner/audit) returns false and has no write path at
  // all. Only the admin changes anything; everyone else can look (owner rule, 2026-08-04).
  const detailId = url.searchParams.get("detail");
  if (detailId) {
    if (!/^\d+$/.test(detailId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const one = (await sb.from("deletion_audit")
      .select(`${COLS}, session_id, order_id, item_id, device_id, meta`)
      .eq("id", Number(detailId)).limit(1)).data?.[0] as Record<string, unknown> | undefined;
    if (!one) return NextResponse.json({ error: "not found" }, { status: 404 });
    const rn = one.restaurant_id
      ? (await sb.from("restaurants").select("name").eq("id", String(one.restaurant_id)).maybeSingle()).data?.name ?? null
      : null;
    // Is the thing it describes still restorable? A soft-deleted order can be put back; a
    // cancellation or a menu-item removal is a different kind of correction. Answered from the
    // live row so the button is never offered for something that cannot be undone.
    let restorable = false;
    if (one.kind === "order_deleted" && one.order_id) {
      const live = (await sb.from("orders").select("deleted_at").eq("id", String(one.order_id)).maybeSingle()).data as { deleted_at?: string | null } | null;
      restorable = !!live?.deleted_at;
    }
    // The two boxes and the bill. `auditAfter` re-reads the order anyway, so the restorable check
    // above and this share the same truth about whether the row is tombstoned.
    const meta = (one.meta || {}) as Record<string, unknown>;
    const rid2 = String(one.restaurant_id || "");
    const [after, billHtml] = await Promise.all([
      auditAfter(rid2, one.order_id ? String(one.order_id) : null),
      auditBillHtml(rid2, (meta.was || null) as Record<string, unknown> | null),
    ]);
    return NextResponse.json({ removal: { ...one, restaurant_name: rn }, after, billHtml, canRestore: restorable });
  }

  let q = sb.from("deletion_audit").select(COLS).order("at", { ascending: false }).limit(limit);
  if (restaurantId) q = q.eq("restaurant_id", restaurantId);
  if (qText) {
    // Shared cleaner — see the note in app/api/admin/oplog/route.ts (2026-08-16).
    const safe = safeSearch(qText);
    q = q.or(`item_title.ilike.%${safe}%,actor.ilike.%${safe}%,reason_note.ilike.%${safe}%`);
  }

  const r = await q;
  if (r.error) return adminFail("the removals record", r.error, { action: "load" });
  const rows = r.data ?? [];

  // Stamp each row with WHICH restaurant it belongs to — one batched name lookup, no N+1
  // (same pattern as /api/admin/oplog).
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, x.name);
  }
  const removals = rows.map((a) => ({ ...a, restaurant_name: a.restaurant_id ? nameById.get(a.restaurant_id) ?? null : null }));
  return NextResponse.json({ removals });
}
