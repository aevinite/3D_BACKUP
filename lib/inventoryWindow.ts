// lib/inventoryWindow.ts — what "this month" MEANS for stock, purchases, waste and expenses.
//
// ── WHY (T9 finding F27, 2026-08-12 — the owner: "every number which is being counted should be
//    perfect") ─────────────────────────────────────────────────────────────────────────────────────
//
// Two screens show the same restaurant the same month's purchases, waste and expenses:
//
//   · the Inventory PAGE   (/api/owner/inventory) called `lfh_inv_stock_summary(uuid, date, date)`
//     with a plain calendar month: `2026-08-01` → `2026-08-31`.
//   · the Inventory REPORT (/api/owner/reports?type=invstock) calls
//     `lfh_inv_report_summary(uuid, timestamptz, timestamptz)` with the window `windowFor()` builds,
//     and **migration 294 ("document dates follow the business day") was applied to that function
//     and NOT to the other one.**
//
// So the two disagreed at both edges by the 05:00-IST business-day offset. A purchase entered at
// 02:00 on the 1st belongs to the previous business day (the restaurant was still working the 31st),
// and one screen counted it in August while the other counted it in July. Nobody would ever spot it
// as a bug — it just looks like the report and the page "don't quite match", which is the most
// corrosive kind of wrong a money screen can be.
//
// This file is the single definition. Both screens now take their window from here, so they cannot
// drift again, and `scripts/verify-inventory-window.mjs` fails the build if either one goes back to
// building its own.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
//
// A restaurant's day starts at 05:00 IST (`BIZ_START_H`, the same constant the Z-report, the manager
// dashboard, `range=today` and the day sheet all use). So "August" means:
//
//     from = 1 Aug, 05:00 IST      → the moment August's trading began
//     to   = 1 Sep, 05:00 IST      → the moment September's trading began (exclusive)
//
// and the DOCUMENT-DATE bounds that go to a `date`-typed function are the IST calendar dates those
// two instants fall on, taken with the same business-day step-back `lib/businessDay` uses — so a
// bill dated at 02:00 on 1 September still lands in August, exactly as the report already computed
// it.
import { businessDateHi } from "@/lib/businessDay";

/** A restaurant's day starts at 05:00 IST. Same constant as the reports route and the Z-report. */
const BIZ_START_H = 5;
const IST_MS = 5.5 * 3600_000;

export type InventoryWindow = {
  /** Inclusive first document DATE (YYYY-MM-DD) — for a `date`-typed RPC or an `expense_date` filter. */
  from: string;
  /** Inclusive last document DATE (YYYY-MM-DD). */
  to: string;
  /** The same window as INSTANTS — for a `timestamptz`-typed RPC. `toIso` is exclusive. */
  fromIso: string;
  toIso: string;
  /** The month this describes, `YYYY-MM`, echoed back so a payload can state what it counted. */
  month: string;
};

/** The instant a given IST calendar date's business day begins (05:00 IST). */
function bizStartInstant(y: number, m0: number, d: number): number {
  return Date.UTC(y, m0, d, BIZ_START_H, 0, 0) - IST_MS;
}

/**
 * The business-day window for one calendar month, `YYYY-MM`.
 *
 * Invalid input falls back to the current IST month rather than throwing — every caller already
 * validates the shape, and a report that silently swapped to a different month would be worse than
 * one that quietly stayed on this one.
 */
export function inventoryMonthWindow(month: string): InventoryWindow {
  const ok = /^\d{4}-\d{2}$/.test(month);
  const now = new Date(Date.now() + IST_MS);
  const y = ok ? +month.slice(0, 4) : now.getUTCFullYear();
  const m0 = ok ? +month.slice(5, 7) - 1 : now.getUTCMonth();
  const label = `${String(y).padStart(4, "0")}-${String(m0 + 1).padStart(2, "0")}`;

  const fromMs = bizStartInstant(y, m0, 1);            // 1st of the month, 05:00 IST
  const toMs = bizStartInstant(y, m0 + 1, 1);          // 1st of the NEXT month, 05:00 IST (exclusive)

  return {
    month: label,
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    // The document-date bounds. `from` is the 1st. `to` uses the SAME business-day step-back the
    // reports route applies (`docDateHi`), so a document dated in the small hours of the 1st of the
    // next month still counts as this month's trading — which is what the restaurant means.
    from: `${label}-01`,
    to: businessDateHi(new Date(toMs).toISOString()),
  };
}

/**
 * The document-date bounds for an ARBITRARY window of instants — the shape the reports route needs,
 * where the window comes from `range=` rather than a month.
 *
 * `istDay(from)` is the low bound and is always right. The HIGH bound steps back the 5-hour
 * business-day offset first: without it, a window ending at 05:00 IST *today* (which is what
 * `range=yesterday` is) still landed on TODAY'S date, and a one-day report covered two calendar days
 * — measured 4 Aug 2026 as 2026-08-03 → 2026-08-04.
 */
export function documentDateBounds(fromIso: string, toIso: string): { from: string; to: string } {
  return {
    from: new Date(Date.parse(fromIso) + IST_MS).toISOString().slice(0, 10),
    to: businessDateHi(toIso),
  };
}
