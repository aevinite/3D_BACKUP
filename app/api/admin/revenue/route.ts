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

export const dynamic = "force-dynamic";

type Billing = { restaurant_id: string; plan: string | null; status: string; amount: number | null; currency: string | null; cycle: string | null; next_due_on: string | null };

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  // IST calendar year for the "collected this year" boundary (see /api/admin/billing) — the
  // page label is IST, so a UTC year flips ~5.5h late and mismatches the heading. UTC+5:30.
  const yearStart = `${new Date(now.getTime() + 330 * 60000).getUTCFullYear()}-01-01`;

  const [billingQ, paymentsQ, restsQ] = await Promise.all([
    sb.from("restaurant_billing").select("restaurant_id, plan, status, amount, currency, cycle, next_due_on"),
    // Explicit columns, bounded. Amount is treated as INR (matches the rest of billing).
    sb.from("restaurant_payments").select("restaurant_id, amount, paid_on").order("paid_on", { ascending: false }).limit(10000),
    sb.from("restaurants").select("id, name, slug").is("deleted_at", null),
  ]);
  // Check ALL three — else a failed payments/restaurants read would show confident zeros / "—"
  // names with a 200 instead of an error the page can retry (audit).
  const anyErr = billingQ.error || paymentsQ.error || restsQ.error;
  // Plain sentence to the screen, raw text to `detail` + the log — see the note in /api/admin/usage.
  if (anyErr) return adminFail("the platform revenue figures", anyErr, { action: "load" });

  const nameById = new Map<string, string>((restsQ.data || []).map((r) => [r.id, r.name]));
  // Only count LIVE restaurants (matches the Billing page's H4 rule + its Trial count): drop
  // any billing row whose restaurant was soft-deleted, so a binned restaurant never inflates
  // MRR / the status bars here.
  const liveIds = new Set<string>((restsQ.data || []).map((r) => r.id));
  const billing = ((billingQ.data || []) as Billing[]).filter((b) => liveIds.has(b.restaurant_id));
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
  for (const r of restsQ.data || []) {
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

  // Real "collected" trend from the payments ledger.
  const byMonth = new Map<string, number>();
  let collectedThisYear = 0, collectedAllTime = 0;
  for (const p of paymentsQ.data || []) {
    const amt = Number(p.amount) || 0;
    collectedAllTime += amt;
    if (p.paid_on && p.paid_on >= yearStart) collectedThisYear += amt;
    if (p.paid_on) { const m = String(p.paid_on).slice(0, 7); byMonth.set(m, (byMonth.get(m) || 0) + amt); }
  }
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
    generatedAt: new Date().toISOString(),
  });
}
