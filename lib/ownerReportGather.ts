// Shared "gather the professional report" logic (owner round-6): one implementation
// the dashboard's Report button AND the /owner/reports hub both call, so the compiled
// statement (billing + CGST/SGST + settlement + per-restaurant sections + day ledger
// + khata) is identical wherever it's generated. Pure data — no React, no page state.
//
// All reads hit the compute-on-view cached owner APIs (mig 196 + the analytics cache),
// so even a 7-restaurant gather is fast and egress-cheap.
// ── EVERY READ HAS A CEILING (owner picked item 18, 2026-08-30) ─────────────────────────────────
// A statement is assembled from three reads per restaurant, and none of them had an upper bound — so
// one stalled read left the whole Report spinning with nothing to try again. 45s each: a real
// statement over a long period genuinely takes a while, and the two failure paths below already
// exist (a per-restaurant failure is DROPPED and NAMED in `omitted`, never silently absorbed), so a
// deadline lands on a path that is already built and already honest.
import { deadline } from "@/lib/partialRead";
const READ_DEADLINE_MS = 45_000;

import { canonPayMethod } from "@/components/owner/Charts";
import type { ReportData, ReportPayments } from "@/components/owner/ownerReportDoc";
import { mapLimit } from "@/lib/mapLimit";

const IST = "Asia/Kolkata";
/** "8 PM" — the one clock this console writes, on screen and now on paper too. */
const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
type Pay = { method: string; revenue: number; orders: number };

// (the shared cap lives in lib/mapLimit; the reason it exists is written there)
const CONCURRENCY = 4;   // 4 restaurants in flight = at most 8 requests, matching the route's cap

export type GatherOpts = {
  restaurants: { id: string; name: string; slug?: string }[];
  activeRid: string | null;   // one restaurant, or null for the whole scope
  scopePin: string | null;    // admin act-as ?rid pin (null for a real owner)
  asSuffix: string;           // ownerPin.asSuffix() value
  periodQs: string;           // e.g. "range=30d" or "range=custom&from=…&to=…"
  periodLabel: string;        // human label for the masthead
};

export async function gatherOwnerReport(o: GatherOpts): Promise<ReportData> {
  const scp = o.scopePin ? `&scope=${o.scopePin}${o.asSuffix}` : "";
  const list = o.activeRid ? o.restaurants.filter((r) => r.id === o.activeRid) : o.restaurants;
  // DEGRADE GRACEFULLY. This used to `throw` inside the mapped function, which rejected the
  // whole Promise.all — so ONE restaurant's analytics timing out threw away the other
  // fourteen good sections and the owner got "Couldn't build the report" instead of a report
  // with one gap (found 2026-08-04). A failed restaurant is now returned as `null`, dropped
  // below, and named in `failed` so the document can say which ones are missing. Only when
  // EVERY restaurant fails do we surface the error — matching the reports route's own rule.
  const failed: string[] = [];
  // "Named in `failed`" only ever covered the ANALYTICS call. If the MONEY call failed instead,
  // the restaurant stayed in with every billing field null — and `bsum()` below returns null
  // unless EVERY restaurant has the field, so the group's whole gross/discount/GST table
  // collapsed to a single "Net amount (kept)" line with no banner saying why (T5 sweep,
  // 2026-08-11). A restaurant whose money could not be read is treated exactly like one whose
  // analytics could not be read: dropped, and NAMED on the paper.
  const gathered = await mapLimit(list, CONCURRENCY, async (r) => {
    const [a, m] = await Promise.all([
      fetch(`/api/owner/analytics?${o.periodQs}&rid=${r.id}&compare=1${scp}`, { cache: "no-store", signal: deadline(READ_DEADLINE_MS) }).then((x) => x.json()).catch((e) => ({ error: String(e?.message || e) })),
      fetch(`/api/owner/reports?type=sales&${o.periodQs}&rid=${r.id}${scp}`, { cache: "no-store", signal: deadline(READ_DEADLINE_MS) }).then((x) => x.json()).catch(() => null),
    ]);
    if (a.error) { failed.push(r.name); return null; }
    if (!m || m.error) { failed.push(r.name); return null; }
    const hour = [...(a.hourly ?? [])].sort((x: { orders: number }, y: { orders: number }) => y.orders - x.orders)[0];
    const t = m && !m.error ? m.totals : null;
    const comps: { label: string; rate: number; amount: number }[] = (m && !m.error && m.tax?.components ? m.tax.components : [])
      .map((c: { label?: string; rate?: number; amount?: number }) => ({ label: String(c.label || "Tax"), rate: Number(c.rate) || 0, amount: Number(c.amount) || 0 }))
      .filter((c: { amount: number }) => c.amount > 0);
    const grain = m && !m.error ? String(m.bucket || "day") : "day";
    const dlabel = (iso: string) => {
      const dt = new Date(iso);
      if (grain === "hour") return dt.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST });
      if (grain === "month") return dt.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: IST });
      return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: IST });
    };
    const daily = (m && !m.error ? (m.rows ?? []) : []).map((x: Record<string, unknown>) => ({
      label: dlabel(String(x.bucket)), iso: String(x.bucket), orders: Number(x.orders) || 0,
      gross: Number(x.subtotal) || 0, discount: Number(x.discount) || 0,
      tax: Number(x.tax) || 0, net: Number(x.revenue) || 0,
    }));
    return {
      name: r.name, slug: r.slug ?? "",
      revenue: Number(a.kpis?.revenue) || 0, orders: Number(a.kpis?.orders) || 0,
      paidOrders: Number(a.kpis?.paidOrders ?? a.kpis?.orders) || 0,
      avg: Number(a.kpis?.avgOrder) || 0, share: 0,
      prevRevenue: a.prev ? Number(a.prev.revenue) || 0 : null,
      billing: {
        gross: t ? Number(t.subtotal) || 0 : null,
        discount: t ? Number(t.discount) || 0 : null,
        taxComponents: comps,
        taxTotal: t ? Number(t.tax) || 0 : null,
        net: t ? Number(t.revenue) || 0 : (Number(a.kpis?.revenue) || 0),
        cancelledOrders: t ? Number(t.cancelledOrders) || 0 : null,
        cancelledValue: t ? Number(t.cancelledValue) || 0 : null,
      },
      busiestHour: hour?.orders ? hour12(Number(hour.hour) || 0) : null,
      dishes: (a.dishes ?? []) as { title: string; qty: number; revenue: number }[],
      categories: (a.categories ?? []) as { category: string; qty: number; revenue: number }[],
      payments: ((a.paymentMethods ?? []) as Pay[]).map((p) => ({ method: canonPayMethod(p.method), revenue: p.revenue, orders: p.orders })),
      daily, dailyGrain: grain,
      hourly: (a.hourly ?? []) as { hour: number; orders: number; revenue: number }[],
    };
  });
  const perRest = gathered.filter((x): x is NonNullable<typeof x> => x !== null);
  // Only a TOTAL failure is an error — one bad restaurant must not blank the whole statement.
  if (!perRest.length && list.length) {
    throw new Error(`Couldn't read any restaurant's figures for this period (${failed.join(", ") || "all failed"}). Try a shorter period, or one restaurant at a time.`);
  }
  const totalRev = perRest.reduce((s, r) => s + r.revenue, 0);
  perRest.forEach((r) => { r.share = totalRev ? r.revenue / totalRev : 0; });
  perRest.sort((a, b) => b.revenue - a.revenue);
  const gp = new Map<string, ReportPayments>();
  for (const r of perRest) for (const p of r.payments) {
    const c = gp.get(p.method) || { method: p.method, revenue: 0, orders: 0 };
    c.revenue += p.revenue; c.orders += p.orders; gp.set(p.method, c);
  }
  // Pay Later liability (as of today) — only when the report covers the owner's WHOLE
  // scope (all restaurants, or a single-restaurant owner), never one of many.
  let khata: { outstanding: number; people: number; collectedMonth: number } | null = null;
  if (!o.activeRid || o.restaurants.length === 1) {
    try {
      const k = await fetch(`/api/owner/khata${o.scopePin ? `?rid=${o.scopePin}${o.asSuffix}` : ""}`, { cache: "no-store", signal: deadline(READ_DEADLINE_MS) }).then((x) => x.json());
      if (k?.summary && Number(k.summary.totalOutstanding) > 0) {
        khata = { outstanding: Number(k.summary.totalOutstanding) || 0, people: Number(k.summary.peopleCount) || 0, collectedMonth: Number(k.summary.collectedMonth) || 0 };
      }
    } catch { /* khata line is optional — never block the report */ }
  }
  const paidOrders = perRest.reduce((s, r) => s + r.paidOrders, 0);
  const bsum = (k: "gross" | "discount" | "taxTotal" | "cancelledOrders" | "cancelledValue") =>
    perRest.every((r) => r.billing[k] != null) ? perRest.reduce((s, r) => s + (r.billing[k] || 0), 0) : null;
  // MERGE ON THE LABEL **AND THE RATE** (T5 sweep, 2026-08-11). Two restaurants whose CGST is
  // configured at different rates were summed onto one "CGST" line, on a document whose whole
  // purpose is filing. Same rate → same line, as before; different rates → "CGST (2.5%)" and
  // "CGST (9%)" stay apart, which is what a return needs.
  const rates = new Map<string, number>();
  for (const r of perRest) for (const c of r.billing.taxComponents) {
    const seen = rates.get(c.label);
    if (seen === undefined) rates.set(c.label, c.rate);
    else if (seen !== c.rate) rates.set(c.label, NaN);   // NaN = this label is used at >1 rate
  }
  const gc = new Map<string, number>();
  for (const r of perRest) for (const c of r.billing.taxComponents) {
    const key = Number.isNaN(rates.get(c.label)) ? `${c.label} (${c.rate}%)` : c.label;
    gc.set(key, (gc.get(key) || 0) + c.amount);
  }
  return {
    scopeName: o.activeRid ? (list[0]?.name ?? "Restaurant") : `All ${list.length} restaurants`,
    // Named on the document so a missing restaurant is VISIBLE, never a silent gap.
    omitted: failed.length ? failed : undefined,
    periodLabel: o.periodLabel,
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST }),
    group: {
      revenue: totalRev, orders: perRest.reduce((s, r) => s + r.orders, 0), paidOrders,
      avg: paidOrders ? totalRev / paidOrders : 0,
      prevRevenue: perRest.every((r) => r.prevRevenue != null) ? perRest.reduce((s, r) => s + (r.prevRevenue || 0), 0) : null,
      billing: {
        gross: bsum("gross"), discount: bsum("discount"),
        taxComponents: Array.from(gc.entries()).map(([label, amount]) => ({ label, amount })),
        taxTotal: bsum("taxTotal"), net: totalRev,
        cancelledOrders: bsum("cancelledOrders"), cancelledValue: bsum("cancelledValue"),
      },
      payments: Array.from(gp.values()).sort((a, b) => b.revenue - a.revenue),
      khata,
    },
    restaurants: perRest,
  };
}
