"use client";
// Owner · Inventory & expenses (mig 221, Stage 1).
//   Overview — the snapshot-cached report: stock value, month's purchases / waste /
//   expenses, the low-stock list, and EVERY expense entry (what, who wrote it, photo,
//   struck-out ones visible) with monthly totals by category — the broken-lamp view.
//   Manage — the same inventory engine the manager panel uses, embedded (invonly),
//   so the owner can enter bills/counts/waste/expenses themselves.
// No polling: the snapshot cache serves opens; ↻ forces a live recompute.
import { useCallback, useEffect, useState } from "react";
import { asSuffix } from "@/lib/ownerPin";

type Summary = { stockValue: number; itemCount: number; lowCount: number; negativeCount: number; purchases: number; waste: number; expenses: number };
type ExpenseRow = { id: string; category: string; title: string; amount: number; expense_date: string; note: string | null; photo_url: string | null; created_by: string | null; voided_at: string | null; void_reason: string | null };
type Payload = {
  month: string; rid: string; summary: Summary;
  low: { id: string; name: string; have: number; par: number; uom: string }[];
  negative: { id: string; name: string; have: number; uom: string }[];
  expenses: ExpenseRow[]; expTotals: Record<string, number>;
  purchases: { id: string; kind: string; vendor_name: string | null; bill_no: string | null; bill_date: string; total: number; created_by: string | null; voided_at: string | null }[];
  wasteByReason: Record<string, number>;
  usage?: { usedByOrders: number; corrections: number; top: { name: string; consumedVal: number; adjustedVal: number }[] };
  cachedAt?: string;
  // How a cancelled order is paid for (mig 252). Read outside the snapshot cache, so
  // flipping the switch below shows immediately.
  cancelCostMode?: "stock" | "bill";
};

const inr = (n: number) => "₹" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-IN");
const EXP_LABELS: Record<string, string> = { breakage: "🔨 Breakage", repair: "🛠️ Repair", utilities: "💡 Utilities", cleaning: "🧹 Cleaning", supplies: "📦 Supplies", rent: "🏠 Rent", transport: "🛵 Transport", misc: "🧾 Other" };
const WASTE_LABELS: Record<string, string> = { spoiled: "Spoiled", burnt: "Burnt", spilled: "Spilled", expired: "Expired", staff_meal: "Staff meals", complimentary: "On the house", other: "Other" };
const agoLabel = (iso?: string) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "updated just now" : m < 60 ? `updated ${m} min ago` : `updated ${Math.round(m / 60)} h ago`;
};

export default function OwnerInventory({ restaurants, initial, skin }: {
  restaurants: { id: string; name: string }[]; initial: string; skin: "light" | "dark";
}) {
  const [rid, setRid] = useState(initial);
  const [view, setView] = useState<"overview" | "manage">("overview");
  const [month, setMonth] = useState(() => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    setBusy(true);
    try {
      const j = await (await fetch(`/api/owner/inventory?rid=${rid}&month=${month}${force ? "&refresh=1" : ""}${asSuffix()}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setData(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, [rid, month]);

  useEffect(() => { if (view === "overview") load(); }, [load, view]);

  // Flip how a cancelled order is charged. First save wins: we send what THIS screen was
  // looking at, so if someone else already changed it the server tells us instead of
  // quietly replacing their choice (the house no-silent-overwrites rule).
  const setCancelMode = async (mode: "stock" | "bill") => {
    if (modeBusy || mode === (data?.cancelCostMode || "stock")) return;
    setModeBusy(true); setModeMsg(null);
    try {
      const res = await fetch(`/api/owner/inventory${asSuffix()}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-LFH-Expect": JSON.stringify({ table: "settings", id: rid, fields: { cancel_cost_mode: data?.cancelCostMode || "stock" } }),
        },
        body: JSON.stringify({ restaurant_id: rid, cancel_cost_mode: mode }),
      });
      const j = await res.json();
      if (!res.ok) { setModeMsg(j.message || j.error || "Couldn't change that."); }
      else { setData((d) => (d ? { ...d, cancelCostMode: mode } : d)); setModeMsg(null); }
    } catch (e) { setModeMsg(e instanceof Error ? e.message : String(e)); }
    setModeBusy(false);
  };

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 7));
  };
  const monthLabel = new Date(month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" });
  const s = data?.summary;

  return (
    <div className="adm-page">
      <div className="adm-page-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ margin: 0 }}>Inventory &amp; expenses</h1>
        {restaurants.length > 1 && (
          <select className="adm-input" style={{ width: "auto" }} value={rid} onChange={(e) => { setRid(e.target.value); setData(null); }}>
            {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {(["overview", "manage"] as const).map((v) => (
            <button key={v} className="adm-btn" onClick={() => setView(v)}
              style={view === v ? { background: "var(--ow-accent, #10b981)", color: "#08130e", fontWeight: 700 } : undefined}>
              {v === "overview" ? "Overview" : "Manage"}
            </button>
          ))}
        </div>
      </div>

      {view === "manage" ? (
        // The manager panel's inventory engine, scoped to this restaurant. Identical
        // behaviour in both panels; the API enforces powers per call regardless.
        <iframe key={rid} src={`/panels/editor/index.html?rid=${encodeURIComponent(rid)}&invonly=1&skin=${skin}`}
          title="Manage inventory" style={{ width: "100%", height: "calc(100vh - 170px)", border: "none", borderRadius: 12 }} />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
            <button className="adm-btn" onClick={() => shiftMonth(-1)}>‹</button>
            <b style={{ minWidth: 140, textAlign: "center" }}>{monthLabel}</b>
            <button className="adm-btn" onClick={() => shiftMonth(1)}>›</button>
            <span style={{ flex: 1 }} />
            <span className="adm-muted" style={{ fontSize: 12 }}>{agoLabel(data?.cachedAt)}</span>
            <button className="adm-btn" onClick={() => load(true)} disabled={busy} title="Recompute now">
              <i className="fas fa-rotate" /> Refresh
            </button>
          </div>

          {err && <div className="adm-empty">⚠️ {err}</div>}
          {!err && !data && <div className="adm-empty">Loading…</div>}
          {data && s && (
            <>
              <div className="adm-stats">
                <div className="adm-stat"><span className="k">Stock on shelf</span><span className="v">{inr(s.stockValue)}</span></div>
                <div className="adm-stat"><span className="k">Bought ({monthLabel.split(" ")[0]})</span><span className="v">{inr(s.purchases)}</span></div>
                <div className="adm-stat"><span className="k">Wasted</span><span className="v">{inr(s.waste)}</span></div>
                <div className="adm-stat"><span className="k">Expenses</span><span className="v">{inr(s.expenses)}</span></div>
              </div>

              {/* ── How a cancelled order is paid for (owner 2026-08-02) ──────────
                  His rule: with stock tracked it comes out of stock; without it, off the
                  bill. Only ONE of the two is ever charged, so the same loss can't be
                  counted twice — the report says which underneath. */}
              <div className="adm-card">
                <h3>💸 When an order is cancelled, what does it cost you?</h3>
                <p className="adm-muted" style={{ fontSize: 13, margin: "2px 0 10px" }}>
                  This changes the “Expenses” line on your daily report and every profit figure that follows it.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {([
                    { k: "stock" as const, t: "Take it out of stock", d: "Only the food that was actually cooked and binned. Recommended — the sale was never collected, so charging its full price would count the loss twice." },
                    { k: "bill" as const, t: "Take it off the bill", d: "The whole menu price of the cancelled order counts as an expense. The food it used is removed from “food taken from stock” so it isn't paid for twice." },
                  ]).map((o) => {
                    const on = (data.cancelCostMode || "stock") === o.k;
                    return (
                      <button key={o.k} className="adm-btn" onClick={() => setCancelMode(o.k)} disabled={modeBusy}
                        style={{ flex: "1 1 260px", textAlign: "left", padding: "10px 12px", alignItems: "flex-start",
                          borderColor: on ? "var(--ow-accent, #10b981)" : undefined,
                          background: on ? "color-mix(in srgb, var(--ow-accent, #10b981) 14%, transparent)" : undefined }}>
                        <span style={{ display: "block", fontWeight: 800, marginBottom: 3 }}>
                          {on ? "● " : "○ "}{o.t}
                        </span>
                        <span className="adm-muted" style={{ display: "block", fontSize: 12, fontWeight: 500, whiteSpace: "normal", lineHeight: 1.45 }}>{o.d}</span>
                      </button>
                    );
                  })}
                </div>
                {modeMsg && <div className="adm-empty" style={{ marginTop: 8 }}>⚠️ {modeMsg}</div>}
              </div>

              {data.negative.length > 0 && (
                <div className="adm-card" style={{ borderColor: "rgba(239,68,68,.5)" }}>
                  <h3>⚠️ Stock below zero</h3>
                  <p className="adm-muted">Usually a purchase that was never entered — ask your manager to add the missing bill.</p>
                  {data.negative.map((i) => <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span>{i.name}</span><b>{i.have} {i.uom}</b></div>)}
                </div>
              )}

              <div className="adm-card">
                <h3>💸 Expense book — {inr(s.expenses)} this month</h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
                  {Object.entries(data.expTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <span key={k} className="adm-chip">{EXP_LABELS[k] || k}: <b>{inr(v)}</b></span>
                  ))}
                </div>
                {data.expenses.length === 0 && <div className="adm-empty">No expenses recorded in {monthLabel}.</div>}
                {data.expenses.map((e) => (
                  <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--adm-line, rgba(128,128,128,.2))", opacity: e.voided_at ? 0.55 : 1 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ textDecoration: e.voided_at ? "line-through" : "none" }}>
                        {EXP_LABELS[e.category] || e.category} — <b>{e.title}</b>
                        {e.voided_at && <span className="adm-muted"> · struck out{e.void_reason ? `: ${e.void_reason}` : ""}</span>}
                      </div>
                      <div className="adm-muted" style={{ fontSize: 12 }}>
                        {e.expense_date}{e.created_by ? ` · by ${e.created_by}` : ""}{e.note ? ` · ${e.note}` : ""}
                      </div>
                    </div>
                    {e.photo_url && (
                      <a href={e.photo_url} target="_blank" rel="noopener noreferrer">
                        <img src={e.photo_url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
                      </a>
                    )}
                    <b style={{ whiteSpace: "nowrap" }}>{inr(e.amount)}</b>
                  </div>
                ))}
              </div>

              <div className="adm-card">
                <h3>🛒 Low stock ({data.low.length})</h3>
                {data.low.length === 0 && <div className="adm-empty">Everything is at or above its par level.</div>}
                {data.low.map((i) => (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>{i.name}</span>
                    <span className="adm-muted">have {i.have} / par {i.par} {i.uom}</span>
                  </div>
                ))}
              </div>

              {data.usage && (data.usage.usedByOrders !== 0 || data.usage.corrections !== 0 || data.usage.top.length > 0) && (
                <div className="adm-card">
                  <h3>📊 Usage &amp; corrections</h3>
                  <p className="adm-muted">
                    Recipes used {inr(data.usage.usedByOrders)} of stock this month; the counts corrected {inr(data.usage.corrections)} beyond orders and logged waste — the closest thing to a leak meter.
                  </p>
                  {data.usage.top.map((u) => (
                    <div key={u.name} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span>{u.name}<span className="adm-muted"> · used {inr(u.consumedVal)}</span></span>
                      <b style={{ color: u.adjustedVal < -0.01 ? "#ef4444" : u.adjustedVal > 0.01 ? "#22c55e" : undefined }}>
                        {u.adjustedVal ? `corrected ${inr(u.adjustedVal)}` : "—"}
                      </b>
                    </div>
                  ))}
                </div>
              )}
              <div className="adm-card">
                <h3>🗑️ Waste by reason</h3>
                {Object.keys(data.wasteByReason).length === 0 && <div className="adm-empty">Nothing logged as wasted in {monthLabel}.</div>}
                {Object.entries(data.wasteByReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span>{WASTE_LABELS[k] || k}</span><b>{inr(v)}</b>
                  </div>
                ))}
              </div>

              <div className="adm-card">
                <h3>🧾 Purchases in {monthLabel} ({data.purchases.length})</h3>
                {data.purchases.length === 0 && <div className="adm-empty">No purchases entered.</div>}
                {data.purchases.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", opacity: p.voided_at ? 0.55 : 1 }}>
                    <span style={{ textDecoration: p.voided_at ? "line-through" : "none" }}>
                      {p.kind === "cash" ? "⚡ Cash buy" : `🧾 ${p.vendor_name || "Bill"}`}{p.bill_no ? ` #${p.bill_no}` : ""}
                      <span className="adm-muted"> · {p.bill_date}{p.created_by ? ` · ${p.created_by}` : ""}</span>
                    </span>
                    <b>{inr(p.total)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
