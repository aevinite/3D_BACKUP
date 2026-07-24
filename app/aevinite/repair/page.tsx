"use client";
// Admin · Repair — the one-stop "something's wrong, fix it" hub (redesigned 2026-07-22).
// Top-to-bottom it answers: what's broken right now? → jump into that panel OR hand it to
// Claude (now on the Mac / overnight) → what's queued → hands-on data tools → what Claude did.
//
// Live errors come from /api/admin/oplog?level=error (the same rows the dashboard's red button
// counts). Data surgery is backed by /api/admin/repair. Sending to Claude = /api/admin/fix-request
// (action_id bundles the error's context; mode picks instant vs the 02:30 robot). NO earnings shown.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";
import { openRestaurantPanel, PANEL_COLOR, ACT_LABEL, timeAgo, type Action } from "@/components/admin/shared";

type Restaurant = { id: string; name: string; slug: string };
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

// Which staff panel an error came from → where "Go to that panel" opens, and a friendly name.
const PANEL_JUMP: Record<string, { route: string; label: string }> = {
  editor: { route: "/manager", label: "Manager panel" },
  manager: { route: "/manager", label: "Manager panel" },
  kitchen: { route: "/kitchen", label: "Kitchen panel" },
  tablet: { route: "/tablet", label: "Waiter tablet" },
  owner: { route: "/owner", label: "Owner panel" },
};
const PANEL_NAME: Record<string, string> = {
  editor: "Manager", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet",
  owner: "Owner", admin: "Admin", guest: "Guest menu", menu: "Guest menu", db: "Database",
};

// Roll repeats of the SAME error into one row with a ×N badge, so a printer firing 8 times
// isn't 8 rows. Keyed by panel + restaurant + action + the first chunk of the message.
type ErrGroup = { key: string; sample: Action; count: number; latest: string };
function groupErrors(rows: Action[]): ErrGroup[] {
  const map = new Map<string, ErrGroup>();
  for (const a of rows) {
    const key = `${a.panel}|${a.restaurant_id || ""}|${a.action}|${(a.detail || "").slice(0, 90)}`;
    const ex = map.get(key);
    if (ex) { ex.count++; if (a.created_at > ex.latest) ex.latest = a.created_at; }
    else map.set(key, { key, sample: a, count: 1, latest: a.created_at });
  }
  return Array.from(map.values()).sort((x, y) => y.latest.localeCompare(x.latest));
}

export default function AdminRepair() {
  const toast = useToast();
  const [rid, setRid] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [data, setData] = useState<RepairData | null>(null);
  const [dataErr, setDataErr] = useState(false);
  const [tool, setTool] = useState<Op | null>(null);

  // Live problems (error-level log rows) + local view state.
  const [errors, setErrors] = useState<Action[]>([]);
  const [errLoading, setErrLoading] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState("");            // which error group is in "are you sure?" mode
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  // "Describe a problem" box + the queue + Claude session history.
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<FixRequest[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [openRun, setOpenRun] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await adminFetch<{ restaurants: Restaurant[] }>("/api/admin/restaurants");
      if (r.ok) setRestaurants(r.data.restaurants || []);
    })();
  }, []);

  // Hands-on tools need a restaurant's live tables/orders.
  const load = useCallback(async () => {
    if (!rid) { setData(null); return; }
    setData(null); setDataErr(false);
    const r = await adminFetch<RepairData>(`/api/admin/repair?restaurant_id=${rid}`);
    if (r.ok) setData(r.data); else setDataErr(true);
  }, [rid]);
  useEffect(() => { load(); }, [load]);

  // Everything that isn't restaurant-scoped: the live errors, the queue, the history. ONE
  // refresh function so the top Refresh button re-pulls all three (no background polling —
  // click-to-refresh keeps egress low, matching the rest of admin).
  const loadHub = useCallback(async () => {
    setErrLoading(true);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [e, q, h] = await Promise.all([
      adminFetch<{ actions: Action[] }>(`/api/admin/oplog?level=error&unresolved=1&limit=50&since=${encodeURIComponent(since24h)}`),
      adminFetch<{ requests: FixRequest[] }>("/api/admin/fix-request?status=open"),
      adminFetch<{ runs: AgentRun[] }>("/api/admin/agent-runs"),
    ]);
    if (e.ok) setErrors(e.data.actions || []);
    if (q.ok) setRequests(q.data.requests || []);
    if (h.ok) setRuns(h.data.runs || []);
    setErrLoading(false);
  }, []);
  useEffect(() => { loadHub(); }, [loadHub]);

  const refreshAll = () => { setRefreshing(true); Promise.all([loadHub(), load()]).finally(() => setTimeout(() => setRefreshing(false), 500)); };

  // Two Claudes (owner 2026-07-22): 'instant' pops a terminal on the Mac now; 'overnight' waits
  // for the 02:30 robot. Used by both the describe box and the per-error buttons.
  const sendDescribed = async (mode: "instant" | "overnight") => {
    if (!note.trim()) { toast("Type what's happening first.", "err"); return; }
    setSending(true);
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ note: note.trim(), restaurant_id: rid || null, mode }),
    });
    setSending(false);
    if (r.ok) {
      setNote("");
      toast(mode === "instant" ? "Sent — a Claude window opens on the Mac within a minute." : "Queued — the night robot takes it at 2:30 AM.");
      loadHub();
    } else toast(r.error || "Couldn't send that.", "err");
  };

  // Hand a specific error to Claude, bundling its surrounding log rows as context.
  const sendError = async (g: ErrGroup, mode: "instant" | "overnight") => {
    setSent((prev) => new Set(prev).add(g.key));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ action_id: g.sample.id, restaurant_id: g.sample.restaurant_id || null, mode }),
    });
    if (r.ok) { toast(mode === "instant" ? "Sent to Claude — window opens on the Mac shortly." : "Queued for the 2:30 AM robot."); loadHub(); }
    else { toast(r.error || "Couldn't send that.", "err"); setSent((prev) => { const n = new Set(prev); n.delete(g.key); return n; }); }
  };

  // Owner fixed it themselves → mark the whole repeat-group resolved (two-step: the button first
  // asks "are you sure?", this runs on confirm). Clears it from the list and the dashboard red button.
  const resolveError = async (g: ErrGroup) => {
    setConfirming("");
    setResolving((p) => new Set(p).add(g.key));
    setHidden((p) => new Set(p).add(g.key)); // optimistic remove
    const r = await adminFetch<{ ok: boolean; resolved: number }>("/api/admin/resolve-error", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: g.sample.id }),
    });
    setResolving((p) => { const n = new Set(p); n.delete(g.key); return n; });
    if (r.ok) { toast("Marked resolved — cleared from your problems."); loadHub(); }
    else { toast(r.error || "Couldn't resolve that.", "err"); setHidden((p) => { const n = new Set(p); n.delete(g.key); return n; }); }
  };

  const jumpTo = (a: Action) => {
    const j = PANEL_JUMP[a.panel];
    if (j && a.restaurant_id) { openRestaurantPanel(a.restaurant_id, j.route); return; }
    if ((a.panel === "guest" || a.panel === "menu") && a.restaurant_slug) window.open(`/r/${a.restaurant_slug}/menu`, "_blank");
  };
  const jumpLabel = (a: Action): string | null => {
    if (PANEL_JUMP[a.panel] && a.restaurant_id) return `Go to ${PANEL_JUMP[a.panel].label}`;
    if ((a.panel === "guest" || a.panel === "menu") && a.restaurant_slug) return "Open guest menu";
    return null;
  };

  const dismissRequest = async (id: string) => {
    setRequests((prev) => prev.filter((x) => x.id !== id));
    const r = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    if (!r.ok) { toast(r.error || "Couldn't update that.", "err"); loadHub(); }
  };

  const scoped = restaurants.find((r) => r.id === rid);
  const scopedName = scoped?.name || null;
  const scopedSlug = scoped?.slug || "";
  const groups = groupErrors(errors).filter((g) => !hidden.has(g.key));

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 4 }}>Repair</h1>
          <p className="adm-page-sub" style={{ margin: 0 }}>See what&rsquo;s broken, jump straight into the panel to fix it by hand, or hand it to Claude — now on the Mac or overnight.</p>
        </div>
        <button className="adm-btn" onClick={refreshAll} disabled={refreshing} title="Reload problems, queue and history">
          <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {/* Status strip */}
      <div className="rp-strip">
        <div className={`rp-pill${groups.length ? " alert" : " ok"}`}>
          <i className={`fas ${groups.length ? "fa-triangle-exclamation" : "fa-circle-check"}`} aria-hidden="true" />
          <span className="n">{errLoading ? "…" : groups.length}</span><span>problem{groups.length === 1 ? "" : "s"} (24h)</span>
        </div>
        <div className="rp-pill">
          <i className="fas fa-robot" aria-hidden="true" /><span className="n">{requests.length}</span><span>waiting for Claude</span>
        </div>
        <div className="rp-pill">
          <i className="fas fa-screwdriver-wrench" aria-hidden="true" /><span className="n">{TOOLS.length}</span><span>hands-on tools</span>
        </div>
      </div>

      {/* ── Problems right now ─────────────────────────────────────────── */}
      <div className="rp-sec-h">
        <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ color: groups.length ? "var(--adm-danger)" : "var(--muted)" }} />
        <h2>Problems right now</h2>
        {groups.length ? <span className="rp-chip danger">{groups.length}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>all restaurants · last 24h</span>
      </div>

      {errLoading ? (
        <div className="adm-empty">Checking for problems…</div>
      ) : groups.length === 0 ? (
        <div className="rp-clear"><i className="fas fa-circle-check" aria-hidden="true" /> All clear — nothing has errored in the last 24 hours.</div>
      ) : (
        <div style={{ marginBottom: 6 }}>
          {groups.map((g) => {
            const a = g.sample;
            const color = PANEL_COLOR[a.panel] || "var(--adm-danger)";
            const title = ACT_LABEL[a.action] || a.action;
            const jl = jumpLabel(a);
            const isOpen = expanded.has(g.key);
            const wasSent = sent.has(g.key);
            return (
              <div key={g.key} className="rp-err">
                <span className="rp-err-bar" style={{ background: color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                    <b style={{ fontSize: 13.5 }}>{title}</b>
                    {g.count > 1 ? <span className="rp-chip danger">×{g.count}</span> : null}
                    <span className="rp-panel" style={{ color, borderColor: color }}>{PANEL_NAME[a.panel] || a.panel}</span>
                    {a.restaurant_name ? <span className="rp-rest"><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{a.restaurant_name}</span> : null}
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(g.latest)}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                  </div>
                  {a.detail ? (
                    <div className="rp-detail" style={{ maxHeight: isOpen ? 240 : 34 }}>{a.detail}</div>
                  ) : <div className="adm-muted" style={{ fontSize: 12 }}>No further detail was recorded.</div>}
                  {confirming === g.key ? (
                    // Step 2 — the "are you sure?" confirm (owner 2026-07-24).
                    <div className="rp-confirm" style={{ marginTop: 9 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}><i className="fas fa-circle-question" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />You fixed this yourself? It&rsquo;ll clear from your problems.</span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="adm-btn" style={{ fontSize: 12, background: "var(--adm-ok, #4caf82)", borderColor: "var(--adm-ok, #4caf82)", color: "#fff", fontWeight: 700 }} disabled={resolving.has(g.key)} onClick={() => resolveError(g)}>
                          <i className="fas fa-check" aria-hidden="true" style={{ marginRight: 6 }} />{resolving.has(g.key) ? "Resolving…" : "Yes, it's resolved"}
                        </button>
                        <button className="adm-btn" style={{ fontSize: 12 }} disabled={resolving.has(g.key)} onClick={() => setConfirming("")}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                      {jl ? (
                        <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => jumpTo(a)} title="Open that panel for this restaurant to fix it by hand">
                          <i className="fas fa-arrow-up-right-from-square" aria-hidden="true" style={{ marginRight: 6 }} />{jl}
                        </button>
                      ) : null}
                      {wasSent ? (
                        <span className="adm-muted" style={{ fontSize: 12 }}><i className="fas fa-check" aria-hidden="true" style={{ color: "var(--adm-ok, #4caf82)", marginRight: 5 }} />Sent to Claude</span>
                      ) : (
                        <>
                          <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => sendError(g, "instant")} title="A Claude window opens on the office Mac within a minute">
                            <i className="fas fa-bolt" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-accent, #e8a13c)" }} />Fix now
                          </button>
                          <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => sendError(g, "overnight")} title="The 2:30 AM robot fixes it and leaves a morning report">
                            <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 6, opacity: 0.8 }} />Overnight
                          </button>
                        </>
                      )}
                      {/* Owner's own fix — the green "I handled it" action, separate from the two Claudes. */}
                      <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => setConfirming(g.key)} title="I fixed this myself — clear it from the list">
                        <i className="fas fa-circle-check" aria-hidden="true" style={{ marginRight: 6, color: "var(--adm-ok, #4caf82)" }} />Resolve
                      </button>
                      {a.detail && a.detail.length > 90 ? (
                        <button className="rp-link" onClick={() => setExpanded((p) => { const n = new Set(p); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>{isOpen ? "less" : "more"}</button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Report anything else ───────────────────────────────────────── */}
      <div className="rp-sec-h">
        <i className="fas fa-comment-dots" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2>Report a problem</h2>
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>for anything the list above didn&rsquo;t catch</span>
      </div>
      <div className="adm-card" style={{ marginBottom: 6 }}>
        <p className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "0 0 10px" }}>
          Describe what&rsquo;s going wrong in your own words — a printer, a button, a wrong total. {rid ? <>Tagged to <b>{scopedName}</b>.</> : <>Pick a restaurant in the tools below to tag it, or leave it general.</>}
        </p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
          placeholder="e.g. The bill button on table 12 does nothing during rush; happens on the waiter tablet."
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13.5, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <span className="adm-muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
            <i className="fas fa-bolt" aria-hidden="true" style={{ color: "var(--adm-accent, #e8a13c)" }} /> Now = a window on the Mac &nbsp;·&nbsp; <i className="fas fa-moon" aria-hidden="true" style={{ opacity: 0.8 }} /> Overnight = the 2:30 robot
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="adm-btn" disabled={sending} onClick={() => sendDescribed("overnight")} title="The night robot fixes it at 2:30 AM and leaves a morning report">
              <i className="fas fa-moon" aria-hidden="true" style={{ marginRight: 7, opacity: 0.8 }} />{sending ? "Sending…" : "Fix overnight"}
            </button>
            <button className="adm-btn primary" disabled={sending} onClick={() => sendDescribed("instant")} title="A Claude terminal opens on the office Mac within a minute">
              <i className="fas fa-bolt" aria-hidden="true" style={{ marginRight: 7 }} />{sending ? "Sending…" : "Fix NOW on the Mac"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Waiting for Claude ─────────────────────────────────────────── */}
      {requests.length > 0 && (
        <>
          <div className="rp-sec-h">
            <i className="fas fa-robot" aria-hidden="true" style={{ color: "var(--muted)" }} />
            <h2>Waiting for Claude</h2><span className="rp-chip">{requests.length}</span>
          </div>
          <div className="adm-card" style={{ marginBottom: 6 }}>
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
        </>
      )}

      {/* ── Hands-on tools ─────────────────────────────────────────────── */}
      <div className="rp-sec-h">
        <i className="fas fa-screwdriver-wrench" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2>Hands-on tools</h2>
        <span className="adm-muted" style={{ fontSize: 12, marginLeft: 2 }}>fix a table or order yourself — pick a restaurant</span>
      </div>
      <div className="adm-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label className="adm-ret">
            <i className="fas fa-store" aria-hidden="true" style={{ opacity: 0.7 }} /> Restaurant
            <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Choose a restaurant to repair">
              <option value="">Choose a restaurant…</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {rid && <button className="adm-btn" onClick={load}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>}
        </div>
      </div>

      {!rid ? (
        <div className="adm-empty">Pick a restaurant above to unlock its table &amp; order tools.</div>
      ) : dataErr ? (
        <div className="adm-empty">Couldn&rsquo;t load that restaurant. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : data === null ? (
        <div className="adm-empty">Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 14 }}>
            {TOOLS.map((t) => (
              <button key={t.op} className="adm-card" onClick={() => setTool(t.op)}
                style={{ textAlign: "left", cursor: "pointer", border: t.danger ? "1px solid color-mix(in srgb, var(--adm-danger) 45%, transparent)" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <i className={`fas ${t.icon}`} aria-hidden="true" style={{ fontSize: 18, color: t.danger ? "var(--adm-danger)" : "var(--adm-accent, #e8a13c)" }} />
                  <b>{t.label}</b>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          <div className="adm-card" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14 }}>Other quick levers</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/* Land ON the right section of THIS restaurant's detail (slug + ?section=), not just the
                  restaurants list — the old links passed the UUID (focus matches by slug) so they
                  opened nothing, and "Maintenance mode" pointed at Settings which has no such toggle. */}
              <Link className="adm-btn" href={`/aevinite/restaurants?focus=${encodeURIComponent(scopedSlug)}&section=features`}><i className="fas fa-toggle-on" aria-hidden="true" /> Feature switches</Link>
              <Link className="adm-btn" href={`/aevinite/restaurants?focus=${encodeURIComponent(scopedSlug)}&section=status`}><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Maintenance mode</Link>
              <Link className="adm-btn" href={`/aevinite/logs?restaurant_id=${rid}`}><i className="fas fa-scroll" aria-hidden="true" /> Full activity log</Link>
            </div>
          </div>
        </>
      )}

      {/* ── Claude session history ─────────────────────────────────────── */}
      {runs.length > 0 && (
        <>
          <div className="rp-sec-h">
            <i className="fas fa-clock-rotate-left" aria-hidden="true" style={{ color: "var(--muted)" }} />
            <h2>Claude session history</h2><span className="rp-chip">{runs.length}</span>
          </div>
          <div className="adm-card" style={{ marginBottom: 8 }}>
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
              const isOpen = openRun === s.id;
              return (
                <div key={s.id} style={{ padding: "9px 0", borderBottom: "var(--border)", fontSize: 13 }}>
                  <button onClick={() => setOpenRun(isOpen ? "" : s.id)} aria-expanded={isOpen}
                    style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: s.report ? "pointer" : "default", minHeight: 40 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 5, marginTop: 1, background: "color-mix(in srgb, var(--adm-accent, #e8a13c) 18%, transparent)", color: "var(--adm-accent, #e8a13c)" }}>{kindLabel}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        {new Date(s.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {mins !== null ? <> · {mins} min</> : null} · <span style={{ color: st.color }}>{st.label}</span>
                        {s.report ? <> · {isOpen ? "hide" : "read what it did"}</> : null}
                      </span>
                    </span>
                    {s.report ? <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`} aria-hidden="true" style={{ marginTop: 4, opacity: 0.5, fontSize: 11 }} /> : null}
                  </button>
                  {isOpen && s.report ? (
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.55, margin: "8px 0 0", padding: "10px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--card) 60%, transparent)", border: "var(--border)", maxHeight: 320, overflowY: "auto", fontFamily: "inherit" }}>{s.report}</pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tool && data && (
        <RepairModal op={tool} rid={rid} scopeName={scopedName} data={data}
          onClose={() => setTool(null)}
          onDone={(msg) => { setTool(null); toast(msg); load(); }}
          onError={(msg) => toast(msg, "err")} />
      )}

      <style>{`
        .rp-strip{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 4px}
        .rp-pill{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;border:var(--border);background:var(--card);font-size:12.5px;color:var(--muted)}
        .rp-pill .n{font-size:18px;font-weight:800;color:var(--text)}
        .rp-pill.alert{background:color-mix(in srgb,var(--adm-danger) 13%,var(--card));border-color:color-mix(in srgb,var(--adm-danger) 45%,transparent);color:var(--adm-danger)}
        .rp-pill.alert .n{color:var(--adm-danger)}
        .rp-pill.ok{border-color:color-mix(in srgb,var(--adm-ok,#4caf82) 40%,transparent)}
        .rp-sec-h{display:flex;align-items:center;gap:9px;margin:24px 0 11px}
        .rp-sec-h h2{margin:0;font-size:16px}
        .rp-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--adm-accent,#e8a13c) 16%,transparent);color:var(--adm-accent,#e8a13c)}
        .rp-chip.danger{background:color-mix(in srgb,var(--adm-danger) 16%,transparent);color:var(--adm-danger)}
        .rp-clear{display:flex;align-items:center;gap:9px;padding:16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent);background:color-mix(in srgb,var(--adm-ok,#4caf82) 8%,var(--card));color:var(--text);font-size:13.5px}
        .rp-clear i{color:var(--adm-ok,#4caf82)}
        .rp-err{position:relative;display:flex;gap:12px;padding:13px 14px 13px 16px;border-radius:12px;border:var(--border);background:var(--card);margin-bottom:10px;overflow:hidden}
        .rp-err-bar{position:absolute;left:0;top:0;bottom:0;width:3px}
        .rp-panel{font-size:10.5px;font-weight:700;letter-spacing:.3px;padding:1px 7px;border-radius:6px;border:1px solid;background:transparent;text-transform:uppercase}
        .rp-rest{font-size:11.5px;color:var(--muted)}
        .rp-detail{font-size:12px;line-height:1.5;color:var(--muted);white-space:pre-wrap;word-break:break-word;overflow:hidden;transition:max-height .18s ease;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        .rp-link{background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0 2px}
        .rp-x{margin-left:auto;background:none;border:none;color:var(--muted);opacity:.5;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px}
        .rp-x:hover{opacity:1;background:color-mix(in srgb,var(--text) 8%,transparent)}
        .rp-confirm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 11px;border-radius:9px;background:color-mix(in srgb,var(--adm-ok,#4caf82) 10%,var(--card));border:1px solid color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent)}
      `}</style>
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
