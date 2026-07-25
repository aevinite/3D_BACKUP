"use client";
// Owner · Feedback & issues — TWO tabs:
//   · Guest ratings — the star-ratings diners leave (feedback table). View the average
//     + distribution, read comments, and mark each one handled / add an internal note.
//   · Staff issues — problems staff flagged; resolve/reopen inline.
// Both are scoped server-side (ownerScope) and gated by their admin entitlement
// (ratings / issues) — a tab hides itself if the admin switched that section off.
// A 60s backstop refresh (paused while the tab is hidden) keeps new items appearing
// without a manual Refresh; no faster poll (egress rule).
import { useCallback, useEffect, useRef, useState } from "react";
import { asSuffix } from "@/lib/ownerPin";

type Issue = {
  id: string; restaurant_id: string; restaurantName: string;
  subject: string; body: string | null; raised_by: string | null; raised_role: string | null;
  status: string; created_at: string; resolved_at: string | null;
  // Optional attachments a staffer added when raising the ticket (mig 150). The API
  // already returns these; the owner page must SHOW them like the admin panel does.
  image_url: string | null; audio_url: string | null;
};
type Rating = {
  id: string; restaurant_id: string; restaurantName: string; order_id: string;
  table_number: string | null; rating: number; comment: string | null; name: string | null;
  created_at: string; acknowledged: boolean; acknowledged_at: string | null;
  acknowledged_by: string | null; staff_note: string | null;
};
type Summary = { total: number; avg: number; dist: number[]; unhandled: number };

const wrap: React.CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word" };
const IST = "Asia/Kolkata"; // every date shown here is in India time, like the rest of the panel
const Stars = ({ n }: { n: number }) => (
  <span aria-label={`${n} out of 5`} style={{ color: "#f5a623", letterSpacing: 1 }}>
    {"★".repeat(n)}<span style={{ color: "var(--border, #ccc)" }}>{"★".repeat(5 - n)}</span>
  </span>
);

export default function OwnerFeedback() {
  const [tab, setTab] = useState<"ratings" | "issues">("ratings");
  // Admin-in-one-restaurant scope pin (bug C1) — rides on EVERY call as ?scope= so a
  // second tab's shared act-as cookie can't hijack this tab. Null for a real owner.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const scp = scopePin ? `?scope=${scopePin}${asSuffix()}` : "";

  // ── Ratings ──
  const [ratings, setRatings] = useState<Rating[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rFilter, setRFilter] = useState<"all" | "unhandled">("all");
  const [ratingsOff, setRatingsOff] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null); // ratings load failed (vs genuinely empty)
  // ── Issues ──
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [iFilter, setIFilter] = useState<"open" | "all">("open");
  const [issuesOff, setIssuesOff] = useState(false);
  const [iErr, setIErr] = useState<string | null>(null); // issues load failed (vs genuinely empty)

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState("");
  const decided = useRef(false); // pick the first available tab only once

  const loadRatings = useCallback(async () => {
    try {
      // On the "To handle" filter, ask the SERVER for unhandled rows so any older than the
      // newest 200 stay reachable + actionable (they were invisible before; audit 2026-07-07).
      const suffix = rFilter === "unhandled" ? (scp ? `${scp}&filter=unhandled` : "?filter=unhandled") : scp;
      const j = await (await fetch(`/api/owner/ratings${suffix}`, { cache: "no-store" })).json();
      if (j.disabled) { setRatingsOff(true); return; }
      if (j.error) throw new Error(j.error);
      setRatings(j.ratings || []); setSummary(j.summary || null); setRErr(null); setErr(null);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m); setRErr(m); }
  }, [scp, rFilter]);

  const loadIssues = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/issues${scp}`, { cache: "no-store" })).json();
      if (j.disabled) { setIssuesOff(true); return; }
      if (j.error) throw new Error(j.error);
      setIssues(j.issues || []); setIErr(null); setErr(null);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m); setIErr(m); }
  }, [scp]);

  const loadAll = useCallback(async () => { await Promise.all([loadRatings(), loadIssues()]); }, [loadRatings, loadIssues]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // Default to the first available tab once we know what's enabled.
  useEffect(() => {
    if (decided.current) return;
    if (ratingsOff && !issuesOff) { setTab("issues"); decided.current = true; }
    else if (!ratingsOff) { decided.current = true; }
  }, [ratingsOff, issuesOff]);

  // 60s backstop refresh, paused while the tab is hidden (egress-safe).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) loadAll(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { loadAll(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [loadAll]);

  const ackRating = async (id: string, acknowledged: boolean) => {
    setBusy(id);
    setRatings((cur) => (cur || []).map((r) => (r.id === id ? { ...r, acknowledged } : r)));
    // Keep the "To handle · N" badge in step with the optimistic row change, so the count
    // doesn't lag a beat behind until loadRatings() returns (audit 2026-07-07). Only when the
    // handled state actually flips, and never below zero.
    setSummary((s) => {
      if (!s) return s;
      const was = (ratings || []).find((r) => r.id === id)?.acknowledged;
      if (was === acknowledged) return s;
      return { ...s, unhandled: Math.max(0, s.unhandled + (acknowledged ? -1 : 1)) };
    });
    try {
      const res = await fetch(`/api/owner/ratings${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, acknowledged }) });
      // Don't let a failed write pretend it worked: surface the error (the reload below
      // then restores the true state instead of leaving a false optimistic tick).
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Couldn't save — please try again."); }
      setErr(null); await loadRatings();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await loadRatings(); }
    finally { setBusy(null); }
  };
  const saveNote = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/owner/ratings${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, note: noteVal }) });
      // Only close the editor + clear the box AFTER the save actually succeeds — otherwise
      // a failed PATCH used to wipe the note the owner typed with no warning.
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Couldn't save your note — please try again."); }
      setErr(null); setNoteFor(null); setNoteVal(""); await loadRatings();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const setIssueStatus = async (id: string, status: "open" | "resolved") => {
    setBusy(id);
    const prev = status === "resolved" ? "open" : "resolved";
    setIssues((cur) => (cur || []).map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      const res = await fetch(`/api/owner/issues${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      // A failed Resolve/Reopen must not silently revert: roll the row back and tell the owner.
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Couldn't update — please try again."); }
      setErr(null); await loadIssues();
    } catch (e) {
      setIssues((cur) => (cur || []).map((i) => (i.id === id ? { ...i, status: prev } : i)));
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const openCount = (issues || []).filter((i) => i.status === "open").length;
  const issueRows = (issues || []).filter((i) => iFilter === "all" || i.status === "open");
  const ratingRows = (ratings || []).filter((r) => rFilter === "all" || !r.acknowledged);
  const bothOff = ratingsOff && issuesOff;

  return (
    <>
      <h1 className="adm-page-h">Feedback &amp; issues</h1>
      <p className="adm-page-sub">What your guests rated and what your staff flagged — read it, handle it, mark it done.</p>

      {bothOff ? (
        <div className="adm-card"><div className="adm-empty">This section isn&apos;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : (
      <div className="adm-card">
        {/* Tabs (hide a tab the admin switched off) */}
        <div className="own-range" style={{ marginBottom: 14 }}>
          {!ratingsOff && <button className={tab === "ratings" ? "on" : ""} onClick={() => setTab("ratings")}>Guest ratings{summary ? ` · ${summary.total}` : ""}</button>}
          {!issuesOff && <button className={tab === "issues" ? "on" : ""} onClick={() => setTab("issues")}>Staff issues · {openCount}</button>}
          <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={loadAll}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
        </div>

        {err && (
          <div className="adm-card" style={{ borderColor: "var(--adm-danger)", margin: "0 0 12px" }}>
            <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
            <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadAll}>Try again</button>
          </div>
        )}

        {/* ───────── RATINGS TAB ───────── */}
        {tab === "ratings" && !ratingsOff && (
          rErr && ratings === null ? (
            <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
              Couldn&apos;t load your ratings — this is a loading error, not &ldquo;no ratings.&rdquo;{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadRatings}>Try again</button>
            </div>
          ) : summary === null && ratings === null ? (
            <div className="adm-empty">Loading ratings…</div>
          ) : (summary?.total || 0) === 0 ? (
            <div className="adm-empty">No guest ratings yet. They appear here after diners rate a bill.</div>
          ) : (
            <>
              {/* Summary: average + distribution */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
                <div style={{ textAlign: "center", minWidth: 110 }}>
                  <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{summary!.avg.toFixed(1)}</div>
                  <div style={{ fontSize: 18 }}><Stars n={Math.round(summary!.avg)} /></div>
                  <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{summary!.total} rating{summary!.total === 1 ? "" : "s"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {[5, 4, 3, 2, 1].map((star) => {
                    const c = summary!.dist[star - 1] || 0;
                    const pct = summary!.total ? Math.round((c / summary!.total) * 100) : 0;
                    return (
                      <div key={star} style={{ display: "flex", alignItems: "center", gap: 8, margin: "3px 0", fontSize: 12.5 }}>
                        <span style={{ width: 12, textAlign: "right" }}>{star}</span>
                        <i className="fas fa-star" style={{ color: "#f5a623", fontSize: 11 }} aria-hidden="true" />
                        <span style={{ flex: 1, height: 8, background: "var(--border,#e5e7eb)", borderRadius: 5, overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "#f5a623" }} />
                        </span>
                        <span className="adm-muted" style={{ width: 34, textAlign: "right" }}>{c}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="own-range" style={{ marginBottom: 12 }}>
                <button className={rFilter === "all" ? "on" : ""} onClick={() => setRFilter("all")}>All</button>
                <button className={rFilter === "unhandled" ? "on" : ""} onClick={() => setRFilter("unhandled")}>To handle · {summary!.unhandled}</button>
              </div>

              {ratingRows.length === 0 ? (
                <div className="adm-empty">{rFilter === "unhandled" ? "Nothing left to handle — nice. 🎉" : "No ratings."}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {ratingRows.map((r) => {
                    const low = r.rating <= 2;
                    const col = low ? "var(--adm-danger, #e5484d)" : r.rating === 3 ? "#f59e0b" : "var(--adm-ok, #16a34a)";
                    return (
                      <div key={r.id} className="adm-card" style={{ margin: 0, borderLeft: `4px solid ${col}`, opacity: r.acknowledged ? 0.72 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15 }}><Stars n={r.rating} /></span>
                          <span className="adm-chip">{r.restaurantName}</span>
                          {r.table_number && <span className="adm-chip">Table {r.table_number}</span>}
                          {r.acknowledged && <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 16%, transparent)", color: "var(--adm-ok,#16a34a)" }}>handled</span>}
                          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                            <button className="adm-btn" disabled={busy === r.id} onClick={() => { setNoteFor(noteFor === r.id ? null : r.id); setNoteVal(r.staff_note || ""); }}><i className="fas fa-pen" aria-hidden="true" /> Note</button>
                            {r.acknowledged
                              ? <button className="adm-btn" disabled={busy === r.id} onClick={() => ackRating(r.id, false)}><i className="fas fa-rotate-left" aria-hidden="true" /> Reopen</button>
                              : <button className="adm-btn" disabled={busy === r.id} onClick={() => ackRating(r.id, true)}><i className="fas fa-check" aria-hidden="true" /> Mark handled</button>}
                          </span>
                        </div>
                        {r.comment && <p style={{ margin: "8px 0 0", color: "var(--text)", fontSize: 13, lineHeight: 1.5, ...wrap }}>“{r.comment}”</p>}
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", ...wrap }}>
                          {r.name ? <b>{r.name}</b> : <span>Guest</span>} · {new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: IST })}
                          {r.acknowledged && r.acknowledged_by ? ` · handled by ${r.acknowledged_by}` : ""}
                        </div>
                        {r.staff_note && noteFor !== r.id && (
                          <div style={{ marginTop: 8, fontSize: 12.5, background: "var(--card2, rgba(127,127,127,.08))", borderRadius: 8, padding: "6px 9px", ...wrap }}>
                            <i className="fas fa-note-sticky" aria-hidden="true" /> {r.staff_note}
                          </div>
                        )}
                        {noteFor === r.id && (
                          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <input className="adm-input" style={{ flex: 1, minWidth: 180 }} value={noteVal} maxLength={500}
                              placeholder="Internal note (e.g. called guest, apologised)" onChange={(e) => setNoteVal(e.target.value)} />
                            <button className="adm-btn" disabled={busy === r.id} onClick={() => saveNote(r.id)}>Save note</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )
        )}

        {/* ───────── ISSUES TAB ───────── */}
        {tab === "issues" && !issuesOff && (
          <>
            <div className="own-range" style={{ marginBottom: 12 }}>
              <button className={iFilter === "open" ? "on" : ""} onClick={() => setIFilter("open")}>Open · {openCount}</button>
              <button className={iFilter === "all" ? "on" : ""} onClick={() => setIFilter("all")}>All</button>
            </div>
            {iErr && issues === null ? (
              <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>
                Couldn&apos;t load issues — this is a loading error, not &ldquo;all clear.&rdquo;{" "}
                <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadIssues}>Try again</button>
              </div>
            ) : issues === null ? (
              <div className="adm-empty">Loading issues…</div>
            ) : issueRows.length === 0 ? (
              <div className="adm-empty">{iFilter === "open" ? "No open issues — all clear. 🎉" : "No issues raised yet."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {issueRows.map((i) => {
                  const open = i.status === "open";
                  const col = open ? "var(--adm-danger, #e5484d)" : "var(--adm-ok, #16a34a)";
                  return (
                    <div key={i.id} className="adm-card" style={{ margin: 0, borderLeft: `4px solid ${col}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <b style={{ fontSize: 14.5, ...wrap }}>{i.subject}</b>
                        <span className="adm-chip">{i.restaurantName}</span>
                        <span className="adm-chip" style={{ background: `color-mix(in srgb, ${col} 16%, transparent)`, color: col }}>{i.status}</span>
                        <span style={{ marginLeft: "auto" }}>
                          {open
                            ? <button className="adm-btn" disabled={busy === i.id} onClick={() => setIssueStatus(i.id, "resolved")}><i className="fas fa-check" aria-hidden="true" /> Resolve</button>
                            : <button className="adm-btn" disabled={busy === i.id} onClick={() => setIssueStatus(i.id, "open")}><i className="fas fa-rotate-left" aria-hidden="true" /> Reopen</button>}
                        </span>
                      </div>
                      {i.body && <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.5, ...wrap }}>{i.body}</p>}
                      {/* Staff-attached photo + voice note (mig 150) — shown to the owner just like the
                          admin panel. Photo opens full-size in a new tab; audio plays inline. Only
                          accept http(s) media URLs (these come from the server upload) so a stray
                          non-http value can never become a clickable javascript: link. */}
                      {i.image_url && /^https?:\/\//i.test(i.image_url) && (
                        <a href={i.image_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10 }}>
                          <img src={i.image_url} alt="Attached photo" style={{ maxWidth: 220, maxHeight: 180, borderRadius: 8, border: "1px solid var(--border,#ddd)", objectFit: "cover" }} />
                        </a>
                      )}
                      {i.audio_url && /^https?:\/\//i.test(i.audio_url) && (
                        <audio controls preload="none" src={i.audio_url} style={{ display: "block", marginTop: 10, maxWidth: "100%" }} />
                      )}
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                        Raised by <b>{i.raised_by || "—"}</b> ({i.raised_role || "staff"}) · {new Date(i.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: IST })}
                        {i.resolved_at ? ` · resolved ${new Date(i.resolved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST })}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}
