// Shared "gather the professional report" logic (owner round-6): one implementation
// the dashboard's Report button AND the /owner/reports hub both call, so the compiled
// statement (billing + CGST/SGST + settlement + per-restaurant sections + day ledger
// + khata) is identical wherever it's generated. Pure data — no React, no page state.
//
// All reads hit the compute-on-view cached owner APIs (mig 196 + the analytics cache),
// so even a 7-restaurant gather is fast and egress-cheap.
import { canonPayMethod } from "@/components/owner/Charts";
import type { ReportData, ReportPayments } from "@/components/owner/ownerReportDoc";

const IST = "Asia/Kolkata";
type Pay = { method: string; revenue: number; orders: number };

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
  const perRest = await Promise.all(list.map(async (r) => {
    const [a, m] = await Promise.all([
      fetch(`/api/owner/analytics?${o.periodQs}&rid=${r.id}&compare=1${scp}`, { cache: "no-store" }).then((x) => x.json()),
      fetch(`/api/owner/reports?type=sales&${o.periodQs}&rid=${r.id}${scp}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null),
    ]);
    if (a.error) throw new Error(a.error);
    const hour = [...(a.hourly ?? [])].sort((x: { orders: number }, y: { orders: number }) => y.orders - x.orders)[0];
    const t = m && !m.error ? m.totals : null;
    const ih = m && !m.error ? m.inHand : null;
    const comps: { label: string; amount: number }[] = (m && !m.error && m.tax?.components ? m.tax.components : [])
      .map((c: { label?: string; amount?: number }) => ({ label: String(c.label || "Tax"), amount: Number(c.amount) || 0 }))
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
        // What the period COST (mig 252). Rides along on the sales payload already fetched
        // above — no extra request. null when the ladder couldn't be built, which keeps the
        // printed statement exactly as it was rather than printing a wrong bottom line.
        expenses: ih ? Number(ih.expenses) || 0 : null,
        left: ih ? Number(ih.left) || 0 : null,
      },
      busiestHour: hour?.orders ? `${hour.hour}:00` : null,
      dishes: (a.dishes ?? []) as { title: string; qty: number; revenue: number }[],
      categories: (a.categories ?? []) as { category: string; qty: number; revenue: number }[],
      payments: ((a.paymentMethods ?? []) as Pay[]).map((p) => ({ method: canonPayMethod(p.method), revenue: p.revenue, orders: p.orders })),
      daily, dailyGrain: grain,
      hourly: (a.hourly ?? []) as { hour: number; orders: number; revenue: number }[],
    };
  }));
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
      const k = await fetch(`/api/owner/khata${o.scopePin ? `?rid=${o.scopePin}${o.asSuffix}` : ""}`, { cache: "no-store" }).then((x) => x.json());
      if (k?.summary && Number(k.summary.totalOutstanding) > 0) {
        khata = { outstanding: Number(k.summary.totalOutstanding) || 0, people: Number(k.summary.peopleCount) || 0, collectedMonth: Number(k.summary.collectedMonth) || 0 };
      }
    } catch { /* khata line is optional — never block the report */ }
  }
  const paidOrders = perRest.reduce((s, r) => s + r.paidOrders, 0);
  const bsum = (k: "gross" | "discount" | "taxTotal" | "cancelledOrders" | "cancelledValue" | "expenses" | "left") =>
    perRest.every((r) => r.billing[k] != null) ? perRest.reduce((s, r) => s + (r.billing[k] || 0), 0) : null;
  const gc = new Map<string, number>();
  for (const r of perRest) for (const c of r.billing.taxComponents) gc.set(c.label, (gc.get(c.label) || 0) + c.amount);
  return {
    scopeName: o.activeRid ? (list[0]?.name ?? "Restaurant") : `All ${list.length} restaurants`,
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
        // Only summed when EVERY restaurant produced one — a partial total would read as
        // the group's costs while silently missing a restaurant's.
        expenses: bsum("expenses"), left: bsum("left"),
      },
      payments: Array.from(gp.values()).sort((a, b) => b.revenue - a.revenue),
      khata,
    },
    restaurants: perRest,
  };
}
