"use client";
// Owner · Inventory & expenses (mig 221, Stage 1).
//   Overview — the snapshot-cached report: stock value, month's purchases / waste /
//   expenses, the low-stock list, and EVERY expense entry (what, who wrote it, photo,
//   struck-out ones visible) with monthly totals by category — the broken-lamp view.
//   Manage — the same inventory engine the manager panel uses, embedded (invonly),
//   so the owner can enter bills/counts/waste/expenses themselves.
// No polling: the snapshot cache serves opens; ↻ forces a live recompute.
import { useCallback, useEffect, useRef, useState } from "react";
import { asSuffix } from "@/lib/ownerPin";
import { useOwnerSkin, useEmbedFrame } from "./useOwnerSkin";

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
  partial?: string[];
};
// ── ONE BOX PER RESTAURANT (owner, 2026-08-18) ───────────────────────────────────────────────────
// "when there are two or more restaurant, it should show boxes of restaurants — in which restaurant
// how much thing has been going on." Every figure in a box is the SAME `lfh_inv_report_summary` the
// single-restaurant screen below uses, over the same month window, computed in one cached backend
// pass (/api/owner/inventory?estate=1) — so a box and the screen you reach by tapping it can never
// disagree, and a normal open costs one row read.
type EstateRow = {
  rid: string; name: string; unread?: boolean;
  stockValue?: number; itemCount?: number; lowCount?: number; negativeCount?: number;
  purchases?: number; waste?: number; expenses?: number;
};
type Estate = {
  month: string; estate: EstateRow[]; offCount?: number;
  totals: { stockValue: number; purchases: number; waste: number; expenses: number; lowCount: number; negativeCount: number; itemCount: number };
  countedOf?: { counted: number; of: number };
  cachedAt?: string; partial?: string[];
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
  // A one-restaurant owner never sees the estate screen — there is nothing to compare. With two or
  // more, the estate IS the front door, and one tap goes into a restaurant.
  const multi = restaurants.length > 1;
  const [where, setWhere] = useState<"estate" | "one">(multi ? "estate" : "one");
  const [est, setEst] = useState<Estate | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  // Live cockpit skin → the embedded Manage panel, by message (never via src: that reloads it).
  const liveSkin = useOwnerSkin(skin);
  // Mounted IMPERATIVELY (useEmbedFrame) so the frame adds NO browser-history entry — a JSX
  // <iframe> does, which swallowed a Back press on this page (found 2026-08-04).
  const bornSkin = useRef(liveSkin).current;
  const embedSrc = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&invonly=1&skin=${bornSkin}`;
  const mount = useEmbedFrame(embedSrc, liveSkin, [rid, view]);
  const [month, setMonth] = useState(() => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force?: boolean) => {
    setBusy(true);
    try {
      const j = await (await fetch(`/api/owner/inventory?rid=${rid}&month=${month}${force ? "&refresh=1" : ""}${asSuffix()}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setData(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, [rid, month]);

  // One estate read at a time. React's dev strict mode runs an effect twice, a fast month-tap can
  // fire two, and a reconnect can fire a third — and this is exactly the screen he asked not to
  // "load every time, so that egress can be saved". A forced Refresh always goes, because that is
  // the button whose whole job is to go.
  const estInFlight = useRef(false);
  const loadEstate = useCallback(async (force?: boolean) => {
    if (!multi) return;
    if (estInFlight.current && !force) return;
    estInFlight.current = true;
    setBusy(true);
    try {
      const j = await (await fetch(`/api/owner/inventory?estate=1&month=${month}${force ? "&refresh=1" : ""}${asSuffix()}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setEst(j); setEstErr(null);
    } catch (e) { setEstErr(e instanceof Error ? e.message : String(e)); }
    finally { estInFlight.current = false; setBusy(false); }
  }, [month, multi]);

  useEffect(() => { if (view === "overview" && where === "one") load(); }, [load, view, where]);
  useEffect(() => { if (view === "overview" && where === "estate") loadEstate(); }, [loadEstate, view, where]);

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
        {multi && (where === "one" ? (
          <>
            {/* NOT the words "All restaurants" — the cockpit's own sidebar already has a nav item
                with exactly that label, meaning something else (the whole-estate scope). Two controls
                on one screen reading the same and doing different things is how someone ends up on
                the dashboard when they wanted to come back here. */}
            <button className="adm-btn" onClick={() => setWhere("estate")} title="Back to every restaurant's stock">
              <i className="fas fa-arrow-left" aria-hidden="true" /> All restaurants&apos; stock
            </button>
            <select className="adm-input" style={{ width: "auto" }} value={rid} onChange={(e) => { setRid(e.target.value); setData(null); }}>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </>
        ) : (
          <span className="adm-chip" style={{ textTransform: "none", fontWeight: 700 }}>{restaurants.length} restaurants</span>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {(["overview", "manage"] as const).map((v) => (
            // Manage is one restaurant's ledger — there is no estate-wide version of entering a
            // bill, so choosing it from the estate screen steps into the restaurant first.
            <button key={v} className="adm-btn" onClick={() => { setView(v); if (v === "manage") setWhere("one"); }}
              style={view === v ? { background: "var(--ow-accent, #10b981)", color: "#08130e", fontWeight: 700 } : undefined}>
              {v === "overview" ? "Overview" : "Manage"}
            </button>
          ))}
        </div>
      </div>

      {view === "overview" && where === "estate" ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
            <button className="adm-btn" onClick={() => shiftMonth(-1)}>‹</button>
            <b style={{ minWidth: 140, textAlign: "center" }}>{monthLabel}</b>
            <button className="adm-btn" onClick={() => shiftMonth(1)}>›</button>
            <span style={{ flex: 1 }} />
            <span className="adm-muted" style={{ fontSize: 12 }}>{agoLabel(est?.cachedAt)}</span>
            <button className="adm-btn" onClick={() => loadEstate(true)} disabled={busy} title="Recompute now">
              <i className="fas fa-rotate" /> Refresh
            </button>
          </div>

          {estErr && (
            <div className="adm-card" style={{ borderColor: "var(--adm-danger)" }}>
              <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{estErr}</span>{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => loadEstate()}>Try again</button>
            </div>
          )}
          {!estErr && !est && <div className="adm-empty">Loading your restaurants…</div>}

          {est && (
            <>
              {/* The estate total. Summed from the SAME rows the boxes below are drawn from, so the
                  header and the boxes cannot drift apart. Stock VALUE adds up across kitchens;
                  quantities deliberately do not — 4 kg here and 4 kg there is not 8 kg of anything. */}
              <div className="adm-stats">
                <div className="adm-stat"><div className="k">Stock on shelf · all restaurants</div><div className="v">{inr(est.totals.stockValue)}</div></div>
                <div className="adm-stat"><div className="k">Bought ({monthLabel.split(" ")[0]})</div><div className="v">{inr(est.totals.purchases)}</div></div>
                <div className="adm-stat"><div className="k">Wasted</div><div className="v">{inr(est.totals.waste)}</div></div>
                <div className="adm-stat"><div className="k">Expenses</div><div className="v">{inr(est.totals.expenses)}</div></div>
              </div>

              {/* Say what these totals cover. An owner with seven restaurants and three boxes needs
                  to be told the other four have stock switched off, not left hunting for them. */}
              <p className="adm-muted" style={{ fontSize: 12.5, margin: "10px 2px 14px" }}>
                {est.estate.length === 0
                  ? "None of your restaurants has stock switched on yet."
                  : <>These figures cover <b>{est.countedOf ? est.countedOf.counted : est.estate.length}</b>{" "}
                    of your restaurants{est.offCount ? <> · {est.offCount} more {est.offCount === 1 ? "has" : "have"} stock switched off</> : null}
                    {est.partial?.length ? <> · some figures couldn&apos;t be read this time — press Refresh</> : null}.</>}
              </p>

              {est.estate.length > 0 && (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))" }}>
                  {est.estate.map((r) => (
                    <button key={r.rid} type="button" className="adm-card"
                      onClick={() => { setRid(r.rid); setData(null); setWhere("one"); }}
                      title={`Open ${r.name}`}
                      style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
                        margin: 0, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <b style={{ fontSize: 15, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</b>
                        {!r.unread && !!r.negativeCount && (
                          <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 18%, transparent)", color: "var(--adm-danger,#e5484d)" }}>
                            {r.negativeCount} below zero
                          </span>
                        )}
                        {!r.unread && !r.negativeCount && !!r.lowCount && (
                          <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-warn,#c98a2b) 20%, transparent)", color: "var(--adm-warn,#c98a2b)" }}>
                            {r.lowCount} running low
                          </span>
                        )}
                      </div>

                      {r.unread ? (
                        // A restaurant whose figures did not read keeps its box and shows dashes.
                        // "₹0 of stock" for a full storeroom is a claim; a dash is the truth.
                        <div className="adm-muted" style={{ fontSize: 13 }}>Couldn&apos;t read this one — press Refresh.</div>
                      ) : (
                        <>
                          <div>
                            <div className="adm-muted" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".03em" }}>STOCK ON SHELF</div>
                            <div style={{ fontSize: 23, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{inr(r.stockValue || 0)}</div>
                            <div className="adm-muted" style={{ fontSize: 11.5 }}>{r.itemCount || 0} ingredient{(r.itemCount || 0) === 1 ? "" : "s"}</div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, borderTop: "1px solid var(--border-c,#e5e7eb)", paddingTop: 9 }}>
                            {[["Bought", r.purchases], ["Wasted", r.waste], ["Expenses", r.expenses]].map(([k, v]) => (
                              <div key={String(k)}>
                                <div className="adm-muted" style={{ fontSize: 11 }}>{k}</div>
                                <div style={{ fontWeight: 700, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>{inr(Number(v) || 0)}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : view === "manage" ? (
        // The manager panel's inventory engine, scoped to this restaurant. Identical
        // behaviour in both panels; the API enforces powers per call regardless.
        <div ref={mount} style={{ width: "100%", height: "calc(100vh - 170px)", borderRadius: 12, overflow: "hidden", display: "flex" }} />
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
                <div className="adm-stat"><div className="k">Stock on shelf</div><div className="v">{inr(s.stockValue)}</div></div>
                <div className="adm-stat"><div className="k">Bought ({monthLabel.split(" ")[0]})</div><div className="v">{inr(s.purchases)}</div></div>
                <div className="adm-stat"><div className="k">Wasted</div><div className="v">{inr(s.waste)}</div></div>
                <div className="adm-stat"><div className="k">Expenses</div><div className="v">{inr(s.expenses)}</div></div>
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
