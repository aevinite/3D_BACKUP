// /api/admin/bills — the ADMIN bill LEDGER: one row per bill (a session + its orders),
// bucketed by state (running / settled / pay-later / on-house / closed-unpaid / deleted),
// across all restaurants or one. Unlike the old bill-audit change-log, this shows the bills
// themselves — WITH amounts (owner's oversight view: you must be able to see if a real sale
// was made to vanish). Deleted bills are NEVER erased — they stay here, tombstoned.
//
//   GET  ?restaurant_id=<uuid>  scope to one restaurant
//        ?state=<bucket>        filter to one state bucket
//        ?limit=<n>             cap (default 200, max 500)
//        ?before=<iso>          "Load more" cursor — bills created before this instant
//        ?from=<iso>&?to=<iso>  a date window, so an OLD bill can be reached at all
//        ?q=<text>              find one bill by its bill no / invoice no / table
//        ?trail=<sessionId>     instead of the list, return that ONE bill's action trail
//   POST { action:'delete'|'restore', sessionId, reason? }  admin soft-delete / restore ANY bill
//
// THE ADMIN MUST BE ABLE TO REACH A DELETED BILL AT ANY TIME (owner, 2026-08-04: "admin can see
// it and he can reopen at any time"). Until now this endpoint read the newest ~200 sessions
// ACROSS ALL RESTAURANTS and only then filtered to the chosen state — so pressing "🗑️ Deleted"
// did not search for deleted bills, it searched inside that window. On a two-restaurant day 200
// sessions is comfortably less than a day, which meant a bill deleted YESTERDAY was already
// unreachable, the chip could read 0 while deleted bills existed, and the "you can restore them"
// promise (and the 90-day retention behind it) could not be kept. Nowhere else in the product
// lists deleted bills: /aevinite/recycle holds restaurants and owners only, and the owner panel
// shows a deletion as an audit LINE with no restore. This screen is the whole story, so the
// filter now runs in the DATABASE, with a date window, a search and a cursor.
//
// Egress-safe: sessions capped + scoped, orders fetched once by session-id set, explicit
// column lists, no select("*") on the hot path.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { softDeleteOrders, restoreOrders } from "@/lib/softDelete";
import { recordRemoval } from "@/lib/removalAudit";
import { rollUpBill, type BillSession, type BillOrder, type BillState } from "@/lib/billLedger";
import { withIdempotency } from "@/lib/idempotency";
import { invalidateFloor } from "@/lib/floorSummary";

export const dynamic = "force-dynamic";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const SESSION_COLS = "id, status, bill_no, invoice_no, invoice_voided, table_number, restaurant_id, opened_at, closed_at, created_at, deleted_at, deleted_by, delete_reason";
const ORDER_COLS = "id, session_id, total, discount, tax_rate, status, payment_status, payment_method, khata_at, deleted_at, deleted_by, delete_reason";

// What an order was actually worth, net of its discount — see lib/billLedger.ts netOf() for why
// `total` alone overstates a discounted bill.
const netAmount = (o: { total?: number | null; discount?: number | null; tax_rate?: number | null }) => {
  const total = Number(o.total) || 0;
  const disc = Number(o.discount) || 0;
  if (disc <= 0) return total;
  const rate = Number(o.tax_rate) > 0 ? Number(o.tax_rate) : 0;
  return Math.round((total - disc * (1 + rate)) * 100) / 100;
};

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
    // Capped like every other read on this route (200 / 50 / 5000 below) — it was the one that
    // stated no ceiling, against the module checklist's egress rule. A bill of 400 KOTs is already
    // refused elsewhere as implausible, so 500 is far above anything real.
    const orderRows = (await sb.from("orders").select("id").eq("session_id", trail).limit(500)).data as { id: string }[] | null;
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
    // Invoice history — the append-only generate/void timeline for this bill (mig 189).
    const invRows = (await sb.from("invoice_events").select("event, invoice_no, reason, actor, created_at")
      .eq("session_id", trail).order("created_at", { ascending: true }).limit(50)).data as
      { event: string; invoice_no: number | null; reason: string | null; actor: string | null; created_at: string }[] | null;
    const invoiceHistory = (invRows || []).map((e) => ({ event: e.event, no: e.invoice_no, reason: e.reason, actor: e.actor, at: e.created_at }));
    // Credit notes issued against this bill (mig 194) — post-settlement corrections.
    const cnRows = (await sb.from("credit_notes").select("credit_no, amount, reason, actor, created_at")
      .eq("session_id", trail).order("created_at", { ascending: true }).limit(50)).data as
      { credit_no: number; amount: number; reason: string | null; actor: string | null; created_at: string }[] | null;
    const creditNotes = (cnRows || []).map((c) => ({ no: c.credit_no, amount: Number(c.amount) || 0, reason: c.reason, actor: c.actor, at: c.created_at }));
    return NextResponse.json({ trail: events, invoiceHistory, creditNotes });
  }

  // ── The ledger list ─────────────────────────────────────────────────────────
  const before = url.searchParams.get("before") || "";      // "Load more" cursor
  const from = url.searchParams.get("from") || "";           // date window start
  const to = url.searchParams.get("to") || "";               // date window end
  const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
  const isIso = (s: string) => !!s && !Number.isNaN(Date.parse(s));

  let sq = sb.from("sessions").select(SESSION_COLS).order("created_at", { ascending: false }).limit(limit);
  if (rid && isUuid(rid)) sq = sq.eq("restaurant_id", rid);
  // DELETED is the one state that lives on the session row itself, so it can be asked for
  // directly instead of being sieved out of a window. A whole-bill delete ALWAYS tombstones the
  // session (lib/softDelete.ts stamps it once the last live order goes, and the delete branch
  // below stamps an order-less bill directly), so `deleted_at is not null` is exactly the
  // "deleted" bucket — and idx_sessions_deleted (mig 188) already covers it.
  if (stateFilter === "deleted") sq = sq.not("deleted_at", "is", null);
  // A date window + a cursor are what let the admin walk back past the newest page at all.
  if (isIso(before)) sq = sq.lt("created_at", new Date(before).toISOString());
  if (isIso(from)) sq = sq.gte("created_at", new Date(from).toISOString());
  if (isIso(to)) sq = sq.lte("created_at", new Date(to).toISOString());
  // Search jumps straight to one bill by the numbers a person actually has in front of them.
  // Digits → bill_no / invoice_no; anything else → the table it was on.
  if (q) {
    const m = q.match(/(\d+)(?!.*\d)/);              // last run of digits, so "INV/2026-27/000042" → 42
    const n = m ? parseInt(m[1], 10) : NaN;
    sq = Number.isFinite(n) ? sq.or(`bill_no.eq.${n},invoice_no.eq.${n}`) : sq.eq("table_number", q);
  }

  // The REAL number of deleted bills, counted in the database rather than inside the page — the
  // chip said "0" while deleted bills existed, which is the worst possible thing for the one
  // screen whose job is proving no sale quietly vanished. Rows-free head count, so it is cheap.
  let delCountQ = sb.from("sessions").select("id", { count: "exact", head: true }).not("deleted_at", "is", null);
  if (rid && isUuid(rid)) delCountQ = delCountQ.eq("restaurant_id", rid);

  const [sessQ, restsQ, delQ] = await Promise.all([sq, sb.from("restaurants").select("id, name").is("deleted_at", null), delCountQ]);
  if (sessQ.error) return NextResponse.json({ error: sessQ.error.message }, { status: 500 });

  const sessions = (sessQ.data || []) as unknown as BillSession[];
  const nameById = new Map<string, string>((restsQ.data || []).map((r) => [r.id, r.name]));

  // Orders for exactly these sessions — one scoped read, grouped in JS.
  const sessionIds = sessions.map((s) => s.id);
  const ordersBySession = new Map<string, BillOrder[]>();
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

  // How many times each bill's invoice was generated (>1 = re-issued after a void). One
  // scoped read of the append-only invoice_events (mig 189), counted in JS.
  if (sessionIds.length) {
    const ev = (await sb.from("invoice_events").select("session_id").eq("event", "generate").in("session_id", sessionIds).limit(5000)).data as { session_id: string }[] | null;
    const genBy = new Map<string, number>();
    for (const e of ev || []) genBy.set(e.session_id, (genBy.get(e.session_id) || 0) + 1);
    for (const b of bills) b.invoiceGens = genBy.get(b.sessionId) || 0;
  }

  // Bucket counts for the chips. The derived states (running / settled / pay-later / on-house /
  // closed-unpaid) can only be worked out by rolling a session up with its orders, so those are
  // counts WITHIN the page being shown and are labelled as such by the UI. DELETED is different:
  // it is a real column, so it gets the true database count and can never under-report.
  const counts: Record<string, number> = {};
  for (const b of bills) counts[b.state] = (counts[b.state] || 0) + 1;
  counts.deleted = delQ.count ?? counts.deleted ?? 0;

  if (stateFilter) bills = bills.filter((b) => b.state === stateFilter);

  // The cursor for "Load more". Null once a page comes back short, which is how the UI knows it has
  // reached the end rather than guessing from the count.
  //
  // IT MUST BE THE COLUMN WE SORT AND FILTER ON (2026-08-06). This handed back
  // `bills[last].at`, which is `closed_at ?? created_at` (lib/billLedger.ts), while the query orders
  // by and filters on `created_at` alone. For any settled bill closed_at > created_at, so the next
  // page asked for `created_at < closed_at_of_the_oldest_row` — a boundary LATER than that row's own
  // created_at, which the rows already on screen satisfy. Two real failures: a table opened 20:00 and
  // closed 21:30 re-returned the last 90 minutes of bills as "more"; and a session created three days
  // ago but closed today made page 2 identical to page 1, so "Load more" could never reach older
  // bills at all — on the one screen whose job is proving no sale quietly vanished (this file's own
  // header: "THE ADMIN MUST BE ABLE TO REACH A DELETED BILL AT ANY TIME").
  //
  // Taken from the last SESSION of the unfiltered page, not the last surviving BillRecord: `bills` has
  // just been narrowed by `stateFilter` above, so on e.g. "Pay-later" a page of 200 sessions holding
  // 3 matches would otherwise hand back the 3rd match's timestamp and re-scan the same window forever.
  // Rolling truly-empty sessions out of `bills` (the orderCount/billNo filter) had the same effect.
  const full = sessions.length >= limit;
  const nextBefore = full && sessions.length ? sessions[sessions.length - 1].created_at || null : null;

  const restaurants = (restsQ.data || []).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    bills, counts, total: bills.length, restaurants,
    deletedTotal: delQ.count ?? 0, nextBefore, generatedAt: new Date().toISOString(),
  });
}

// ── Admin soft-delete / restore ANY bill ───────────────────────────────────────
// AT MOST ONCE. `credit_note` calls lfh_issue_credit_note directly, so a double-tap — or a retry
// after a reply was lost — issued TWO credit notes against one bill (the RPC only refuses once the
// running total would exceed the bill, so any partial credit could be doubled). Every other money
// path in the app carries this guard; this was the one that didn't. `delete`/`restore` were always
// safe by nature (they filter on deleted_at) and are unaffected by wrapping.
export const POST = withIdempotency(postImpl, "admin");
async function postImpl(req: NextRequest) {
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
    // A REASON IS REQUIRED, as it is for a manager's delete and for every void. This is the
    // strongest removal in the product — an admin taking out any bill on any restaurant — and it
    // was the one that could leave "no reason recorded" on the Removals record the owner reads.
    const reason = String(body?.reason || "").trim().slice(0, 200);
    if (!reason) return NextResponse.json({ error: "A reason is required to delete a bill." }, { status: 400 });
    const orderRows = (await sb.from("orders").select("id, total, discount, tax_rate").eq("session_id", sessionId).is("deleted_at", null)).data as { id: string; total: number | null; discount: number | null; tax_rate: number | null }[] | null;
    const ids = (orderRows || []).map((o) => o.id);
    const res = await softDeleteOrders(rid, ids, { actor: "Admin", actorId: null, reason });
    // …and into the Audit, the one place a person looks for "what was removed and why". The
    // admin's own bill ledger deleted bills with only an activity-log line, so the biggest
    // removal available anywhere in the product was missing from the Removals record
    // (2026-08-03). One row per order, same shape the panels write.
    for (const o of orderRows || []) {
      await recordRemoval({
        rid, kind: "order_deleted", reason: { note: reason || null }, user: null,
        orderId: o.id, sessionId, tableNumber: sess.table_number != null ? String(sess.table_number) : null,
        // The value REMOVED from the books, net of the bill's own discount (2026-08-05) — the same
        // rule lib/billLedger.ts now uses. `orders.total` carries tax on the PRE-discount subtotal,
        // so the raw column overstated what the guest was ever asked for.
        amount: netAmount(o),
        meta: { from: "admin bill ledger", orders_on_bill: (orderRows || []).length },
      });
    }
    // A session with no orders won't be reached by softDeleteOrders — tombstone it directly.
    if (!ids.length) {
      await sb.from("sessions").update({ deleted_at: new Date().toISOString(), deleted_by: "Admin", delete_reason: reason || null }).eq("id", sessionId).is("deleted_at", null);
    }
    invalidateFloor(rid);
    await logAction("admin", "order_delete", { restaurant_id: rid, table_number: sess.table_number, detail: `admin deleted bill${sess.bill_no ? ` #${sess.bill_no}` : ""}${reason ? ` — ${reason}` : ""}` });
    return NextResponse.json({ ok: true, deleted: res.deleted });
  }

  if (action === "restore") {
    const orderRows = (await sb.from("orders").select("id").eq("session_id", sessionId).not("deleted_at", "is", null)).data as { id: string }[] | null;
    const ids = (orderRows || []).map((o) => o.id);
    const res = await restoreOrders(rid, ids);
    // Un-tombstone the session itself (covers the no-orders case + belt for the rest).
    // Scoped by restaurant like every other write on this route — rid came from this very
    // session two reads ago, so the row was already right; the missing pair was a consistency gap.
    await sb.from("sessions").update({ deleted_at: null, deleted_by: null, deleted_by_id: null, delete_reason: null }).eq("id", sessionId).eq("restaurant_id", rid);
    invalidateFloor(rid);
    await logAction("admin", "bill_restore", { restaurant_id: rid, table_number: sess.table_number, detail: `admin restored bill${sess.bill_no ? ` #${sess.bill_no}` : ""}` });
    return NextResponse.json({ ok: true, restored: res.restored });
  }

  if (action === "credit_note") {
    // Admin issues a CREDIT NOTE against this bill (post-settlement correction, mig 194) —
    // the bill is never edited; a new immutable credit document is recorded.
    const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;
    const reason = String(body?.reason || "").trim().slice(0, 200);
    if (amount <= 0) return NextResponse.json({ error: "Enter a credit amount greater than zero." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "A reason is required to issue a credit note." }, { status: 400 });
    const { data, error } = await sb.rpc("lfh_issue_credit_note", { p_session: sessionId, p_amount: amount, p_reason: reason, p_actor: "Admin" });
    // Code first, prose as the fallback for a database without mig 278 (see that migration's header).
    if (error) return NextResponse.json({ error: (error.code === "LFH02" || /cannot exceed/i.test(error.message)) ? "The credit can't be more than the bill total." : error.message }, { status: error.code === "LFH02" ? 409 : 400 });
    const row = Array.isArray(data) ? data[0] : data;
    await logAction("admin", "credit_note", { restaurant_id: rid, table_number: sess.table_number, detail: `admin credit note #${row?.credit_no} · ₹${amount} on bill${sess.bill_no ? ` #${sess.bill_no}` : ""} — ${reason}` });
    return NextResponse.json({ ok: true, creditNo: row?.credit_no });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
