"use client";
// Owner · Audit & logs (owner, 2026-08-02 — was "Activity"). Two views in one page:
//
//   • AUDIT (removals) — everything taken out of the system across your restaurant(s):
//     a cancelled KOT, a deleted bill, a dish off an order or off the menu, with the
//     reason and the person (deletion_audit, mig 251). The DEFAULT view: it is the one
//     an owner comes here to answer ("who took that off, and why?").
//   • ACTIVITY LOG — everything your staff did: orders accepted/served, tables opened/
//     closed, bills settled, discounts, and (for a tablet action) which manager's PIN
//     unlocked it. Click ANY row for the full organized detail — the same popup the
//     admin and manager panels use.
//
// Each view is a sub-option on the Access screen (Owner's menu → Audit & logs), so a
// view the admin switched off is ABSENT here — and its endpoint refuses too (the
// server answers 403 + disabled:true; hiding is never the only guard).
//
// Scoped server-side by ownerScope (only this owner's restaurants; money is NOT hidden —
// it's your own data). A 60s backstop refresh (paused while the tab is hidden) keeps new
// rows appearing without a manual Refresh; no faster poll (egress rule).
import { useCallback, useEffect, useState } from "react";
import { actLabel, panelChipStyle, timeAgo, inr, formatActionDetail, isManagerPinRow, type Action } from "@/components/admin/shared";
import { LogDetailModal } from "@/components/admin/LogDetailModal";
import { RemovalDetailModal } from "@/components/admin/RemovalDetail";
import { asValue } from "@/lib/ownerPin";

// One row of the Removals record — same wording as the manager panel's Removals screen
// (AUDIT_KIND / REMOVAL_REASONS in public/panels/editor/app.js), so the two panels never
// describe the same row differently.
type Removal = {
  id: number; at: string; kind: string; reason_code: string | null; reason_note: string | null;
  actor: string | null; actor_role: string | null; table_number: string | null;
  bill_no: number | null; invoice_no: string | null; kot_no: number | null;
  item_title: string | null; qty: number | null; amount: string | number | null;
  restaurant_id: string | null; restaurant_name: string | null;
};
const REMOVAL_KIND: Record<string, [string, string]> = {
  order_cancelled: ["🎫", "KOT cancelled"],
  order_deleted: ["🧾", "Bill deleted"],
  dish_removed: ["🍽", "Dish removed from an order"],
  menu_item_deleted: ["📕", "Menu item deleted"],
  invoice_voided: ["↩️", "Invoice voided (reopened)"],
  qty_reduced: ["➖", "Quantity reduced"],
  discount_given: ["％", "Discount given"],
  payment_reverted: ["↺", "Payment reverted"],
  on_the_house: ["🎁", "On the house"],
};
const REMOVAL_REASON: Record<string, string> = {
  mistake: "By mistake",
  guest_changed: "Guest changed their mind",
  wrong_table: "Wrong table",
  sold_out: "Not available / sold out",
  kitchen_error: "Kitchen error",
  other: "Other reason",
};

export default function OwnerAuditLogs() {
  // Admin-in-one-restaurant scope pin (?rid=) — rides on every call as ?scope= so a second
  // tab's shared act-as cookie can't repoint this one. Null for a real owner.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  // Which view is showing. "audit" is the default; if the server says that view is switched
  // off for this owner (403 + disabled), the page falls over to the other one on its own.
  const [view, setView] = useState<"audit" | "activity">("audit");
  const [audDisabled, setAudDisabled] = useState(false);
  const [actDisabled, setActDisabled] = useState(false);

  // ── Audit (removals) state ────────────────────────────────────────────────
  const [removals, setRemovals] = useState<Removal[] | null>(null);
  const [removalId, setRemovalId] = useState<number | null>(null);   // which removal is open in full
  const [audErr, setAudErr] = useState<string | null>(null);
  const [audQ, setAudQ] = useState("");

  // ── Activity state ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [detailRow, setDetailRow] = useState<Action | null>(null);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const scopeParams = useCallback(() => {
    const params = new URLSearchParams();
    // scope = the admin act-as auth pin (per-tab, can't be hijacked); rid = the narrowing
    // filter so a single selected restaurant shows ONLY its own rows (mirrors the Reports
    // page, which sends both). Without rid the server falls back to the owner's full set.
    if (scopePin) { params.set("scope", scopePin); params.set("rid", scopePin); const a = asValue(); if (a) params.set("as", a); }
    return params;
  }, [scopePin]);

  const loadAudit = useCallback(async () => {
    const qs = scopeParams().toString();
    try {
      const j = await (await fetch(`/api/owner/audit${qs ? "?" + qs : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setAudDisabled(true); setView((v) => (v === "audit" ? "activity" : v)); return; }
      if (j.error) throw new Error(j.error);
      setRemovals(j.removals || []); setAudErr(null);
    } catch (e) { setAudErr(e instanceof Error ? e.message : String(e)); }
  }, [scopeParams]);

  const loadActivity = useCallback(async () => {
    const params = scopeParams();
    if (level) params.set("level", level);
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    const qs = params.toString();
    try {
      const j = await (await fetch(`/api/owner/oplog${qs ? "?" + qs : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setActDisabled(true); setView((v) => (v === "activity" ? "audit" : v)); return; }
      if (j.error) throw new Error(j.error);
      setRows(j.actions || []); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopeParams, level, qDebounced]);

  // Both views load once up front — that is also how the page learns which views this
  // owner even HAS (a disabled answer hides its chip). Two small, capped reads.
  useEffect(() => { setRemovals(null); loadAudit(); }, [loadAudit]);
  useEffect(() => { setRows(null); loadActivity(); }, [loadActivity]);

  // 60s backstop refresh of the view on screen, paused while the tab is hidden (egress-safe).
  useEffect(() => {
    const reload = () => { if (view === "audit") loadAudit(); else loadActivity(); };
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) reload(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { reload(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [view, loadAudit, loadActivity]);

  const bothOff = audDisabled && actDisabled;

  return (
    <>
      <h1 className="adm-page-h">Audit &amp; logs</h1>
      <p className="adm-page-sub">What was removed and why — and everything your staff did, line by line.</p>

      {/* View switch — only the views this restaurant's Access settings allow are offered. */}
      {!bothOff && (
        <div className="own-range" style={{ marginBottom: 12 }}>
          {!audDisabled && <button className={view === "audit" ? "on" : ""} onClick={() => setView("audit")}>🗑 Audit · removals</button>}
          {!actDisabled && <button className={view === "activity" ? "on" : ""} onClick={() => setView("activity")}>📜 Activity log</button>}
        </div>
      )}

      {bothOff ? (
        <div className="adm-card"><div className="adm-empty">Audit &amp; logs isn&rsquo;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : view === "audit" && !audDisabled ? (
        <AuditView removals={removals} err={audErr} q={audQ} setQ={setAudQ} onReload={loadAudit} onOpenRemoval={setRemovalId} />
      ) : (
        <ActivityView rows={rows} err={err} level={level} setLevel={setLevel} q={q} setQ={setQ} onReload={loadActivity} onOpen={setDetailRow} />
      )}

      {detailRow && <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
      {/* Click a removal → the whole story: which KOT, every item on it, the totals, the time and
          day, who did it. The owner SEES everything and changes nothing — /api/owner/audit is
          GET-only and always answers canRestore:false (owner rule, 2026-08-04). */}
      {removalId != null && (
        <RemovalDetailModal id={removalId} base="/api/owner/audit" onClose={() => setRemovalId(null)} />
      )}
    </>
  );
}

// ── Audit (removals) ─────────────────────────────────────────────────────────
function AuditView({ removals, err, q, setQ, onReload, onOpenRemoval }: {
  removals: Removal[] | null; err: string | null; q: string; setQ: (v: string) => void; onReload: () => void;
  onOpenRemoval: (id: number) => void;
}) {
  // Client-side search over what's on screen (the feed is already capped server-side).
  const needle = q.toLowerCase().trim();
  const match = (r: Removal) => !needle || [
    r.kot_no != null ? `kot ${r.kot_no}` : "", r.bill_no != null ? `bill ${r.bill_no}` : "",
    r.table_number ? `table ${r.table_number}` : "", r.item_title, r.actor, r.reason_note,
    r.reason_code ? REMOVAL_REASON[r.reason_code] : "", (REMOVAL_KIND[r.kind] || [])[1], r.restaurant_name,
  ].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  const list = (removals || []).filter(match);
  const cols = "1.4fr 1fr auto";

  return (
    <div className="adm-card">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a KOT, bill, table, dish, person or reason…"
          aria-label="Search the removals record"
          style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
        />
        <button className="adm-btn" onClick={onReload}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
      </div>

      {err && removals === null ? (
        <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
          Couldn&apos;t load the removals record — this is a loading error, not &ldquo;nothing was removed.&rdquo;{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={onReload}>Try again</button>
        </div>
      ) : removals === null ? (
        <div className="adm-empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">{needle ? "Nothing matches that." : "Nothing has been removed yet — this list fills itself as it happens."}</div>
      ) : (
        <div className="adm-logwrap">
          <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>What was removed</div><div>Why · by whom</div><div>When</div></div>
          {list.map((r) => {
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
      )}
    </div>
  );
}

// ── Activity log (unchanged behaviour — severity chips, search, click for detail) ──
function ActivityView({ rows, err, level, setLevel, q, setQ, onReload, onOpen }: {
  rows: Action[] | null; err: string | null;
  level: "" | "error" | "warn" | "info"; setLevel: (v: "" | "error" | "warn" | "info") => void;
  q: string; setQ: (v: string) => void; onReload: () => void; onOpen: (a: Action) => void;
}) {
  const cols = "88px 1fr auto";
  return (
    <div className="adm-card">
      {/* Severity filter + search + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="own-range" style={{ margin: 0 }}>
          <button className={level === "" ? "on" : ""} onClick={() => setLevel("")}>All</button>
          {/* No "Errors" filter here: raw app/system faults (level='error') are technical
              support signals, not for the owner — they're excluded server-side in
              /api/owner/oplog and surface only on the admin side (owner 2026-07-26). */}
          <button className={level === "warn" ? "on" : ""} onClick={() => setLevel("warn")}>Notable</button>
          <button className={level === "info" ? "on" : ""} onClick={() => setLevel("info")}>Info</button>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search action or detail…"
          aria-label="Search the activity log"
          style={{ flex: "1 1 200px", minWidth: 160, padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
        />
        <button className="adm-btn" onClick={onReload}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
      </div>

      {err && rows === null ? (
        <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
          Couldn&apos;t load your activity — this is a loading error, not &ldquo;nothing happened.&rdquo;{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={onReload}>Try again</button>
        </div>
      ) : rows === null ? (
        <div className="adm-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="adm-empty">No staff activity yet — it appears here as your team works.</div>
      ) : (
        <div className="adm-logwrap">
          <div className="adm-logrow head" style={{ gridTemplateColumns: cols }}><div>Panel</div><div>Action</div><div>When</div></div>
          {rows.map((a) => {
            const isErr = a.level === "error";
            const isWarn = a.level === "warn";
            const isResolved = isErr && !!a.resolved_at;
            const showRed = isErr && !isResolved;
            const det = isErr ? (a.detail || "") : formatActionDetail(a.action, a.detail);
            // A non-empty actor on a tablet row = the manager whose PIN unlocked it (except
            // the person's own login/profile actions).
            const isPin = isManagerPinRow(a);
            const pinShared = isPin && String(a.actor).includes(" / ");
            return (
              <div
                key={a.id}
                className="adm-logrow"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(a)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a); } }}
                style={{
                  gridTemplateColumns: cols,
                  cursor: "pointer",
                  background: showRed ? "color-mix(in srgb, var(--adm-danger) 12%, transparent)" : isWarn ? "color-mix(in srgb, var(--adm-warn) 8%, transparent)" : undefined,
                  borderLeft: showRed ? "3px solid var(--adm-danger)" : isWarn ? "3px solid var(--adm-warn)" : "3px solid transparent",
                  opacity: isResolved ? 0.62 : 1,
                }}
              >
                <div><span className="adm-chip" style={panelChipStyle(a.panel)}>{a.panel}</span></div>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: showRed ? "var(--adm-danger)" : undefined, fontWeight: isErr ? 600 : undefined, textDecoration: isResolved ? "line-through" : undefined }}>{actLabel(a.action)}</span>
                  {isPin
                    ? <span className="adm-chip" title={pinShared ? "PIN shared by these managers — any could have entered it" : "Unlocked by this manager's PIN"}
                        style={{ marginLeft: 6, fontWeight: 700, background: pinShared ? "color-mix(in srgb, var(--adm-warn) 20%, transparent)" : "color-mix(in srgb, #d4af37 20%, transparent)", color: pinShared ? "var(--adm-warn)" : "#d4af37" }}>🔑 {a.actor}</span>
                    : a.actor ? <span className="adm-muted"> · {a.actor}</span> : ""}
                  {a.table_number && (isPin || !a.actor) ? <span className="adm-muted"> · Table {a.table_number}</span> : ""}
                  {det ? <span className="adm-muted"> · {det.length > 60 ? det.slice(0, 60) + "…" : det}</span> : null}
                  {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
                </div>
                <div className="adm-when">{timeAgo(a.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
