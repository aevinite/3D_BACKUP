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
  /** The answer to "was the food made?" on a cancellation (owner, 2026-08-18). Sent by the list
   *  endpoints as a TEXT scalar out of `meta` so a list never carries a whole order snapshot per row;
   *  absent/null means nobody has answered yet, which is a real state and never guessed at. */
  made?: string | boolean | null;
  order_id?: string | null;
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

/** ── THE TAGS (owner, 2026-08-18: "make tags for all kind of audit and stuff") ────────────────────
 *  Additive labels a person can filter by — deliberately NOT a second risk model: risk answers "did
 *  money move", a tag answers "what area of the restaurant is this about". The database half is
 *  lfh_audit_tags() (migration 337) and `verify:audit` asserts the two agree, kind by kind. */
export const KIND_TAGS: Record<string, string[]>;
export const TAG_LABEL: Record<string, string>;
export const TAG_ICON: Record<string, string>;
/** The tags for ONE row: its kind's tags, plus — for a cancellation — whether the food was made
 *  (`loss` / `no-loss` / `unanswered`, and `cost-unknown` when a made loss prices at zero because the
 *  dish has no recipe). An unanswered cancellation stays unanswered; it is never guessed. */
export function tagsOf(row: { kind?: string; meta?: { made?: boolean | null; loss_cost?: unknown } | null }): string[];
/** Every tag present across a set of rows, with how many carry it — for a chip strip. Built from the
 *  WHOLE feed, so a chip's count does not change when you tap it. */
export function tagCountsFrom(rows: unknown[]): { tag: string; count: number; label: string; icon: string }[];
export function tagLabel(tag: string): string;
export function tagIcon(tag: string): string;
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

// ── THE ACTIVITY LOG'S HALF (owner, 2026-08-14: "sort in activity log such as from printer") ─────
// The same three screens carry the Activity log (staff_actions) as well as the Audit, and it is the
// bigger feed — so it gets the same chips and the same sort, from the same module, for the same
// reason: one grouping, three screens, no chance of "Printer" meaning different rows on each.

/** One row of the activity log, as every panel receives it from its own oplog endpoint.
 *  `id` is `string | number` on purpose: the admin console types it as a number and the owner
 *  console as a string (PostgREST hands a bigint over as text once it is big enough). The tie-break
 *  parses it either way, so both are genuinely accepted rather than one being cast at a call site. */
export interface ActivityRow {
  id: string | number;
  action: string;
  panel?: string | null;
  actor?: string | null;
  detail?: string | null;
  table_number?: string | null;
  level?: string | null;
  created_at?: string;
  restaurant_name?: string | null;
}

export interface ActivityGroup {
  id: string;
  label: string;
  icon: string;
  test: (action: string) => boolean;
}

export interface ActivityGroupCount {
  group: string;
  count: number;
  label: string;
  icon: string;
}

export interface ActivitySort {
  id: string;
  label: string;
  cmp: (a: ActivityRow, b: ActivityRow) => number;
}

/** The groups, in PRIORITY order — first match wins, and the last one matches everything, so a
 *  brand-new action name always lands somewhere rather than falling out of every chip. */
export const ACTIVITY_GROUPS: ActivityGroup[];
export const ACTIVITY_SORTS: ActivitySort[];
export const ACTIVITY_DEFAULT_SORT: string;
/** Which group an action name belongs to. Total — always answers. */
export function activityGroupOf(action: string): string;
/** The same for a whole row, where an error-level row is a Problem whatever its action says. */
export function activityGroupOfRow(row: ActivityRow): string;
export function activityGroupLabel(id: string): string;
/** Which groups are present and how many of each. Only groups with rows behind them. */
export function activityCounts(rows: ActivityRow[]): ActivityGroupCount[];
/** The search, over what the row SHOWS — including the group's own words, so typing "printer"
 *  finds the printer rows even though no row contains that word. */
export function activityMatches(r: ActivityRow, needle: string): boolean;
/** Filter by group + search, then sort — the whole pipeline in one call. */
export function activityView(
  rows: ActivityRow[],
  opts: { group?: string; q?: string; sort?: string },
): ActivityRow[];
