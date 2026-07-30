// lib/openSession.ts — opening a table, race-tolerantly.
//
// Every panel that opens a table did SELECT-then-INSERT: "is there an open session? no →
// insert one". Two devices tapping Open on the same table in the same instant both pass the
// check, both insert, and the second one hits the unique index
// `idx_one_open_session_per_table` — which surfaced as a raw
//   duplicate key value violates unique constraint "idx_one_open_session_per_table"
// 500 to whoever tapped second (error log 2026-07-26). On a busy floor that is two waiters
// seating the same party, and the loser sees a crash for doing nothing wrong.
//
// Opening a table is IDEMPOTENT by nature: the desired end state is "this table has an open
// session". So losing the race is a SUCCESS — we just return the row that won. Migration 228
// adds the matching advisory lock inside lfh_staff_open_table so concurrent opens serialise at
// the database too; this helper covers the routes that insert directly.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const isDuplicate = (msg: string) =>
  /duplicate key value|idx_one_open_session_per_table|23505/i.test(msg);

export type OpenedSession = Record<string, unknown> | null;

// openTableSession: return this table's open session, creating one if there isn't one yet.
// Never throws on the concurrent-open race — it re-reads and returns the winning row.
// Any OTHER database error still throws, so a real failure is never swallowed.
export async function openTableSession(
  rid: string,
  tableNumber: string,
  opts: { openedBy?: string } = {},
): Promise<OpenedSession> {
  const readOpen = async (): Promise<OpenedSession> =>
    ((await sb.from("sessions").select("*")
      .eq("restaurant_id", rid).eq("table_number", tableNumber).neq("status", "closed")
      .limit(1)).data?.[0] ?? null) as OpenedSession;

  const already = await readOpen();
  if (already) return already;

  const nowIso = new Date().toISOString();
  const ins = await sb.from("sessions").insert({
    table_number: tableNumber, status: "open", opened_by: opts.openedBy || "waiter",
    opened_at: nowIso, restaurant_id: rid,
  }).select();
  if (!ins.error) return (ins.data?.[0] ?? null) as OpenedSession;

  // Lost the race → the table is open, which is what the caller wanted. Return the winner.
  if (isDuplicate(ins.error.message)) {
    const winner = await readOpen();
    if (winner) return winner;
  }
  throw new Error(ins.error.message);
}
