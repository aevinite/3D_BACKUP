// lib/removalAudit.ts — the ONE way a money-lowering change gets into the Audit record.
//
// WHY THIS IS SERVER-SIDE (owner, 2026-08-02, after driving the real panel on Aangan Garden).
// Migration 251 named five removal kinds; only two were ever written, and the BROWSER wrote them
// (app.js called POST /audit after the action). Anything the browser forgot was simply never
// recorded — removing a dish, reopening a bill and deleting a menu item all recorded nothing, and
// the waiter panel recorded nothing at all. A record that depends on a client remembering is not a
// record. So recording now happens INSIDE the endpoint that makes the change: every panel, every
// role, an offline replay and any panel built later are covered without being told.
//
// The REASON still comes from the person (only a human can say why), so the action endpoints accept
// `reason_code` / `reason_note` in their body and pass them here. When none is given the row is
// still written — the panels render "no reason recorded", which is the honest thing to show, and
// far better than the change leaving no trace.
//
// BEST-EFFORT ON PURPOSE: the change itself has already happened and has already been logged to the
// activity log, so a failure here must never make a successful removal look failed. It is reported
// as an error-level activity row (so it shows red in the admin's log) and never swallowed silently.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";
import type { StaffUser } from "@/lib/userAuth";

/** Every kind the Audit (Removals) view knows how to label. Keep in step with the label maps in
 *  public/panels/editor/app.js (AUDIT_KIND), app/owner/activity/page.tsx and
 *  app/aevinite/logs/page.tsx (REMOVAL_KIND) — a kind with no label renders as its raw key.
 *  Guarded by scripts/verify-audit-coverage.mjs. */
export type RemovalKind =
  | "order_cancelled"     // a KOT voided — nothing charged to the guest
  | "order_deleted"       // a bill taken off the manager's working list (tombstoned, restorable —
                          //   it STAYS in the reports, the Z-report and the tax return; see
                          //   lib/accessTree.ts's delete_bill row for why the wording matters)
  | "dish_removed"        // one dish taken off a live order
  | "qty_reduced"         // a dish's quantity lowered on a live order
  | "menu_item_deleted"   // a dish / category / tag taken off the menu
  | "invoice_voided"      // a settled bill reopened for edits
  | "discount_given"      // money taken off a bill
  | "payment_reverted"    // a bill marked paid, then un-marked
  | "on_the_house"        // a bill settled with no money collected
  // Not a removal — the AFTER half of a reopen. Recorded when a reopened bill is re-issued, so
  // the Audit shows what the bill was worth before, what it is worth now, and what moved
  // (owner, 2026-08-05: "before and after will also be shown in the audit section"). A reopen
  // that adds food RAISES the bill, so without this the trail only ever showed the lower number.
  | "bill_changed_after_reopen"
  // A GUEST'S PERSONAL DATA, ERASED ON REQUEST (owner, 2026-08-12: "delete — it will go in audit
  // and stuff"). The only irreversible erase in the owner panel: it clears the guest, their visit
  // history, their devices and their pay-later person record, with no tombstone and no restore.
  // The Activity log records who pressed it; this records that it HAPPENED, on the screen someone
  // would actually check when a guest is missing. Only the last 4 phone digits are kept — an audit
  // of an erasure must not become a fresh copy of the number we were asked to erase.
  | "customer_erased"
  // Also not a removal — the REVERSAL of one. A delete wrote a permanent row here while a restore
  // wrote only an Activity-log line, and that log is cleared after 30 days at most (mig 158,
  // settable to 1 day). So a month later the lasting record said a bill had been removed, with a
  // reason and a person, and carried nothing to say it had been put back — which reads worse than
  // what actually happened (T7 finding F4, 2026-08-11).
  | "order_restored";

export type RemovalReason = { code?: string | null; note?: string | null };

/** Pull the person's stated reason out of a request body, whatever shape the panel sent.
 *  `reason` alone (the older delete-bill/void-invoice bodies) becomes the free-text note, so those
 *  call sites keep working unchanged and still record something meaningful. */
export function reasonFromBody(body: unknown): RemovalReason {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  return { code: str(b.reason_code), note: str(b.reason_note) || str(b.reason) };
}

type RecordArgs = {
  rid: string;
  kind: RemovalKind;
  reason?: RemovalReason;
  /** The signed-in staff member. Absent = the admin super-user acting from a panel view. */
  user?: StaffUser | null;
  deviceId?: string | null;
  orderId?: string | null;
  /** For a bill-level event with no single order behind it (reopen, on-the-house). */
  sessionId?: string | null;
  itemId?: string | null;
  itemTitle?: string | null;
  qty?: number | null;
  /** What it was worth. Pass it for a single dish — its row is usually gone by now. */
  amount?: number | null;
  tableNumber?: string | null;
  /** Anything extra worth keeping: the before/after values of what changed. */
  meta?: Record<string, unknown>;
};

/** What the thing LOOKED LIKE at the moment it was removed (owner, 2026-08-04).
 *
 * "You should be able to click and view the full — how it was and what he changed, which KOT he
 * deleted and what was the item, with time, day, everything, who has done it, with restaurant."
 *
 * The Audit recorded a deleted bill's VALUE (`amount`) and which table it was on, and nothing at
 * all about what was on it. So "₹1,150 deleted from table 6" could not be checked, argued with, or
 * put right — the one question a person actually asks ("what did they take off?") had no answer.
 *
 * The snapshot is taken HERE rather than at the ~12 call sites, for the same reason recording
 * itself moved server-side: anything that depends on a caller remembering is not a record. One
 * extra indexed read per removal, and only on a removal, so it costs nothing in normal service.
 *
 * Deliberately a COPY, not a join: the row it describes can be edited or (for a menu item) really
 * gone by the time anyone looks, so the Audit has to hold its own evidence.
 */
async function snapshotOrder(rid: string, orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const o = (await sb.from("orders")
      .select("id, kot_no, table_number, session_id, items, subtotal, discount, discount_note, total, tax, status, payment_status, payment_method, created_at, allergies")
      .eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as Record<string, unknown> | null;
    if (!o) return null;
    // The bill numbers live on the SESSION, and they are what a person quotes when they ask about
    // a bill — so resolve them into the snapshot rather than leaving a uuid nobody can use.
    let bill: Record<string, unknown> | null = null;
    if (o.session_id) {
      bill = (await sb.from("sessions").select("bill_no, invoice_no, invoice_at, opened_at, cust_name, cust_phone")
        .eq("id", String(o.session_id)).maybeSingle()).data as Record<string, unknown> | null;
    }
    const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
    return {
      kot_no: o.kot_no ?? null,
      table_number: o.table_number ?? null,
      bill_no: bill?.bill_no ?? null,
      invoice_no: bill?.invoice_no ?? null,
      customer: bill?.cust_name ?? null,
      customer_phone: bill?.cust_phone ?? null,
      ordered_at: o.created_at ?? null,
      status: o.status ?? null,
      payment_status: o.payment_status ?? null,
      payment_method: o.payment_method ?? null,
      subtotal: o.subtotal ?? null,
      discount: o.discount ?? null,
      discount_note: o.discount_note ?? null,
      tax: o.tax ?? null,
      total: o.total ?? null,
      allergies: Array.isArray(o.allergies) ? o.allergies : null,
      // Trimmed to what a person reads on a bill line. Capped so one enormous order can never
      // bloat the audit row (the count is kept, so a truncated snapshot says so honestly).
      item_count: items.length,
      items: items.slice(0, 60).map((it) => ({
        title: it.title ?? null,
        qty: it.qty ?? null,
        price: it.price ?? null,
        options: Array.isArray(it.options) ? it.options : null,
        removed: Array.isArray(it.removed) ? it.removed : null,
        note: it.note ?? null,
      })),
      items_truncated: items.length > 60,
    };
  } catch {
    return null;   // the removal already happened — never let evidence-gathering undo it
  }
}

/** Write one Audit row. Never throws. */
export async function recordRemoval(a: RecordArgs): Promise<void> {
  try {
    // Capture what it WAS before writing the row, unless the caller already passed its own
    // `was` (a dish removal knows the single line better than a re-read would).
    let meta = a.meta ?? {};
    if (a.orderId && !("was" in meta)) {
      const was = await snapshotOrder(a.rid, a.orderId);
      if (was) meta = { ...meta, was };
    }
    const { error } = await sb.rpc("lfh_record_removal", {
      p_rid: a.rid,
      p_kind: a.kind,
      p_reason_code: a.reason?.code ?? null,
      p_reason_note: a.reason?.note ?? null,
      // An admin acting from a panel view has no staff cookie — record that plainly rather than
      // leaving the row unattributed ("who did this?" must always have an answer).
      p_actor: a.user?.name || a.user?.username || "Admin (Aevidine)",
      p_actor_id: a.user?.id ?? null,
      p_actor_role: a.user?.role || "admin",
      p_device: a.deviceId ?? null,
      p_order: a.orderId ?? null,
      p_item: a.itemId ?? null,
      p_item_title: a.itemTitle ?? null,
      p_qty: a.qty ?? null,
      p_amount: a.amount ?? null,
      p_table: a.tableNumber ?? null,
      p_meta: meta,
      p_session: a.sessionId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    // Reported, never silent — but never fatal to the action that already succeeded.
    try {
      await logAction("manager", "audit_record_failed", {
        restaurant_id: a.rid, level: "error",
        detail: `${a.kind}: ${e instanceof Error ? e.message : String(e)}`,
      });
    } catch {}
  }
}
