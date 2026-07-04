"use client";
// Owner · Reports (redesign 2026-07-04). On-demand only — a report exists when the
// owner ASKS for one (never compulsory/scheduled, owner's rule). Eight well-named
// reports instead of a 300-report jungle: pick a report + a period (+ a restaurant
// when there's more than one), hit Generate, read it, download it as CSV or print
// it. The Tax / GST report shows the ONE merged rate the manager panel shows, then
// breaks the same figure into its named components (CGST/SGST/…) underneath —
// identical totals, only the presentation differs (owner's tax spec).
import { useCallback, useEffect, useMemo, useState } from "react";
import { inr } from "@/components/admin/shared";
import { TimeBar, LeaderBar } from "@/components/owner/Charts";

type RType = "sales" | "tax" | "dishes" | "categories" | "payments" | "discounts" | "cancellations" | "hourly";
type Range = "today" | "yesterday" | "7d" | "30d" | "12m";

const REPORTS: { k: RType; label: string; icon: string; blurb: string }[] = [
  { k: "sales", label: "Sales summary", icon: "fa-chart-line", blurb: "Money in, per day — subtotal, tax, discounts, what you kept" },
  { k: "tax", label: "Tax / GST", icon: "fa-landmark", blurb: "Tax collected, with the CGST/SGST split for filing" },
  { k: "dishes", label: "Dishes (item-wise)", icon: "fa-utensils", blurb: "Every dish: how many sold, what it earned" },
  { k: "categories", label: "Categories", icon: "fa-layer-group", blurb: "Which sections of the menu earn" },
  { k: "payments", label: "Payment methods", icon: "fa-wallet", blurb: "UPI vs cash vs card" },
  { k: "discounts", label: "Discounts", icon: "fa-tag", blurb: "What was given away, when" },
  { k: "cancellations", label: "Cancellations", icon: "fa-ban", blurb: "Lost business — voided orders and their value" },
  { k: "hourly", label: "Busy hours", icon: "fa-clock", blurb: "Orders and revenue by hour of day" },
];
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" }, { k: "12m", label: "12 months" },
];

type Row = Record<string, unknown>;
type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type Report = { type: RType; range: Range; rows: Row[]; totals?: Record<string, number>; tax?: TaxInfo };
type Rest = { id: string; name: string };

const PAY_LABEL: Record<string, string> = { upi: "UPI", cash: "Cash", card: "Card", other: "Other" };

function bucketLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  // Buckets are IST instants (the RPC truncates in Asia/Kolkata). Format IN THAT zone
  // explicitly, or a viewer/SSR outside IST sees every day & month off by one — wrong
  // on a GST document (found 2026-07-05). tz pinned to Asia/Kolkata always.
  const tz = "Asia/Kolkata";
  if (range === "today" || range === "yesterday") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: tz });
  if (range === "12m") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: tz });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: tz });
}

// CSV download — plain client-side blob, no server round-trip.
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function OwnerReports() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [ready, setReady] = useState(false);           // restaurant list has loaded
  const [rid, setRid] = useState<string>("");          // "" = all restaurants
  const [type, setType] = useState<RType>("sales");
  const [range, setRange] = useState<Range>("30d");
  const [rep, setRep] = useState<Report | null>(null);
  // What actually produced `rep` — the title/scope MUST read from this, never from the
  // live pickers, or switching a tab shows old numbers under the new heading (found
  // 2026-07-05). null rid = all restaurants.
  const [gen, setGen] = useState<{ type: RType; rid: string; range: Range } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Restaurant list once (for the scope picker); single-restaurant owners skip it.
  useEffect(() => {
    fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()).then((o) => {
      const list: Rest[] = (o.restaurants ?? []).map((r: Row) => ({ id: r.id as string, name: r.name as string }));
      setRests(list);
      if (list.length === 1) setRid(list[0].id);
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const generate = useCallback(async () => {
    setBusy(true); setErr(null);
    const asked = { type, rid, range };
    try {
      const q = new URLSearchParams({ type, range });
      if (rid) q.set("rid", rid);
      const r = await fetch(`/api/owner/reports?${q}`, { cache: "no-store" }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setRep(r); setGen({ type: asked.type, rid: asked.rid, range: asked.range });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setRep(null); setGen(null); }
    setBusy(false);
  }, [type, range, rid]);

  // Auto-generate once the restaurant list is in (so single-restaurant owners have
  // their rid before the first Tax report runs — else the CGST/SGST split dead-ends
  // with no picker to obey, found 2026-07-05) and whenever the report TYPE or the
  // RESTAURANT changes (clicking a chip / dropdown is itself an on-demand ask). A
  // RANGE change stays behind the Generate button (the heavier date choice).
  useEffect(() => { if (ready) generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, type, rid]);

  // Title + scope come from the GENERATED report, so heading and body can't disagree.
  const shownType = gen?.type ?? type;
  const shownRange = gen?.range ?? range;
  const meta = REPORTS.find((r) => r.k === shownType)!;
  const restName = gen ? (gen.rid ? (rests.find((r) => r.id === gen.rid)?.name ?? "This restaurant") : "All restaurants") : "";
  const money = rep && ["sales", "tax", "discounts", "cancellations"].includes(rep.type);
  const mrows = (money ? (rep!.rows as unknown as MoneyRow[]) : []);
  const t = rep?.totals;

  // Chart + table + CSV shapes per report type.
  const chart = useMemo(() => {
    if (!rep) return null;
    if (money) {
      const key = rep.type === "sales" ? "revenue" : rep.type === "tax" ? "tax" : rep.type === "discounts" ? "discount" : "cancelledValue";
      return mrows.map((r) => ({ label: bucketLabel(r.bucket, rep.range), revenue: Number(r[key as keyof MoneyRow]) || 0 }));
    }
    if (rep.type === "hourly") return (rep.rows as { hour: number; revenue: number }[]).map((r) => ({ label: `${r.hour}:00`, revenue: r.revenue }));
    return null;
  }, [rep, money, mrows]);

  const exportCsv = () => {
    if (!rep) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${meta.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${rep.range}-${stamp}.csv`;
    if (money) {
      downloadCsv(name,
        ["Period", "Orders", "Paid orders", "Subtotal", "Tax", "Discount", "Revenue", "Cancelled orders", "Cancelled value"],
        mrows.map((r) => [bucketLabel(r.bucket, rep.range), r.orders, r.paidOrders, r.subtotal, r.tax, r.discount, r.revenue, r.cancelledOrders, r.cancelledValue]));
    } else if (rep.type === "dishes") {
      downloadCsv(name, ["Dish", "Qty", "Revenue"], (rep.rows as { title: string; qty: number; revenue: number }[]).map((r) => [r.title, r.qty, r.revenue]));
    } else if (rep.type === "categories") {
      downloadCsv(name, ["Category", "Qty", "Revenue"], (rep.rows as { category: string; qty: number; revenue: number }[]).map((r) => [r.category, r.qty, r.revenue]));
    } else if (rep.type === "payments") {
      downloadCsv(name, ["Method", "Orders", "Revenue"], (rep.rows as { method: string; orders: number; revenue: number }[]).map((r) => [PAY_LABEL[r.method] || r.method || "Unknown", r.orders, r.revenue]));
    } else if (rep.type === "hourly") {
      downloadCsv(name, ["Hour", "Orders", "Revenue"], (rep.rows as { hour: number; orders: number; revenue: number }[]).map((r) => [`${r.hour}:00`, r.orders, r.revenue]));
    }
  };

  return (
    <>
      <div className="rp-head">
        <div>
          <h1 className="rp-h1">Reports</h1>
          <p className="rp-sub">Pick a report, pick a period, hit Generate — then download or print it.</p>
        </div>
      </div>

      {/* Report picker */}
      <div className="owx-chips" role="tablist" aria-label="Report type">
        {REPORTS.map((r) => (
          <button key={r.k} role="tab" aria-selected={type === r.k} className={`owx-chip${type === r.k ? " on" : ""}`}
            title={r.blurb} onClick={() => setType(r.k)}>
            <i className={`fas ${r.icon}`} aria-hidden="true" />{r.label}
          </button>
        ))}
      </div>

      {/* Scope + period + generate */}
      <div className="rp-controls">
        {rests.length > 1 && (
          <select className="rp-select" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            <option value="">All restaurants</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <div className="owx-range" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.k} role="tab" aria-selected={range === r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>
          ))}
        </div>
        <button className="adm-btn primary" onClick={generate} disabled={busy}>
          <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-bolt"}`} style={{ marginRight: 6 }} aria-hidden="true" />
          {busy ? "Generating…" : "Generate"}
        </button>
        {rep && (
          <div className="rp-actions">
            <button className="adm-btn" onClick={exportCsv} title="Download this report as a CSV (opens in Excel/Sheets)">
              <i className="fas fa-download" style={{ marginRight: 6 }} aria-hidden="true" />Download CSV
            </button>
            <button className="adm-btn" onClick={() => window.print()} title="Print or save as PDF">
              <i className="fas fa-print" style={{ marginRight: 6 }} aria-hidden="true" />Print
            </button>
          </div>
        )}
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}><b>Couldn&apos;t generate.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}

      {rep && (
        <div className="rp-report" id="rp-print">
          <div className="rp-title">
            <b>{meta.label}</b>
            <span className="adm-muted"> · {restName} · {RANGES.find((r) => r.k === rep.range)?.label}</span>
          </div>

          {/* Summary tiles */}
          {money && t && (
            <div className="adm-stats" style={{ marginTop: 10 }}>
              {rep.type === "sales" && (<>
                <div className="adm-stat"><div className="k">Revenue (kept)</div><div className="v">{inr(t.revenue)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
                <div className="adm-stat"><div className="k">Tax collected</div><div className="v">{inr(t.tax)}</div></div>
                <div className="adm-stat"><div className="k">Discounts</div><div className="v">{inr(t.discount)}</div></div>
              </>)}
              {rep.type === "tax" && (<>
                <div className="adm-stat"><div className="k">Tax collected</div><div className="v">{inr(t.tax)}</div></div>
                {rep.tax && <div className="adm-stat"><div className="k">Tax rate</div><div className="v">{rep.tax.effectivePct}%</div></div>}
                <div className="adm-stat"><div className="k">Taxable sales</div><div className="v">{inr(t.subtotal)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
              </>)}
              {rep.type === "discounts" && (<>
                <div className="adm-stat"><div className="k">Discounts given</div><div className="v">{inr(t.discount)}</div></div>
                <div className="adm-stat"><div className="k">Revenue (after discounts)</div><div className="v">{inr(t.revenue)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
              </>)}
              {rep.type === "cancellations" && (<>
                <div className="adm-stat"><div className="k">Lost value</div><div className="v">{inr(t.cancelledValue)}</div></div>
                <div className="adm-stat"><div className="k">Cancelled orders</div><div className="v">{t.cancelledOrders}</div></div>
                <div className="adm-stat"><div className="k">Kept revenue</div><div className="v">{inr(t.revenue)}</div></div>
              </>)}
            </div>
          )}

          {/* Tax split — the merged figure broken into its named parts (single restaurant) */}
          {rep.type === "tax" && rep.tax && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">The split <span className="adm-muted">· same total, shown the way the printed bill shows it{rep.tax.configured ? "" : " (no custom taxes set — standard CGST/SGST halves)"}</span></div>
              <table className="owx-table" style={{ marginTop: 6 }}>
                <thead><tr><th>Tax line</th><th>Rate</th><th>Collected</th></tr></thead>
                <tbody>
                  <tr><td><b>Total tax (as the manager panel shows)</b></td><td>{rep.tax.effectivePct}%</td><td><b>{inr(t?.tax ?? 0)}</b></td></tr>
                  {rep.tax.components.map((c) => (
                    <tr key={c.label} className="owx-taxsplit"><td>{c.label}</td><td>{c.rate}%</td><td>{inr(c.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rep.type === "tax" && !rep.tax && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <span className="adm-muted" style={{ fontSize: 12.5 }}>
                Pick a single restaurant to see its CGST/SGST split — tax lines are set per restaurant, so they can&apos;t be merged across all of them.
              </span>
            </div>
          )}

          {/* Chart */}
          {chart && chart.length > 0 && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">{meta.label} <span className="adm-muted">· over the period</span></div>
              <TimeBar data={chart} color="var(--accent)" height={220} />
            </div>
          )}
          {rep.type === "dishes" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Top dishes</div>
              <LeaderBar data={(rep.rows as { title: string; qty: number; revenue: number }[]).slice(0, 10).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: "var(--accent)" }))} />
            </div>
          )}
          {rep.type === "categories" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Categories</div>
              <LeaderBar data={(rep.rows as { category: string; qty: number; revenue: number }[]).slice(0, 10).map((d) => ({ id: d.category, name: d.category, revenue: d.revenue, orders: d.qty, accentColor: "var(--accent)" }))} />
            </div>
          )}
          {rep.type === "payments" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Payment methods</div>
              <LeaderBar data={(rep.rows as { method: string; orders: number; revenue: number }[]).map((d) => ({ id: d.method || "unknown", name: PAY_LABEL[d.method] || d.method || "Unknown", revenue: d.revenue, orders: d.orders, accentColor: "var(--accent)" }))} />
            </div>
          )}

          {/* Table */}
          <div className="owx-tablewrap" style={{ marginTop: 10 }}>
            <table className="owx-table">
              {money && (<>
                <thead><tr><th>Period</th><th>Orders</th><th>Paid</th><th>Subtotal</th><th>Tax</th><th>Discount</th><th>Revenue</th><th>Cancelled</th><th>Lost ₹</th></tr></thead>
                <tbody>
                  {mrows.map((r) => (
                    <tr key={r.bucket}>
                      <td>{bucketLabel(r.bucket, rep.range)}</td>
                      <td>{r.orders}</td><td>{r.paidOrders}</td>
                      <td>{inr(r.subtotal)}</td><td>{inr(r.tax)}</td><td>{inr(r.discount)}</td>
                      <td><b>{inr(r.revenue)}</b></td>
                      <td>{r.cancelledOrders}</td><td>{inr(r.cancelledValue)}</td>
                    </tr>
                  ))}
                </tbody>
                {t && (
                  <tfoot><tr>
                    <td>Total</td><td>{t.orders}</td><td>{t.paidOrders}</td>
                    <td>{inr(t.subtotal)}</td><td>{inr(t.tax)}</td><td>{inr(t.discount)}</td>
                    <td>{inr(t.revenue)}</td><td>{t.cancelledOrders}</td><td>{inr(t.cancelledValue)}</td>
                  </tr></tfoot>
                )}
              </>)}
              {rep.type === "dishes" && (<>
                <thead><tr><th>Dish</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { title: string; qty: number; revenue: number }[]).map((r) => (
                  <tr key={r.title}><td>{r.title}</td><td>{r.qty}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "categories" && (<>
                <thead><tr><th>Category</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { category: string; qty: number; revenue: number }[]).map((r) => (
                  <tr key={r.category}><td>{r.category}</td><td>{r.qty}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "payments" && (<>
                <thead><tr><th>Method</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { method: string; orders: number; revenue: number }[]).map((r) => (
                  <tr key={r.method || "unknown"}><td>{PAY_LABEL[r.method] || r.method || "Unknown"}</td><td>{r.orders}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "hourly" && (<>
                <thead><tr><th>Hour</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { hour: number; orders: number; revenue: number }[]).map((r) => (
                  <tr key={r.hour}><td>{r.hour}:00</td><td>{r.orders}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
            </table>
            {rep.rows.length === 0 && <div className="adm-empty">Nothing in this period.</div>}
          </div>
        </div>
      )}

      <style jsx>{`
        .rp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .rp-h1 { font-size: 18px; font-weight: 800; margin: 0; }
        .rp-sub { font-size: 12.5px; color: var(--muted); margin: 3px 0 0; }
        .rp-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0 14px; }
        .rp-actions { display: flex; gap: 8px; margin-left: auto; }
        .rp-select {
          height: 32px; padding: 0 10px; border-radius: 8px; border: var(--border);
          background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 600;
        }
        .rp-title { font-size: 14px; }
        .rp-ct { font-size: 13px; font-weight: 800; }
        @media print {
          .rp-controls, .owx-chips { display: none !important; }
          .rp-head :global(.rp-sub) { display: none; }
          /* Strip the console chrome + card borders/shadows so the PDF is a clean
             document, not a screenshot of the panel. The report page's own class names
             (.rp-*) drifted from the old global print block (.rep-*) so those never
             applied — target the real markup here. (found 2026-07-05) */
          :global(.owx-side), :global(.owx-top), :global(.adm-adminbar) { display: none !important; }
          :global(.adm-main), :global(.adm-body), :global(.owx-wrap) { padding: 0 !important; margin: 0 !important; overflow: visible !important; }
          :global(.adm-card) { border: 1px solid #ddd !important; box-shadow: none !important; break-inside: avoid; }
          :global(.owx-tablewrap) { max-height: none !important; overflow: visible !important; }
        }
      `}</style>
    </>
  );
}
