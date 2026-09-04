// GET /api/owner/analytics — drill-down data for the owner dashboard charts.
//   ?range=today|yesterday|7d|30d|all  (window; default today)
//   &rid=<uuid>              (optional: restaurant scope; omit = group scope)
//
// Group scope  → { scope:'group', restaurantRevenue[], timeseries[] }
// Restaurant   → { scope:'restaurant', restaurant{}, kpis{}, timeseries[], dishes[], categories[], hourly[] }
//
// All aggregation is server-side via the lfh_owner_* RPCs (migration 089) — one
// round-trip per chart, tiny pre-summed rows, never order scanning in JS.
//
// AUTH: ownerScope() (lib/ownerScope.ts) — a real OWNER sees only the restaurants they own, the
// ADMIN super-user sees all, everyone else gets 401, and a real owner is further narrowed to the
// restaurants whose "reports" section the admin still grants (the entitledSubset call below).
// (This header used to say "Service-role only, behind the ADMIN_PASSWORD cookie gate (same as
// /api/owner/overview)". That was wrong on both counts and had been for months: the gate is
// ownerScope, which is a different rule with different consequences for a real owner. Its twin in
// /api/owner/overview was corrected in the 2026-08-05 sweep and this copy was missed — so the
// comment pointed at a file that contradicted it, which is exactly what makes the next reader "fix"
// the wrong thing. Corrected in the T9 sweep, 2026-08-06.)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, scopedRestaurantIds, dbFail, type PartialKey } from "@/lib/ownerScope";
import { cachedOwnerPayload, scopeKeyOf, ordersFingerprint, reportMonthFingerprint } from "@/lib/ownerCache";
import { payrollEffectiveByRid } from "@/lib/tableTags";
import { istDateOf } from "@/lib/staffProfileShared";
import { businessDateHi } from "@/lib/businessDay";
import { mapLimit, FANOUT } from "@/lib/mapLimit";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { rd } from "@/lib/readGuard";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

// The busy-hours heatmap is a RECENCY pattern, and its aggregate is the one analytics
// query that times out on a huge window (the "All time" range = 2020→now made it hit the
// statement timeout, 500'd the WHOLE dashboard — every other query is fine). Bound it to
// the last ~90 days regardless of the selected range, never earlier than the range's own
// start. A 90-day busy-hours grid is fully representative; all-time was never meaningful.
const HEAT_MAX_DAYS = 90;
// Clamp the heatmap window to the last ~90 days OF THE SELECTED WINDOW — anchored to the
// window's own END (`to`), NOT wall-clock now. Anchoring to now would invert the window
// (from > to) for a historical range — e.g. the dashboard's "most recent week with
// activity" fallback for a restaurant quiet >90 days — and blank the very grid it's meant
// to fill. For today/7d/30d/month/all, `to ≈ now`, so this is identical to now-90d.
function heatFrom(from: string, to: string): string {
  return new Date(Math.max(Date.parse(from), Date.parse(to) - HEAT_MAX_DAYS * DAY)).toISOString();
}
// Window for a range. "today" = since 05:00 IST business-day start (matches the
// counters + lfh_owner_overview). Others are rolling windows ending now.
function windowFor(range: string, sp?: URLSearchParams): { from: string; to: string; bucket: string } {
  const now = Date.now();
  const to = new Date(now).toISOString();
  if (range === "all") return { from: "2020-01-01T00:00:00Z", to, bucket: "day" };
  // custom: exact IST day range from the report dialog (owner round-4: "from which
  // to which date you want the report"). Inclusive dates; bad input → 30d fallback.
  if (range === "custom" && sp) {
    const f = sp.get("from"), t2 = sp.get("to");
    const ok = (x: string | null) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (ok(f) && ok(t2)) {
      const pf = Date.parse(f + "T00:00:00+05:30");
      const pt = Math.min(Date.parse(t2 + "T00:00:00+05:30") + DAY, now);
      if (Number.isFinite(pf) && pt > pf) {
        return { from: new Date(pf).toISOString(), to: new Date(pt).toISOString(), bucket: pt - pf > 3 * DAY ? "day" : "hour" };
      }
    }
    return windowFor("30d");
  }
  // whole IST months (mirrors the reports route)
  if (range === "month" || range === "lastmonth") {
    const istNow = new Date(now + 5.5 * 3600_000);
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const start = (yy: number, mm: number) => Date.UTC(yy, mm, 1) - 5.5 * 3600_000;
    if (range === "month") return { from: new Date(start(y, m)).toISOString(), to, bucket: "day" };
    return { from: new Date(start(y, m - 1)).toISOString(), to: new Date(start(y, m)).toISOString(), bucket: "day" };
  }
  // ── "12m" AND "fy" LIVE IN BOTH ROUTES OR IN NEITHER (T5 re-run, 2026-08-11) ───────────
  // The sibling reports route has understood these two since the GST work; this one did not,
  // and an unknown range here falls through to TODAY at the bottom of the function. Nothing
  // sent them until the compiled-statement dialog gained an FY option — and the statement then
  // printed "FY (Apr–Mar) · Total collected ₹0", because `gatherOwnerReport` asks BOTH routes
  // for the same window and only one of them knew what it meant. Measured on the backup the
  // moment the option shipped. Same boundaries as the reports route, to the millisecond:
  // 12m = the 12 whole IST calendar months ending this month; fy = the Indian financial year,
  // 1 April → now (April is month index 3).
  if (range === "12m" || range === "fy") {
    const istNow = new Date(now + 5.5 * 3600_000);
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const istMonthStart = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1) - 5.5 * 3600_000).toISOString();
    if (range === "12m") return { from: istMonthStart(y, m - 11), to, bucket: "month" };
    return { from: istMonthStart(m >= 3 ? y : y - 1, 3), to, bucket: "month" };
  }
  // this calendar week: Monday 00:00 IST → now, day buckets (owner 2026-07-27:
  // "make option like … this week"). Mirrors the whole-IST-month logic above.
  if (range === "week") {
    const istNow = new Date(now + 5.5 * 3600_000);
    const dow = (istNow.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - dow) - 5.5 * 3600_000;
    return { from: new Date(monday).toISOString(), to, bucket: "day" };
  }
  // 7d / 30d: EXACTLY N whole IST calendar days ending today (inclusive), aligned to
  // 00:00 IST. A rolling now−N×24h window instead spilled into a partial (N+1)th IST
  // day whose day-bucket the client's whole-day zero-filled axis drops — so the chart
  // total came out LESS than the KPI above it (bug, 2026-07-06). Aligning the window to
  // the same IST day boundaries the client plots makes chart sum == KPI by construction.
  if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    const istNow = new Date(now + 5.5 * 3600_000);
    const istMidnightToday = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3600_000;
    return { from: new Date(istMidnightToday - (n - 1) * DAY).toISOString(), to, bucket: "day" };
  }
  // today's 05:00 IST business-day start (shift to IST, step back 5h, floor to the day).
  const biz = new Date(now + 5.5 * 3600_000 - 5 * 3600_000);
  const todayStart = Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), biz.getUTCDate(), 5, 0, 0) - 5.5 * 3600_000;
  // yesterday: the full previous business day [yesterday 05:00 IST, today 05:00 IST).
  if (range === "yesterday") return { from: new Date(todayStart - DAY).toISOString(), to: new Date(todayStart).toISOString(), bucket: "hour" };
  // today (default): 05:00 IST business-day start → now.
  return { from: new Date(todayStart).toISOString(), to, bucket: "hour" };
}

// Change-detector choice. The precise orders fingerprint SCANS its window, which on a
// wide window ("All time" ≈ 6 years of rows) is a ~10s statement-timeout on a big
// tenant — the exact "Couldn't load / Loading… forever" the owner hit live 2026-07-27.
// Past ~35 days we switch to the mig-202 rollup-derived fingerprint (~35ms): it still
// catches every new/changed recent order; an edit to an ANCIENT order is picked up by
// the nightly rollup refresh (and the Refresh button always forces a recompute). Same
// tradeoff the money reports already ship with (reports route, mig 202).
const WIDE_FP_MS = 35 * DAY;
const fpFor = (ids: string[] | null, from: string, to: string) =>
  Date.parse(to) - Date.parse(from) > WIDE_FP_MS
    ? reportMonthFingerprint(ids, from, to)
    : ordersFingerprint(ids, from, to);

// The dashboard now shows STAFF PAY as an expense, and that money lives in staff_payments —
// which the orders fingerprint knows nothing about. Without this, recording a salary left the
// cached dashboard showing the OLD "after staff pay" number until an order happened to change.
// One tiny indexed count + the newest row's timestamps, appended to the orders fingerprint.
async function fpWithStaffPay(ids: string[] | null, from: string, to: string): Promise<string | null> {
  const base = await fpFor(ids, from, to);
  if (base === null) return base;
  // `ids` is NULL for the ADMIN's all-restaurants view, and this used to bail out on that —
  // so the admin's "Staff pay out" / "After staff pay" tiles (which staffPayExpense() DOES
  // render for that scope) never invalidated on a recorded salary and sat on an old figure
  // until an ORDER happened to move the fingerprint. That is the very bug the header note above
  // describes fixing for a scoped owner (T5 sweep, 2026-08-06). A NULL scope simply means
  // "every restaurant", so ask the same question without the filter — staff_payments is small
  // and the column is indexed.
  // NULL = every restaurant (admin). An EMPTY array is a different thing — a scoped owner with
  // nothing entitled — and must NOT fall through to a platform-wide read.
  if (ids && !ids.length) return base;
  const q0 = sb.from("staff_payments").select("created_at, voided_at", { count: "exact" });
  const q = await (ids ? q0.in("restaurant_id", ids) : q0)
    .order("created_at", { ascending: false }).limit(1);
  const last = (q.data || [])[0] as { created_at?: string; voided_at?: string | null } | undefined;
  return `${base}|sp:${q.count ?? 0}:${last?.created_at ?? ""}:${last?.voided_at ?? ""}`;
}

// `errText` is GONE (T9 sweep, 2026-08-06). It existed to stop a thrown PostgREST object rendering
// as the literal "[object Object]" in the owner's red banner — a real fix, but it solved the wrong
// half: the owner then got the database's message instead, which is just as unusable and is internal
// to us. `dbFail` (lib/ownerScope) does the shape-handling AND keeps the detail in our log, and it
// carries the statement-timeout advice the reports route pioneered. One helper, ten endpoints.

// The previous EQUAL-LENGTH window, for the KPI ▲/▼ delta chips ("today" compares
// against the same span of yesterday's business day, 7d against the 7 days before,
// …). "all" has no previous period — the chips just don't render.
function prevWindowFor(range: string, from: string, to: string): { from: string; to: string } | null {
  if (range === "all") return null;
  const f = Date.parse(from), t = Date.parse(to);
  const span = t - f;
  if (range === "today") {
    // same-time-yesterday, so a 11:00 check compares mornings, not a whole day.
    return { from: new Date(f - DAY).toISOString(), to: new Date(f - DAY + span).toISOString() };
  }
  return { from: new Date(f - span).toISOString(), to: new Date(f).toISOString() };
}

// Window to fetch for the "this period vs previous" OVERLAY line. The overlay aligns
// day-1↔day-1, so its previous window must be the current one shifted back by its OWN
// WHOLE-day length — not prevWindowFor's partial span (7d spans ~6.x days of real time,
// which would drop the earliest overlay day and draw a fake zero). Hour ranges and whole-
// month/custom ranges reuse the equal-span step-back (already whole-period there).
function prevTsWindowFor(range: string, from: string, to: string): { from: string; to: string } | null {
  if (range === "all") return null;
  const f = Date.parse(from);
  if (range === "7d") return { from: new Date(f - 7 * DAY).toISOString(), to: from };
  if (range === "30d") return { from: new Date(f - 30 * DAY).toISOString(), to: from };
  // "week" starts Monday 00:00 IST → previous window is the WHOLE prior week, so the
  // overlay lines up Mon↔Mon by day-of-week (same idea as month's day-1↔day-1).
  if (range === "week") return { from: new Date(f - 7 * DAY).toISOString(), to: from };
  // "month" (the locked this-month-vs-last-month chart): previous window is the WHOLE
  // previous calendar month, so the overlay lines up day-1↔day-1 by day-of-month.
  if (range === "month") {
    const istNow = new Date(Date.now() + 5.5 * 3600_000);
    const y = istNow.getUTCFullYear(), m = istNow.getUTCMonth();
    const start = (yy: number, mm: number) => Date.UTC(yy, mm, 1) - 5.5 * 3600_000;
    return { from: new Date(start(y, m - 1)).toISOString(), to: new Date(start(y, m)).toISOString() };
  }
  // "12m" and "fy" are month-grained and long; the equal-span step-back below lines their
  // buckets up month-for-month, which is what the overlay wants.
  return prevWindowFor(range, from, to);
}

// (the fan-out cap now lives in lib/mapLimit — see the note there)

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

// Paid revenue + orders summed over a window (tiny pre-summed rows), scoped to
// the caller's restaurants — ONE extra RPC per dashboard load when compare=1.
// p_ids pushes the scope INTO the DB (mig 138) so we never sum the whole platform
// just to keep one owner's delta (the cost bomb this fixed). NULL = all (admin).
async function windowTotals(pIds: string[] | null, from: string, to: string) {
  const rev = await sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to, p_ids: pIds });
  if (rev.error) throw rev.error;
  let revenue = 0, orders = 0;
  for (const r of (rev.data ?? []) as Record<string, unknown>[]) {
    revenue += Number(r.revenue) || 0;
    orders += Number(r.orders) || 0;
  }
  return { revenue: num(revenue), orders };
}

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;

  const sp = req.nextUrl.searchParams;
  // ── AN UNKNOWN RANGE IS ANSWERED AS "today", SO IT MUST SAY "today" (T9 finding F21) ───────────
  // `windowFor()` falls through to today for anything it doesn't recognise, but `range` was echoed
  // back RAW in the payload — so `?range=NOT_A_RANGE` returned today's numbers labelled
  // "NOT_A_RANGE" (measured live on the backup, 2026-08-12, against the reports route which
  // correctly answered "today"). That route added this normalisation after the same bug rendered a
  // blank chart title; this one never got it, and the two halves of one KPI row could disagree.
  const VALID_RANGES = new Set(["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all", "custom"]);
  const rawRange = sp.get("range") || "today";
  const range = VALID_RANGES.has(rawRange) ? rawRange : "today";
  const rid = sp.get("rid");
  const compare = sp.get("compare") === "1";
  // All-time "records" (lfh_owner_records) is an UNBOUNDED scan of the restaurant's whole
  // order history — cheap to run once, wasteful every 60s. The client asks for it only on
  // first load / range change (&records=1) and keeps its last value across auto-refreshes,
  // so the polled path no longer re-scans all-time bests each minute (audit 2026-07-07).
  const wantRecords = sp.get("records") === "1";
  // Per-restaurant privacy (mig 133, Stage 7): revenue/analytics IS the "reports" section —
  // a REAL owner only sees it for restaurants whose "reports" the admin still grants. Ungranted
  // restaurants are dropped (zero data, no leak). Admin (scope.all / scope.admin) is never gated.
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "reports");
    if (rid && !allowed.includes(rid)) return NextResponse.json({ error: "Reports aren't enabled for this restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    if (!allowed.length) return NextResponse.json({ error: "Reports aren't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope.ids = allowed;
  }
  const { from, to, bucket } = windowFor(range, sp);

  // ── STAFF PAY AS AN EXPENSE (mig 221, owner 2026-07-30: "it should also reduce main profit
  //    because it all counts as expense") ─────────────────────────────────────────────────
  // Cash truth: money that actually left in this window, pay-list members only (a payment can
  // only exist for someone on the list). ONE indexed sum, and only for restaurants that have
  // the module — a restaurant without it gets `null` and the dashboard shows no such tile.
  // THE ADMIN'S ALL-RESTAURANTS VIEW USED TO LOSE THIS TILE IN SILENCE (T9 sweep, 2026-08-05).
  // `scope.all` gave an EMPTY id list, so this returned null and the staff-pay / after-staff-pay
  // tiles simply weren't there — no figure, no note, nothing to tell the admin why. The tips line
  // was fixed for exactly this on 2026-08-04 ("used to mean the tips line silently vanished from
  // that view with no note") and its two neighbours were left behind. Enumerate the scope like tips
  // does, and read the payroll rung for the whole set in ONE settings query rather than one
  // round-trip per restaurant — that loop was fine for one restaurant and wrong for a platform.
  // ── THE RESTAURANT LIST IS READ ONCE, NOT ONCE PER TILE (T20 sweep, 2026-08-19) ────────────────
  // `staffPayExpense()` and `foodLossExpense()` each resolved the scope for themselves, and on the
  // ADMIN's all-restaurants view that means `scopedRestaurantIds()` — which PAGES the whole
  // `restaurants` table, a thousand rows at a time. Two tiles, so the same paged read ran twice on
  // every recompute, and the two awaits sat one after another in the returned object literal, so the
  // second waited on the first. Memoised per request and started together: one list, one wait.
  //
  // Deliberately a promise, not an array: the resolution is only paid for if a tile actually needs
  // it, which for a single-restaurant owner is never (the `rid` / `scope.ids` branches are free).
  let scopeIdsP: Promise<string[] | null> | null = null;
  const tileIds = (): Promise<string[] | null> => (scopeIdsP ??= (async () => {
    try {
      return (rid ? [rid] : scope.all ? await scopedRestaurantIds(scope) : scope.ids).filter(Boolean) as string[];
    } catch { return null; }   // an unreadable list must not print a figure that is too small
  })());
  const staffPayExpense = async (): Promise<{ paidOut: number; people: number; entries: number } | null> => {
    const ids = await tileIds();
    if (!ids || !ids.length) return null;
    const eff = await payrollEffectiveByRid(ids);
    const on = ids.filter((id) => eff[id] === true);
    if (!on.length) return null;
    const q = await sb.rpc("lfh_staff_pay_expense", {
      p_restaurant: on.length === 1 ? on[0] : null,
      // businessDateHi, NOT istDateOf: a business-day window ends at 05:00 IST the next
      // morning, so istDateOf handed back TOMORROW and a salary recorded the next morning was
      // counted into the previous day (T5 sweep, 2026-08-06 — see lib/businessDay).
      p_from: istDateOf(from), p_to: businessDateHi(to),
      p_ids: on.length === 1 ? null : on,
    });
    const r = (q.data || [])[0] as Record<string, unknown> | undefined;
    if (!r) return { paidOut: 0, people: 0, entries: 0 };
    return { paidOut: num(r.paid_out), people: Number(r.people) || 0, entries: Number(r.entries) || 0 };
  };
  // ── FOOD MADE THEN BINNED (owner, 2026-08-18 — docs/CANCEL-AND-LOSS-SPEC.md) ─────────────────
  // "the cancelinging amout go up expensis goes up." A cancellation where the food WAS cooked writes
  // a `food_loss` expense priced at what the ingredients really cost (migration 337). This is the
  // figure that reaches his Expenses tile.
  //
  // It is NOT the cancelled bill's value: that is revenue he never earned and it was never in the
  // revenue figure to begin with (mig 315 — revenue is net, and cancelled orders are never counted).
  // The ingredient cost is a real cost; the bill value is not. Keeping those two apart is the whole
  // reason this exists.
  //
  // Read directly rather than through an RPC: it is a handful of rows, filtered on the indexed
  // restaurant_id, with the columns named and voided rows excluded. Same window rule as staff pay —
  // a business day ends at 05:00 IST, so businessDateHi, never istDateOf.
  const foodLossExpense = async (): Promise<{ amount: number; entries: number } | null> => {
    const ids = await tileIds();          // the same one list — see the note on staffPayExpense
    if (!ids || !ids.length) return null;
    const q = await sb.from("expenses")
      .select("amount")
      .in("restaurant_id", ids)
      .eq("category", "food_loss")
      .is("voided_at", null)
      .gte("expense_date", istDateOf(from))
      .lte("expense_date", businessDateHi(to))
      .limit(5000);
    // A FAILED read is reported as ABSENT, never as zero — a silent 0 here would tell him he wasted
    // nothing, which is the wrong way for this to fail (the same rule staff pay above follows).
    if (q.error) { console.error("[owner/analytics] food-loss read failed:", q.error.message); return null; }
    const rows = q.data || [];
    return { amount: rows.reduce((a, r) => a + num((r as { amount: unknown }).amount), 0), entries: rows.length };
  };
  // ── THE KEY MUST CARRY THE RESOLVED WINDOW, NOT JUST ITS NAME (T5 sweep, 2026-08-06) ──────
  // This used to be the bare range name, so "today" and "30d" were the SAME cache key today as
  // yesterday. Snapshots are served stale-while-revalidate — the stored value ships first and
  // refreshes behind it — so the first dashboard open after the 05:00-IST business-day rollover
  // showed YESTERDAY'S completed day labelled "Today", and the first open after IST midnight
  // showed a 30-day window ending yesterday. The sibling reports route added exactly this guard
  // after the 2026-07-27 audit ("the first open of a new day served YESTERDAY'S 30-day window")
  // and this route was never given it, so the two halves of the same KPI row could disagree.
  // `from` is the resolved window start, so the key changes the moment the window does.
  // Built from the RESOLVED window, never from the raw query string. `custom` used to
  // interpolate sp.get("from")/sp.get("to") straight in — but windowFor() validates those and
  // silently falls back to 30d, so every distinct junk value minted its own cache row holding
  // the identical 30-day payload (T5 sweep, 2026-08-11). `from`/`to` are already validated.
  // ── AND THE CUSTOM KEY HAS TO BE STABLE, NOT MERELY VALIDATED (T13 sweep, 2026-09-04) ────────
  // The 2026-08-11 change above was right to stop keying on the RAW query values. It left half
  // the fault standing, because the resolved `to` for a custom range that includes today is
  // `now` — Math.min(requested end, now) in windowFor — so the key carried a MILLISECOND
  // timestamp and no two requests could ever share it. Measured on this route:
  //   custom 1 Aug → 7 Aug (wholly past)   two requests, one snapshot   ✅ cached
  //   custom 1 Aug → TODAY                 two requests 0.5s apart, two different `to` values,
  //                                        two different keys, two full recomputes  ❌
  // So the compute-on-view cache did nothing at all for the one custom range a person actually
  // asks for — the one ending today — and each open also left another row behind in the cache
  // table under a key nothing can ever hit again.
  //
  // Keyed to the DAY, exactly as the eight fixed ranges already are. That is safe rather than
  // merely cheaper: two custom requests that share a `from` and a `to`-day differ only in the
  // seconds between them, so they ARE the same window, and `fingerprint()` is what notices new
  // orders inside that day — the key's job is identity, not freshness. `from` is always an IST
  // midnight and `to` either a day boundary or now, so slicing cannot merge two real windows.
  const rangeKey = range === "custom"
    ? `custom:${from.slice(0, 10)}:${to.slice(0, 10)}`
    : `${range}:${from.slice(0, 10)}`;
  const prevWin = compare ? prevWindowFor(range, from, to) : null;
  const prevTsWin = compare ? prevTsWindowFor(range, from, to) : null;

  try {
    if (!rid) {
      // Group scope — the "who earns more" bar + multi-line trend. Compute-on-view cached
      // (mig 196): a normal home open serves the stored JSON instantly; the Refresh button
      // (?refresh=1) forces a live recompute. Keyed by the already-authorized scope.
      const gIds = scope.all ? [] : scope.ids;
      const groupPayload = await cachedOwnerPayload({
        // v2: payload gained `heatmap` (mig 197); v3: gained `categories`; v5: gained
        // `timeseriesPrev` (revenue-vs-previous-period overlay); v6 (2026-08-31): gained `window`,
        // the resolved from/to — each shape change bumps the version so stale snapshots can't serve
        // field-less JSON verbatim until their fingerprint happens to change (found 2026-07-26, and
        // walked into again on 2026-08-31 by adding `window` without bumping: the live check found
        // `range=today` carrying it and `range=30d`, served from a snapshot, not).
        key: `analytics:v6:group:${scopeKeyOf(null, scope.all, gIds)}:${rangeKey}:c${compare ? 1 : 0}`,
        force: sp.get("refresh") === "1",
        fingerprint: () => fpWithStaffPay(scope.all ? null : gIds, from, to),
        compute: async () => {
      const allow = scope.all ? null : new Set(scope.ids);
      const pIds = scope.all ? null : scope.ids; // DB-side scope (mig 138) — no whole-platform scan
      // Speed (owner round-5): every independent read starts NOW and runs concurrently —
      // the payment/category per-restaurant fan-outs and the prev-window totals used to
      // wait for the base block, serialising 3 extra round-trips into the compute time.
      const pmIds: (string | null)[] = scope.all ? [null] : scope.ids;
      const pmP = mapLimit(pmIds, FANOUT, (id) => sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      const catScopedP = scope.all ? null : mapLimit(scope.ids, FANOUT, (id) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      // ── A PROMISE MUST NOT BE ABLE TO REJECT BEFORE ANYONE IS LISTENING (T9 finding F12) ────────
      // `windowTotals` is the one helper here that THROWS (`if (rev.error) throw rev.error`) instead
      // of returning an error object. It was started here and only awaited ~50 lines below, with
      // `await pmP` and the whole category fan-out in between — so if the previous-window RPC failed
      // while those were still in flight, the rejection had no handler attached, and Node reports an
      // unhandled rejection, which on the serverless runtime can end the invocation instead of
      // letting this route answer with its own `dbFail`. Catching it AT CREATION keeps the
      // parallelism (which is why it starts early) and turns the failure into a value.
      const prevP: Promise<{ revenue: number; orders: number } | null> = prevWin
        ? windowTotals(pIds, prevWin.from, prevWin.to).catch((e) => {
            console.error("[owner/analytics] previous-window totals failed:", e instanceof Error ? e.message : e);
            return null;   // the ▲/▼ comparison chips simply don't render — never a wrong delta
          })
        : Promise.resolve(null);
      // Previous-period revenue PER BUCKET (same grain), for the "this period vs previous"
      // overlay that replaces Busy hours. ONE extra pre-summed RPC, only inside the cached
      // compute — so it runs at most on a ~5-min recompute, never on a plain snapshot read.
      const prevTsP = prevTsWin
        ? sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: null, p_from: prevTsWin.from, p_to: prevTsWin.to, p_bucket: bucket, p_ids: pIds })
        : Promise.resolve(null);
      const [rev, ts, heat] = await Promise.all([
        sb.rpc("lfh_owner_restaurant_revenue", { p_from: from, p_to: to, p_ids: pIds }),
        sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: null, p_from: from, p_to: to, p_bucket: bucket, p_ids: pIds }),
        // Busy heatmap (mig 197): one ≤7×24 pre-summed grid across the caller's own
        // restaurants — p_ids pushes the scope into the DB, same rule as the calls above.
        sb.rpc("lfh_owner_heatmap", { p_restaurant_id: null, p_from: heatFrom(from, to), p_to: to, p_ids: pIds }),
      ]);
      if (rev.error) throw rev.error;
      if (ts.error) throw ts.error;
      // Heatmap is NON-FATAL: a slow/failed busy-hours grid must never wedge the whole
      // dashboard (it did on "All time"). On error, `heat.data ?? []` below yields an empty
      // grid and every other number/chart still renders.
      // An owner only ever sees their OWN restaurants; admin sees all. These RPCs
      // return one row per restaurant, so we filter the tiny pre-summed rows here.
      const restaurantRevenue = (rev.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          id: r.restaurant_id, slug: r.slug, name: r.name, accentColor: (r.accent_color as string) || "#e3c06f",
          revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      const timeseries = (ts.data ?? [])
        .filter((r: Record<string, unknown>) => !allow || allow.has(r.restaurant_id as string))
        .map((r: Record<string, unknown>) => ({
          bucket: r.bucket, restaurantId: r.restaurant_id, revenue: num(r.revenue), orders: Number(r.orders) || 0,
        }));
      // Payment breakdown: lfh_owner_payment_breakdown(NULL) sums PLATFORM-WIDE and its
      // rows carry no restaurant_id, so it CANNOT be post-filtered — passing NULL for a
      // scoped owner leaks every other tenant's payment totals (cross-tenant leak, found
      // + fixed 2026-07-04). Admin (scope.all) may sum all; a scoped owner sums ONLY
      // their own restaurants (one tiny call each) and we merge by method.
      // ── DEGRADE GRACEFULLY, like the sibling reports route (T5 sweep, 2026-08-06) ──────────
      // These two fan-outs used to `throw r.error` on the FIRST failing restaurant, which threw
      // out of the cached compute and 500'd the whole request — one restaurant's slow payment or
      // category RPC blanked every chart, every KPI and every OTHER restaurant's numbers. The
      // reports route has had the opposite policy since the 2026-07-09 audit ("keep the
      // restaurants that succeeded… only surface an error when EVERY one failed"), and the
      // heatmap in this very file is excluded from its throw loop for exactly this reason. Keep
      // what answered; only a TOTAL failure is an error.
      const pmByMethod = new Map<string, { method: string; revenue: number; orders: number }>();
      const pmRes = await pmP;
      const pmOk = pmRes.filter((r) => !r.error);
      if (!pmOk.length && pmRes.length) throw pmRes.find((r) => r.error)?.error || new Error("Payment breakdown failed");
      for (const r of pmOk) {
        for (const row of (r.data ?? []) as Record<string, unknown>[]) {
          const m = String(row.method ?? "");
          const cur = pmByMethod.get(m) || { method: m, revenue: 0, orders: 0 };
          cur.revenue = num(cur.revenue + (Number(row.revenue) || 0));
          cur.orders += Number(row.orders) || 0;
          pmByMethod.set(m, cur);
        }
      }
      const paymentMethods = Array.from(pmByMethod.values()).sort((a, b) => b.revenue - a.revenue);
      // ── SAY SO WHEN A TOTAL IS ONLY PART OF THE GROUP (T9 finding F18, 2026-08-07) ──────────────
      // The degrade-gracefully rule above (T5, 2026-08-06) is right: one slow restaurant must not
      // blank the whole dashboard. But "keep what answered" quietly turns a GROUP TOTAL into a
      // subset — a multi-restaurant owner whose 3rd restaurant's RPC failed saw a "revenue by
      // payment method" chart that simply excluded it, presented as the whole group. That is the
      // same class as the ₹0 figures this sweep removed elsewhere: a number that is too small,
      // stated as fact. So the chart is still drawn from what DID answer, and the payload names
      // what is missing so the screen can say it. (cachedOwnerPayload refuses to STORE a payload
      // carrying `partial`, so this note can never outlive the blip — see lib/ownerCache.)
      const partial: PartialKey[] = [];
      if (pmOk.length < pmRes.length) partial.push("payments");
      // The heatmap is deliberately NON-FATAL (see heatFrom) — but "degraded quietly" and
      // "this restaurant is empty at those hours" look identical on screen, which is the very
      // thing `partial` exists to stop. Name it like its neighbours (T5 sweep, 2026-08-11).
      if (heat.error) partial.push("busyHours");
      // Category split across the group (round-2: the owner wants "Revenue by category"
      // on the multi home too). lfh_owner_category_breakdown is per-restaurant, so —
      // exactly like the payment breakdown above — a scoped owner sums their own
      // restaurants (one tiny pre-summed call each) and we merge by category name.
      // scope.all (admin) merges across every restaurant id from the revenue rows.
      const catByName = new Map<string, { category: string; qty: number; revenue: number }>();
      // scoped owners: already in flight; admin all-view needs the rev rows to know the ids
      const catRes = catScopedP ? await catScopedP : await mapLimit(
        (rev.data ?? []).map((r: Record<string, unknown>) => r.restaurant_id as string),
        FANOUT, (id: string) => sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: id, p_from: from, p_to: to }));
      const catOk = catRes.filter((r) => !r.error);       // same degrade-gracefully rule as above
      if (!catOk.length && catRes.length) throw catRes.find((r) => r.error)?.error || new Error("Category breakdown failed");
      for (const r of catOk) {
        for (const row of (r.data ?? []) as Record<string, unknown>[]) {
          const c = String(row.category ?? "Other");
          const cur = catByName.get(c) || { category: c, qty: 0, revenue: 0 };
          cur.qty += Number(row.qty) || 0;
          cur.revenue = num(cur.revenue + (Number(row.revenue) || 0));
          catByName.set(c, cur);
        }
      }
      const categories = Array.from(catByName.values()).sort((a, b) => b.revenue - a.revenue);
      if (catOk.length < catRes.length) partial.push("categories");
      const prev = await prevP;
      // Sum the previous window's per-restaurant rows into ONE total per bucket (the overlay
      // is a whole-group total line, not per-restaurant). Non-fatal: a failed prev query just
      // yields an empty array and the current line still draws.
      const prevTs = await prevTsP;
      // Cap to the window END: the day-grain RPC (mig 190 `hist` CTE) filters p_from but
      // NOT p_to — it always runs to the rollup watermark (~now). Existing callers end
      // "now" so never saw it; this is the first PAST-ending window, so we drop any bucket
      // at/after prevTsWin.to here (tiny pre-summed rows; the filter, not a wider fetch).
      const prevCut = prevTsWin ? Date.parse(prevTsWin.to) : Infinity;
      const prevByBucket = new Map<string, number>();
      if (prevTs && !prevTs.error) {
        for (const r of (prevTs.data ?? []) as Record<string, unknown>[]) {
          const b = String(r.bucket);
          if (Date.parse(b) >= prevCut) continue;
          prevByBucket.set(b, num((prevByBucket.get(b) || 0) + (Number(r.revenue) || 0)));
        }
      }
      const timeseriesPrev = Array.from(prevByBucket.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([bucket, revenue]) => ({ bucket, revenue }));
      const heatmap = ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({
        dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue),
      }));
      // Together, not one after another: they are independent reads over the same id list.
      const [staffPay, foodLoss] = await Promise.all([staffPayExpense(), foodLossExpense()]);
      // The resolved window rides along for the same reason it does on the reports route — see the
      // long note there. `?range=custom` with unusable dates is answered as the last 30 days and
      // still labelled "custom", and without this the screen cannot say which thirty days.
      return { scope: "group", range, window: { from, to }, restaurantRevenue, timeseries, timeseriesPrev, paymentMethods, categories, heatmap, prev,
        staffPay, foodLoss,
        ...(partial.length ? { partial } : {}) };
        },
      });
      return NextResponse.json(groupPayload);
    }

    // Restaurant scope — KPIs + per-dish/category/hourly + this restaurant's trend.
    // An owner may only drill into a restaurant they actually own.
    if (!scope.all && !scope.ids.includes(rid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    // Crazy-dashboard extras (mig 127, all rid-scoped + pre-summed):
    //  · records — all-time bests (one JSONB row, on-demand only).
    //
    // GONE, deliberately (owner-panel sweep 2026-08-04): `sameHour`
    // (lfh_owner_samehour_compare) and `payTrend` (lfh_owner_payment_trend). Both ran on
    // EVERY cold/refresh compute of a restaurant dashboard — payTrend returned 56 rows on the
    // demo restaurant — and NOTHING rendered either field: the charts that once did
    // (SameHourBar, PayTrendStack) had become unreferenced exports. Worse, both sat in the
    // `throw` loop below, so a failure in a query no screen uses would blank the whole owner
    // dashboard; the heatmap was explicitly excluded from that loop for exactly this reason.
    // The RPCs are untouched in the database — re-add the fetch WITH its chart if either view
    // comes back.
    // Compute-on-view cached like the group scope (owner round-3: "auto calculate…
    // it should show number only, very fast — the live site is already optimized").
    // LIVE bits stay OUTSIDE the cache: open-tables (a now-count) and the unbounded
    // all-time records (fetched once per restaurant on demand).
    const restBase = await cachedOwnerPayload({
      // Still v5 after `sameHour`/`payTrend` were dropped: the bump rule exists so a stale
      // snapshot can't serve JSON that is MISSING a field the UI now reads. Here the change is
      // the other direction — an old snapshot merely carries two extra fields nothing reads —
      // so a bump would only buy a pointless recompute for every restaurant.
      key: `analytics:v6:rest:${rid}:${rangeKey}:c${compare ? 1 : 0}`,
      force: sp.get("refresh") === "1",
      fingerprint: () => fpWithStaffPay([rid], from, to),
      compute: async () => {
    const [meta, ts, dishes, cats, hourly, heat, pm, prevTs] = await Promise.all([
      sb.from("restaurants").select("id, slug, name, accent_color, hero_title").eq("id", rid).maybeSingle(),
      sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: from, p_to: to, p_bucket: bucket }),
      sb.rpc("lfh_owner_dish_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_category_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_hourly", { p_restaurant_id: rid, p_from: from, p_to: to }),
      sb.rpc("lfh_owner_heatmap", { p_restaurant_id: rid, p_from: heatFrom(from, to), p_to: to }),
      sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: rid, p_from: from, p_to: to }),
      // Previous-period revenue per bucket for the "this period vs previous" overlay. Same
      // grain as the current trend; non-fatal (excluded from the throw loop below).
      prevTsWin
        ? sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: rid, p_from: prevTsWin.from, p_to: prevTsWin.to, p_bucket: bucket })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (meta.error) throw meta.error;
    if (!meta.data) throw new Error("restaurant not found");
    // `heat` is deliberately EXCLUDED — the heatmap is non-fatal (see heatFrom): its error
    // must not throw, or one slow busy-hours grid wedges the whole dashboard. `heat.data ?? []`
    // below degrades to an empty grid.
    for (const e of [ts, dishes, cats, hourly, pm]) if (e.error) throw e.error;

    const dishRows = (dishes.data ?? []).map((r: Record<string, unknown>) => ({
      title: r.title, qty: Number(r.qty) || 0, revenue: num(r.revenue),
    }));
    const tsRows = (ts.data ?? []).map((r: Record<string, unknown>) => ({
      bucket: r.bucket, revenue: num(r.revenue), orders: Number(r.orders) || 0,
    }));
    const revenue = num(tsRows.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0));
    const orders = tsRows.reduce((a: number, r: { orders: number }) => a + r.orders, 0);
    // Avg order = PAID revenue ÷ PAID order count (both from paid-only sources). `orders` above
    // counts ALL non-cancelled orders (incl. open/unpaid), so revenue/orders understated the
    // average and made it drift UPWARD as open tables settled with no new orders. paid-count
    // comes from the payment breakdown (already fetched, WHERE payment_status='paid'). (owner 2026-07-06)
    const paidOrders = (pm.data ?? []).reduce((a: number, r: Record<string, unknown>) => a + (Number(r.orders) || 0), 0);
    // ── A FAILED ▲/▼ COMPARISON MUST NOT THROW THE DASHBOARD AWAY (T20 sweep #7, 2026-08-27) ────────
    // `windowTotals` is the one helper here that THROWS instead of returning an error object, and this
    // await sits INSIDE the cached compute — so a failed previous-window RPC left the whole compute,
    // hit the outer catch, and answered "Couldn't load your dashboard just now" for ONE restaurant.
    // Every real number on that page had already been read successfully.
    //
    // The GROUP scope has caught it since T9 finding F12 (`.catch(... return null)` on line ~388, with
    // the reasoning written out: "the ▲/▼ comparison chips simply don't render — never a wrong delta").
    // The restaurant scope was left throwing, so the SAME failure blanked one screen and merely dropped
    // two little arrows on the other. Same policy on both halves now: no delta beats no dashboard.
    const prev = prevWin
      ? await windowTotals([rid], prevWin.from, prevWin.to).catch((e) => {
          console.error("[owner/analytics] previous-window totals failed:", e instanceof Error ? e.message : e);
          return null;
        })
      : null;
    // Previous window's revenue per bucket (ascending) for the overlay line. Non-fatal.
    // Cap to the window END — the day-grain RPC ignores p_to (mig 190 `hist`, see group note).
    const prevCut = prevTsWin ? Date.parse(prevTsWin.to) : Infinity;
    const tsPrevRows = (prevTs.error ? [] : (prevTs.data ?? []))
      .map((r: Record<string, unknown>) => ({ bucket: r.bucket, revenue: num(r.revenue) }))
      .filter((r: { bucket: unknown }) => Date.parse(String(r.bucket)) < prevCut)
      .sort((a: { bucket: unknown }, b: { bucket: unknown }) => (String(a.bucket) < String(b.bucket) ? -1 : 1));

    // `orders` counts ALL non-cancelled (incl. open/unpaid) while revenue+avgOrder are
    // PAID-only — so Revenue ÷ Orders ≠ Avg order and looks like a wrong number. Ship
    // `paidOrders` too so the dashboard can label the tile honestly (owner audit 2026-07-06).
    // Together, not one after another — see the note on staffPayExpense.
    const [staffPay, foodLoss] = await Promise.all([staffPayExpense(), foodLossExpense()]);
    return {
      scope: "restaurant", range, window: { from, to }, prev,
      restaurant: { id: meta.data.id, slug: meta.data.slug, name: meta.data.name, accentColor: meta.data.accent_color || "#e3c06f", heroTitle: meta.data.hero_title || "" },
      kpis: { revenue, orders, paidOrders, avgOrder: paidOrders ? num(revenue / paidOrders) : 0, topDish: dishRows[0]?.title || "—" },
      staffPay, foodLoss,
      timeseries: tsRows,
      timeseriesPrev: tsPrevRows,
      dishes: dishRows,
      categories: (cats.data ?? []).map((r: Record<string, unknown>) => ({ category: r.category, qty: Number(r.qty) || 0, revenue: num(r.revenue) })),
      hourly: (hourly.data ?? []).map((r: Record<string, unknown>) => ({ hour: Number(r.hour) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      heatmap: ((heat.data ?? []) as Record<string, unknown>[]).map((r) => ({ dow: Number(r.dow) || 0, hr: Number(r.hr) || 0, orders: Number(r.orders) || 0, revenue: num(r.revenue) })),
      paymentMethods: (pm.data ?? []).map((r: Record<string, unknown>) => ({ method: r.method, revenue: num(r.revenue), orders: Number(r.orders) || 0 })),
      // Same rule as the group scope: an unread busy grid says so instead of drawing an empty
      // one (T5 sweep, 2026-08-11). cachedOwnerPayload refuses to STORE a payload carrying
      // `partial`, so the note can never outlive the blip.
      ...(heat.error ? { partial: ["busyHours"] as PartialKey[] } : {}),
    };
      },
    });

    // THE OPEN-TABLES COUNT IS GONE FROM HERE (T5 sweep, 2026-08-06). It was a live count(*) on
    // open sessions, run OUTSIDE the snapshot cache on EVERY request — measured at ~165 ms — and
    // NOTHING rendered it: every open-tables figure on the dashboard (the hero line, the estate
    // table's Open column, the drawer) reads /api/owner/overview, which already returns
    // open_tables per restaurant on the same page load and refreshes on the same 60s tick. That
    // is the project's own "nothing is fetched that nothing renders" rule, and this was the last
    // thing breaking it here. If a future card wants a live head-count, read it from the overview
    // payload rather than adding a second query for the same number.
    //
    // The all-time RECORDS scan stays outside the cache on purpose: it is unbounded, and the
    // client asks for it once per restaurant (&records=1), not on the polled path.
    // ── A TILE THAT VANISHES SAYS SO (improvement I5, owner 2026-08-12) ──────────────────────────
    // A failed all-time-records read used to leave `records: null`, and the tile simply wasn't
    // there — the exact "one fewer block and nothing says why" that `partial` exists to stop, and
    // the last block on this page that wasn't using it. It stays NON-fatal (the rest of the
    // dashboard is fine without it) and is fetched OUTSIDE the snapshot cache, so naming it here
    // cannot poison a stored payload.
    let records: unknown = null;
    let recordsUnread = false;
    if (wantRecords) {
      const r = await rd("records", () => sb.rpc("lfh_owner_records", { p_restaurant_id: rid }));
      if (r.error) { console.error("[owner/analytics] all-time records unread:", r.error); recordsUnread = true; }
      else records = r.data ?? null;
    }
    const basePartial = (restBase as { partial?: PartialKey[] }).partial || [];
    const partialOut = recordsUnread ? [...basePartial, "records" as PartialKey] : basePartial;
    return NextResponse.json({ ...restBase, records, ...(partialOut.length ? { partial: partialOut } : {}) });
  } catch (e) {
    return dbFail("owner/analytics", e, {
      message: "Couldn't load your dashboard just now — please try again.",
    });
  }
}
