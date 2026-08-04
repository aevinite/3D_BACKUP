"use client";
// Admin · Bills — the real bill LEDGER across all restaurants ("Pro Ledger" design).
// One row per bill (a session + its orders), bucketed by state: running / settled /
// pay-later / on-house / closed-unpaid / deleted. Amounts SHOWN (owner's oversight view).
// Expand a bill → detail + INVOICE HISTORY (generate/void/re-issue timeline, mig 189) +
// the change trail + delete/restore. Deleted bills are never erased — tombstoned + restorable.
// From /api/admin/bills. Change log at /aevinite/bill-audit/changes.
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh, timeAgo, inr, actLabel } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type BillState = "running" | "settled" | "khata" | "onhouse" | "cancelled" | "deleted";
type Bill = {
  sessionId: string; billNo: number | null; invoiceNo: number | null; invoiceVoided: boolean;
  restaurantId: string | null; restaurantName: string; table: string | null; state: BillState;
  amount: number; paid: number; orderCount: number; invoiceGens: number;
  openedAt: string | null; closedAt: string | null; at: string | null;
  deletedAt: string | null; deletedBy: string | null; deleteReason: string | null;
};
type Rest = { id: string; name: string };
type Data = {
  bills: Bill[]; counts: Record<string, number>; total: number; restaurants: Rest[]; generatedAt: string;
  // deletedTotal is the REAL database count of deleted bills (not "how many are on this page") —
  // the chip used to be able to say 0 while deleted bills existed. nextBefore is the paging
  // cursor: null once there is nothing older to fetch.
  deletedTotal?: number; nextBefore?: string | null;
};
type TrailEvent = { action: string; actor: string | null; detail: string | null; at: string };
type InvEvent = { event: string; no: number | null; reason: string | null; actor: string | null; at: string };
type CNote = { no: number; amount: number; reason: string | null; actor: string | null; at: string };
type Expanded = { trail: TrailEvent[]; invoiceHistory: InvEvent[]; creditNotes: CNote[] } | "loading";

const META: Record<BillState, { label: string; tone: string; icon: IconName }> = {
  running:   { label: "Running",       tone: "#22c55e", icon: "running" },
  settled:   { label: "Settled",       tone: "#3b82f6", icon: "settled" },
  khata:     { label: "Pay-later",     tone: "#a855f7", icon: "khata" },
  onhouse:   { label: "On the house",  tone: "#14b8a6", icon: "onhouse" },
  cancelled: { label: "Closed unpaid", tone: "#f59e0b", icon: "cancelled" },
  deleted:   { label: "Deleted",       tone: "#ef4444", icon: "deleted" },
};
const ORDER: BillState[] = ["running", "settled", "khata", "onhouse", "cancelled", "deleted"];

// Bill-context wording, deliberately narrower than the shared map (this page is ONE bill's
// trail, so "Invoice voided" reads better than the generic "Reopened the bill"). Anything not
// listed falls through to the shared actLabel(), which never prints a raw code.
const ACT_LABEL: Record<string, string> = {
  order_delete: "Bill/order deleted", orders_delete: "Bills cleared", bill_restore: "Bill restored",
  order_discount: "Discount applied", bill_discount: "Bill discount", payment_revert: "Payment reverted",
  bill_paid: "Marked paid", bill_split: "Split bill", on_the_house: "On the house", khata_park: "Parked to pay-later",
  invoice_generate: "Invoice generated", invoice_void: "Invoice voided", close_unpaid: "Closed unpaid",
  table_close: "Table closed", table_restart: "Table restarted", order_move: "Order moved", table_shift: "Table moved",
};

// ── inline vector icons (no emoji — UI/UX rule) ──────────────────────────────
type IconName = "running" | "settled" | "khata" | "onhouse" | "cancelled" | "deleted" | "chev" | "invoice" | "reopen" | "restore" | "trash" | "refresh" | "log";
function Ico({ n, s = 15 }: { n: IconName; s?: number }) {
  const p: Record<IconName, React.ReactNode> = {
    running: <><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4V8z" /></>,
    settled: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
    khata: <><path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H18" /></>,
    onhouse: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9M12 8S11 3 8.5 3 6 6 8 8m4 0s1-5 3.5-5S18 6 16 8" /></>,
    cancelled: <><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></>,
    deleted: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
    chev: <path d="M6 9l6 6 6-6" />,
    invoice: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 13h6M9 17h6M9 9h2" /></>,
    reopen: <><path d="M9 14l-4-4 4-4" /><path d="M5 10h9a5 5 0 0 1 5 5v2" /></>,
    restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
    refresh: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    log: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }} aria-hidden="true">{p[n]}</svg>;
}

const CSS = `
.blz .blz-stat{transition:border-color .16s ease,transform .16s ease}
.blz-chip{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .16s ease;border:1px solid var(--border);background:var(--adm-surface,var(--bg));color:var(--muted)}
.blz-chip:hover{color:var(--text);border-color:var(--muted)}
.blz-row{transition:background .14s ease}
.blz-row:hover{background:color-mix(in srgb, var(--accent) 6%, transparent)}
.blz-chev{transition:transform .2s ease}
.blz-row.open .blz-chev{transform:rotate(180deg)}
.blz-act{transition:all .15s ease}
.blz-act:hover{border-color:var(--muted)}
@keyframes blzspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.blz *{transition:none!important;animation:none!important}}
`;

export default function AdminBills() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rid, setRid] = useState("");
  const [state, setState] = useState<BillState | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [exp, setExp] = useState<Record<string, Expanded>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Reaching BACK. The list used to be "the newest 200 sessions, then filtered" — so a bill
  // deleted yesterday could not be found at all. A date window, a search and a Load-more cursor
  // are what make "admin can see it and reopen it at any time" true (owner, 2026-08-04).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");   // what is typed; `q` is what has been submitted
  const [more, setMore] = useState<Bill[]>([]);   // pages after the first
  const [moreBusy, setMoreBusy] = useState(false);

  const qsFor = useCallback((extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (rid) p.set("restaurant_id", rid);
    if (state) p.set("state", state);
    if (from) p.set("from", from);
    // An end DATE means the whole of that day, not midnight at its start — otherwise picking
    // "to: today" hides everything taken today, the exact off-by-one the report window rule warns about.
    if (to) p.set("to", to + "T23:59:59.999+05:30");
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v);
    return p.toString();
  }, [rid, state, from, to, q]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/bills?" + qsFor(), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j); setMore([]);              // a new filter starts a fresh first page
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [qsFor]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh only while looking at the FIRST page. Refreshing under someone who has paged
  // back through months would throw their place away — the thing they came here to do.
  const pagedIn = more.length > 0;
  const autoRefresh = useCallback(() => { if (!pagedIn) load(); }, [pagedIn, load]);
  useActiveAutoRefresh(autoRefresh, 60000);

  // The oldest bill currently on screen is the cursor for the next page.
  const nextBefore = more.length ? more[more.length - 1].at : (d?.nextBefore ?? null);
  const loadMore = async () => {
    if (!nextBefore || moreBusy) return;
    setMoreBusy(true);
    try {
      const res = await fetch("/api/admin/bills?" + qsFor({ before: nextBefore }), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load more.");
      setMore((m) => [...m, ...((j.bills || []) as Bill[])]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setMoreBusy(false); }
  };

  const expand = async (b: Bill) => {
    const next = open === b.sessionId ? null : b.sessionId;
    setOpen(next);
    if (next && !exp[b.sessionId]) {
      setExp((t) => ({ ...t, [b.sessionId]: "loading" }));
      try {
        const res = await fetch("/api/admin/bills?trail=" + b.sessionId, { cache: "no-store" });
        const j = await res.json();
        setExp((t) => ({ ...t, [b.sessionId]: { trail: j.trail || [], invoiceHistory: j.invoiceHistory || [], creditNotes: j.creditNotes || [] } }));
      } catch { setExp((t) => ({ ...t, [b.sessionId]: { trail: [], invoiceHistory: [], creditNotes: [] } })); }
    }
  };

  const act = async (b: Bill, action: "delete" | "restore") => {
    let reason = "";
    if (action === "delete") {
      const r = window.prompt(`Delete bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})?\n\nThe bill is NOT erased — it stays here marked deleted and can be restored.\n\nReason (required):`, "");
      if (r === null) return;
      reason = r.trim();
      if (!reason) { alert("A reason is required to delete a bill."); return; }
    } else if (!window.confirm(`Restore bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})? It returns to the ledger as a normal record.`)) return;
    setBusy(b.sessionId);
    try {
      const res = await fetch("/api/admin/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, sessionId: b.sessionId, reason }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed.");
      setExp((t) => { const c = { ...t }; delete c[b.sessionId]; return c; });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  // Issue a CREDIT NOTE (post-settlement correction) — the bill is never changed; a new
  // immutable credit document is recorded against it (mig 194).
  const issueCredit = async (b: Bill) => {
    const amtStr = window.prompt(`Issue a credit note against bill${b.billNo ? ` #${b.billNo}` : ""} (${b.restaurantName})?\n\nThe bill is NOT changed — a new credit note is recorded against it. Bill total is ${inr(b.amount)}.\n\nCredit amount (₹):`, "");
    if (amtStr === null) return;
    const amount = Math.round(parseFloat(amtStr) * 100) / 100;
    if (!amount || amount <= 0) { alert("Enter a valid credit amount."); return; }
    const reason = window.prompt("Reason for this credit note (required):", "");
    if (reason === null) return;
    if (!reason.trim()) { alert("A reason is required to issue a credit note."); return; }
    setBusy(b.sessionId);
    try {
      // ONE id for this credit note, so a lost reply that gets retried cannot record it twice.
      // Generated here rather than inside a request helper: a fresh id per attempt would make the
      // server treat the second send as a brand-new credit note, which is the very thing to stop.
      const actionId = (globalThis.crypto?.randomUUID?.() as string) || `credit-${b.sessionId}-${amount}-${Date.now()}`;
      const res = await fetch("/api/admin/bills", { method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": actionId }, body: JSON.stringify({ action: "credit_note", sessionId: b.sessionId, amount, reason: reason.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to issue credit note.");
      const r2 = await fetch("/api/admin/bills?trail=" + b.sessionId, { cache: "no-store" });
      const j2 = await r2.json();
      setExp((t) => ({ ...t, [b.sessionId]: { trail: j2.trail || [], invoiceHistory: j2.invoiceHistory || [], creditNotes: j2.creditNotes || [] } }));
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const counts = d?.counts || {};
  const totalAll = ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
  // Everything on screen = the first page plus whatever "Load more" has fetched.
  const rows: Bill[] = [...(d?.bills || []), ...more];
  const settledPaid = rows.filter((b) => b.state === "settled").reduce((s, b) => s + b.paid, 0);

  return (
    <div className="blz">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Bills</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Every bill across all restaurants, by state. Deleted bills are never erased — they stay here, tombstoned, and you can restore them. Amounts shown for oversight.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="adm-btn" href="/aevinite/bill-audit/changes" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }} title="Chronological change log"><Ico n="log" s={14} />Change log</a>
          <button className="adm-btn" disabled={loading} onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ display: "inline-flex", animation: loading ? "blzspin 1s linear infinite" : undefined }}><Ico n="refresh" s={14} /></span>Refresh
          </button>
        </div>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "18px 0" }}>
        <Stat icon="running" tone="#22c55e" k="Open now" v={counts.running || 0} sub="tables still running" />
        <Stat icon="settled" tone="#3b82f6" k="Settled" v={counts.settled || 0} sub={`${inr(settledPaid)} collected`} />
        <Stat icon="cancelled" tone="#f59e0b" k="Closed unpaid" v={counts.cancelled || 0} sub="walk-outs / cancels" />
        <Stat icon="deleted" tone="#ef4444" k="Deleted" v={counts.deleted || 0} sub="restorable" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="blz-chip" onClick={() => setState("")} style={chip(state === "")}>All <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{totalAll}</span></button>
        {ORDER.map((k) => (
          <button key={k} className="blz-chip" onClick={() => setState(k)} style={chip(state === k, META[k].tone)}>
            <span style={{ color: META[k].tone, display: "inline-flex" }}><Ico n={META[k].icon} s={14} /></span>
            {META[k].label} <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{counts[k] || 0}</span>
          </button>
        ))}
        <select value={rid} onChange={(e) => { setRid(e.target.value); setOpen(null); }} style={{ marginLeft: "auto", padding: "9px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">All restaurants</option>
          {(d?.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {/* REACHING BACK — a date window and a search, so a bill from any day can be found and put
          back. Without these the screen only ever showed the newest page, and a bill deleted
          yesterday was already unreachable (owner, 2026-08-04). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <form
          onSubmit={(e) => { e.preventDefault(); setQ(qLive.trim()); setOpen(null); }}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={qLive} onChange={(e) => setQLive(e.target.value)} maxLength={40}
            placeholder="Find a bill — bill no, invoice no, or table"
            aria-label="Find a bill by its bill number, invoice number or table"
            style={{ padding: "9px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, minWidth: 260 }}
          />
          <button className="adm-btn" type="submit">Find</button>
          {(q || from || to) && (
            <button className="adm-btn" type="button" onClick={() => { setQ(""); setQLive(""); setFrom(""); setTo(""); setOpen(null); }}>Clear</button>
          )}
        </form>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          From
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOpen(null); }}
            style={{ padding: "8px 10px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
          to
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOpen(null); }}
            style={{ padding: "8px 10px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
        </label>
        {typeof d?.deletedTotal === "number" && d.deletedTotal > 0 && state !== "deleted" && (
          <button className="adm-btn" onClick={() => { setState("deleted"); setOpen(null); }}
            style={{ color: "#ef4444", borderColor: "color-mix(in srgb, #ef4444 40%, transparent)" }}>
            Show all {d.deletedTotal} deleted {d.deletedTotal === 1 ? "bill" : "bills"}
          </button>
        )}
      </div>

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? (err ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={5} label="Loading bills" />) : rows.length === 0 ? (
          <div className="adm-empty">
            {q || from || to
              ? "No bill matches that search or date range."
              : state === "deleted" ? "No bills have been deleted." : "No bills in this view."}
          </div>
        )
          : rows.map((b) => {
            const m = META[b.state];
            const isOpen = open === b.sessionId;
            const del = b.state === "deleted";
            return (
              <div key={b.sessionId} style={{ borderBottom: "1px solid var(--adm-line, rgba(255,255,255,0.06))", background: del ? "color-mix(in srgb, #ef4444 8%, transparent)" : undefined }}>
                <button onClick={() => expand(b)} className={`blz-row${isOpen ? " open" : ""}`} style={{ width: "100%", display: "grid", gridTemplateColumns: "148px 1.3fr 60px 116px 92px 24px", gap: 12, alignItems: "center", padding: "12px 16px", background: "transparent", border: 0, cursor: "pointer", textAlign: "left", color: "var(--text)", minWidth: 640 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: m.tone, fontWeight: 700, fontSize: 12.5 }}><Ico n={m.icon} s={15} />{m.label}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{b.billNo != null ? `#${b.billNo}` : "—"}</b>
                    <span style={{ color: "var(--muted)", margin: "0 6px" }}>·</span>
                    <span style={{ color: "var(--muted)" }}>{b.restaurantName}</span>
                    {b.invoiceGens > 1 && <span title={`Invoice re-issued ${b.invoiceGens} times`} style={{ marginLeft: 8, fontSize: 10.5, padding: "2px 7px", borderRadius: 6, fontWeight: 700, background: "color-mix(in srgb, #f59e0b 18%, transparent)", color: "#f59e0b" }}>re-issued ×{b.invoiceGens}</span>}
                    {b.invoiceVoided && <span title="Invoice currently voided (reopened)" style={{ marginLeft: 8, fontSize: 10.5, padding: "2px 7px", borderRadius: 6, fontWeight: 700, background: "color-mix(in srgb, #f59e0b 14%, transparent)", color: "#f59e0b", display: "inline-flex", alignItems: "center", gap: 4 }}><Ico n="reopen" s={11} />reopened</span>}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{b.table ? `T${b.table}` : "—"}</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right", textDecoration: del ? "line-through" : undefined, opacity: del ? 0.7 : 1 }}>{inr(b.amount)}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={b.at || undefined}>{b.at ? timeAgo(b.at) : "—"}</span>
                  <span className="blz-chev" style={{ color: "var(--muted)", justifySelf: "end", display: "inline-flex" }}><Ico n="chev" s={14} /></span>
                </button>

                {isOpen && (
                  <div style={{ padding: "2px 18px 18px", background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}>
                    {del && (
                      <div style={{ display: "flex", gap: 11, padding: "12px 14px", borderRadius: 11, border: "1px solid var(--adm-danger)", background: "color-mix(in srgb, #ef4444 12%, transparent)", margin: "12px 0" }}>
                        <span style={{ color: "var(--adm-danger)", flex: "0 0 auto", marginTop: 1 }}><Ico n="trash" s={16} /></span>
                        <div style={{ fontSize: 13 }}>
                          <b style={{ color: "var(--adm-danger)" }}>This bill was deleted</b>{b.deletedBy ? ` by ${b.deletedBy}` : ""}{b.deletedAt ? ` · ${new Date(b.deletedAt).toLocaleString()}` : ""}.
                          {b.deleteReason ? <div style={{ marginTop: 3 }}>Reason: <i>{b.deleteReason}</i></div> : <div style={{ marginTop: 3, opacity: 0.7 }}>No reason recorded.</div>}
                          <div style={{ marginTop: 3, opacity: 0.7 }}>Kept in full for tax/audit — you can restore it.</div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, margin: "14px 0" }}>
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

                    <SecHead icon="invoice" label="Invoice history" />
                    <InvoiceHistory e={exp[b.sessionId]} gens={b.invoiceGens} />

                    <SecHead icon="reopen" label="Credit notes" />
                    <CreditNotes e={exp[b.sessionId]} />

                    <SecHead icon="log" label="What happened to this bill" />
                    <Trail e={exp[b.sessionId]} openedAt={b.openedAt} rest={b.restaurantName} />

                    <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {del ? (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => act(b, "restore")} style={{ borderColor: "#22c55e", color: "#22c55e", display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <Ico n="restore" s={14} />{busy === b.sessionId ? "Restoring…" : "Restore bill"}
                        </button>
                      ) : (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => act(b, "delete")} style={{ borderColor: "var(--adm-danger)", color: "var(--adm-danger)", display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <Ico n="trash" s={14} />{busy === b.sessionId ? "Deleting…" : "Delete bill"}
                        </button>
                      )}
                      {!del && (
                        <button className="adm-btn blz-act" disabled={busy === b.sessionId} onClick={() => issueCredit(b)} style={{ display: "inline-flex", alignItems: "center", gap: 7 }} title="Record a refund/correction without changing the settled bill">
                          <Ico n="reopen" s={14} />Issue credit note
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {/* Walking further back. Present whenever the server says there is an older page, so the
            admin is never silently stopped at the newest one. */}
        {d && rows.length > 0 && nextBefore && (
          <div style={{ padding: "14px 16px", textAlign: "center", borderTop: "1px solid var(--adm-line, rgba(255,255,255,0.06))" }}>
            <button className="adm-btn" onClick={loadMore} disabled={moreBusy}>
              {moreBusy ? "Loading…" : "Load older bills"}
            </button>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              Showing {rows.length} — there are older ones. Use the dates or the search to jump straight to a bill.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, tone, k, v, sub }: { icon: IconName; tone: string; k: string; v: number; sub: string }) {
  return (
    <div className="adm-card blz-stat" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: tone, display: "inline-flex" }}><Ico n={icon} s={14} /></span>{k}
      </div>
      <div className="fit-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.5px", fontVariantNumeric: "tabular-nums" }}>{v}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{k}</div><div style={{ fontSize: 13.5, fontWeight: 600 }}>{v}</div></div>;
}

function SecHead({ icon, label }: { icon: IconName; label: string }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", margin: "16px 0 8px", display: "flex", alignItems: "center", gap: 7 }}><Ico n={icon} s={13} />{label}</div>;
}

function InvoiceHistory({ e, gens }: { e: Expanded | undefined; gens: number }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>;
  const inv = e.invoiceHistory;
  if (!inv.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Invoice not generated for this bill.</div>;
  return (
    <>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>Generated <b style={{ color: "var(--text)" }}>{gens}</b> time{gens === 1 ? "" : "s"}{gens > 1 ? " — re-issued after a void." : "."}</div>
      <div style={{ position: "relative", paddingLeft: 22 }}>
        <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: "var(--adm-line, rgba(255,255,255,.1))" }} />
        {inv.map((ev, i) => {
          const voided = ev.event === "void";
          const col = voided ? "#f59e0b" : "#3b82f6";
          return (
            <div key={i} style={{ position: "relative", padding: "6px 0", fontSize: 12.5 }}>
              <span style={{ position: "absolute", left: -19, top: 9, width: 11, height: 11, borderRadius: 99, background: col, border: "2px solid var(--bg)" }} />
              <div style={{ fontWeight: 600 }}>{voided ? `Invoice #${ev.no} voided (reopened)` : `Invoice #${ev.no} generated`}</div>
              <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{new Date(ev.at).toLocaleString()}{ev.actor ? ` · ${ev.actor}` : ""}{ev.reason ? <> — <i>{ev.reason}</i></> : ""}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CreditNotes({ e }: { e: Expanded | undefined }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>;
  const cn = e.creditNotes;
  if (!cn.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No credit notes on this bill.</div>;
  const total = cn.reduce((s, c) => s + c.amount, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {cn.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, minWidth: 150, fontVariantNumeric: "tabular-nums" }}>Credit note #{c.no} · {inr(c.amount)}</span>
          <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.reason || ""}{c.actor ? ` · ${c.actor}` : ""}</span>
          <span style={{ color: "var(--muted)", fontSize: 11.5 }} title={c.at}>{timeAgo(c.at)}</span>
        </div>
      ))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Total credited: <b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{inr(total)}</b></div>
    </div>
  );
}

function Trail({ e, openedAt, rest }: { e: Expanded | undefined; openedAt: string | null; rest: string }) {
  if (e === "loading" || e === undefined) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Loading trail…</div>;
  const t = e.trail;
  if (!t.length) return <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No recorded changes for this bill.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {t.map((ev, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, minWidth: 150 }}>{ACT_LABEL[ev.action] || actLabel(ev.action)}</span>
          <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.detail || ""}{ev.actor ? ` · ${ev.actor}` : ""}</span>
          <span style={{ color: "var(--muted)", fontSize: 11.5 }} title={ev.at}>{timeAgo(ev.at)}</span>
        </div>
      ))}
    </div>
  );
}

function chip(active: boolean, tone?: string): React.CSSProperties {
  return {
    border: active ? `1px solid ${tone || "var(--accent)"}` : "var(--border)",
    background: active ? `color-mix(in srgb, ${tone || "var(--accent)"} 18%, transparent)` : "transparent",
    color: active ? (tone || "var(--accent)") : "var(--muted)", fontWeight: active ? 700 : 600,
  };
}
