"use client";
// Admin · Billing & plans — SaaS billing: what each restaurant PAYS US. This is
// PLATFORM income (allowed) — NOT restaurant food revenue (CLAUDE.md hard rule
// keeps those separate; food GMV never appears here). The owner enters payments
// manually (no payment gateway yet). Backed by /api/admin/billing
// (migration 118: restaurant_billing + restaurant_payments, additive-only).
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { useToast } from "@/components/admin/toast";

type Row = {
  id: string; name: string; slug: string; active: boolean;
  plan: string | null; status: string; amount: number | null; currency: string; cycle: string;
  startedOn: string | null; nextDueOn: string | null; notes: string | null;
  paidThisYear: number; lastPayment: { amount: number; paid_on: string } | null;
};
type Summary = { totalCollectedThisYear: number; statusCounts: Record<string, number>; dueSoon: number; overdue: number };
type Payment = { id: string; restaurant_id: string; amount: number; paid_on: string; method: string | null; period_label: string | null; note: string | null; created_at: string };

// Currency-aware money formatter — shows each restaurant's OWN currency instead of
// always ₹ (audit 2026-07-08). Falls back to "CODE 12,000" for an unknown code.
const money = (n: number, currency = "INR") => {
  const c = (currency || "INR").toUpperCase();
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(Number(n) || 0); }
  catch { return `${c} ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`; }
};
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminBilling() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/billing", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load billing.");
      setRows(j.restaurants || []); setSummary(j.summary || null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const needle = q.trim().toLowerCase();
  const filtered = (rows || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));
  const todayStr = today();

  return (
    <>
      <h1 className="adm-page-h">Billing &amp; plans</h1>
      <p className="adm-page-sub">What each restaurant pays for its subscription — plan, cycle, next due date and payment history. Entered by hand; there&apos;s no payment gateway yet.</p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>
      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err}</p>}

      <div className="adm-stats">
        <div className="adm-stat"><div className="k">Active</div><div className="v">{summary?.statusCounts.active || 0}</div></div>
        <div className="adm-stat"><div className="k">Trial</div><div className="v">{summary?.statusCounts.trial || 0}</div></div>
        <div className="adm-stat"><div className="k">Paused / cancelled</div><div className="v">{(summary?.statusCounts.paused || 0) + (summary?.statusCounts.cancelled || 0)}</div></div>
        <div className="adm-stat"><div className="k">Collected this year</div><div className="v">{summary ? money(summary.totalCollectedThisYear, "INR") : "…"}</div></div>
        <div className="adm-stat"><div className="k">Due in 30 days</div><div className="v" style={summary && summary.overdue > 0 ? { color: "var(--adm-danger)" } : undefined}>{summary?.dueSoon ?? "…"}{summary && summary.overdue > 0 ? ` (${summary.overdue} overdue)` : ""}</div></div>
      </div>

      <div className="adm-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <i className="fas fa-magnifying-glass adm-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or slug…" aria-label="Search restaurants"
            style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "var(--border)", borderRadius: 10, padding: "10px 13px", fontSize: 13.5 }} />
          <span className="adm-muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{filtered.length} of {rows?.length ?? 0}</span>
        </div>

        {rows === null ? (
          <div className="adm-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="adm-empty">No restaurants match &ldquo;{q}&rdquo;.</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.2fr 1fr 90px 1fr 1fr 100px 90px" }}>
              <span>Restaurant</span><span>Plan</span><span>Status</span><span>Amount / cycle</span><span>Next due</span><span style={{ textAlign: "right" }}>Paid (yr)</span><span />
            </div>
            {filtered.map((r) => {
              const overdue = !!r.nextDueOn && r.nextDueOn < todayStr;
              return (
                <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1.2fr 1fr 90px 1fr 1fr 100px 90px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                    <div className="adm-muted mono" style={{ fontSize: 11.5 }}>{r.slug}</div>
                  </div>
                  <div className="adm-muted">{r.plan || "—"}</div>
                  <div><span className={`adx-billpill ${r.status}`}>{r.status}</span></div>
                  <div className="adm-muted">{r.amount ? `${money(r.amount, r.currency)} /${r.cycle === "monthly" ? "mo" : "yr"}` : "—"}</div>
                  <div className={overdue ? "adx-overdue" : undefined}>{r.nextDueOn || "—"}{overdue ? " · overdue" : ""}</div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>{money(r.paidThisYear, r.currency)}</div>
                  <div style={{ textAlign: "right" }}>
                    <button className="adm-btn" onClick={() => setEditing(r)}>Manage</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && <BillingEditor row={editing} onClose={() => setEditing(null)} onChanged={load} />}
    </>
  );
}

function BillingEditor({ row, onClose, onChanged }: { row: Row; onClose: () => void; onChanged: () => void }) {
  const [plan, setPlan] = useState(row.plan || "");
  const [status, setStatus] = useState(row.status);
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const [currency, setCurrency] = useState(row.currency || "INR");
  const [cycle, setCycle] = useState(row.cycle || "yearly");
  const [startedOn, setStartedOn] = useState(row.startedOn || "");
  const [nextDueOn, setNextDueOn] = useState(row.nextDueOn || "");
  const [notes, setNotes] = useState(row.notes || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [payMethod, setPayMethod] = useState("");
  const [payLabel, setPayLabel] = useState("");
  const [payNote, setPayNote] = useState("");
  const [rollDue, setRollDue] = useState(true);
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  const toast = useToast();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  // Synchronous guard so a double-click can't record the same payment twice (audit 2026-07-07).
  const payingRef = useRef(false);
  // Stable per-payment action id → a lost-response RETRY (same id) is deduped server-side so
  // the payment can't be recorded twice; reset only after a successful save (audit 2026-07-08).
  const payActionIdRef = useRef<string | null>(null);

  const loadHistory = useCallback(async () => {
    // Now announces a failure via the shared toast instead of swallowing it — a failed load
    // left the payment history blank with no explanation (audit 2026-07-07).
    try {
      const r = await fetch(`/api/admin/billing?restaurant_id=${encodeURIComponent(row.id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.error) {
        setPayments(j.payments || []);
        // Keep the "Next due on" field in sync — recording a payment with "roll due" advances
        // it server-side, and the open editor used to keep showing the OLD date until reopened
        // (audit 2026-07-07). j.billing.next_due_on is the fresh value.
        if (j.billing && typeof j.billing.next_due_on !== "undefined") setNextDueOn(j.billing.next_due_on || "");
      } else {
        toast("Couldn't load payment history — " + (j.error || "try reopening."), "err");
      }
    } catch { toast("Couldn't load payment history — network error.", "err"); }
  }, [row.id, toast]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // One line: phone Back + Escape close it, focus trapped inside, page behind frozen.
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-billing-editor", onClose);

  const savePlan = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "set_plan", restaurant_id: row.id, plan: plan || null, status, amount: amount === "" ? null : amount, currency, cycle,
        started_on: startedOn || null, next_due_on: nextDueOn || null, notes: notes || null,
      }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg("Saved."); onChanged();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const addPayment = async () => {
    const amt = Number(String(payAmount).replace(/[^0-9.-]/g, "")); // tolerate "12,000" / stray symbols (audit 2026-07-08)
    if (!(amt > 0)) { setPayMsg("Enter an amount greater than 0 (e.g. 12000)."); return; }
    if (!payDate) { setPayMsg("Pick a payment date."); return; }
    if (payingRef.current) return;
    payingRef.current = true;
    if (!payActionIdRef.current) payActionIdRef.current = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setPayBusy(true); setPayMsg(null);
    try {
      const r = await fetch("/api/admin/billing", { method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": payActionIdRef.current }, body: JSON.stringify({
        action: "add_payment", restaurant_id: row.id, amount: amt, paid_on: payDate, method: payMethod || null, period_label: payLabel || null, note: payNote || null, roll_next_due: rollDue,
      }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't record payment.");
      payActionIdRef.current = null; // committed → the next payment gets a fresh id
      setPayAmount(""); setPayMethod(""); setPayLabel(""); setPayNote("");
      setPayMsg("Payment recorded.");
      // loadHistory() re-reads billing and refreshes the "Next due on" field (rolled server-side).
      await loadHistory(); onChanged();
    } catch (e) { setPayMsg(e instanceof Error ? e.message : String(e)); } finally { setPayBusy(false); payingRef.current = false; }
  };

  const deletePayment = async (id: string) => {
    if (!confirm("Delete this payment record?")) return;
    try {
      const r = await fetch("/api/admin/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_payment", payment_id: id }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't delete.");
      await loadHistory(); onChanged();
    } catch (e) { setPayMsg(e instanceof Error ? e.message : String(e)); }
  };

  const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%" };
  const cardStyle: React.CSSProperties = { background: "var(--card)", border: "var(--border)", borderRadius: 14, width: "min(96vw, 560px)", maxHeight: "90vh", overflowY: "auto" };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Billing for ${row.name}`} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div style={{ ...cardStyle, pointerEvents: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "var(--border)", position: "sticky", top: 0, background: "var(--card)", borderRadius: "14px 14px 0 0" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{row.name}</div>
              <div className="adm-muted mono" style={{ fontSize: 11.5 }}>{row.slug}</div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "transparent", border: 0, color: "var(--muted)", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 6 }}>×</button>
          </div>

          <div style={{ padding: 18, display: "grid", gap: 18 }}>
            <div>
              <h2 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>Plan &amp; status</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ fontSize: 12 }}>Plan name<input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Standard" style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Status
                  <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                    <option value="trial">Trial</option><option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 12000" inputMode="decimal" style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Cycle
                  <select value={cycle} onChange={(e) => setCycle(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                    <option value="yearly">Yearly</option><option value="monthly">Monthly</option>
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Started on<input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Next due on<input type="date" value={nextDueOn} onChange={(e) => setNextDueOn(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} /></label>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button className="adm-btn primary" disabled={saving} onClick={savePlan}>{saving ? "Saving…" : "Save plan"}</button>
                {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
              </div>
            </div>

            <div style={{ borderTop: "var(--border)", paddingTop: 16 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>Add a payment</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ fontSize: 12 }}>Amount<input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="e.g. 12000" inputMode="decimal" style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Paid on<input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Method<input value={payMethod} onChange={(e) => setPayMethod(e.target.value)} placeholder="UPI / bank transfer / cash" style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12 }}>Period<input value={payLabel} onChange={(e) => setPayLabel(e.target.value)} placeholder="e.g. 2026 yearly" style={{ ...inputStyle, marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Note<input value={payNote} onChange={(e) => setPayNote(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} /></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5 }}>
                <input type="checkbox" checked={rollDue} onChange={(e) => setRollDue(e.target.checked)} />
                Roll &ldquo;next due&rdquo; forward by one {cycle === "monthly" ? "month" : "year"} from this payment date
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button className="adm-btn primary" disabled={payBusy} onClick={addPayment}>{payBusy ? "Recording…" : "Add payment"}</button>
                {payMsg && <span className="adm-muted" style={{ fontSize: 12 }}>{payMsg}</span>}
              </div>
            </div>

            <div style={{ borderTop: "var(--border)", paddingTop: 16 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>Payment history</h2>
              {payments === null ? (
                <div className="adm-empty">Loading…</div>
              ) : payments.length === 0 ? (
                <div className="adm-empty">No payments recorded yet.</div>
              ) : (
                <div className="adm-logwrap">
                  <div className="adm-logrow head" style={{ gridTemplateColumns: "90px 90px 1fr 1fr 40px" }}><span>Date</span><span>Amount</span><span>Method</span><span>Period / note</span><span /></div>
                  {payments.map((p) => (
                    <div key={p.id} className="adm-logrow" style={{ gridTemplateColumns: "90px 90px 1fr 1fr 40px" }}>
                      <span>{p.paid_on}</span>
                      <span style={{ fontWeight: 700 }}>{money(p.amount, row.currency)}</span>
                      <span className="adm-muted">{p.method || "—"}</span>
                      <span className="adm-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.period_label || p.note || "—"}</span>
                      <span style={{ textAlign: "right" }}>
                        <button className="adm-btn danger" style={{ padding: "4px 8px" }} onClick={() => deletePayment(p.id)} aria-label="Delete this payment" title="Delete this payment"><i className="fas fa-trash" aria-hidden="true" /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
