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

      {!rid ? (
        <div className="adm-empty">Pick a restaurant to see its tables and orders.</div>
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
