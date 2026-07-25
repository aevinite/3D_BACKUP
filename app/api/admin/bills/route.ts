// /api/admin/bills — the ADMIN bill LEDGER: one row per bill (a session + its orders),
// bucketed by state (running / settled / pay-later / on-house / closed-unpaid / deleted),
// across all restaurants or one. Unlike the old bill-audit change-log, this shows the bills
// themselves — WITH amounts (owner's oversight view: you must be able to see if a real sale
// was made to vanish). Deleted bills are NEVER erased — they stay here, tombstoned.
//
//   GET  ?restaurant_id=<uuid>  scope to one restaurant
//        ?state=<bucket>        filter to one state bucket
//        ?limit=<n>             cap (default 200, max 500)
//        ?trail=<sessionId>     instead of the list, return that ONE bill's action trail
//   POST { action:'delete'|'restore', sessionId, reason? }  admin soft-delete / restore ANY bill
//
// Egress-safe: sessions capped + scoped, orders fetched once by session-id set, explicit
// column lists, no select("*") on the hot path.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { softDeleteOrders, restoreOrders } from "@/lib/softDelete";
import { rollUpBill, type BillSession, type BillOrder, type BillState } from "@/lib/billLedger";

export const dynamic = "force-dynamic";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const SESSION_COLS = "id, status, bill_no, invoice_no, invoice_voided, table_number, restaurant_id, opened_at, closed_at, created_at, deleted_at, deleted_by, delete_reason";
const ORDER_COLS = "id, session_id, total, discount, status, payment_status, payment_method, khata_at, deleted_at, deleted_by, delete_reason";

async function requireAdmin(req: NextRequest) {
  return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const rid = url.searchParams.get("restaurant_id");
  const stateFilter = url.searchParams.get("state") as BillState | null;
  const trail = url.searchParams.get("trail");
  const limit = Math.min(500, Math.max(20, Number(url.searchParams.get("limit")) || 200));

  // ── Per-bill action trail (lazy, on expand) — keeps the list query lean ──────
  if (trail && isUuid(trail)) {
    const orderRows = (await sb.from("orders").select("id").eq("session_id", trail)).data as { id: string }[] | null;
    const orderIds = (orderRows || []).map((o) => o.id);
    // Actions linked to this bill's orders (delete/discount/revert/invoice) OR table-level
    // events on the session's table around its lifetime. order_id link is exact; the rest we
    // scope to the session's table + restaurant for context.
    const sess = (await sb.from("sessions").select("table_number, restaurant_id, opened_at, created_at, closed_at").eq("id", trail).maybeSingle()).data as
      { table_number: string | null; restaurant_id: string | null; opened_at: string | null; created_at: string | null; closed_at: string | null } | null;
    let events: { action: string; actor: string | null; detail: string | null; at: string }[] = [];
    if (orderIds.length) {
      const byOrder = (await sb.from("staff_actions").select("action, actor, detail, created_at").in("order_id", orderIds).order("created_at", { ascending: true }).limit(200)).data as
        { action: string; actor: string | null; detail: string | null; created_at: string }[] | null;
      events = (byOrder || []).map((e) => ({ action: e.action, actor: e.actor, detail: e.detail, at: e.created_at }));
    }
    return NextResponse.json({ trail: events });
  }

  // ── The ledger list ─────────────────────────────────────────────────────────
  let sq = sb.from("sessions").select(SESSION_COLS).order("created_at", { ascending: false }).limit(limit);
  if (rid && isUuid(rid)) sq = sq.eq("restaurant_id", rid);
  const [sessQ, restsQ] = await Promise.all([sq, sb.from("restaurants").select("id, name").is("deleted_at", null)]);
  if (sessQ.error) return NextResponse.json({ error: sessQ.error.message }, { status: 500 });

  const sessions = (sessQ.data || []) as unknown as BillSession[];
  const nameById = new Map<string, string>((restsQ.data || []).map((r) => [r.id, r.name]));

  // Orders for exactly these sessions — one scoped read, grouped in JS.
  const sessionIds = sessions.map((s) => s.id);
  let ordersBySession = new Map<string, BillOrder[]>();
  if (sessionIds.length) {
    const oQ = await sb.from("orders").select(ORDER_COLS).in("session_id", sessionIds).limit(5000);
    if (oQ.error) return NextResponse.json({ error: oQ.error.message }, { status: 500 });
    for (const o of (oQ.data || []) as unknown as BillOrder[]) {
      const k = o.session_id || "";
      const arr = ordersBySession.get(k) || [];
      arr.push(o); ordersBySession.set(k, arr);
    }
  }

  // Roll up, drop truly-empty sessions (no orders AND no bill number — a tap-and-leave).
  let bills = sessions
    .map((s) => rollUpBill(s, ordersBySession.get(s.id) || [], (s.restaurant_id && nameById.get(s.restaurant_id)) || "—"))
    .filter((b) => b.orderCount > 0 || b.billNo != null);

  // Bucket counts BEFORE the state filter, so the filter chips always show totals.
  const counts: Record<string, number> = {};
  for (const b of bills) counts[b.state] = (counts[b.state] || 0) + 1;

  if (stateFilter) bills = bills.filter((b) => b.state === stateFilter);

  const restaurants = (restsQ.data || []).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ bills, counts, total: bills.length, restaurants, generatedAt: new Date().toISOString() });
}

// ── Admin soft-delete / restore ANY bill ───────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const sessionId = String(body?.sessionId || "");
  if (!isUuid(sessionId)) return NextResponse.json({ error: "bad sessionId" }, { status: 400 });

  const sess = (await sb.from("sessions").select("id, restaurant_id, table_number, bill_no").eq("id", sessionId).maybeSingle()).data as
    { id: string; restaurant_id: string | null; table_number: string | null; bill_no: number | null } | null;
  if (!sess || !sess.restaurant_id) return NextResponse.json({ error: "bill not found" }, { status: 404 });
  const rid = sess.restaurant_id;

  if (action === "delete") {
    const reason = String(body?.reason || "").trim().slice(0, 200);
    const orderRows = (await sb.from("orders").select("id").eq("session_id", sessionId).is("deleted_at", null)).data as { id: string }[] | null;
    const ids = (orderRows || []).map((o) => o.id);
    const res = await softDeleteOrders(rid, ids, { actor: "Admin", actorId: null, reason });
    // A session with no orders won't be reached by softDeleteOrders — tombstone it directly.
    if (!ids.length) {
      await sb.from("sessions").update({ deleted_at: new Date().toISOString(), deleted_by: "Admin", delete_reason: reason || null }).eq("id", sessionId).is("deleted_at", null);
    }
    await logAction("admin", "order_delete", { restaurant_id: rid, table_number: sess.table_number, detail: `admin deleted bill${sess.bill_no ? ` #${sess.bill_no}` : ""}${reason ? ` — ${reason}` : ""}` });
    return NextResponse.json({ ok: true, deleted: res.deleted });
  }

  if (action === "restore") {
    const orderRows = (await sb.from("orders").select("id").eq("session_id", sessionId).not("deleted_at", "is", null)).data as { id: string }[] | null;
    const ids = (orderRows || []).map((o) => o.id);
    const res = await restoreOrders(rid, ids);
    // Un-tombstone the session itself (covers the no-orders case + belt for the rest).
    await sb.from("sessions").update({ deleted_at: null, deleted_by: null, deleted_by_id: null, delete_reason: null }).eq("id", sessionId);
    await logAction("admin", "bill_restore", { restaurant_id: rid, table_number: sess.table_number, detail: `admin restored bill${sess.bill_no ? ` #${sess.bill_no}` : ""}` });
    return NextResponse.json({ ok: true, restored: res.restored });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
