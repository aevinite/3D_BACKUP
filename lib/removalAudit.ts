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
  | "order_deleted"       // a bill taken out of the reports (tombstoned, restorable)
  | "dish_removed"        // one dish taken off a live order
  | "qty_reduced"         // a dish's quantity lowered on a live order
  | "menu_item_deleted"   // a dish / category / tag taken off the menu
  | "invoice_voided"      // a settled bill reopened for edits
  | "discount_given"      // money taken off a bill
  | "payment_reverted"    // a bill marked paid, then un-marked
  | "on_the_house";       // a bill settled with no money collected

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

/** Write one Audit row. Never throws. */
export async function recordRemoval(a: RecordArgs): Promise<void> {
  try {
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
      p_meta: a.meta ?? {},
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
