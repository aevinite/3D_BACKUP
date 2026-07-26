"use client";
// Owner · Activity — the log of everything your staff did across your restaurant(s):
// orders accepted/served, tables opened/closed, bills settled, discounts, and (for a
// tablet action) which manager's PIN unlocked it. Click ANY row for the full organized
// detail (who, when, how, the manager PIN when one was used) — the same popup the admin
// and manager panels use.
//
// Scoped server-side by ownerScope (only this owner's restaurants; money is NOT hidden —
// it's your own data). A 60s backstop refresh (paused while the tab is hidden) keeps new
// actions appearing without a manual Refresh; no faster poll (egress rule).
import { useCallback, useEffect, useState } from "react";
import { ACT_LABEL, PANEL_COLOR, timeAgo, formatActionDetail, isManagerPinRow, type Action } from "@/components/admin/shared";
import { LogDetailModal } from "@/components/admin/LogDetailModal";
import { asValue } from "@/lib/ownerPin";

export default function OwnerActivity() {
  // Admin-in-one-restaurant scope pin (?rid=) — rides on every call as ?scope= so a second
  // tab's shared act-as cookie can't repoint this one. Null for a real owner.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  const [rows, setRows] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [level, setLevel] = useState<"" | "error" | "warn" | "info">("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [detailRow, setDetailRow] = useState<Action | null>(null);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    // scope = the admin act-as auth pin (per-tab, can't be hijacked); rid = the narrowing
    // filter so a single selected restaurant shows ONLY its own rows (mirrors the Reports
    // page, which sends both). Without rid the server falls back to the owner's full set.
    if (scopePin) { params.set("scope", scopePin); params.set("rid", scopePin); const a = asValue(); if (a) params.set("as", a); }
    if (level) params.set("level", level);
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    const qs = params.toString();
    try {
      const j = await (await fetch(`/api/owner/oplog${qs ? "?" + qs : ""}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setRows(j.actions || []); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopePin, level, qDebounced]);

  useEffect(() => { setRows(null); load(); }, [load]);

  // 60s backstop refresh, paused while the tab is hidden (egress-safe).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) load(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const cols = "88px 1fr auto";

  return (
    <>
      <h1 className="adm-page-h">Activity</h1>
      <p className="adm-page-sub">Everything your staff did — tap any line for who did it, when, and how.</p>

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
          <button className="adm-btn" onClick={load}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
        </div>

        {err && rows === null ? (
          <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
            Couldn&apos;t load your activity — this is a loading error, not &ldquo;nothing happened.&rdquo;{" "}
            <button className="adm-btn" style={{ marginLeft: 6 }} onClick={load}>Try again</button>
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
                  onClick={() => setDetailRow(a)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailRow(a); } }}
                  style={{
                    gridTemplateColumns: cols,
                    cursor: "pointer",
                    background: showRed ? "color-mix(in srgb, var(--adm-danger) 12%, transparent)" : isWarn ? "color-mix(in srgb, var(--adm-warn) 8%, transparent)" : undefined,
                    borderLeft: showRed ? "3px solid var(--adm-danger)" : isWarn ? "3px solid var(--adm-warn)" : "3px solid transparent",
                    opacity: isResolved ? 0.62 : 1,
                  }}
                >
                  <div><span className="adm-chip" style={{ background: "color-mix(in srgb, " + (PANEL_COLOR[a.panel] || "#888") + " 22%, transparent)", color: PANEL_COLOR[a.panel] || "var(--muted)" }}>{a.panel}</span></div>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: showRed ? "var(--adm-danger)" : undefined, fontWeight: isErr ? 600 : undefined, textDecoration: isResolved ? "line-through" : undefined }}>{ACT_LABEL[a.action] || a.action}</span>
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

      {detailRow && <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </>
  );
}
