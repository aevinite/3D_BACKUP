// lib/sessionClose.ts — the ONE table-close used by BOTH the manager (editor) and
// tablet routes, so the rule is genuinely identical instead of copy-pasted in two
// places (the tablet copy also used to swallow its cleanup errors — fixed here).
//
// Rule: a table can't be closed while any live order is still COOKING
// (received/preparing) OR has an UNPAID bill — unless force=true ("close anyway").
// On a clear/forced close: mark the session closed, LOG any money still owed (so
// it's never silently erased), CANCEL un-served unpaid work (the meal's over), and
// ARCHIVE everything else as the bill record. Every write is error-checked.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";
import { recordRemoval } from "@/lib/removalAudit";
import type { StaffUser } from "@/lib/userAuth";

const nowIso = () => new Date().toISOString();
const must = (r: { error: { message: string } | null; data: unknown }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as any[];
};

export type CloseResult =
  | { ok: false; status: number; message: string; reason: "unpaid" | "cooking" | "both" | "not_found" }
  | { ok: true; session: any };

export type OrderLite = { status?: string | null; payment_status?: string | null };

// Clear a table's live guest signals — resolve open waiter-calls + deny pending join/open
// requests — scoped to ONE restaurant + table. Used by BOTH the manual /tables/:t/restart
// endpoint so the restart and close cleanups can't drift. A restart keeps
// the session OPEN, so the mig-020 close trigger never fires — this MUST be done explicitly,
// or an unanswered call from the old party leaves a ghost 🔔 badge + ATTEND on the emptied
// table (#7 fixed the manual path; the auto path had the same gap). Best-effort; never throws.
export async function clearTableSignals(
  rid: string | null | undefined,
  tableNumber: string | number | null | undefined,
): Promise<void> {
  if (!rid || tableNumber == null) return;
  const t = String(tableNumber);
  try {
    await sb.from("waiter_calls").update({ resolved: true }).eq("resolved", false).eq("restaurant_id", rid).eq("table_number", t);
    await sb.from("requests").update({ status: "denied" }).eq("status", "pending").eq("restaurant_id", rid).eq("table_number", t);
  } catch { /* best-effort — cleanup must never break the restart that triggered it */ }
}

// Pure decision: given the session's live (non-archived, non-cancelled) orders,
// can it be closed? Blocked when any order is still COOKING (received/preparing)
// OR UNPAID — unless force=true. Exported so the rule can be unit-tested directly.
export function closeBlock(orders: OrderLite[], force: boolean):
  | null
  | { reason: "unpaid" | "cooking" | "both"; status: number; message: string } {
  if (force) return null;
  const cooking = orders.some((o) => o.status === "received" || o.status === "preparing");
  const unpaid = orders.some((o) => o.payment_status !== "paid");
  if (!cooking && !unpaid) return null;
  const reason = unpaid && cooking ? "both" : unpaid ? "unpaid" : "cooking";
  const message =
    reason === "both" ? "This table still owes money and has orders still cooking — settle and serve, or close anyway."
    : reason === "unpaid" ? "This table still owes money — settle the bill, or close anyway."
    : "This table still has orders cooking — serve them, or close anyway.";
  return { reason, status: 409, message };
}

export async function closeSession(
  sessionId: string,
  opts: { force?: boolean },
  ctx: {
    panel: "editor" | "tablet" | "admin";
    deviceId?: string | null;
    /** WHICH RESTAURANT — required, not optional (T25 round 2, item 30, 2026-08-31). Every write in
     *  this function is keyed by `session_id` alone, so the ownership check below is the only thing
     *  keeping a close inside the restaurant that asked for it — and it used to be skipped when this
     *  was absent. */
    restaurantId: string;
    /** Who closed it — so the Audit row for a written-off bill names a person, not "someone". */
    user?: StaffUser | null;
    /** Why, when the panel asked (the "close anyway" dialog). */
    reason?: { code?: string | null; note?: string | null };
  },
): Promise<CloseResult> {
  const force = opts.force === true;

  // Confirm the session belongs to the acting restaurant before closing it. The session id
  // is client-supplied and every query below keys on session_id alone (service-role bypasses
  // RLS), so without this a panel scoped to one restaurant could close another restaurant's
  // table. The neighbouring invoice/void/shift actions already do this same pre-check; close
  // was the gap.
  //
  // ⚠️ IT USED TO BE OPT-IN (T25 round 2, item 30, 2026-08-31). The line here read
  // `if (ctx.restaurantId)`, and the note beside it said *"kept optional so an unscoped caller still
  // works"* — so the ONE check that scopes eight writes was skipped entirely by a caller that did not
  // pass it. All eight callers DO pass it (checked, one by one), so nothing was wrong on the floor;
  // what was wrong is that being right depended on every future caller remembering. The field is now
  // required by the type and refused when absent.
  if (!ctx.restaurantId) {
    return { ok: false, status: 400, message: "Couldn't tell which restaurant this table belongs to.", reason: "not_found" };
  }
  {
    const owns = (await sb.from("sessions").select("id").eq("id", sessionId).eq("restaurant_id", ctx.restaurantId).maybeSingle()).data;
    if (!owns) return { ok: false, status: 404, message: "That table isn't for this restaurant.", reason: "not_found" };
  }

  // Live orders that would block a close: not archived, not cancelled, and either
  // still cooking OR not yet paid. Decision lives in the pure closeBlock() helper.
  // BOUNDED (T25 round 2, item 31): the orders on ONE table. 500 is far past a real bill, and an
  // unbounded read is silently capped at 1,000 — which here would mean closing a table while a
  // blocker sat past the cap, unseen.
  const blockers = must(await sb.from("orders").select("id,status,payment_status")
    .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled").limit(500));
  const block = closeBlock(blockers, force);
  if (block) return { ok: false, status: block.status, message: block.message, reason: block.reason };

  // READ THE MONEY STILL OWED **BEFORE** THE SESSION IS CLOSED. Since mig 232 the DB's own
  // close trigger cancels+archives whatever is still live on the session (so orders can never
  // outlive their session, however the close happened) — which means asking AFTER the update
  // would find nothing and this compliance log ("closed with N unpaid order(s), ₹X owed")
  // would silently stop recording walk-outs. Scoped to THIS session, never the bare table
  // number, which could hit a different party that later sat at the same table.
  const owedRows = must(await sb.from("orders").select("id,total,discount,subtotal,tax,khata_at")
    .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid")
    .limit(500));

  const row = must(await sb.from("sessions").update({ status: "closed", closed_at: nowIso() }).eq("id", sessionId).select());
  const sess = row[0];
  if (sess) {
    if (owedRows.length) {
      // Discount is stored PRE-TAX, so the amount actually owed drops by discount×(1+rate),
      // not by the bare discount (matching the bill math everywhere else). Derive each order's
      // rate from its own stored tax/subtotal — no RPC needed, and correct per-restaurant. (#6)
      const owed = owedRows.reduce((s: number, o: any) => {
        const sub = Number(o.subtotal) || 0, tax = Number(o.tax) || 0;
        const rate = sub > 0 ? tax / sub : 0;
        return s + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate);
      }, 0);
      await logAction(ctx.panel, "close_unpaid", { restaurant_id: sess.restaurant_id ?? undefined, table_number: sess.table_number ?? null, detail: `closed with ${owedRows.length} unpaid ${owedRows.length === 1 ? "order" : "orders"}, ₹${Math.round(owed * 100) / 100} owed`, device_id: ctx.deviceId ?? undefined });
      // …AND into the Audit (2026-08-03). Closing a table that still owes money writes the bill
      // OFF — the orders below are cancelled, so the money never becomes a sale. That is the
      // single largest money-lowering event in the product and it lived only in the activity log,
      // where nobody looking at "what was removed and why" would ever find it. One row per order
      // that is actually cancelled (khata is money to collect later, not a write-off).
      for (const o of owedRows as { id: string; total: number | null; khata_at: string | null }[]) {
        if (o.khata_at) continue;
        await recordRemoval({
          rid: sess.restaurant_id,
          kind: "order_cancelled",
          reason: {
            code: ctx.reason?.code ?? null,
            note: ctx.reason?.note || "Table closed while the bill was still unpaid (walk-out / written off)",
          },
          user: ctx.user ?? null, deviceId: ctx.deviceId ?? null,
          orderId: o.id, sessionId, tableNumber: sess.table_number != null ? String(sess.table_number) : null,
          amount: Number(o.total) || 0,
          meta: { closed_unpaid: true, orders_on_bill: owedRows.length, owed: Math.round(owed * 100) / 100, panel: ctx.panel },
        });
      }
    }
    // Force-closing a table that still owes money is a walk-out / write-off: CANCEL every
    // unpaid order on the bill — not just the un-served ones — so the whole bill shows as
    // ✕ Cancelled (a visible record, never a real sale). Previously only cooking orders
    // (received/preparing) were cancelled and SERVED-but-unpaid food was merely archived,
    // so an eaten walk-out left no cancelled record (owner, 2026-07-24). EXCLUDE khata
    // orders (khata_at set) — a parked tab is money-to-collect-later, not a cancellation.
    // archived_at/cancelled_at start the 30-min "restore to floor" grace window (mig 112).
    must(await sb.from("orders").update({ status: "cancelled", archived: true, archived_at: nowIso(), cancelled_at: nowIso() })
      .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid").is("khata_at", null).select());
    must(await sb.from("orders").update({ archived: true, archived_at: nowIso() })
      .eq("session_id", sessionId).eq("archived", false).select());
    // The round is over — RELEASE the head + every partner from this session, so the
    // table isn't left "connected" to the last party. A new party re-joins fresh on
    // the next open/scan. (owner, 2026-06-18)
    must(await sb.from("session_members").update({ removed: true })
      .eq("session_id", sessionId).eq("removed", false).select());
    // Also clear any TABLE-scoped guest signals the close trigger misses: a waiter-call
    // left by a guest who never joined a session (session_id = NULL, from
    // lfh_call_waiter_table) is keyed to the table only, so the mig-020 close trigger
    // (WHERE session_id = …) never resolves it — and it then reappears as a phantom 🔔
    // ATTEND on the NEXT party at this table. Restart already clears these; close now
    // does too. Best-effort (clearTableSignals never throws). (audit 2026-07-08)
    await clearTableSignals(sess.restaurant_id, sess.table_number);
  }
  await logAction(ctx.panel, "table_close", { restaurant_id: sess?.restaurant_id ?? undefined, table_number: sess?.table_number ?? null, device_id: ctx.deviceId ?? undefined });
  return { ok: true, session: sess || null };
}
