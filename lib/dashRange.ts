// lib/dashRange.ts — how far back the MANAGER PANEL's dashboard, its reports and its GST
// document reach.
//
// The panel reaches exactly as far as the Access screen hands over, and nothing wider. Every
// restaurant starts on TODAY. The switch is Access → Manager → Manager menu → Dashboard →
// "How far back it reaches" (lib/accessTree.ts, node `mgr_dash_range`), stored at
// access_config.view_dashboard.manager_opts.range.
//
// ── FOUR RUNGS, NOT TWO (owner, 2026-09-23) ────────────────────────────────────────────────
// "Why does it take the GST report of the month? The manager has only access today. Make sure
// you can change the access to 30 days, one day, two day — and that all should be from the
// admin panel. And make sure whatever day that he has been given, he could only be able to
// give report of that particular thing."
//
// He was reading the real hole: the DASHBOARD stopped at today, and the 🧾 GST report sitting
// three buttons along handed the same manager a whole month. Two separate doors to the same
// restaurant's sales, with only one of them gated. So the ladder grew from two rungs to four —
// Today · Today + yesterday · Last 7 days · Last 30 days — and EVERY door that answers with a
// range now measures itself against it: /stats, /staff-risk, the menu matrix and /gst-report.
//
// This partly reverses the 2026-08-03 deletion of the 30-day and 12-month views, and the
// reversal is deliberate and narrower than what was removed. What he refused then was a
// manager panel that OFFERED wide ranges to everybody with two of them greyed out ("the thirty
// days and one year is showing… there is literally no need for it"). What exists now is a
// restaurant that has been GIVEN thirty days by its admin, and a panel that shows exactly the
// rungs it was given and no greyed-out extras. Twelve months did NOT come back: a year is a
// live scan of `orders` that the owner panel's Reports already does properly, snapshot-cached
// and pre-aggregated, and nothing about a GST filing needs it.
//
// ONE set of helpers, used by BOTH sides, so the panel can never offer a day the server
// refuses: /api/editor/whoami sends the reach to the panel (which draws its range buttons from
// it) and every ranged endpoint clamps what it was asked for. The clamp applies to the manager,
// the owner AND the admin — a range no screen offers is a range nothing should compute.

export type DashRange = "today" | "yesterday" | "last7" | "last30";
export type DashReach = "today" | "today_yesterday" | "last7" | "last30";

/** How many BUSINESS DAYS each rung is worth. The ladder is ordered by this number, which is
 *  what makes "is this range inside that reach?" one comparison instead of a table of pairs. */
export const REACH_DAYS: Record<DashReach, number> = { today: 1, today_yesterday: 2, last7: 7, last30: 30 };

/** The same number for a RANGE. "yesterday" is rung 2 because seeing yesterday is what a
 *  two-day grant buys; it reads ONE day (its own 05:00→05:00 window), not two. */
const RANGE_RUNG: Record<DashRange, number> = { today: 1, yesterday: 2, last7: 7, last30: 30 };

/** This restaurant's dashboard reach, straight from its stored access_config.
 *  An unknown or missing value is TODAY — the narrowest rung — never the widest. */
export function dashboardReach(accessConfig: unknown): DashReach {
  const stored = (accessConfig as { view_dashboard?: { manager_opts?: { range?: string } } } | null | undefined)
    ?.view_dashboard?.manager_opts?.range;
  return stored === "today_yesterday" || stored === "last7" || stored === "last30" ? stored : "today";
}

/** How many days back this restaurant may look, as a number. */
export function reachDays(reach: DashReach): number {
  return REACH_DAYS[reach] ?? 1;
}

/** The ranges this reach actually offers, narrowest first — the panel draws its buttons from
 *  exactly this list, so a rung can never appear on screen that the server would refuse. */
export function rangesFor(reach: DashReach): DashRange[] {
  const cap = reachDays(reach);
  return (Object.keys(RANGE_RUNG) as DashRange[]).filter((r) => RANGE_RUNG[r] <= cap);
}

/** The only answers the dashboard can give. Anything else asked for — a "year" remembered in an
 *  old browser, a hand-typed ?range=decade, a rung this restaurant was not given — resolves to
 *  today, and never to an error: a wider word in the URL must not reach further than the screen
 *  offers, but it also must not break the screen. */
export function clampDashRange(asked: unknown, reach: DashReach): DashRange {
  const a = String(asked ?? "") as DashRange;
  return RANGE_RUNG[a] && RANGE_RUNG[a] <= reachDays(reach) ? a : "today";
}

/** Plain English for a range, for a heading or a CSV. */
export const RANGE_LABEL: Record<DashRange, string> = {
  today: "today", yesterday: "yesterday", last7: "the last 7 days", last30: "the last 30 days",
};

// ── Bills list reach (owner, 2026-08-03) ────────────────────────────────────
// The Bills tab's record of settled bills keeps its OWN two-rung ladder, and that is on
// purpose: he widened what a manager may REPORT on, not the list of every guest's bill they
// can open and reprint. Its switch is Access → Manager → Permission for manager → Bills →
// "Which bills they can see" (lib/accessTree.ts, node `mgr_bills_range`), stored at
// access_config.view_bills.manager_opts.range. Read by /api/editor/whoami (so the panel knows
// whether to draw the Yesterday group at all) and enforced by /api/editor/orders — the window
// AND every bill search are clamped to it, for the manager, the owner and the admin alike: a
// day no screen offers is a day nothing lists.
export type BillsReach = "today" | "today_yesterday";

/** This restaurant's bills reach, straight from its stored access_config. */
export function billsReach(accessConfig: unknown): BillsReach {
  const stored = (accessConfig as { view_bills?: { manager_opts?: { range?: string } } } | null | undefined)
    ?.view_bills?.manager_opts?.range;
  return stored === "today_yesterday" ? "today_yesterday" : "today";
}
