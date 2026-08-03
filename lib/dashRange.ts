// lib/dashRange.ts — how far back the MANAGER PANEL's dashboard reaches.
//
// The panel's dashboard has exactly the reach the Access screen hands over — TODAY, or today
// AND yesterday — and nothing wider. Every restaurant starts on today; "today + yesterday" is
// handed over deliberately, because someone who can see yesterday can work out what a shift
// took. The switch is Access → Manager → Manager menu → Dashboard → "How far back it reaches"
// (lib/accessTree.ts, node `mgr_dash_range`), stored at
// access_config.view_dashboard.manager_opts.range.
//
// The 30-day and 12-month views were DELETED from this panel on 2026-08-03. The owner opened
// Aangan through owner → manager mode, saw "30 days" and "Year" sitting in the rail greyed out
// with a "not available to the manager" tooltip, and said the right thing: they should not be
// there at all — "the feature… there is literally no need for it". They were never a manager's
// screen; they were an extra for an admin/owner looking in, repeating the owner panel's own
// Reports, which does wide ranges properly (snapshot-cached, pre-aggregated, up to a full year
// and custom windows) instead of scanning `orders` live.
//
// ONE pair of helpers, used by BOTH sides, so the rail can never offer a day the server
// refuses: /api/editor/whoami sends the reach to the panel (which draws Today / Yesterday from
// it) and /api/editor/stats + /staff-risk clamp what they were asked for. The clamp applies to
// the manager, the owner AND the admin — a range no screen offers is a range nothing should
// compute.
export type DashRange = "today" | "yesterday";
export type DashReach = "today" | "today_yesterday";

/** This restaurant's dashboard reach, straight from its stored access_config. */
export function dashboardReach(accessConfig: unknown): DashReach {
  const stored = (accessConfig as { view_dashboard?: { manager_opts?: { range?: string } } } | null | undefined)
    ?.view_dashboard?.manager_opts?.range;
  return stored === "today_yesterday" ? "today_yesterday" : "today";
}

/** The only two answers the dashboard can give. Anything else asked for — a "30d" remembered
 *  in an old browser, a hand-typed ?range=year — resolves to today, and never to an error: a
 *  wider word in the URL must not reach further than the screen offers, but it also must not
 *  break the screen. */
export function clampDashRange(asked: unknown, reach: DashReach): DashRange {
  return asked === "yesterday" && reach === "today_yesterday" ? "yesterday" : "today";
}

// ── Bills list reach (owner, 2026-08-03) ────────────────────────────────────
// The SAME two answers, for the Bills tab's record of settled bills. Its switch is Access →
// Manager → Permission for manager → Bills → "Which bills they can see" (lib/accessTree.ts,
// node `mgr_bills_range`), stored at access_config.view_bills.manager_opts.range. Read by
// /api/editor/whoami (so the panel knows whether to draw the Yesterday group at all) and
// enforced by /api/editor/orders — the window AND every bill search are clamped to it, for
// the manager, the owner and the admin alike: a day no screen offers is a day nothing lists.

/** This restaurant's bills reach, straight from its stored access_config. */
export function billsReach(accessConfig: unknown): DashReach {
  const stored = (accessConfig as { view_bills?: { manager_opts?: { range?: string } } } | null | undefined)
    ?.view_bills?.manager_opts?.range;
  return stored === "today_yesterday" ? "today_yesterday" : "today";
}
