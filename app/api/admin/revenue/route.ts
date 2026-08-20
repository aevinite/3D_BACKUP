// GET /api/admin/revenue — the PLATFORM's own business numbers (the operator's SaaS
// health), derived from the existing restaurant_billing + restaurant_payments tables.
// This is PLATFORM income (what restaurants pay US for their subscription) — explicitly
// allowed, and separate from restaurant FOOD revenue, which never appears in /aevinite.
//
// Everything here is DERIVABLE from current data (no schema change): MRR/ARR from the
// active subscriptions' amounts, status counts, MRR-by-plan, and the real month-by-month
// "collected" trend from the payments ledger. True MRR-history / churn-rate need a
// subscription-event log (a later feature) — we're honest and don't fake those.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";
// Read every row of a one-row-per-restaurant table, past PostgREST's cap — see lib/pageAll.ts.
import { pageAll } from "@/lib/pageAll";

export const dynamic = "force-dynamic";

type Billing = { restaurant_id: string; plan: string | null; status: string; amount: number | null; currency: string | null; cycle: string | null; next_due_on: string | null };

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  // IST calendar year for the "collected this year" boundary (see /api/admin/billing) — the
  // page label is IST, so a UTC year flips ~5.5h late and mismatches the heading. UTC+5:30.
  const yearStart = `${new Date(now.getTime() + 330 * 60000).getUTCFullYear()}-01-01`;

  // The 12-month chart's window, as a date the database can filter on.
  const monthsFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);

  // ── EVERY FIGURE ON THIS PAGE NOW COUNTS EVERY ROW (owner-approved 2026-08-20, item 13) ───────
  // All three reads used to stop at PostgREST's row cap and say nothing about it, so MRR, the
  // status bars and "collected all time" went quietly small as the platform grew — the bad way to
  // become wrong, on the numbers that say whether the business works. The two fixes are different
  // on purpose:
  //
  //   · restaurant_billing and restaurants are ONE ROW PER RESTAURANT, so they are PAGED
  //     (lib/pageAll). At a thousand restaurants that is one extra round trip.
  //   · restaurant_payments is a LEDGER — it grows forever and has no ceiling. Paging it into the
  //     app to add it up would drag every row across the wire to produce fourteen numbers, so it
  //     gets a SQL AGGREGATE instead (migration 343): one row, computed in Postgres, nothing left
  //     for a cap to truncate. The same answer the Z-report and the Pay Later headline reached.
  const [billingQ, collectedQ, restsQ] = await Promise.all([
    pageAll<Billing>("restaurant_billing", (from, to) =>
      sb.from("restaurant_billing").select("restaurant_id, plan, status, amount, currency, cycle, next_due_on")
        .order("restaurant_id").range(from, to)),
    sb.rpc("lfh_admin_platform_collected", { p_year_start: yearStart, p_months_from: monthsFrom }),
    pageAll<{ id: string; name: string; slug: string }>("restaurants", (from, to) =>
      sb.from("restaurants").select("id, name, slug").is("deleted_at", null).order("id").range(from, to)),
  ]);
  // Check ALL three — else a failed payments/restaurants read would show confident zeros / "—"
  // names with a 200 instead of an error the page can retry (audit).
  const anyErr = billingQ.error || collectedQ.error || restsQ.error;
  // Plain sentence to the screen, raw text to `detail` + the log — see the note in /api/admin/usage.
  if (anyErr) return adminFail("the platform revenue figures", anyErr as { message?: string }, { action: "load" });

  const restRows = restsQ.rows || [];
  const nameById = new Map<string, string>(restRows.map((r) => [r.id, r.name]));
  // Only count LIVE restaurants (matches the Billing page's H4 rule + its Trial count): drop
  // any billing row whose restaurant was soft-deleted, so a binned restaurant never inflates
  // MRR / the status bars here.
  const liveIds = new Set<string>(restRows.map((r) => r.id));
  const billing = (billingQ.rows || []).filter((b) => liveIds.has(b.restaurant_id));
  // Monthly-equivalent recurring value of one subscription (yearly spread over 12).
  const monthlyEq = (b: Billing) => { const a = Number(b.amount) || 0; return b.cycle === "monthly" ? a : a / 12; };

  // MRR = sum of ACTIVE, INR subscriptions' monthly-equivalent value. (Mixing currencies
  // into one figure would be wrong; today every plan is INR — non-INR is tracked separately.)
  const activeInr = billing.filter((b) => b.status === "active" && (b.currency || "INR") === "INR");
  const mrr = Math.round(activeInr.reduce((s, b) => s + monthlyEq(b), 0));
  const arr = mrr * 12;
  const nonInrActive = billing.filter((b) => b.status === "active" && (b.currency || "INR") !== "INR").length;

  // Counts by status across ALL LIVE restaurants — a live restaurant with NO billing row
  // counts as "trial", the SAME derivation as /api/admin/billing. Iterating only billing rows
  // here undercounted Trial, so the Revenue and Billing screens showed different Trial totals
  // for the same platform (QA 2026-07-24). Now both agree.
  const billingByRid = new Map<string, Billing>(billing.map((b) => [b.restaurant_id, b]));
  const byStatus: Record<string, number> = { active: 0, trial: 0, paused: 0, cancelled: 0 };
  for (const r of restRows) {
    const st = billingByRid.get(r.id)?.status ?? "trial";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }

  // MRR contribution by plan (active INR only).
  const planMap = new Map<string, { plan: string; mrr: number; count: number }>();
  for (const b of activeInr) {
    const plan = b.plan || "— (no plan)";
    const cur = planMap.get(plan) || { plan, mrr: 0, count: 0 };
    cur.mrr += monthlyEq(b); cur.count += 1; planMap.set(plan, cur);
  }
  const mrrByPlan = [...planMap.values()].map((p) => ({ ...p, mrr: Math.round(p.mrr) })).sort((a, b) => b.mrr - a.mrr);

  // Real "collected" trend from the payments ledger — computed in SQL over EVERY payment
  // (migration 343), so nothing here can be a truncated sample.
  const coll = (Array.isArray(collectedQ.data) ? collectedQ.data[0] : collectedQ.data) as
    { all_time?: number; this_year?: number; months?: Record<string, number> | null; row_count?: number } | null;
  const collectedAllTime = Number(coll?.all_time) || 0;
  const collectedThisYear = Number(coll?.this_year) || 0;
  const byMonth = new Map<string, number>(Object.entries(coll?.months || {}).map(([k, v]) => [k, Number(v) || 0]));
  // Last 12 calendar months, zero-filled so the chart never has gaps.
  const monthly: { month: string; label: string; collected: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthly.push({ month: key, label: d.toLocaleDateString("en-IN", { month: "short" }), collected: Math.round(byMonth.get(key) || 0) });
  }

  // Paying subscriptions table (active INR), biggest first.
  const paying = activeInr
    .map((b) => ({ name: nameById.get(b.restaurant_id) || "—", plan: b.plan || "—", cycle: b.cycle || "yearly", monthly: Math.round(monthlyEq(b)), nextDue: b.next_due_on || null }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 100);

  return NextResponse.json({
    currency: "INR",
    mrr, arr, nonInrActive,
    activeSubs: byStatus.active, // count ALL active subs (matches the "Active (paying)" status bar); MRR stays INR-only
    byStatus,
    mrrByPlan,
    collectedThisYear: Math.round(collectedThisYear),
    collectedAllTime: Math.round(collectedAllTime),
    monthly,
    paying,
    // How many payment rows the figures above were computed over. Not shown on the page — it is
    // there so a "that looks low" can be answered without opening the database.
    paymentsCounted: Number(coll?.row_count) || 0,
    generatedAt: new Date().toISOString(),
  });
}
