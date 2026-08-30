// lib/tableOfAction.ts — "which TABLE does this write touch?"
//
// SERVER-ONLY (imports supabaseAdmin). Split out of lib/tableAssign.ts so that TWO
// features can share one resolver instead of each growing its own:
//   • waiter sections  (lib/tableAssign.ts)  — may this waiter touch that table?
//   • offline clashes  (lib/clash.ts)        — has that table moved on since?
//
// It was extracted rather than copied because the two live deployments are at different
// points: the sections module isn't released on the client stack, and shipping the whole
// of tableAssign.ts there would have dragged an unreleased feature onto a live client.
// One small shared file keeps both stacks on the SAME code with no fork.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

// Table numbers are TEXT in every operational table (orders/sessions/waiter_calls/
// requests/table_tags) but INTEGER[] on the staff row, so all comparing is done on
// normalised STRINGS. "007" and 7 must be the same table.
export const normTable = (v: unknown): string => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? String(n) : "";
};

export type Affected = { tables: string[]; unknown: boolean };

// ── Resolving "which table does this write touch?" ───────────────────────────
//
// Most tablet writes name a row id, not a table. Rather than bolting a check onto each
// of the ~38 POST branches (easy to miss one when a new action lands), the dispatcher
// asks THIS resolver once, up front, using the same `[a, b, c]` path segments it already
// destructured. A new `orders/:id/<something>` action is therefore covered the day it is
// written, with no extra work.
//
// Cost: at most ONE extra lookup, and only for a real waiter at a sections restaurant —
// every other caller short-circuits in waiterTables() before we get here.
const NO_TABLE: Affected = { tables: [], unknown: false };

async function tableOfSession(rid: string, id: string): Promise<string | null> {
  const { data } = await sb.from("sessions").select("table_number")
    .eq("restaurant_id", rid).eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

async function tableOfOrder(rid: string, id: string): Promise<string | null> {
  const { data } = await sb.from("orders").select("table_number")
    .eq("restaurant_id", rid).eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

// order_items carries NO table_number (mig 014) — the reliable join is
// order_id → orders.table_number. session_id exists too but is null when the
// restaurant runs with dining sessions off, so it is only the fallback.
async function tableOfItem(rid: string, id: string): Promise<string | null> {
  const { data } = await sb
    .from("order_items").select("order_id, session_id")
    .eq("restaurant_id", rid).eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.order_id) return await tableOfOrder(rid, data.order_id);
  if (data.session_id) return await tableOfSession(rid, data.session_id);
  return null;
}

async function tableOfSimple(
  rid: string, table: "waiter_calls" | "requests", id: string,
): Promise<string | null> {
  const { data } = await sb.from(table).select("table_number")
    .eq("restaurant_id", rid).eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

async function tableOfMember(rid: string, id: string): Promise<string | null> {
  const { data } = await sb
    .from("session_members").select("session_id")
    .eq("restaurant_id", rid).eq("id", id).maybeSingle();
  return data?.session_id ? await tableOfSession(rid, data.session_id) : null;
}

/**
 * Every table a tablet POST would touch. `unknown: true` means the row the action names
 * could not be resolved to a table — the caller then refuses, because "couldn't tell"
 * must never read as "allowed".
 *
 * Moves carry TWO tables (source and destination) and BOTH must be the waiter's, or a
 * restricted waiter could push a party onto a table they can no longer see.
 */
export async function affectedTables(
  rid: string,
  a: string, b: string | undefined, c: string | undefined,
  body: Record<string, unknown> | null | undefined,
): Promise<Affected> {
  // NO RESTAURANT, NO ANSWER (T25 round 2, item 29, 2026-08-31). Every lookup below reads a row BY
  // ID with the service-role key, which bypasses the row-level rules — so without the restaurant it
  // would answer with whichever restaurant owns that id. Both callers have `rid` to hand: the tablet
  // dispatcher (which uses the answer to decide whether a waiter may write to that table) and
  // lib/clash.ts (which uses it to decide whether somebody else's party is on it now). An answer of
  // "I couldn't tell" is already handled everywhere — it is `unknown: true` — so a missing restaurant
  // takes that path rather than guessing.
  if (!rid) return { tables: [], unknown: true };
  const bod = body || {};
  const push = async (v: string | null): Promise<Affected> =>
    v ? { tables: [v], unknown: false } : { tables: [], unknown: true };

  // Actions with no table at all — a takeaway parcel, a standalone banquet bill, a
  // restaurant-wide floor complaint. Never restricted by a section.
  if (a === "issue" || a === "parcel") return NO_TABLE;

  // The table is right there in the path or the body.
  if (a === "tables" && b) return { tables: [normTable(b)], unknown: false };
  if (a === "order" || (a === "sessions" && b === "open")) {
    return { tables: [normTable(bod.table)], unknown: false };
  }
  if (a === "banquet" && b === "place") {
    const t = normTable(bod.table);
    return t ? { tables: [t], unknown: false } : NO_TABLE; // blank = standalone bill
  }

  // Row-id actions. `dest` is the second table on the four "move a party/ticket" ones.
  const dest = normTable(bod.to);
  const withDest = (base: Affected): Affected =>
    dest ? { tables: [...base.tables, dest], unknown: base.unknown } : base;

  if (a === "sessions" && b) return withDest(await push(await tableOfSession(rid, b)));
  if (a === "orders" && b) return withDest(await push(await tableOfOrder(rid, b)));
  if ((a === "items" || a === "order-items") && b) return withDest(await push(await tableOfItem(rid, b)));
  if (a === "calls" && b) return await push(await tableOfSimple(rid, "waiter_calls", b));
  if (a === "requests" && b) return await push(await tableOfSimple(rid, "requests", b));
  if (a === "members" && b) return await push(await tableOfMember(rid, b));

  // An action shape we don't recognise. Unknown ⇒ refuse for a restricted waiter (a new
  // table-scoped endpoint is protected on the day it is added, not the day it is noticed).
  return { tables: [], unknown: true };
}
