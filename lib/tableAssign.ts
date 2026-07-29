// lib/tableAssign.ts — waiter SECTIONS: a tablet login works only the tables it was
// given. Migration 221; design notes in docs/ACCESS-LADDER.md (module `table_assign`).
//
// SERVER-ONLY (imports supabaseAdmin). The panels hide what a waiter may not touch,
// but hiding a tile is never the guard — every read is narrowed and every write is
// re-checked here.
//
// THE ONE RULE THAT KEEPS EVERYTHING ELSE WORKING: `waiterTables()` answers `null` =
// "not restricted" for the admin super-user, for any role that isn't `tablet`
// (a manager/owner looking into the tablet panel keeps the whole floor), and for every
// restaurant whose module is off. Only a real waiter at a restaurant using sections
// ever gets an array back — so this file is a no-op for everyone else, which is why it
// can be wired into the hot path without changing today's behaviour anywhere.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { moduleLadder } from "@/lib/tableTags";
import type { StaffUser } from "@/lib/userAuth";

// The admin/owner rungs (mig 222). Brand-new module ⇒ ships OFF everywhere.
export const tableAssignLadder = (rid: string) =>
  moduleLadder(rid, {
    allowed: "table_assign_allowed",
    control: "table_assign_owner_control",
    enabled: "table_assign_enabled",
  });

// Table numbers are TEXT in every operational table (orders/sessions/waiter_calls/
// requests/table_tags) but INTEGER[] on the staff row, so all comparing is done on
// normalised STRINGS. "007" and 7 must be the same table.
export const normTable = (v: unknown): string => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? String(n) : "";
};

// The waiter's own list, normalised. Read straight off the staff row that
// requireRole/userFromCookie already fetched — no query.
export function assignedOf(user: StaffUser | null | undefined): string[] {
  const raw: unknown = user?.assigned_tables;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const t = normTable(v);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The set of tables this caller is limited to, or `null` when they are not limited.
 *
 * `null` (unrestricted) for: the admin super-user (`user === null`), anyone who isn't a
 * waiter, and every restaurant where the module isn't effective. An ARRAY (possibly
 * EMPTY) only for a real waiter at a restaurant using sections — and empty deliberately
 * means "sees nothing", which is the owner's chosen behaviour for an unassigned waiter.
 */
export async function waiterTables(
  user: StaffUser | null | undefined,
  rid: string,
): Promise<string[] | null> {
  if (!user) return null;              // admin super-user
  if (user.role !== "tablet") return null; // manager/owner oversight keeps the full floor
  if (!(await tableAssignLadder(rid)).effective) return null; // module off for this restaurant
  return assignedOf(user);
}

export const allows = (limit: string[] | null, table: unknown): boolean =>
  limit === null || limit.includes(normTable(table));

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
type Affected = { tables: string[]; unknown: boolean };

const NO_TABLE: Affected = { tables: [], unknown: false };

async function tableOfSession(id: string): Promise<string | null> {
  const { data } = await sb.from("sessions").select("table_number").eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

async function tableOfOrder(id: string): Promise<string | null> {
  const { data } = await sb.from("orders").select("table_number").eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

// order_items carries NO table_number (mig 014) — the reliable join is
// order_id → orders.table_number. session_id exists too but is null when the
// restaurant runs with dining sessions off, so it is only the fallback.
async function tableOfItem(id: string): Promise<string | null> {
  const { data } = await sb
    .from("order_items").select("order_id, session_id").eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.order_id) return await tableOfOrder(data.order_id);
  if (data.session_id) return await tableOfSession(data.session_id);
  return null;
}

async function tableOfSimple(
  table: "waiter_calls" | "requests", id: string,
): Promise<string | null> {
  const { data } = await sb.from(table).select("table_number").eq("id", id).maybeSingle();
  return data?.table_number ? normTable(data.table_number) : null;
}

async function tableOfMember(id: string): Promise<string | null> {
  const { data } = await sb
    .from("session_members").select("session_id").eq("id", id).maybeSingle();
  return data?.session_id ? await tableOfSession(data.session_id) : null;
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
  a: string, b: string | undefined, c: string | undefined,
  body: Record<string, unknown> | null | undefined,
): Promise<Affected> {
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

  if (a === "sessions" && b) return withDest(await push(await tableOfSession(b)));
  if (a === "orders" && b) return withDest(await push(await tableOfOrder(b)));
  if ((a === "items" || a === "order-items") && b) return withDest(await push(await tableOfItem(b)));
  if (a === "calls" && b) return await push(await tableOfSimple("waiter_calls", b));
  if (a === "requests" && b) return await push(await tableOfSimple("requests", b));
  if (a === "members" && b) return await push(await tableOfMember(b));

  // An action shape we don't recognise. Unknown ⇒ refuse for a restricted waiter (a new
  // table-scoped endpoint is protected on the day it is added, not the day it is noticed).
  return { tables: [], unknown: true };
}

// The message a blocked waiter sees. Deliberately plain and non-alarming: this is a
// rota, not a telling-off.
export const notYoursMessage = (t: string) =>
  t ? `Table ${t} isn't in your section — ask your manager to add it.`
    : `That table isn't in your section — ask your manager to add it.`;

/**
 * The single check the tablet POST dispatcher runs. Returns null when the write may
 * proceed, or the refusal message when it may not.
 */
export async function blockedReason(
  limit: string[] | null,
  a: string, b: string | undefined, c: string | undefined,
  body: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  if (limit === null) return null;                       // not a restricted caller
  const { tables, unknown } = await affectedTables(a, b, c, body);
  if (unknown) return notYoursMessage("");
  const bad = tables.find((t) => t && !limit.includes(t));
  return bad ? notYoursMessage(bad) : null;
}
