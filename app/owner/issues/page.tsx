"use client";
// Owner · Feedback & issues — TWO tabs:
//   · Guest ratings — the star-ratings diners leave (feedback table). View the average
//     + distribution, read comments, and mark each one handled / add an internal note.
//   · Complaints — problems staff flagged via the 🚩 button; resolve/reopen inline.
// Both are scoped server-side (ownerScope) and gated by their admin entitlement
// (ratings / issues) — a tab hides itself if the admin switched that section off.
// A 60s backstop refresh (paused while the tab is hidden) keeps new items appearing
// without a manual Refresh; no faster poll (egress rule).
// ── `--border` IS A WHOLE BORDER, NOT A COLOUR (sweep 6 · T14, 2026-08-18) ───────────────────────
// `app/globals.css` declares `--border: 1px solid #1d2430`. So every `1px solid var(--border)` in
// this file expanded to `1px solid 1px solid #1d2430`, which is not a valid declaration — the
// browser threw the whole line away. MEASURED, not guessed: the computed value of the customers
// table's row separator was `0px none`, the ratings bar's track computed to `rgba(0,0,0,0)`, and the
// "empty" half of a star row computed to the SAME amber as the filled half.
// That last one is the one that mattered: every rating on the Feedback screen drew FIVE GOLD STARS,
// so a 1★ complaint and a 5★ compliment looked identical. No text check could ever have caught it —
// the `aria-label` said "1 out of 5" the whole time, which is exactly why it survived every sweep.
// `--border-c` is the declared COLOUR (`#1d2430` dark, `#e5e8ee` light). Use that where a colour is
// wanted, and the bare `var(--border)` shorthand where a whole border is wanted.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { actorLabel, actorTitle } from "@/lib/ownerActor";
import { asSuffix } from "@/lib/ownerPin";
// Client-safe by design (lib/partialRead has zero imports) — see that file's header.
import { partialNote } from "@/lib/partialRead";

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
// ── A DATABASE ID NEVER REACHES THIS SCREEN — and the fix is now the SHARED one ────────────────
// Sweep 7 · T14 (2026-08-27) found `handled by c0af7b5b-…` on a rating card and added a local
// `handledBy()` here. T12's sweep (2026-08-29) had already done it properly: the five owner routes
// now record the login NAME (`lib/ownerScope` → `ownerActorName`), and `lib/ownerActor.ts` turns a
// legacy uuid row into the same em dash a nameless row already uses, keeping the reference in the
// hover text. So the local copy is DELETED rather than left beside it — one way, not two.
const IST = "Asia/Kolkata"; // every date shown here is in India time, like the rest of the panel
const Stars = ({ n }: { n: number }) => (
  <span aria-label={`${n} out of 5`} className="hue-ink" style={{ ["--hue" as string]: "#f5a623", letterSpacing: 1 }}>
    {"★".repeat(n)}<span style={{ color: "var(--border-c, #ccc)" }}>{"★".repeat(5 - n)}</span>
  </span>
);

export default function OwnerFeedback() {
  const router = useRouter();
  const [tab, setTab] = useState<"ratings" | "issues">("ratings");
  // Admin-in-one-restaurant scope pin (bug C1) — rides on EVERY call as ?scope= so a
  // second tab's shared act-as cookie can't hijack this tab. Null for a real owner.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  // scope = the admin act-as auth pin; rid = the narrowing filter so a single selected
  // restaurant shows ONLY its own ratings/issues (mirrors the Reports page, which sends both).
  // Without rid the server falls back to the owner's full set. Harmless on the PATCH calls
  // (they scope by the row id), so one suffix serves every request here.
  const scp = scopePin ? `?scope=${scopePin}&rid=${scopePin}${asSuffix()}` : "";

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
  // ── THE BADGE IS THE SERVER'S COUNT, NOT A COUNT OF WHAT FITS ON THE PAGE (sweep 6 · T14) ───────
  // `/api/owner/issues` computes `openCount` as one indexed head-count over the whole scope — it was
  // given that on 2026-08-12 precisely so a restaurant with more than 300 complaints could not
  // understate how many are open. This page then threw it away and counted the rows it happened to
  // have, which is the very thing that fix removed. Null until the first reply, so the badge can fall
  // back to the shown page (and does, when the server says it couldn't count either).
  const [openSrv, setOpenSrv] = useState<number | null>(null);
  // Which figures the two routes could NOT read this time. Both tabs feed the same note, so the
  // owner reads one sentence rather than hunting for which half of the page went quiet. Each loader
  // clears its own keys on every load, so a passing blip disappears by itself.
  const [rPartial, setRPartial] = useState<string[]>([]);
  const [iPartial, setIPartial] = useState<string[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState("");
  // (a `decided` ref used to live here — see the tab effect below for why it could never work)

  const loadRatings = useCallback(async () => {
    try {
      // On the "To handle" filter, ask the SERVER for unhandled rows so any older than the
      // newest 200 stay reachable + actionable (they were invisible before; audit 2026-07-07).
      const suffix = rFilter === "unhandled" ? (scp ? `${scp}&filter=unhandled` : "?filter=unhandled") : scp;
      const j = await (await fetch(`/api/owner/ratings${suffix}`, { cache: "no-store" })).json();
      if (j.disabled) { setRatingsOff(true); return; }
      if (j.error) throw new Error(j.error);
      setRatings(j.ratings || []); setSummary(j.summary || null); setRErr(null); setErr(null);
      setRPartial(Array.isArray(j.partial) ? j.partial : []);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m); setRErr(m); }
  }, [scp, rFilter]);

  const loadIssues = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/issues${scp}`, { cache: "no-store" })).json();
      if (j.disabled) { setIssuesOff(true); return; }
      if (j.error) throw new Error(j.error);
      setIssues(j.issues || []); setIErr(null); setErr(null);
      // The server says so in `partial` when its own head-count failed; in that case it already fell
      // back to counting the shown page, and so do we.
      const countUnread = Array.isArray(j.partial) && j.partial.includes("openCount");
      setOpenSrv(!countUnread && typeof j.openCount === "number" ? j.openCount : null);
      setIPartial(Array.isArray(j.partial) ? j.partial : []);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m); setIErr(m); }
  }, [scp]);

  const loadAll = useCallback(async () => { await Promise.all([loadRatings(), loadIssues()]); }, [loadRatings, loadIssues]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ── A TAB THAT IS SWITCHED OFF MUST NOT BE THE ONE YOU ARE ON (sweep 7 · T14, 2026-08-27) ───────
  // This was a `decided` ref: "pick the first available tab, once". It ran on the FIRST render,
  // when `ratingsOff`/`issuesOff` are still their initial `false` — so `else if (!ratingsOff)` was
  // always true and `decided` was latched before either request had answered. When ratings then
  // came back switched off, the effect returned early and `tab` stayed on "ratings".
  // What that looks like, watched on 2026-08-27 with Guest ratings off and Complaints on: the page
  // renders the heading, then a card holding ONLY a "Complaints · 1" button and Refresh — and
  // nothing at all underneath. The ratings block is hidden because that section is off; the
  // complaints block is hidden because the open tab is still "ratings". A restaurant with an open
  // complaint was shown an empty screen. Broken since PR #199 and never seen, because the check
  // that covered it READ this effect instead of driving it.
  // No latch now: if the tab you are on is off and the other one is on, move. It can never fight a
  // real click, because a switched-off tab has no button to click.
  useEffect(() => {
    if (tab === "ratings" && ratingsOff && !issuesOff) setTab("issues");
    else if (tab === "issues" && issuesOff && !ratingsOff) setTab("ratings");
  }, [tab, ratingsOff, issuesOff]);

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
      // What the note said when this editor opened, so a co-owner who typed first wins and this
      // person is TOLD rather than overwritten (T9 sweep, 2026-08-05 — the rule reached the panels
      // in 2026-07-30 but never this box).
      const was = (ratings || []).find((r) => r.id === id)?.staff_note ?? "";
      const res = await fetch(`/api/owner/ratings${scp}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-LFH-Expect": JSON.stringify({ table: "feedback", id, fields: { staff_note: was } }),
        },
        body: JSON.stringify({ id, note: noteVal }),
      });
      // Only close the editor + clear the box AFTER the save actually succeeds — otherwise
      // a failed PATCH used to wipe the note the owner typed with no warning.
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const c = j?.clash as { plain?: string; todo?: string } | undefined;
        throw new Error(c?.plain ? `${c.plain}${c.todo ? ` ${c.todo}` : ""}` : (j.error || "Couldn't save your note — please try again."));
      }
      setErr(null); setNoteFor(null); setNoteVal(""); await loadRatings();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await loadRatings(); }
    finally { setBusy(null); }
  };
  const setIssueStatus = async (id: string, status: "open" | "resolved") => {
    setBusy(id);
    const prev = status === "resolved" ? "open" : "resolved";
    setIssues((cur) => (cur || []).map((i) => (i.id === id ? { ...i, status } : i)));
    // Keep the server's count in step with the optimistic row change, the same way the ratings
    // badge already does — otherwise the badge would sit a beat behind until the reload lands.
    const wasOpen = (issues || []).find((i) => i.id === id)?.status === "open";
    if (wasOpen !== (status === "open")) {
      setOpenSrv((n) => (n === null ? n : Math.max(0, n + (status === "open" ? 1 : -1))));
    }
    try {
      const res = await fetch(`/api/owner/issues${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      // A failed Resolve/Reopen must not silently revert: roll the row back and tell the owner.
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Couldn't update — please try again."); }
      setErr(null); await loadIssues();
    } catch (e) {
      setIssues((cur) => (cur || []).map((i) => (i.id === id ? { ...i, status: prev } : i)));
      if (wasOpen !== (status === "open")) {
        setOpenSrv((n) => (n === null ? n : Math.max(0, n + (status === "open" ? -1 : 1))));
      }
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const shownOpen = (issues || []).filter((i) => i.status === "open").length;
  const openCount = openSrv ?? shownOpen;
  const issueRows = (issues || []).filter((i) => iFilter === "all" || i.status === "open");
  const ratingRows = (ratings || []).filter((r) => rFilter === "all" || !r.acknowledged);
  const bothOff = ratingsOff && issuesOff;
  // ── A SECTION YOU DO NOT HAVE SIMPLY IS NOT THERE (owner, 2026-08-31) ─────────────────────────
  // R36 again, from the page side: *"owner can't know which option are not given to them, only
  // admin should know that."* The sidebar already hides a withheld section from a real owner;
  // this page did not — reached by a typed URL or an old bookmark it printed "This section isn't enabled for your restaurant — contact Aevidine",
  // which names a feature he has not been given and tells him who to ask for it. The card is
  // DELETED, not restyled, and he goes back to his dashboard. `replace`, not `push`, so Back does
  // not bounce him straight into it again.
  // The ADMIN never lands here: the route only answers `disabled` for a REAL owner
  // (`if (!scope.all && !scope.admin)`), so the X-ray view still opens every section.
  useEffect(() => { if (bothOff) router.replace("/owner"); }, [bothOff, router]);
  // ── A LIST THAT IS ONLY PART OF THE LIST HAS TO SAY SO (sweep 6 · T14, 2026-08-18) ──────────────
  // The two sister screens in this panel already do it — Customers says "the N most-recent of M",
  // Pay Later says "the N people who owe the most, of M". This one said nothing, and on French House
  // that meant 381 ratings, 200 cards and no hint that 181 of them were out of reach. An owner who
  // scrolls to the bottom of a list is entitled to believe he has reached the bottom of it.
  const RATINGS_PAGE = 200;   // /api/owner/ratings → .limit(200)
  const ISSUES_PAGE = 300;    // /api/owner/issues  → .limit(300)
  const ratingsShown = (ratings || []).length;
  const ratingsOf = rFilter === "unhandled" ? (summary?.unhandled ?? 0) : (summary?.total ?? 0);
  const ratingsCapped = ratingsShown >= RATINGS_PAGE && ratingsOf > ratingsShown;
  const issuesCapped = (issues || []).length >= ISSUES_PAGE;
  const partial = [...new Set([...rPartial, ...iPartial])];

  return (
    <>
      <h1 className="adm-page-h">Feedback &amp; complaints</h1>
      <p className="adm-page-sub">What your guests rated and the complaints your staff raised — read it, handle it, mark it done.</p>

      {/* Nothing at all while the redirect above runs — never a sentence naming a section he
          has not been given (R36). */}
      {bothOff ? null : (
      <div className="adm-card">
        {/* Tabs (hide a tab the admin switched off) */}
        <div className="own-range" style={{ marginBottom: 14 }}>
          {!ratingsOff && <button className={tab === "ratings" ? "on" : ""} onClick={() => setTab("ratings")}>Guest ratings{summary ? ` · ${summary.total}` : ""}</button>}
          {!issuesOff && <button className={tab === "issues" ? "on" : ""} onClick={() => setTab("issues")}>Complaints · {openCount}</button>}
          <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={loadAll}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
        </div>

        {partial.length > 0 && (
          <div className="adm-card" style={{ margin: "0 0 12px", borderColor: "var(--adm-warn)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)" }} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 200 }}>{partialNote(partial)}</span>
            <button className="adm-btn" onClick={loadAll}><i className="fas fa-rotate" aria-hidden="true" /> Try again</button>
          </div>
        )}

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
                        <span style={{ flex: 1, height: 8, background: "var(--border-c,#e5e7eb)", borderRadius: 5, overflow: "hidden" }}>
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
                          {/* NEVER A DATABASE ID WHERE A PERSON'S NAME GOES (T12 sweep, 2026-08-29).
                              Five owner routes used to record the owner's uuid as the person; they
                              now record the login name (lib/ownerScope → ownerActorName). Rows
                              written BEFORE that still hold the uuid, and this line printed it as
                              "handled by c0af7b5b-…". lib/ownerActor.ts turns a bare id into the
                              same em dash a nameless row already uses, with the reference kept in
                              the hover text. */}
                          {r.acknowledged && r.acknowledged_by
                            ? <span title={actorTitle(r.acknowledged_by)}> · handled by {actorLabel(r.acknowledged_by)}</span>
                            : ""}
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
                  {/* Plain muted text, not a warning bar — nothing is wrong, the list is just long. */}
                  {ratingsCapped && (
                    <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {rFilter === "unhandled"
                        ? `Showing the ${ratingsShown} newest of ${ratingsOf.toLocaleString("en-IN")} still to handle. Handle these and the next ones appear.`
                        : `Showing the ${ratingsShown} most recent of ${ratingsOf.toLocaleString("en-IN")}. “To handle” reaches the older ones that still need you.`}
                    </div>
                  )}
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
                Couldn&apos;t load complaints — this is a loading error, not &ldquo;all clear.&rdquo;{" "}
                <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadIssues}>Try again</button>
              </div>
            ) : issues === null ? (
              <div className="adm-empty">Loading complaints…</div>
            ) : issueRows.length === 0 ? (
              <div className="adm-empty">{iFilter === "open" ? "No open complaints — all clear. 🎉" : "No complaints raised yet."}</div>
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
                          <img src={i.image_url} alt="Attached photo" style={{ maxWidth: 220, maxHeight: 180, borderRadius: 8, border: "1px solid var(--border-c,#ddd)", objectFit: "cover" }} />
                        </a>
                      )}
                      {i.audio_url && /^https?:\/\//i.test(i.audio_url) && (
                        <audio controls preload="none" src={i.audio_url} style={{ display: "block", marginTop: 10, maxWidth: "100%" }} />
                      )}
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                        Raised by <b title={actorTitle(i.raised_by)}>{actorLabel(i.raised_by)}</b> ({i.raised_role || "staff"}) · {new Date(i.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: IST })}
                        {i.resolved_at ? ` · resolved ${new Date(i.resolved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST })}` : ""}
                      </div>
                    </div>
                  );
                })}
                {issuesCapped && (
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Showing the {ISSUES_PAGE} most recent complaints.{" "}
                    {openCount > ISSUES_PAGE
                      ? `${openCount.toLocaleString("en-IN")} are still open, so some open ones are past the end of this page.`
                      : "Open ones are listed first, so none of those is hidden below this."}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}
