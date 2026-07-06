"use client";
// Admin · Logs — both logs in one place, like the manager has: OPERATIONS (every
// staff action, incl. the admin's own) and CUSTOMERS (guests, their orders/calls,
// and the blocklist). The admin sees admin actions here; the manager never does.
import { useCallback, useEffect, useState } from "react";
import { ACT_LABEL, PANEL_COLOR, timeAgo, type Action } from "@/components/admin/shared";

type Member = {
  id: string; name: string | null; phone: string | null; role: string;
  approved: boolean; removed: boolean; joined_at: string;
  session?: { table_number?: string; status?: string } | null;
};
type Block = { id: string; device_id?: string | null; phone?: string | null; table_number?: string | null; reason?: string | null; blocked_at: string };
type CustData = { members: Member[]; blocklist: Block[]; orders: { member_id: string }[]; calls: { member_id: string }[] };

export default function AdminLogs() {
  const [tab, setTab] = useState<"ops" | "cust">("ops");
  const [ops, setOps] = useState<Action[] | null>(null);
  const [cust, setCust] = useState<CustData | null>(null);
  // Error flags so a failed fetch shows a retry instead of an eternal "Loading…"
  // (bug #7, 2026-07-06 — the catch used to swallow errors and never clear the sentinel).
  const [opsErr, setOpsErr] = useState(false);
  const [custErr, setCustErr] = useState(false);

  const loadOps = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/oplog?limit=200", { cache: "no-store" })).json(); if (j.error) setOpsErr(true); else { setOps(j.actions || []); setOpsErr(false); } } catch { setOpsErr(true); }
  }, []);
  const loadCust = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/custlog", { cache: "no-store" })).json(); if (j.error) setCustErr(true); else { setCust(j); setCustErr(false); } } catch { setCustErr(true); }
  }, []);
  useEffect(() => { if (tab === "ops") loadOps(); else loadCust(); }, [tab, loadOps, loadCust]);

  return (
    <>
      <h1 className="adm-page-h">Logs</h1>
      <p className="adm-page-sub">Everything that happens — staff actions and guests. (Change how long logs are kept in Settings.)</p>

      <div className="adm-tabs">
        <button className={tab === "ops" ? "active" : ""} onClick={() => setTab("ops")}>Operations</button>
        <button className={tab === "cust" ? "active" : ""} onClick={() => setTab("cust")}>Customers</button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="adm-btn" onClick={() => (tab === "ops" ? loadOps() : loadCust())}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>
      </div>

      {tab === "ops"
        ? <OpsTable rows={ops} err={opsErr} onRetry={loadOps} />
        : <CustTable data={cust} err={custErr} onRetry={loadCust} />}
    </>
  );
}

function OpsTable({ rows, err, onRetry }: { rows: Action[] | null; err: boolean; onRetry: () => void }) {
  const cols = "92px 1fr auto";
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the operations log. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (rows === null) return <div className="adm-empty">Loading…</div>;
  if (rows.length === 0) return <div className="adm-empty">No staff actions yet.</div>;
  return (
    <div className="adm-logwrap">
      <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Panel</div><div>Action</div><div>When</div></div>
      {rows.map((a) => (
        <div key={a.id} className="adm-logrow" style={{ gridTemplateColumns: cols }}>
          <div><span className="adm-chip" style={{ background: "color-mix(in srgb, " + (PANEL_COLOR[a.panel] || "#888") + " 22%, transparent)", color: PANEL_COLOR[a.panel] || "var(--muted)" }}>{a.panel}</span></div>
          <div style={{ minWidth: 0 }}>
            {ACT_LABEL[a.action] || a.action}{a.actor ? <span className="adm-muted"> · {a.actor}</span> : a.detail ? <span className="adm-muted"> · {a.detail}</span> : a.table_number ? <span className="adm-muted"> · Table {a.table_number}</span> : ""}
            {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
          </div>
          <div className="adm-when">{timeAgo(a.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

function CustTable({ data, err, onRetry }: { data: CustData | null; err: boolean; onRetry: () => void }) {
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the customer log. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (data === null) return <div className="adm-empty">Loading…</div>;
  const { members, blocklist, orders, calls } = data;
  // Roll up each member's order count + call count. (No ₹ spend here — the admin
  // panel shows no earnings anywhere, owner 2026-07-03.)
  const byMember = new Map<string, { n: number; calls: number }>();
  for (const o of orders) { const m = byMember.get(o.member_id) || { n: 0, calls: 0 }; m.n++; byMember.set(o.member_id, m); }
  for (const c of calls) { const m = byMember.get(c.member_id) || { n: 0, calls: 0 }; m.calls++; byMember.set(c.member_id, m); }
  const cols = "1fr 70px 80px 1.2fr auto";

  return (
    <>
      <div className="adm-logwrap" style={{ marginBottom: 16 }}>
        <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Guest</div><div>Table</div><div>Role</div><div>Did</div><div>When</div></div>
        {members.length === 0 ? <div className="adm-empty">No guests in sessions yet.</div> : members.map((m) => {
          const did = byMember.get(m.id) || { n: 0, calls: 0 };
          return (
            <div key={m.id} className="adm-logrow" style={{ gridTemplateColumns: cols, opacity: m.removed ? 0.55 : 1 }}>
              <div><b>{m.name || "Guest"}</b>{m.phone ? <span className="adm-muted"> · {m.phone}</span> : ""}</div>
              <div>{m.session?.table_number ? `#${m.session.table_number}` : "—"}</div>
              <div className="adm-muted">{m.role === "owner" ? "Head" : "Guest"}</div>
              <div className="adm-muted">{did.n} order{did.n !== 1 ? "s" : ""}{did.calls ? ` · ${did.calls} call${did.calls !== 1 ? "s" : ""}` : ""}</div>
              <div className="adm-when">{timeAgo(m.joined_at)}</div>
            </div>
          );
        })}
      </div>

      <div className="adm-card">
        <h2>Blocklist <span className="adm-muted" style={{ fontWeight: 400 }}>· {blocklist.length}</span></h2>
        {blocklist.length === 0 ? <p className="adm-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>Nobody is blocked.</p> : (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {blocklist.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                <i className="fas fa-ban" style={{ color: "var(--adm-danger)" }} aria-hidden="true" />
                <span>{b.phone || b.device_id || b.table_number || "unknown"}{b.reason ? <span className="adm-muted"> · {b.reason}</span> : ""}</span>
                <span className="adm-when" style={{ marginLeft: "auto" }}>{timeAgo(b.blocked_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
