"use client";
// Admin · Repair kit — emergency data surgery during live service. Pick a restaurant, pick a
// tool, pick the target, type a reason, confirm. Every action is logged (warn-level, repair_*)
// and shows up in the Activity log + Bill audit. NO earnings are shown here (admin rule).
//
// Backed by /api/admin/repair (GET targets, POST one op). Destructive ops require a typed reason
// and go through a confirm modal (useAdminModal → phone Back + Escape + focus-trap).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";

type Restaurant = { id: string; name: string };
type Session = { id: string; table_number: string; status: string; bill_no: number | null; invoice_no: number | null; invoice_voided: boolean };
type Order = { id: string; table_number: string; kot_no: number | null; status: string; payment_status: string; created_at: string; session_id: string | null };
type RepairData = { sessions: Session[]; orders: Order[] };
type FixRequest = { id: string; restaurant_id: string | null; created_at: string; source: string | null; mode?: string | null; summary: string; pr_url: string | null };
type AgentRun = { id: string; kind: "live" | "nightly" | "audit"; title: string; status: "running" | "done" | "closed" | "failed"; report: string | null; started_at: string; ended_at: string | null };

type Op = "void_bill" | "delete_order" | "refire_order" | "unstick_table" | "edit_time";

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();

const TOOLS: { op: Op; label: string; icon: string; desc: string; danger?: boolean }[] = [
  { op: "unstick_table", label: "Unstick a table", icon: "fa-wand-magic-sparkles", desc: "Force-close a jammed open/pending table so it's usable again." },
  { op: "refire_order", label: "Re-fire an order", icon: "fa-fire-burner", desc: "Send the same dishes to the kitchen again as a fresh order (new KOT)." },
  { op: "void_bill", label: "Void a bill", icon: "fa-file-circle-xmark", desc: "Reopen an invoiced bill for edits. The invoice number is kept on record." },
  { op: "edit_time", label: "Edit an order's time", icon: "fa-clock-rotate-left", desc: "Fix a wrong date/time on an order. Note: the business day flips at 5 AM." },
  { op: "delete_order", label: "Delete an order", icon: "fa-trash-can", desc: "Permanently remove a stuck order/bill. Can't be undone.", danger: true },
];

export default function AdminRepair() {
  const toast = useToast();
  const [rid, setRid] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [data, setData] = useState<RepairData | null>(null);
  const [dataErr, setDataErr] = useState(false);
  const [tool, setTool] = useState<Op | null>(null);
  // "Describe a problem to Claude" + the open fix-request queue.
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<FixRequest[]>([]);
  // Session history (agent_runs): every Claude run — pop-up terminal, night robot, audits.
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [openRun, setOpenRun] = useState("");

  useEffect(() => {
    (async () => {
      const r = await adminFetch<{ restaurants: Restaurant[] }>("/api/admin/restaurants");
      if (r.ok) setRestaurants(r.data.restaurants || []);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!rid) { setData(null); return; }
    setData(null); setDataErr(false);
    const r = await adminFetch<RepairData>(`/api/admin/repair?restaurant_id=${rid}`);
    if (r.ok) setData(r.data); else setDataErr(true);
  }, [rid]);
  useEffect(() => { load(); }, [load]);

  const loadRequests = useCallback(async () => {
    const r = await adminFetch<{ requests: FixRequest[] }>("/api/admin/fix-request?status=open");
    if (r.ok) setRequests(r.data.requests || []);
    const h = await adminFetch<{ runs: AgentRun[] }>("/api/admin/agent-runs");
    if (h.ok) setRuns(h.data.runs || []);
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  const uuidLocal = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now());
  // Two Claudes (owner 2026-07-22): 'instant' pops a terminal on the Mac now; 'overnight'
  // waits for the 02:30 robot. Both come through here — only the mode differs.
  const sendDescribed = async (mode: "instant" | "overnight") => {
    if (!note.trim()) { toast("Type what's happening first.", "err"); return; }
    setSending(true);
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuidLocal() },
      body: JSON.stringify({ note: note.trim(), restaurant_id: rid || null, mode }),
    });
    setSending(false);
    if (r.ok) {
      setNote("");
      toast(mode === "instant" ? "Sent — a Claude window opens on the Mac within a minute." : "Queued — the night robot takes it at 2:30 AM.");
      loadRequests();
    } else toast(r.error || "Couldn't send that.", "err");
  };
  const dismissRequest = async (id: string) => {
    setRequests((prev) => prev.filter((x) => x.id !== id)); // optimistic
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    if (!r.ok) { toast(r.error || "Couldn't update that.", "err"); loadRequests(); }
  };

  const scopedName = restaurants.find((r) => r.id === rid)?.name || null;

  return (
    <>
      <h1 className="adm-page-h">Repair kit</h1>
      <p className="adm-page-sub">Fix a live problem in seconds — then Claude fixes the real cause. Every repair is logged.</p>

      {/* Restaurant picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <label className="adm-ret">
          <i className="fas fa-store" aria-hidden="true" style={{ opacity: 0.7 }} /> Restaurant
          <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Choose a restaurant to repair">
            <option value="">Choose a restaurant…</option>
            {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {rid && <button className="adm-btn" onClick={load}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>}
      </div>

      {/* Describe a problem to Claude — for issues with no matching error row. */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 6px" }}><i className="fas fa-robot" aria-hidden="true" style={{ marginRight: 8, opacity: 0.85 }} />Report a problem to Claude</h2>
        <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "0 0 10px" }}>
          Describe what&rsquo;s going wrong (printer, a button, a wrong total…). A Claude window opens on the office Mac within a minute if it&rsquo;s on — otherwise the night robot takes it. {rid ? <>Tagged to <b>{scopedName}</b>.</> : <>Pick a restaurant above to tag it, or leave it general.</>}
        </p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
          placeholder="e.g. The bill button on table 12 does nothing during rush; happens on the waiter tablet."
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13.5, resize: "vertical" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="adm-btn" disabled={sending} onClick={() => sendDescribed("overnight")} title="The night robot fixes it at 2:30 AM and leaves a morning report">
            <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 7, opacity: 0.8 }} />{sending ? "Sending…" : "Fix overnight"}
          </button>
          <button className="adm-btn primary" disabled={sending} onClick={() => sendDescribed("instant")} title="A Claude terminal opens on the office Mac within a minute">
            <i className="fas fa-bolt" aria-hidden="true" style={{ marginRight: 7 }} />{sending ? "Sending…" : "Fix NOW on the Mac"}
          </button>
        </div>
      </div>

      {/* Open fix requests queue */}
      {requests.length > 0 && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: "0 0 8px" }}>Waiting for Claude <span className="adm-muted" style={{ fontWeight: 400 }}>· {requests.length}</span></h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {requests.map((q) => (
              <div key={q.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                <i className={`fas ${q.mode === "overnight" ? "fa-moon" : q.source === "error_row" ? "fa-triangle-exclamation" : "fa-bolt"}`} aria-hidden="true" title={q.mode === "overnight" ? "Waiting for the 2:30 AM robot" : "Instant — pops on the Mac"} style={{ marginTop: 2, opacity: 0.7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.summary}</div>
                  <div className="adm-muted" style={{ fontSize: 11.5 }}>{new Date(q.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{q.pr_url ? <> · <a href={q.pr_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>fix ready →</a></> : ""}</div>
                </div>
                <button className="adm-btn" onClick={() => dismissRequest(q.id)} title="Dismiss" style={{ fontSize: 11.5, padding: "3px 9px" }}>Dismiss</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Claude session history — every run: pop-up terminals (live), night robot, audits. */}
      {runs.length > 0 && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: "0 0 8px" }}><i className="fas fa-clock-rotate-left" aria-hidden="true" style={{ marginRight: 8, opacity: 0.85 }} />Claude session history <span className="adm-muted" style={{ fontWeight: 400 }}>· {runs.length}</span></h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {runs.map((s) => {
              const mins = s.ended_at ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)) : null;
              const kindLabel = s.kind === "live" ? "LIVE" : s.kind === "nightly" ? "NIGHT" : "AUDIT";
              const statusInfo: Record<AgentRun["status"], { label: string; color: string }> = {
                running: { label: "working…", color: "var(--adm-accent, #e8a13c)" },
                done: { label: "finished", color: "var(--adm-ok, #4caf82)" },
                closed: { label: "window closed", color: "var(--adm-muted-fg, #9aa)" },
                failed: { label: "failed", color: "var(--adm-danger)" },
              };
              const st = statusInfo[s.status];
              const expanded = openRun === s.id;
              return (
                <div key={s.id} style={{ padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                  <button onClick={() => setOpenRun(expanded ? "" : s.id)} aria-expanded={expanded}
                    style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: s.report ? "pointer" : "default", minHeight: 40 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 5, marginTop: 1, background: "color-mix(in srgb, var(--adm-accent, #e8a13c) 18%, transparent)", color: "var(--adm-accent, #e8a13c)" }}>{kindLabel}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        {new Date(s.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {mins !== null ? <> · {mins} min</> : null} · <span style={{ color: st.color }}>{st.label}</span>
                        {s.report ? <> · {expanded ? "hide" : "read what it did"}</> : null}
                      </span>
                    </span>
                    {s.report ? <i className={`fas fa-chevron-${expanded ? "up" : "down"}`} aria-hidden="true" style={{ marginTop: 4, opacity: 0.5, fontSize: 11 }} /> : null}
                  </button>
                  {expanded && s.report ? (
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.55, margin: "8px 0 0", padding: "10px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--card) 60%, transparent)", border: "var(--border)", maxHeight: 320, overflowY: "auto", fontFamily: "inherit" }}>{s.report}</pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!rid ? (
        <div className="adm-empty">Pick a restaurant to use the repair tools on its tables and orders.</div>
      ) : dataErr ? (
        <div className="adm-empty">Couldn&rsquo;t load that restaurant. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : data === null ? (
        <div className="adm-empty">Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 18 }}>
            {TOOLS.map((t) => (
              <button
                key={t.op}
                className="adm-card"
                onClick={() => setTool(t.op)}
                style={{ textAlign: "left", cursor: "pointer", border: t.danger ? "1px solid color-mix(in srgb, var(--adm-danger) 45%, transparent)" : undefined }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <i className={`fas ${t.icon}`} aria-hidden="true" style={{ fontSize: 18, color: t.danger ? "var(--adm-danger)" : "var(--adm-accent, #e8a13c)" }} />
                  <b>{t.label}</b>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Links to the other levers the owner already has. */}
          <div className="adm-card">
            <h2 style={{ margin: "0 0 8px" }}>Other quick levers</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link className="adm-btn" href={`/aevinite/restaurants?focus=${rid}`}><i className="fas fa-toggle-on" aria-hidden="true" /> Feature switches</Link>
              <Link className="adm-btn" href="/aevinite/settings"><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Maintenance mode</Link>
              <Link className="adm-btn" href={`/aevinite/logs?restaurant_id=${rid}`}><i className="fas fa-scroll" aria-hidden="true" /> Activity log</Link>
            </div>
          </div>
        </>
      )}

      {tool && data && (
        <RepairModal
          op={tool}
          rid={rid}
          scopeName={scopedName}
          data={data}
          onClose={() => setTool(null)}
          onDone={(msg) => { setTool(null); toast(msg); load(); }}
          onError={(msg) => toast(msg, "err")}
        />
      )}
    </>
  );
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
// Convert a UTC ISO to the value a <input type="datetime-local"> expects. Uses the browser's
// local zone (the admin is on IST), which is the same zone new Date(inputValue) parses back in —
// so the round-trip is consistent.
function toLocalInput(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function RepairModal({ op, rid, scopeName, data, onClose, onDone, onError }: {
  op: Op; rid: string; scopeName: string | null; data: RepairData;
  onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, `admin-repair-${op}`, onClose);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [cancelOld, setCancelOld] = useState(true);
  const [when, setWhen] = useState("");

  const meta = TOOLS.find((t) => t.op === op)!;

  // Which targets this op offers.
  const invoicedSessions = data.sessions.filter((s) => s.invoice_no && !s.invoice_voided);
  const openSessions = data.sessions; // GET already returns only open/pending
  const orders = data.orders;

  // When an order is chosen for edit_time, prefill its current time.
  const onPickOrder = (id: string) => {
    setTargetId(id);
    if (op === "edit_time") {
      const o = orders.find((x) => x.id === id);
      if (o) setWhen(toLocalInput(o.created_at));
    }
  };

  const submit = async () => {
    if (!reason.trim()) { onError("Please type a reason."); return; }
    const payload: Record<string, unknown> = { op, restaurant_id: rid, reason: reason.trim() };
    if (op === "void_bill" || op === "unstick_table") {
      if (!targetId) { onError("Pick a table."); return; }
      payload.session_id = targetId;
    } else {
      if (!targetId) { onError("Pick an order."); return; }
      payload.order_id = targetId;
    }
    if (op === "refire_order") payload.cancel_old = cancelOld;
    if (op === "edit_time") {
      if (!when) { onError("Pick a date and time."); return; }
      const d = new Date(when); // parsed in the admin's local zone (IST)
      if (isNaN(d.getTime())) { onError("That date looks wrong."); return; }
      payload.created_at = d.toISOString();
    }
    setBusy(true);
    try {
      const r = await adminFetch<{ ok: boolean; kot_no?: number }>("/api/admin/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        onDone(op === "refire_order" && r.data.kot_no ? `Re-fired — new KOT #${r.data.kot_no}.` : "Done.");
      } else {
        onError(r.error || "Couldn't do that just now.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={meta.label} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 500px)" }}>
          <h2 style={{ margin: "0 0 4px" }}>{meta.label}</h2>
          <p className="adm-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" }}>{meta.desc}{scopeName ? <> · <b>{scopeName}</b></> : null}</p>

          {/* Target picker */}
          {op === "void_bill" ? (
            <Field label="Bill (invoiced tables)">
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rp-select">
                <option value="">Choose a table…</option>
                {invoicedSessions.map((s) => <option key={s.id} value={s.id}>Table {s.table_number} · invoice #{s.invoice_no}</option>)}
              </select>
              {invoicedSessions.length === 0 && <Hint>No invoiced bills open right now.</Hint>}
            </Field>
          ) : op === "unstick_table" ? (
            <Field label="Table (open / pending)">
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="rp-select">
                <option value="">Choose a table…</option>
                {openSessions.map((s) => <option key={s.id} value={s.id}>Table {s.table_number} · {s.status}{s.invoice_no ? ` · invoice #${s.invoice_no}` : ""}</option>)}
              </select>
              {openSessions.length === 0 && <Hint>No open or pending tables right now.</Hint>}
            </Field>
          ) : (
            <Field label="Order">
              <select value={targetId} onChange={(e) => onPickOrder(e.target.value)} className="rp-select">
                <option value="">Choose an order…</option>
                {orders.map((o) => <option key={o.id} value={o.id}>Table {o.table_number} · KOT {o.kot_no ?? "—"} · {o.status} · {fmtTime(o.created_at)}</option>)}
              </select>
              {orders.length === 0 && <Hint>No recent orders for this restaurant.</Hint>}
            </Field>
          )}

          {op === "refire_order" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, margin: "2px 0 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={cancelOld} onChange={(e) => setCancelOld(e.target.checked)} />
              Cancel the original broken order after re-firing
            </label>
          )}

          {op === "edit_time" && (
            <Field label="New date & time (your local time)">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rp-select" />
              <Hint>Moving an order past 5 AM shifts it to another day&rsquo;s reports.</Hint>
            </Field>
          )}

          {/* Reason — required on every op */}
          <Field label="Reason (required — this is saved to the log)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. printer jammed, KOT never reached kitchen" className="rp-select" />
          </Field>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
            <button className="adm-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button className={`adm-btn ${meta.danger ? "danger" : "primary"}`} disabled={busy} onClick={submit}>{busy ? "Working…" : meta.label}</button>
          </div>
        </div>
      </div>
      <style>{`.rp-select{width:100%;padding:8px 10px;border-radius:8px;border:var(--border);background:var(--card);color:var(--text);font-size:13.5px}`}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--muted)" }}>{label}</div>
      {children}
    </div>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 5 }}>{children}</div>;
}
