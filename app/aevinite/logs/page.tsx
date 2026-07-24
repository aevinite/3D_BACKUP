"use client";
// Admin · Logs — both logs in one place, like the manager has: OPERATIONS (every
// staff action, incl. the admin's own) and CUSTOMERS (guests, their orders/calls,
// and the blocklist). The admin sees admin actions here; the manager never does.
//
// Two admin controls added 2026-07-08:
//   1. A RESTAURANT filter (All + each by name) that scopes BOTH tabs to one
//      restaurant. The DB keeps every restaurant's logs; this is just the view.
//      Scoped server-side (indexed, explicit columns, limited) — never a whole-table read.
//   2. A "logs are getting full" banner + one-tap cleanup (Keep 1 year / 6 months /
//      1 month / 7 days). This is the MANUAL complement to the automatic per-restaurant
//      nightly prune (lfh_prune_logs, migration 152). It only ever deletes activity-log
//      rows (staff_actions) — never bills or customer records.
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_LABEL, PANEL_COLOR, timeAgo, formatActionDetail, type Action } from "@/components/admin/shared";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";

type Restaurant = { id: string; name: string };
type Member = {
  id: string; name: string | null; phone: string | null; role: string;
  approved: boolean; removed: boolean; joined_at: string; restaurant_name?: string | null;
  session?: { table_number?: string; status?: string } | null;
};
type Block = { id: string; device_id?: string | null; phone?: string | null; table_number?: string | null; reason?: string | null; blocked_at: string; restaurant_name?: string | null };
type CustData = { members: Member[]; blocklist: Block[]; orders: { member_id: string }[]; calls: { member_id: string }[] };

// Cleanup windows offered in the "logs are getting full" banner (delete older than).
const CLEANUP_OPTS = [
  { days: 365, label: "Keep 1 year" },
  { days: 182, label: "Keep 6 months" },
  { days: 30, label: "Keep 1 month" },
  { days: 7, label: "Keep 7 days" },
];

export default function AdminLogs() {
  const toast = useToast();
  const [tab, setTab] = useState<"ops" | "cust">("ops");
  // "" = All restaurants; otherwise scope both tabs + the cleanup to this restaurant.
  const [rid, setRid] = useState("");
  // Everything-Log filters (Operations tab): severity + free-text search.
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">("");
  const [q, setQ] = useState("");
  // Only the TYPED SEARCH is debounced (so typing doesn't fire a request per keystroke).
  // Filter buttons (restaurant / severity) must apply INSTANTLY — debouncing them made a
  // click on "Errors" feel like it did nothing for a beat, then jump (owner 2026-07-24).
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [ops, setOps] = useState<Action[] | null>(null);
  const [cust, setCust] = useState<CustData | null>(null);
  // Error flags so a failed fetch shows a retry instead of an eternal "Loading…"
  // (bug #7, 2026-07-06 — the catch used to swallow errors and never clear the sentinel).
  const [opsErr, setOpsErr] = useState(false);
  const [custErr, setCustErr] = useState(false);
  // Log-volume count for the "getting full" banner (scoped to the current restaurant).
  const [count, setCount] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(50000);
  // The cleanup choice awaiting confirmation (null = nothing pending).
  const [pending, setPending] = useState<{ days: number; label: string } | null>(null);

  // Load the restaurant list once for the dropdown (reuses the admin Restaurants endpoint).
  useEffect(() => {
    (async () => {
      const r = await adminFetch<{ restaurants: Restaurant[] }>("/api/admin/restaurants");
      if (r.ok) setRestaurants(r.data.restaurants || []);
    })();
  }, []);

  // Seed filters from the URL so deep-links land PRE-FILTERED (before this, the page
  // ignored searchParams entirely): the notification bell links here with ?level=error
  // and the Repair page's "Full activity log" links with ?restaurant_id=<id>. Read once
  // on mount from location.search (no Suspense boundary needed, matching this page's style).
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const lv = p.get("level");
      if (lv === "error" || lv === "warn" || lv === "info") setLevel(lv);
      const r = p.get("restaurant_id");
      if (r) setRid(r);
      const query = p.get("q");
      if (query) setQ(query);
    } catch {}
  }, []);

  const loadOps = useCallback(async () => {
    const qs = (rid ? `&restaurant_id=${rid}` : "") + (level ? `&level=${level}` : "") + (qDebounced.trim() ? `&q=${encodeURIComponent(qDebounced.trim())}` : "");
    try { const j = await (await fetch(`/api/admin/oplog?limit=200${qs}`, { cache: "no-store" })).json(); if (j.error) setOpsErr(true); else { setOps(j.actions || []); setOpsErr(false); } } catch { setOpsErr(true); }
  }, [rid, level, qDebounced]);
  const loadCust = useCallback(async () => {
    const qs = rid ? `?restaurant_id=${rid}` : "";
    try { const j = await (await fetch(`/api/admin/custlog${qs}`, { cache: "no-store" })).json(); if (j.error) setCustErr(true); else { setCust(j); setCustErr(false); } } catch { setCustErr(true); }
  }, [rid]);
  // Cheap HEAD count for the banner — no rows pulled. Refreshes when the restaurant changes.
  const loadCount = useCallback(async () => {
    const qs = rid ? `?restaurant_id=${rid}` : "";
    const r = await adminFetch<{ count: number; threshold: number }>(`/api/admin/oplog/cleanup${qs}`);
    if (r.ok) { setCount(r.data.count); setThreshold(r.data.threshold); } else setCount(null);
  }, [rid]);

  // Re-load the active tab whenever the tab, restaurant filter, severity or (debounced)
  // search changes. No setTimeout here — the debounce lives in qDebounced above, so a
  // severity/restaurant click fetches immediately (instant filter, no laggy "both blue").
  useEffect(() => {
    setOps(null); setCust(null);
    if (tab === "ops") loadOps(); else loadCust();
  }, [tab, loadOps, loadCust]);
  useEffect(() => { loadCount(); }, [loadCount]);

  const runCleanup = async () => {
    if (!pending) return;
    const r = await adminFetch<{ removed: number }>("/api/admin/oplog/cleanup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant_id: rid || null, keepDays: pending.days }),
    });
    setPending(null);
    if (r.ok) {
      const n = r.data.removed;
      toast(`Removed ${n.toLocaleString()} old ${n === 1 ? "entry" : "entries"}.`);
      loadCount();
      if (tab === "ops") loadOps();
    } else {
      toast(r.error || "Couldn't clean up just now.", "err");
    }
  };

  const scopedName = rid ? restaurants.find((r) => r.id === rid)?.name : "";
  const full = count !== null && count >= threshold;

  // "Send to Claude" — file a fix request from an error row (bundles the surrounding log lines).
  const sendToClaude = async (a: Action) => {
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) },
      body: JSON.stringify({ action_id: a.id, restaurant_id: a.restaurant_id || null }),
    });
    if (r.ok) toast("Sent to Claude — it'll be looked at overnight."); else toast(r.error || "Couldn't send that.", "err");
  };

  return (
    <>
      <h1 className="adm-page-h">Logs</h1>
      <p className="adm-page-sub">Everything that happens — staff actions and guests. (Change how long logs are kept in Settings.)</p>

      {/* Restaurant filter — scopes BOTH tabs to one restaurant. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label className="adm-ret">
          <i className="fas fa-store" aria-hidden="true" style={{ opacity: 0.7 }} /> Restaurant
          <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Filter logs by restaurant">
            <option value="">All restaurants</option>
            {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>

      {/* "Logs are getting full" banner — only when the activity-log volume is large. */}
      {full && (
        <div className="adm-card" style={{ marginBottom: 14, borderColor: "var(--adm-warn)", background: "color-mix(in srgb, var(--adm-warn) 10%, var(--card))" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5 }}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ color: "var(--adm-warn)", marginTop: 2 }} />
            <div>
              <b>The activity log {scopedName ? <>for {scopedName}</> : "across all restaurants"} is getting large</b>
              {" "}— {count!.toLocaleString()} entries. Old entries auto-delete each night, but you can clear space now by keeping only the most recent:
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {CLEANUP_OPTS.map((o) => (
              <button key={o.days} className="adm-btn" onClick={() => setPending(o)}>{o.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="adm-tabs">
        <button className={tab === "ops" ? "active" : ""} onClick={() => setTab("ops")}>Operations</button>
        <button className={tab === "cust" ? "active" : ""} onClick={() => setTab("cust")}>Customers</button>
      </div>
      {/* Severity filter + search — Operations tab only (the Everything Log view). */}
      {tab === "ops" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div className="adm-tabs" role="group" aria-label="Filter by severity" style={{ margin: 0 }}>
            <button className={level === "" ? "active" : ""} onClick={() => setLevel("")}>All</button>
            <button className={level === "error" ? "active" : ""} onClick={() => setLevel("error")}>⚠️ Errors</button>
            <button className={level === "warn" ? "active" : ""} onClick={() => setLevel("warn")}>Notable</button>
            <button className={level === "info" ? "active" : ""} onClick={() => setLevel("info")}>Info</button>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search action or detail…"
            aria-label="Search the log"
            style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
          />
          <button className="adm-btn" onClick={() => loadOps()}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>
        </div>
      )}
      {tab === "cust" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="adm-btn" onClick={() => loadCust()}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>
        </div>
      )}

      {tab === "ops"
        ? <OpsTable rows={ops} err={opsErr} onRetry={loadOps} scopedName={scopedName || null} onSendToClaude={sendToClaude} />
        : <CustTable data={cust} err={custErr} onRetry={loadCust} />}

      {/* Cleanup confirm — a shared modal (phone Back + Escape + focus-trap via useAdminModal). */}
      {pending && (
        <CleanupModal
          label={pending.label}
          days={pending.days}
          scopeName={scopedName || null}
          onCancel={() => setPending(null)}
          onConfirm={runCleanup}
        />
      )}
    </>
  );
}

function OpsTable({ rows, err, onRetry, scopedName, onSendToClaude }: { rows: Action[] | null; err: boolean; onRetry: () => void; scopedName: string | null; onSendToClaude: (a: Action) => void }) {
  const cols = "92px 1fr auto";
  // Which row's full detail is expanded (errors + tap-batches carry long text worth reading).
  const [open, setOpen] = useState<string | null>(null);
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the operations log. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (rows === null) return <div className="adm-empty">Loading…</div>;
  if (rows.length === 0) return <div className="adm-empty">No staff actions {scopedName ? `for ${scopedName}` : "yet"}.</div>;
  return (
    <div className="adm-logwrap">
      <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Panel</div><div>Action</div><div>When</div></div>
      {rows.map((a) => {
        const isErr = a.level === "error";
        const isWarn = a.level === "warn";
        // A row is expandable when it carries detail longer than fits on one line, or is a
        // tap-batch / error worth reading in full.
        // Errors keep their raw text (stack/where matters); everything else (esp. tap batches)
        // is shown in plain English via the shared formatter.
        const det = isErr ? (a.detail || "") : formatActionDetail(a.action, a.detail);
        const expandable = !!det && (det.length > 60 || isErr);
        const isOpen = open === a.id;
        return (
          <div
            key={a.id}
            className="adm-logrow"
            onClick={expandable ? () => setOpen(isOpen ? null : a.id) : undefined}
            style={{
              gridTemplateColumns: cols,
              cursor: expandable ? "pointer" : "default",
              // Tint the whole row by severity so errors jump out.
              background: isErr ? "color-mix(in srgb, var(--adm-danger) 12%, transparent)" : isWarn ? "color-mix(in srgb, var(--adm-warn) 8%, transparent)" : undefined,
              borderLeft: isErr ? "3px solid var(--adm-danger)" : isWarn ? "3px solid var(--adm-warn)" : "3px solid transparent",
            }}
          >
            <div><span className="adm-chip" style={{ background: "color-mix(in srgb, " + (PANEL_COLOR[a.panel] || "#888") + " 22%, transparent)", color: PANEL_COLOR[a.panel] || "var(--muted)" }}>{a.panel}</span></div>
            <div style={{ minWidth: 0 }}>
              <span style={{ color: isErr ? "var(--adm-danger)" : undefined, fontWeight: isErr ? 600 : undefined }}>{ACT_LABEL[a.action] || a.action}</span>
              {a.actor ? <span className="adm-muted"> · {a.actor}</span> : a.table_number ? <span className="adm-muted"> · Table {a.table_number}</span> : ""}
              {det ? (
                isOpen
                  ? <div className="adm-muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{det}</div>
                  : <span className="adm-muted"> · {det.length > 60 ? det.slice(0, 60) + "…" : det}</span>
              ) : null}
              {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
              {isErr && (
                <button
                  className="adm-btn"
                  onClick={(e) => { e.stopPropagation(); onSendToClaude(a); }}
                  style={{ marginTop: 6, fontSize: 11.5, padding: "3px 9px" }}
                >
                  <i className="fas fa-robot" aria-hidden="true" style={{ marginRight: 5 }} />Send to Claude
                </button>
              )}
            </div>
            <div className="adm-when">{timeAgo(a.created_at)}</div>
          </div>
        );
      })}
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
              <div style={{ minWidth: 0 }}>
                <div><b>{m.name || "Guest"}</b>{m.phone ? <span className="adm-muted"> · {m.phone}</span> : ""}</div>
                {m.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{m.restaurant_name}</span> : null}
              </div>
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
                <span>{b.phone || b.device_id || b.table_number || "unknown"}{b.reason ? <span className="adm-muted"> · {b.reason}</span> : ""}{b.restaurant_name ? <span className="adm-muted"> · <i className="fas fa-store" style={{ fontSize: 9, marginRight: 3, opacity: 0.7 }} aria-hidden="true" />{b.restaurant_name}</span> : ""}</span>
                <span className="adm-when" style={{ marginLeft: "auto" }}>{timeAgo(b.blocked_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup confirm modal. useAdminModal wires phone Back + Escape close, focus trap,
// and scroll-lock (CLAUDE.md rule: every new modal registers with the back-stack).
// ─────────────────────────────────────────────────────────────────────────────
function CleanupModal({ label, days, scopeName, onCancel, onConfirm }: {
  label: string; days: number; scopeName: string | null; onCancel: () => void; onConfirm: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "admin-logs-cleanup", onCancel);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <>
      <div onClick={busy ? undefined : onCancel} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Confirm log cleanup" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 440px)" }}>
          <h2 style={{ margin: "0 0 8px" }}>Delete old activity-log entries?</h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 6px" }}>
            This permanently deletes activity-log entries older than <b style={{ color: "var(--text)" }}>{days} days</b> ({label.toLowerCase()}) {scopeName ? <>for <b style={{ color: "var(--text)" }}>{scopeName}</b></> : <>across <b style={{ color: "var(--text)" }}>all restaurants</b></>}.
          </p>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px" }}>Bills and customer records are never touched. This can&rsquo;t be undone.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="adm-btn" disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="adm-btn danger" disabled={busy} onClick={go}>{busy ? "Deleting…" : "Delete old entries"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
