// Types for /panels/auditsort.js — the ONE sort/filter behaviour behind the Audit (removals)
// record, shared by the owner console, the manager panel and the admin console. See the .js header
// for why it lives in `public/panels` rather than `lib`: the manager panel loads it as a plain
// <script>, so it can have no imports.

/** One row of the removals record, as every panel receives it from its own audit endpoint. */
export interface AuditRow {
  id: number;
  at: string;
  kind: string;
  reason_code?: string | null;
  reason_note?: string | null;
  actor?: string | null;
  actor_role?: string | null;
  table_number?: string | null;
  bill_no?: number | null;
  invoice_no?: string | null;
  kot_no?: number | null;
  item_title?: string | null;
  qty?: number | null;
  amount?: string | number | null;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
}

export interface AuditSort {
  id: string;
  label: string;
  cmp: (a: AuditRow, b: AuditRow) => number;
}

export interface AuditKindCount {
  kind: string;
  count: number;
  label: string;
  icon: string;
}

/** The five sort orders, in the order they are offered. Every comparator is TOTAL (it tie-breaks
 *  on the row id), so equal rows never swap places between renders. */
/** THE words and glyph for every removal type, and the words for every one-tap reason — the ONE set,
 *  read by the owner console, the manager panel and the admin console. They lived in three
 *  hand-written maps and six of the eleven types were named differently in each (T7 pass 2).
 *  `components/admin/RemovalDetail.tsx` re-exports these as KIND_LABEL / KIND_ICON. */
export const KIND_LABEL: Record<string, string>;
export const KIND_ICON: Record<string, string>;
/** DID MONEY ACTUALLY MOVE (owner, 2026-08-13). "money" = the restaurant collected less than the
 *  food was worth (discount, on-the-house, payment reverted, bill deleted, reopen difference).
 *  "record" = the record changed and the money did not (a KOT cancelled before anything was charged,
 *  a dish off a live order, a menu edit, a reopen, a restore, a note/allergy after settling).
 *  "data" = a guest's details erased on request. The DATABASE holds the same map (lfh_audit_risk),
 *  and npm run verify:audit asserts the two agree — two answers to "is this about money" is how a
 *  summary starts disagreeing with the list printed above it. */
export const KIND_RISK: Record<string, "money" | "record" | "data">;
export function riskOf(kind: string): "money" | "record" | "data";
export const REASON_LABEL: Record<string, string>;
export const SORTS: AuditSort[];
export const DEFAULT_SORT: string;
export function sortById(id: string): AuditSort;
/** Sorts a COPY — never in place, so a screen's state object is not mutated underneath React. */
export function sortRows(rows: AuditRow[], sortId?: string): AuditRow[];
/** Which types are present and how many of each, biggest first. Only types with rows behind them,
 *  so no "Voided invoices 0" chip is ever offered. Words come from the caller's shared KIND_LABEL. */
export function kindCounts(
  rows: AuditRow[],
  label?: Record<string, string>,
  icon?: Record<string, string>,
): AuditKindCount[];
/** The chips, counted in the DATABASE when the caller has those counts (mig 311's grouped read), so
 *  a chip spans every page rather than the one on screen — and every type stays reachable from page 1.
 *  Falls back to counting the rows in hand when `dbCounts` is absent. */
export function kindCountsFrom(
  rows: AuditRow[],
  dbCounts: { kind: string; n: number; amount: number }[] | null | undefined,
  label?: Record<string, string>,
  icon?: Record<string, string>,
): (AuditKindCount & { amount?: number })[];
/** The search, stated once so all three panels match on the same fields. */
export function matches(
  r: AuditRow,
  needle: string,
  kindLabel?: Record<string, string>,
  reasonLabel?: Record<string, string>,
): boolean;
/** Filter by type + search, then sort — the whole pipeline, so no screen can order the steps wrong. */
export function view(
  rows: AuditRow[],
  opts: {
    kind?: string;
    q?: string;
    sort?: string;
    kindLabel?: Record<string, string>;
    reasonLabel?: Record<string, string>;
  },
): AuditRow[];
/** What the visible rows add up to in money. Rows with no amount contribute nothing. */
export function sumAmount(rows: AuditRow[]): number;
