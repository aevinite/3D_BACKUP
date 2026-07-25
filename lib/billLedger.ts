// lib/billLedger.ts — shared bill-state model for the admin bill ledger.
//
// This app has NO `bills` table: a "bill" = a `sessions` row (the tab) + its child
// `orders` (which carry the money + payment state). This helper rolls a session and
// its orders into ONE ledger record with a single primary STATE bucket, so the admin
// can see at a glance what every bill is: running, settled, pay-later, on-the-house,
// cancelled, or deleted — plus a "reopened" flag when a tax invoice was voided.
import { ON_THE_HOUSE_METHOD } from "@/lib/tableTags";

export type BillState =
  | "running"    // table open now, bill still growing
  | "settled"    // paid & closed — a normal finished bill
  | "khata"      // pay-later parked — closed but money owed to the book
  | "onhouse"    // comped — zero collected
  | "cancelled"  // closed unpaid / walked out / all-cancelled
  | "deleted";   // soft-deleted — kept + tombstoned, never erased

export const BILL_STATE_META: Record<BillState, { label: string; tone: string; emoji: string }> = {
  running:   { label: "Running",        tone: "#22c55e", emoji: "🟢" },
  settled:   { label: "Settled",        tone: "#3b82f6", emoji: "✅" },
  khata:     { label: "Pay-later",      tone: "#a855f7", emoji: "💜" },
  onhouse:   { label: "On the house",   tone: "#14b8a6", emoji: "🎁" },
  cancelled: { label: "Closed unpaid",  tone: "#f59e0b", emoji: "🟠" },
  deleted:   { label: "Deleted",        tone: "#ef4444", emoji: "🗑️" },
};

// The minimal order shape this logic needs (kept tiny for egress).
export type BillOrder = {
  id: string;
  session_id: string | null;
  total: number | null;
  discount: number | null;
  status: string | null;         // received/preparing/served/cancelled
  payment_status: string | null; // pending/paid
  payment_method: string | null;
  khata_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

export type BillSession = {
  id: string;
  status: string | null;         // open/pending/closed
  bill_no: number | null;
  invoice_no: number | null;
  invoice_voided: boolean | null;
  table_number: string | null;
  restaurant_id: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

const gross = (os: BillOrder[]) => os.reduce((s, o) => s + (Number(o.total) || 0), 0);

// Derive the one primary state bucket for a bill from its session + orders.
export function deriveBillState(session: BillSession, orders: BillOrder[]): BillState {
  const hasOrders = orders.length > 0;
  // DELETED wins: the whole session was tombstoned, or every order is soft-deleted.
  if (session.deleted_at || (hasOrders && orders.every((o) => o.deleted_at))) return "deleted";

  const live = orders.filter((o) => !o.deleted_at);
  // RUNNING: the tab is still open (money can still be added).
  if (session.status !== "closed") return "running";

  // Closed — classify by how it settled. Priority: pay-later > on-house > paid > unpaid.
  if (live.some((o) => o.khata_at && o.payment_status !== "paid")) return "khata";
  if (live.some((o) => o.payment_method === ON_THE_HOUSE_METHOD)) return "onhouse";
  if (live.some((o) => o.payment_status === "paid")) return "settled";
  return "cancelled"; // closed with nothing collected (walk-out / all cancelled)
}

// One rolled-up ledger record for the UI.
export type BillRecord = {
  sessionId: string;
  billNo: number | null;
  invoiceNo: number | null;
  invoiceVoided: boolean;      // → "reopened / corrected" badge
  restaurantId: string | null;
  restaurantName: string;
  table: string | null;
  state: BillState;
  amount: number;              // headline total (live orders; for a deleted bill, the removed total)
  paid: number;                // how much was actually collected
  orderCount: number;
  openedAt: string | null;
  closedAt: string | null;
  at: string | null;           // sort key (closed_at ?? created_at)
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

export function rollUpBill(session: BillSession, orders: BillOrder[], restaurantName: string): BillRecord {
  const state = deriveBillState(session, orders);
  const live = orders.filter((o) => !o.deleted_at);
  const forTotal = state === "deleted" ? orders : live;
  const paid = live.filter((o) => o.payment_status === "paid");
  return {
    sessionId: session.id,
    billNo: session.bill_no,
    invoiceNo: session.invoice_no,
    invoiceVoided: session.invoice_voided === true,
    restaurantId: session.restaurant_id,
    restaurantName,
    table: session.table_number,
    state,
    amount: gross(forTotal),
    paid: gross(paid),
    orderCount: orders.length,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    at: session.closed_at || session.created_at,
    deletedAt: session.deleted_at || (orders.find((o) => o.deleted_at)?.deleted_at ?? null),
    deletedBy: session.deleted_by || (orders.find((o) => o.deleted_by)?.deleted_by ?? null),
    deleteReason: session.delete_reason || (orders.find((o) => o.delete_reason)?.delete_reason ?? null),
  };
}
