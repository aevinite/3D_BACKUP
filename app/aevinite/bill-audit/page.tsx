"use client";
// Admin · Bills — the real bill LEDGER across all restaurants. One row per bill (a
// session + its orders), bucketed by state: running · settled · pay-later · on-house ·
// closed-unpaid · deleted. Amounts SHOWN (owner's oversight view — you must be able to
// see if a real sale was made to vanish). Deleted bills are NEVER erased: they stay here,
// tombstoned with who/when/why, and the admin can restore them. A "Change log" tab keeps
// the old chronological trail. From /api/admin/bills (+ /api/admin/bill-audit for changes).
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh, timeAgo, inr } from "@/components/admin/shared";

type BillState = "running" | "settled" | "khata" | "onhouse" | "cancelled" | "deleted";
type Bill = {
  sessionId: string; billNo: number | null; invoiceNo: number | null; invoiceVoided: boolean;
  restaurantId: string | null; restaurantName: string; table: string | null; state: BillState;
  amount: number; paid: number; orderCount: number; openedAt: string | null; closedAt: string | null;
  at: string | null; deletedAt: string | null; deletedBy: string | null; deleteReason: string | null;
};
type Rest = { id: string; name: string };
type Data = { bills: Bill[]; counts: Record<string, number>; total: number; restaurants: Rest[]; generatedAt: string };
type TrailEvent = { action: string; actor: string | null; detail: string | null; at: string };

// Local state metadata (kept out of the shared lib so this client bundle stays lean).
const META: Record<BillState, { label: string; tone: string; emoji: string }> = {
  running:   { label: "Running",       tone: "#22c55e", emoji: "🟢" },
  settled:   { label: "Settled",       tone: "#3b82f6", emoji: "✅" },
  khata:     { label: "Pay-later",     tone: "#a855f7", emoji: "💜" },
  onhouse:   { label: "On the house",  tone: "#14b8a6", emoji: "🎁" },
  cancelled: { label: "Closed unpaid", tone: "#f59e0b", emoji: "🟠" },
  deleted:   { label: "Deleted",       tone: "#ef4444", emoji: "🗑️" },
};
const ORDER: BillState[] = ["running", "settled", "khata", "onhouse", "cancelled", "deleted"];

const ACT_LABEL: Record<string, string> = {
  order_delete: "Bill/order deleted", orders_delete: "Bills cleared", bill_restore: "Bill restored",
  order_discount: "Discount applied", bill_discount: "Bill discount", payment_revert: "Payment reverted",
  bill_paid: "Marked paid", bill_split: "Split bill", on_the_house: "On the house", khata_park: "Parked to pay-later",
  invoice_generate: "Invoice generated", invoice_void: "Invoice voided", close_unpaid: "Closed unpaid",
  table_close: "Table closed", table_restart: "Table restarted", order_move: "Order moved", table_shift: "Table moved",
};

export default function AdminBills() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rid, setRid] = useState("");
  const [state, setState] = useState<BillState | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [trails, setTrails] = useState<Record<string, TrailEvent[] | "loading">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams();
      if (rid) qs.set("restaurant_id", rid);
      if (state) qs.set("state", state);
      const res = await fetch("/api/admin/bills?" + qs.toString(), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [rid, state]);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const expand = async (b: Bill) => {
    const next = open === b.sessionId ? null : b.sessionId;
    setOpen(next);
    if (next && !trails[b.sessionId]) {
      setTrails((t) => ({ ...t, [b.sessionId]: "loading" }));
      try {
        const res = await fetch("/api/admin/bills?trail=" + b.sessionId, { cache: "no-store" });
        const j = await res.json();
        setTrails((t) => ({ ...t, [b.sessionId]: (j.trail || []) as TrailEvent[] }));
      } catch { setTrails((t) => ({ ...t, [b.sessionId]: [] })); }
    }
  };

  const act = async (b: Bill, action: "delete" | "restore") => {
    let reason = "";
    if (action === "delete") {
      const r = window.prompt(`Delete bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})?\n\nThe bill is NOT erased — it stays here marked deleted and can be restored.\n\nReason (required):`, "");
      if (r === null) return;
      reason = r.trim();
      if (!reason) { alert("A reason is required to delete a bill."); return; }
    } else {
      if (!window.confirm(`Restore bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})? It returns to the ledger as a normal record.`)) return;
    }
    setBusy(b.sessionId);
    try {
      const res = await fetch("/api/admin/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: b.sessionId, reason }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed.");
      setTrails((t) => { const c = { ...t }; delete c[b.sessionId]; return c; });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const counts = d?.counts || {};
  const totalAll = ORDER.reduce((s, k) => s + (counts[k] || 0), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Bills</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Every bill across all restaurants, by state. Deleted bills are never erased — they stay here, tombstoned, and you can restore them. Amounts shown for oversight.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="adm-btn" href="/aevinite/bill-audit/changes" style={{ textDecoration: "none" }} title="Chronological change log">
            <i className="fas fa-list-timeline" style={{ marginRight: 7 }} aria-hidden="true" />Change log
          </a>
          <button className="adm-btn" disabled={loading} onClick={load}>
            <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {/* Filters: restaurant + state buckets with counts */}
      <div className="adm-card" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setState("")} className="adm-chip"
          style={chip(state === "")}>All <span style={{ opacity: 0.6 }}>{totalAll}</span></button>
        {ORDER.map((k) => (
          <button key={k} onClick={() => setState(k)} className="adm-chip" style={chip(state === k, META[k].tone)}>
            <span aria-hidden="true">{META[k].emoji}</span> {META[k].label} <span style={{ opacity: 0.6 }}>{counts[k] || 0}</span>
          </button>
        ))}
        <select value={rid} onChange={(e) => { setRid(e.target.value); setOpen(null); }} style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">All restaurants</option>
          {(d?.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div>
          : d.bills.length === 0 ? <div className="adm-empty">No bills in this view.</div>
          : (
            <div>
              {d.bills.map((b) => {
                const m = META[b.state];
                const isOpen = open === b.sessionId;
                const del = b.state === "deleted";
                return (
                  <div key={b.sessionId} style={{ borderBottom: "1px solid var(--adm-line, rgba(255,255,255,0.06))", background: del ? "color-mix(in srgb, #ef4444 8%, transparent)" : undefined }}>
                    {/* Row */}
                    <button onClick={() => expand(b)} style={{ width: "100%", display: "grid", gridTemplateColumns: "128px 1.2fr 64px 110px 90px 30px", gap: 10, alignItems: "center", padding: "11px 14px", background: "transparent", border: 0, cursor: "pointer", textAlign: "left", color: "var(--text)", minWidth: 640 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: m.tone, flex: "0 0 auto" }} aria-hidden="true" />
                        <span style={{ fontWeight: 700, fontSize: 12.5, color: m.tone }}>{m.label}</span>
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{b.billNo != null ? `#${b.billNo}` : "—"}</b>
                        <span className="adm-muted" style={{ margin: "0 6px" }}>·</span>
                        <span className="adm-muted">{b.restaurantName}</span>
                        {b.invoiceVoided && <span title="Tax invoice voided (reopened)" style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", borderRadius: 6, background: "color-mix(in srgb, #f59e0b 22%, transparent)", color: "#f59e0b" }}>↩ reopened</span>}
                      </span>
                      <span className="adm-muted" style={{ fontSize: 12.5 }}>{b.table ? `T${b.table}` : "—"}</span>
                      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", textDecoration: del ? "line-through" : undefined, opacity: del ? 0.7 : 1 }}>{inr(b.amount)}</span>
                      <span className="adm-muted" style={{ fontSize: 12, textAlign: "right" }} title={b.at || undefined}>{b.at ? timeAgo(b.at) : "—"}</span>
                      <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`} style={{ fontSize: 11, opacity: 0.5, textAlign: "right" }} aria-hidden="true" />
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div style={{ padding: "4px 16px 16px", background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
                        {del && (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--adm-danger)", background: "color-mix(in srgb, #ef4444 12%, transparent)", marginBottom: 12 }}>
                            <i className="fas fa-trash-can" style={{ color: "var(--adm-danger)", marginTop: 2 }} aria-hidden="true" />
                            <div style={{ fontSize: 13 }}>
                              <b style={{ color: "var(--adm-danger)" }}>This bill was deleted</b>
                              {b.deletedBy ? ` by ${b.deletedBy}` : ""}{b.deletedAt ? ` · ${new Date(b.deletedAt).toLocaleString()}` : ""}.
                              {b.deleteReason ? <div style={{ marginTop: 3 }}>Reason: <i>{b.deleteReason}</i></div> : <div style={{ marginTop: 3, opacity: 0.7 }}>No reason recorded.</div>}
                              <div style={{ marginTop: 3, opacity: 0.7 }}>It is retained in full for tax/audit and can be restored.</div>
                            </div>
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 12 }}>
                          <Field k="Bill no" v={b.billNo != null ? `#${b.billNo}` : "—"} />
                          <Field k="Invoice no" v={b.invoiceNo != null ? `#${b.invoiceNo}${b.invoiceVoided ? " (voided)" : ""}` : "—"} />
                          <Field k="Restaurant" v={b.restaurantName} />
                          <Field k="Table" v={b.table ? `T${b.table}` : "—"} />
                          <Field k="Total" v={inr(b.amount)} />
                          <Field k="Collected" v={inr(b.paid)} />
                          <Field k="Orders" v={String(b.orderCount)} />
                          <Field k="Opened" v={b.openedAt ? new Date(b.openedAt).toLocaleString() : "—"} />
                          <Field k="Closed" v={b.closedAt ? new Date(b.closedAt).toLocaleString() : "—"} />
                        </div>

                        {/* Trail */}
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>What happened to this bill</div>
                        {trails[b.sessionId] === "loading" || trails[b.sessionId] === undefined ? (
                          <div className="adm-muted" style={{ fontSize: 12.5 }}>Loading trail…</div>
                        ) : (trails[b.sessionId] as TrailEvent[]).length === 0 ? (
                          <div className="adm-muted" style={{ fontSize: 12.5 }}>No recorded changes for this bill.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {(trails[b.sessionId] as TrailEvent[]).map((e, i) => (
                              <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "baseline" }}>
                                <span style={{ fontWeight: 600, minWidth: 150 }}>{ACT_LABEL[e.action] || e.action}</span>
                                <span className="adm-muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{e.detail || ""}{e.actor ? ` · ${e.actor}` : ""}</span>
                                <span className="adm-muted" style={{ fontSize: 11.5 }} title={e.at}>{timeAgo(e.at)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Admin actions */}
                        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                          {del ? (
                            <button className="adm-btn" disabled={busy === b.sessionId} onClick={() => act(b, "restore")} style={{ borderColor: "#22c55e", color: "#22c55e" }}>
                              <i className="fas fa-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />{busy === b.sessionId ? "Restoring…" : "Restore bill"}
                            </button>
                          ) : (
                            <button className="adm-btn" disabled={busy === b.sessionId} onClick={() => act(b, "delete")} style={{ borderColor: "var(--adm-danger)", color: "var(--adm-danger)" }}>
                              <i className="fas fa-trash-can" style={{ marginRight: 7 }} aria-hidden="true" />{busy === b.sessionId ? "Deleting…" : "Delete bill"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
    </div>
  );
}

function chip(active: boolean, tone?: string): React.CSSProperties {
  return {
    cursor: "pointer", padding: "7px 11px", borderRadius: 8, fontSize: 12.5,
    border: active ? `1px solid ${tone || "var(--accent)"}` : "var(--border)",
    background: active ? `color-mix(in srgb, ${tone || "var(--accent)"} 18%, transparent)` : "transparent",
    color: active ? (tone || "var(--accent)") : "var(--muted)", fontWeight: active ? 700 : 500,
    display: "inline-flex", alignItems: "center", gap: 5,
  };
}
