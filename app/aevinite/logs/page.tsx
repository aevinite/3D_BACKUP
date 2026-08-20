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
import { actLabel, panelChipStyle, panelLabel, timeAgo, inr, formatActionDetail, isManagerPinRow, type Action } from "@/components/admin/shared";
import { LogDetailModal } from "@/components/admin/LogDetailModal";
import { RemovalDetailModal, KIND_LABEL, KIND_ICON } from "@/components/admin/RemovalDetail";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { adminFetch } from "@/lib/adminFetch";
import { SkelList } from "@/components/admin/Skeleton";
// Sort orders + type chips for the removals record, shared with the owner console and the manager
// panel (see /panels/auditsort.js for why it lives there — the panel loads it as a bare <script>).
import AUDITSORT from "@/public/panels/auditsort.js";

type Restaurant = { id: string; name: string };
// One row of the Removals record (deletion_audit, mig 251) — what was taken out and why.
type Removal = {
  id: number; at: string; kind: string; reason_code: string | null; reason_note: string | null;
  actor: string | null; actor_role: string | null; table_number: string | null;
  bill_no: number | null; invoice_no: string | null; kot_no: number | null;
  item_title: string | null; qty: number | null; amount: string | number | null;
  restaurant_id: string | null; restaurant_name: string | null;
};
type Member = {
  id: string; name: string | null; phone: string | null; role: string;
  approved: boolean; removed: boolean; joined_at: string; restaurant_name?: string | null;
  session?: { table_number?: string; status?: string } | null;
};
type Block = { id: string; device_id?: string | null; phone?: string | null; table_number?: string | null; reason?: string | null; blocked_at: string; restaurant_name?: string | null };
type CustData = { members: Member[]; blocklist: Block[]; orders: { member_id: string }[]; calls: { member_id: string }[] };

// How many rows each feed asks the server for. Named, because a list that comes back exactly this
// long is a TRUNCATED list, and the page has to say so — otherwise the admin reads the newest 200
// rows and believes he has read everything there is (T17 sweep, 2026-08-19).
const FEED_LIMIT = 200;

// Cleanup windows offered in the "logs are getting full" banner (delete older than).
const CLEANUP_OPTS = [
  { days: 365, label: "Keep 1 year" },
  { days: 182, label: "Keep 6 months" },
  { days: 30, label: "Keep 1 month" },
  { days: 7, label: "Keep 7 days" },
];

// The removal kinds — DERIVED from the one shared map (T7 pass 2, 2026-08-12), never listed here
// again. This page kept its own copy and disagreed with the owner console on six of eleven types:
// it said "Invoice voided (reopened)" where the owner read "Bill reopened", for the same row.
const REMOVAL_KIND: Record<string, [string, string]> = Object.fromEntries(
  Object.keys(KIND_LABEL).map((k) => [k, [KIND_ICON[k] || "•", KIND_LABEL[k]] as [string, string]]),
);
// The same two maps flattened, for /panels/auditsort.js — which takes plain label/icon lookups so it
// stays free of any import and can be loaded by the manager panel as a bare <script>.
const AUD_ICON: Record<string, string> = Object.fromEntries(Object.entries(REMOVAL_KIND).map(([k, v]) => [k, v[0]]));
const AUD_LABEL: Record<string, string> = Object.fromEntries(Object.entries(REMOVAL_KIND).map(([k, v]) => [k, v[1]]));
const REMOVAL_REASON: Record<string, string> = AUDITSORT.REASON_LABEL;

export default function AdminLogs() {
  const toast = useToast();
  const [tab, setTab] = useState<"aud" | "ops" | "cust">("ops");
  // "" = All restaurants; otherwise scope both tabs + the cleanup to this restaurant.
  const [rid, setRid] = useState("");
  // Everything-Log filters (Operations tab): severity + free-text search. Seed the severity
  // from the URL (?level=error) so the bell's "View log →" deep-link actually lands on Errors
  // instead of All — the link used to be ignored (client component, searchParams never read).
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">(() => {
    if (typeof window === "undefined") return "";
    const l = new URLSearchParams(window.location.search).get("level");
    return l === "error" || l === "warn" || l === "info" ? l : "";
  });
  const [q, setQ] = useState("");
  // Only the TYPED SEARCH is debounced (so typing doesn't fire a request per keystroke).
  // Filter buttons (restaurant / severity) must apply INSTANTLY — debouncing them made a
  // click on "Errors" feel like it did nothing for a beat, then jump (owner 2026-07-24).
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [ops, setOps] = useState<Action[] | null>(null);
  const [cust, setCust] = useState<CustData | null>(null);
  const [aud, setAud] = useState<Removal[] | null>(null);
  const [removalId, setRemovalId] = useState<number | null>(null);   // which removal is open in full
  // Error flags so a failed fetch shows a retry instead of an eternal "Loading…"
  // (bug #7, 2026-07-06 — the catch used to swallow errors and never clear the sentinel).
  const [opsErr, setOpsErr] = useState(false);
  const [custErr, setCustErr] = useState(false);
  const [audErr, setAudErr] = useState(false);
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
  // `seeded` gates the first fetch until the URL has been read. Without it the load effect fired
  // once with the DEFAULT filters and again with the seeded ones, so following "Full activity log"
  // from the Repair page pulled 200 rows for EVERY restaurant and then 200 more for the one asked
  // for — twice the data for the same screen (T17 sweep, 2026-08-19).
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const lv = p.get("level");
      if (lv === "error" || lv === "warn" || lv === "info") setLevel(lv);
      const r = p.get("restaurant_id");
      if (r) setRid(r);
      const query = p.get("q");
      if (query) { setQ(query); setQDebounced(query); }
    } catch {}
    setSeeded(true);
  }, []);

  const loadOps = useCallback(async () => {
    const qs = (rid ? `&restaurant_id=${rid}` : "") + (level ? `&level=${level}` : "") + (qDebounced.trim() ? `&q=${encodeURIComponent(qDebounced.trim())}` : "");
    try { const j = await (await fetch(`/api/admin/oplog?limit=${FEED_LIMIT}${qs}`, { cache: "no-store" })).json(); if (j.error) setOpsErr(true); else { setOps(j.actions || []); setOpsErr(false); } } catch { setOpsErr(true); }
  }, [rid, level, qDebounced]);
  const loadCust = useCallback(async () => {
    const qs = rid ? `?restaurant_id=${rid}` : "";
    try { const j = await (await fetch(`/api/admin/custlog${qs}`, { cache: "no-store" })).json(); if (j.error) setCustErr(true); else { setCust(j); setCustErr(false); } } catch { setCustErr(true); }
  }, [rid]);
  // HOW LONG THE AUDIT IS KEPT (owner, 2026-08-12: "there should be option of three years, five
  // years, seven years, 10 years, and one year … it's an important thing and very less things will be
  // in the audit, so make sure to save that"). It sits at the TOP of the Audit tab, where he asked
  // for it — the same place the activity log's own cleanup banner sits. ADMIN-ONLY, like the log's
  // window: the owner reads the record, the platform decides how long it is kept.
  const [auditYears, setAuditYears] = useState<number | null>(null);
  const [auditYearOpts, setAuditYearOpts] = useState<number[]>([1, 3, 5, 7, 10]);
  const [auditYearsMsg, setAuditYearsMsg] = useState("");
  const loadAuditYears = useCallback(async () => {
    const r = await adminFetch<{ audit_retention_years: number; auditYearOptions?: number[] }>("/api/admin/settings");
    if (r.ok) { setAuditYears(r.data.audit_retention_years ?? 10); if (Array.isArray(r.data.auditYearOptions)) setAuditYearOpts(r.data.auditYearOptions); }
  }, []);
  useEffect(() => { loadAuditYears(); }, [loadAuditYears]);
  const saveAuditYears = async (years: number) => {
    const prev = auditYears;
    setAuditYears(years); setAuditYearsMsg("");
    const r = await adminFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ audit_retention_years: years }) });
    // A failed save must not leave the screen showing a window the database never took — the same
    // rule the rest of this page follows for its cleanup actions.
    if (!r.ok) { setAuditYears(prev); setAuditYearsMsg("Couldn't save that — the window is unchanged."); return; }
    setAuditYearsMsg(`Saved — the Audit is kept for ${years} year${years === 1 ? "" : "s"}.`);
    toast(`Audit kept for ${years} year${years === 1 ? "" : "s"}`);
  };

  // Sort + type filter for the Removals record, shared with the owner console and the manager panel
  // via /panels/auditsort.js (owner, 2026-08-11). Both act on rows already in hand.
  const [audKind, setAudKind] = useState("");
  const [audSort, setAudSort] = useState(AUDITSORT.DEFAULT_SORT);
  // Chips come from the WHOLE arrived feed, so a chip's count never changes when you tap it.
  const audChips = AUDITSORT.kindCounts(aud || [], AUD_LABEL, AUD_ICON);
  // A type that has gone from the feed (a stale chip after Refresh) must not leave an empty list
  // with no way back.
  const audKindSafe = audKind && audChips.some((c) => c.kind === audKind) ? audKind : "";
  const audRows = aud === null ? null : (AUDITSORT.view(aud, { kind: audKindSafe, sort: audSort, kindLabel: AUD_LABEL }) as Removal[]);

  // …and the SAME pair for the Operations feed (owner, 2026-08-14). The severity buttons above
  // answer "how bad was it"; these answer "what KIND of thing was it" — which is the question
  // "show me just the printer" actually is. Grouping, counting and sorting all live in the one
  // shared module, so this screen can never disagree with the owner console or the manager panel.
  const [opsGroup, setOpsGroup] = useState("");
  const [opsSort, setOpsSort] = useState(AUDITSORT.ACTIVITY_DEFAULT_SORT);
  const opsChips = AUDITSORT.activityCounts(ops || []) as { group: string; count: number; label: string; icon: string }[];
  const opsGroupSafe = opsGroup && opsChips.some((c) => c.group === opsGroup) ? opsGroup : "";
  const opsRows = ops === null ? null : (AUDITSORT.activityView(ops, { group: opsGroupSafe, sort: opsSort }) as Action[]);
  // The Removals record (deletion_audit) — every restaurant's audit rows, searchable.
  const loadAud = useCallback(async () => {
    const qs = (rid ? `&restaurant_id=${rid}` : "") + (qDebounced.trim() ? `&q=${encodeURIComponent(qDebounced.trim())}` : "");
    try { const j = await (await fetch(`/api/admin/audit?limit=${FEED_LIMIT}${qs}`, { cache: "no-store" })).json(); if (j.error) setAudErr(true); else { setAud(j.removals || []); setAudErr(false); } } catch { setAudErr(true); }
  }, [rid, qDebounced]);
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
    if (!seeded) return;
    setOps(null); setCust(null); setAud(null);
    if (tab === "ops") loadOps(); else if (tab === "aud") loadAud(); else loadCust();
  }, [seeded, tab, loadOps, loadCust, loadAud]);
  useEffect(() => { if (seeded) loadCount(); }, [seeded, loadCount]);

  const runCleanup = async () => {
    if (!pending) return;
    const r = await adminFetch<{ removed: number }>("/api/admin/oplog/cleanup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant_id: rid || null, keepDays: pending.days }),
    });
    setPending(null);
    if (r.ok) {
      const n = r.data.removed;
      toast(`Removed ${n.toLocaleString("en-IN")} old ${n === 1 ? "entry" : "entries"}.`);
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

  // Mark an error resolved (stops it showing red) or reopen it — via the SAME group endpoint the
  // Repair page + dashboard use (/api/admin/resolve-error), so all three stay in step. It acts on
  // the whole repeat-group (same panel + action + message + restaurant), so we optimistically flip
  // every matching row locally the way the server does, and reload only if the server rejects it.
  const markResolved = async (a: Action, resolved: boolean) => {
    const now = new Date().toISOString();
    const sameGroup = (x: Action) => x.level === "error" && x.panel === a.panel && x.action === a.action
      && (x.detail ?? null) === (a.detail ?? null) && (x.restaurant_id ?? null) === (a.restaurant_id ?? null);
    setOps((prev) => prev ? prev.map((x) => sameGroup(x) ? { ...x, resolved_at: resolved ? now : null } : x) : prev);
    const r = await adminFetch<{ ok: boolean }>("/api/admin/resolve-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: a.id, reopen: !resolved }),
    });
    if (r.ok) toast(resolved ? "Marked resolved." : "Reopened."); else { toast(r.error || "Couldn't update that.", "err"); loadOps(); }
  };

  return (
    <>
      <h1 className="adm-page-h">Audit &amp; logs</h1>
      <p className="adm-page-sub">Everything, for every restaurant — what was removed and why (Audit), every staff action including errors (Operations), and the guests (Customers). (Change how long logs are kept in Settings.)</p>

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
              {" "}— {count!.toLocaleString("en-IN")} entries. Old entries auto-delete each night, but you can clear space now by keeping only the most recent:
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
        <button className={tab === "aud" ? "active" : ""} onClick={() => setTab("aud")}>Audit · removals</button>
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
      {/* WHAT KIND OF THING HAPPENED + A SORT — the Audit tab's controls, brought to the feed that
          needed them more (owner, 2026-08-14: "you can able to sort in activity log such as from
          printer and all that"). Both come from /panels/auditsort.js, the same module the Audit tab
          below and the owner console and the manager panel all read, so "Printer" means the same
          set of rows on every screen. Only groups with rows get a chip. */}
      {tab === "ops" && opsChips.length > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div className="adm-tabs" role="group" aria-label="Filter by type" style={{ margin: 0, flexWrap: "wrap" }}>
            <button className={opsGroupSafe === "" ? "active" : ""} onClick={() => setOpsGroup("")}>All types</button>
            {opsChips.map((c) => (
              <button key={c.group} className={opsGroupSafe === c.group ? "active" : ""} onClick={() => setOpsGroup(c.group)}
                title={`${c.label} — ${c.count} in this view`}>
                <span aria-hidden="true">{c.icon}</span> {c.label} <span style={{ opacity: 0.65 }}>{c.count}</span>
              </button>
            ))}
          </div>
          <select value={opsSort} onChange={(e) => setOpsSort(e.target.value)} aria-label="Sort the activity log"
            style={{ marginLeft: "auto", padding: "6px 9px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12.5 }}>
            {AUDITSORT.ACTIVITY_SORTS.map((s: { id: string; label: string }) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      )}
      {tab === "aud" && (
        <>
          {/* HOW LONG THE AUDIT IS KEPT — at the top, where the log's own cleanup banner sits.
              Not styled as a warning: this is a policy control, not a problem. The note underneath
              changes with the choice, because "1 year" and "10 years" are very different promises. */}
          <div className="adm-card" style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <i className="fas fa-box-archive" style={{ color: "var(--accent)" }} aria-hidden="true" />
            <div style={{ flex: "1 1 260px", minWidth: 200 }}>
              <b style={{ fontSize: 13 }}>Keep the Audit for</b>
              <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {auditYears == null ? "…"
                  : auditYears >= 8
                    ? "Removals older than this are cleared automatically. Anything newer is kept — nothing here can be deleted by hand."
                    : `⚠ Records are normally kept 6–8 years. At ${auditYears} year${auditYears === 1 ? "" : "s"} you would no longer have the removal trail for older bills.`}
              </div>
            </div>
            <select
              value={auditYears ?? 10}
              disabled={auditYears == null}
              onChange={(e) => saveAuditYears(Number(e.target.value))}
              aria-label="How many years the Audit is kept"
              style={{ padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13, fontWeight: 700 }}
            >
              {auditYearOpts.map((y) => <option key={y} value={y}>{y} year{y === 1 ? "" : "s"}</option>)}
            </select>
            {auditYearsMsg ? <span className="adm-muted" style={{ fontSize: 11.5, flex: "1 1 100%" }}>{auditYearsMsg}</span> : null}
          </div>

          {/* WHAT IS THE LIST OF WHAT (owner, 2026-08-11) — a chip per removal type present, with
              its count, from the SAME /panels/auditsort.js the owner console and the manager panel
              use. The search here is server-side (`&q=` above), so these work on the rows that
              arrived: picking a type or re-sorting costs no request. */}
          {audChips.length > 1 && (
            <div className="own-range aud-chips" style={{ marginBottom: 10 }}>
              <button className={audKind === "" ? "on" : ""} onClick={() => setAudKind("")}>All <i>{(aud || []).length}</i></button>
              {audChips.map((c) => (
                <button key={c.kind} className={audKind === c.kind ? "on" : ""} onClick={() => setAudKind(c.kind)} title={`Show only: ${c.label}`}>
                  <span aria-hidden="true">{c.icon}</span> {c.label} <i>{c.count}</i>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a dish, person or reason…"
              aria-label="Search the removals record"
              style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <span className="adm-muted">Sort</span>
              <select value={audSort} onChange={(e) => setAudSort(e.target.value)} aria-label="Sort the removals record"
                style={{ padding: "7px 8px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}>
                {AUDITSORT.SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <button className="adm-btn" onClick={() => loadAud()}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>
          </div>
        </>
      )}
      {tab === "cust" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="adm-btn" onClick={() => loadCust()}><i className="fas fa-rotate-right" aria-hidden="true" /> Refresh</button>
        </div>
      )}

      {tab === "ops"
        ? <OpsTable rows={opsRows} err={opsErr} onRetry={loadOps} scopedName={scopedName || null} capped={(ops?.length ?? 0) >= FEED_LIMIT} onSendToClaude={sendToClaude} onResolve={markResolved} />
        : tab === "aud"
        ? <AudTable rows={audRows} err={audErr} onRetry={loadAud} scopedName={scopedName || null} capped={(aud?.length ?? 0) >= FEED_LIMIT} onOpenRemoval={setRemovalId} />
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

      {/* Click a removal → the whole story: which KOT, every item on it, the totals, the time and
          day, who did it and at which restaurant. Admin-only extra: the button to put a deleted
          bill back. The OWNER sees the identical panel from /api/owner/audit, which is GET-only and
          never offers that button (owner rule, 2026-08-04: they can see everything, change nothing). */}
      {removalId != null && (
        <RemovalDetailModal id={removalId} base="/api/admin/audit" onClose={() => setRemovalId(null)} onRestored={loadAud} />
      )}
    </>
  );
}

function OpsTable({ rows, err, onRetry, scopedName, capped, onSendToClaude, onResolve }: { rows: Action[] | null; err: boolean; onRetry: () => void; scopedName: string | null; capped: boolean; onSendToClaude: (a: Action) => void; onResolve: (a: Action, resolved: boolean) => void }) {
  const cols = "92px 1fr auto";
  // Which row's full detail popup is open (every row is clickable → the organized detail card).
  const [detailRow, setDetailRow] = useState<Action | null>(null);
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the operations log. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (rows === null) return <SkelList rows={6} label="Loading log" />;
  if (rows.length === 0) return <div className="adm-empty">No staff actions {scopedName ? `for ${scopedName}` : "yet"}.</div>;
  return (
    <>
    <div className="adm-logwrap">
      <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Panel</div><div>Action</div><div>When</div></div>
      {rows.map((a) => {
        const isErr = a.level === "error";
        const isWarn = a.level === "warn";
        // A resolved error stops showing red (owner 2026-07-24) — it renders neutral/muted with a
        // "Resolved" tag, and offers "Reopen" instead of "Mark resolved". `seen_at` is a separate
        // state (drives the notification bell), never the log colour.
        const isResolved = isErr && !!a.resolved_at;
        const showRed = isErr && !isResolved;
        // A row is expandable when it carries detail longer than fits on one line, or is a
        // tap-batch / error worth reading in full.
        // Errors keep their raw text (stack/where matters); everything else (esp. tap batches)
        // is shown in plain English via the shared formatter.
        const det = isErr ? (a.detail || "") : formatActionDetail(a.action, a.detail);
        // On a TABLET row, `actor` is the manager whose PIN unlocked the action (no per-person
        // tablet login exists) — except a person's own login/profile actions. A name with
        // " / " = a PIN shared by >1 manager → ambiguous.
        const isTabletPin = isManagerPinRow(a);
        const pinShared = isTabletPin && String(a.actor).includes(" / ");
        return (
          <div
            key={a.id}
            className="adm-logrow"
            role="button"
            tabIndex={0}
            onClick={() => setDetailRow(a)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailRow(a); } }}
            style={{
              gridTemplateColumns: cols,
              cursor: "pointer",
              // Tint the whole row by severity so unresolved errors jump out; a resolved error
              // (showRed=false) drops back to neutral so it no longer reads as a live problem.
              background: showRed ? "color-mix(in srgb, var(--adm-danger) 12%, transparent)" : isWarn ? "color-mix(in srgb, var(--adm-warn) 8%, transparent)" : undefined,
              borderLeft: showRed ? "3px solid var(--adm-danger)" : isWarn ? "3px solid var(--adm-warn)" : "3px solid transparent",
              opacity: isResolved ? 0.62 : 1,
            }}
          >
            <div><span className="adm-chip" style={panelChipStyle(a.panel)}>{panelLabel(a.panel)}</span></div>
            <div style={{ minWidth: 0 }}>
              <span style={{ color: showRed ? "var(--adm-danger)" : undefined, fontWeight: isErr ? 600 : undefined, textDecoration: isResolved ? "line-through" : undefined }}>{actLabel(a.action)}</span>
              {isResolved && <span className="adm-chip" style={{ marginLeft: 6, background: "color-mix(in srgb, var(--adm-ok, #16a34a) 20%, transparent)", color: "var(--adm-ok, #16a34a)", fontWeight: 700 }}><i className="fas fa-check" aria-hidden="true" style={{ marginRight: 4 }} />Resolved</span>}
              {isTabletPin
                ? <span className="adm-chip" title={pinShared ? "PIN shared by these managers — any could have entered it" : "Unlocked by this manager's PIN"}
                    style={{ marginLeft: 6, fontWeight: 700, background: pinShared ? "color-mix(in srgb, var(--adm-warn) 20%, transparent)" : "color-mix(in srgb, #d4af37 20%, transparent)", ["--hue" as string]: pinShared ? "var(--adm-warn)" : "#d4af37" }}>🔑 {a.actor}</span>
                : a.actor_id === ADMIN_VIEW_ACTOR_ID
                ? <span className="adm-chip" title="You did this from an admin panel view — staff and owner logs show it as a plain panel action"
                    style={{ marginLeft: 6, fontWeight: 700, background: "color-mix(in srgb, #6b7280 20%, transparent)", color: "var(--adm-muted, #8b919c)" }}><i className="fas fa-user-shield" aria-hidden="true" style={{ marginRight: 4 }} />Admin</span>
                : a.actor ? <span className="adm-muted"> · {a.actor}</span> : ""}
              {a.table_number && (isTabletPin || !a.actor) ? <span className="adm-muted"> · Table {a.table_number}</span> : ""}
              {det ? <span className="adm-muted"> · {det.length > 60 ? det.slice(0, 60) + "…" : det}</span> : null}
              {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
              {isErr && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <button
                    className="adm-btn"
                    onClick={(e) => { e.stopPropagation(); onSendToClaude(a); }}
                    style={{ fontSize: 11.5, padding: "3px 9px" }}
                  >
                    <i className="fas fa-robot" aria-hidden="true" style={{ marginRight: 5 }} />Send to Claude
                  </button>
                  {isResolved ? (
                    <button
                      className="adm-btn"
                      onClick={(e) => { e.stopPropagation(); onResolve(a, false); }}
                      style={{ fontSize: 11.5, padding: "3px 9px" }}
                    >
                      <i className="fas fa-rotate-left" aria-hidden="true" style={{ marginRight: 5 }} />Reopen
                    </button>
                  ) : (
                    <button
                      className="adm-btn"
                      onClick={(e) => { e.stopPropagation(); onResolve(a, true); }}
                      style={{ fontSize: 11.5, padding: "3px 9px" }}
                    >
                      <i className="fas fa-check" aria-hidden="true" style={{ marginRight: 5 }} />Mark resolved
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="adm-when">{timeAgo(a.created_at)}</div>
          </div>
        );
      })}
    </div>
    {capped && <FeedCap what="staff actions" />}
    {detailRow && <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </>
  );
}

// The Removals record — every restaurant's deletion_audit rows, with the restaurant named
// on each row so "All restaurants" is never ambiguous.
function AudTable({ rows, err, onRetry, scopedName, capped, onOpenRemoval }: { rows: Removal[] | null; err: boolean; onRetry: () => void; scopedName: string | null; capped: boolean; onOpenRemoval: (id: number) => void }) {
  const cols = "1.4fr 1fr auto";
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the removals record. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (rows === null) return <SkelList rows={6} label="Loading removals" />;
  if (rows.length === 0) return <div className="adm-empty">Nothing has been removed {scopedName ? `at ${scopedName}` : "yet"} — this list fills itself as it happens.</div>;
  return (
    <>
      <div className="adm-logwrap aud-stack">
      <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>What was removed</div><div>Why · by whom</div><div>When</div></div>
      {rows.map((r) => {
        const [ico, label] = REMOVAL_KIND[r.kind] || ["•", r.kind];
        const bits = [
          r.table_number ? `Table ${r.table_number}` : "",
          r.kot_no != null ? `KOT #${r.kot_no}` : "",
          r.bill_no != null ? `Bill #${r.bill_no}` : "",
          r.invoice_no ? `Invoice ${r.invoice_no}` : "",
          r.item_title ? `${r.item_title}${(r.qty || 0) > 1 ? ` ×${r.qty}` : ""}` : "",
          r.amount != null ? inr(parseFloat(String(r.amount)) || 0) : "",
        ].filter(Boolean).join(" · ");
        const reason = [r.reason_code ? REMOVAL_REASON[r.reason_code] || r.reason_code : "", r.reason_note || ""].filter(Boolean).join(" — ") || "no reason recorded";
        return (
          <div
            key={r.id} className="adm-logrow" style={{ gridTemplateColumns: cols, cursor: "pointer" }}
            role="button" tabIndex={0}
            title="See exactly what was removed"
            onClick={() => onOpenRemoval(r.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenRemoval(r.id); } }}
          >
            <div style={{ minWidth: 0 }}>
              <span aria-hidden="true" style={{ marginRight: 6 }}>{ico}</span>
              <b>{label}</b>
              {bits ? <span className="adm-muted"> · {bits}</span> : null}
              {r.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{r.restaurant_name}</span> : null}
            </div>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13 }}>{reason}</span>
              <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1 }}>{r.actor || "—"}{r.actor_role ? ` · ${r.actor_role}` : ""}</span>
            </div>
            <div className="adm-when">{timeAgo(r.at)}</div>
          </div>
        );
      })}
      </div>
      {capped && <FeedCap what="removals" />}
    </>
  );
}

// "This list is the newest N, not all of them." A truncated feed that says nothing is the reason
// the admin can believe he has read everything (T17 sweep, 2026-08-19).
function FeedCap({ what }: { what: string }) {
  return (
    <p className="adm-muted" style={{ fontSize: 12, margin: "8px 2px 0" }}>
      <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6, opacity: 0.7 }} />
      Showing the {FEED_LIMIT} most recent {what} — there are older ones. Narrow it with the
      restaurant filter or the search to see further back.
    </p>
  );
}

function CustTable({ data, err, onRetry }: { data: CustData | null; err: boolean; onRetry: () => void }) {
  if (err) return <div className="adm-empty">Couldn&rsquo;t load the customer log. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button></div>;
  if (data === null) return <SkelList rows={6} label="Loading log" />;
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
