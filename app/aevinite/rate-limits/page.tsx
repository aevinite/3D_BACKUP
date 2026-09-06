"use client";
// Admin · Rate Limits — see and change every abuse limit in one place (owner, 2026-07-26).
// Limits are enforced in the DB (mig 205); when one is reached it shows here AND in the Problems
// section. Per limit: how many / per how long / on-off. Hits can be Allowed (reset that person's
// counter) or handed to Claude. Admin-only.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";
import { timeAgo } from "@/components/admin/shared";
// THE ONE LIST of what each limit is called — the same one the phone alert and the diary line
// read. See labelFor() below for why this page needed it (item 14).
import { RATE_LABELS } from "@/lib/plainError";
import { SkelList } from "@/components/admin/Skeleton";

type Rule = { id: string; key: string; label: string; max_count: number; window_seconds: number; enabled: boolean; updated_at: string };
type Hit = { id: string; restaurant_id: string; restaurant_name: string | null; key: string; subject: string; subject_label: string | null; hit_count: number; max_count: number; window_seconds: number; last_at: string };
type Blocked = { key: string; ip: string; note: string | null; since: string };
type UnblockReq = { id: string; key: string; ip: string; device_id: string | null; message: string | null; created_at: string; asked_today: number | null };

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();

// Friendly "per X" from a seconds window.
function perLabel(s: number): string {
  if (s % 3600 === 0) return `${s / 3600} hour${s / 3600 === 1 ? "" : "s"}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} sec`;
}

// ── A HIT WITH NO CEILING MUST NOT PRINT ZERO ONES (item 1, sweep #8 T21) ────────────────────────
// Not every wall on this page has an editable ceiling. The ADMIN password wall deliberately has
// none — this very page says so, in the note at the bottom of "The limits", and refuses to offer it
// as a rule row — so migration 208's lfh_rate_alert writes `max_count: 0, window_seconds: 0` on
// those events. The chip printed them straight through, and perLabel(0) answers "0 hours" because 0
// divides by 3600 cleanly, so the one live alert on this platform read:
//
//     Admin login    3 / 0 per 0 hours
//
// which is not a smaller number than the real one, it is a meaningless one — the same class as a
// NaN or an [object Object] reaching a person's screen. It was measured on this screen at 1280×800
// and at 360×780, and it is the SECOND half of a pair: the Repair board printed the same chip and
// was fixed there on 2026-09-04 (`rlChip`, app/aevinite/repair/page.tsx), one screen of two. The
// wording is deliberately kept identical to that one, so the two boards keep saying the same thing
// about the same alert — the exact drift `labelFor` below was fixed for a day earlier.
const hitChip = (h: { hit_count: number; max_count: number; window_seconds: number }) =>
  h.max_count > 0 && h.window_seconds > 0
    ? `${h.hit_count} / ${h.max_count} per ${perLabel(h.window_seconds)}`
    : `${h.hit_count} attempt${h.hit_count === 1 ? "" : "s"}`;


export default function AdminRateLimits() {
  const toast = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [requests, setRequests] = useState<UnblockReq[]>([]);
  const [loading, setLoading] = useState(true);
  // A FAILED LOAD IS NOT AN ALL-CLEAR (T17 sweep, 2026-08-19). `load()` only raised a toast, which
  // is gone in three seconds, and then every section rendered its EMPTY state: a green "No limits
  // reached right now.", an empty rules card, "No requests right now." and "No devices are
  // blocked." Four confident answers to a question the page never managed to ask.
  const [loadErr, setLoadErr] = useState("");
  const [draft, setDraft] = useState<Record<string, { max_count: number; window_seconds: number }>>({});
  const [busy, setBusy] = useState<string>("");
  // Each section can be folded shut; the choice is remembered on this device (pure UI, no query).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { const raw = localStorage.getItem("lfh_rl_collapsed"); if (raw) setCollapsed(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  const toggleSection = (id: string) => setCollapsed((p) => {
    const next = { ...p, [id]: !p[id] };
    try { localStorage.setItem("lfh_rl_collapsed", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const setSection = (id: string, shut: boolean) => setCollapsed((p) => {
    if (!!p[id] === shut) return p;
    const next = { ...p, [id]: shut };
    try { localStorage.setItem("lfh_rl_collapsed", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  // "Change limit" jumps from a hit down to that rule's row. The href alone can't do it: when
  // "The limits" is folded shut the target isn't in the DOM yet, and the browser resolves the
  // hash in this same click — before React re-renders — so the page just sat there and the
  // admin was left at the top with no idea which rule was meant. Open the section ourselves,
  // then scroll on the frame AFTER the row actually exists.
  const jumpToRule = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    revealRule(key);
  };
  // ── ARRIVING FROM ANOTHER SCREEN WITH #rule-<key> ────────────────────────────────────────────
  // The Repair board's rate-limit alerts carry a "Change rate limit" button pointing here at
  // `#rule-guest_order`, and IT DID NOTHING (found 2026-09-02 while making every alert land on
  // its control). Two reasons, both the same shape as the same-page problem solved above: the
  // rules arrive from a fetch, so at the moment the browser resolves the hash the row does not
  // exist yet; and "The limits" may be folded shut on this device, so it would not exist even
  // after the fetch. So the alert told him which limit to change and then left him at the top of
  // the page — the exact complaint he raised about the maintenance banner.
  //
  // Extracted rather than duplicated: the button on this page and the link from the other one now
  // run the same three lines, so neither can drift into working while the other doesn't.
  const revealRule = useCallback((key: string) => {
    setSection("rules", false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(`rule-${key}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Ring it, the same way every other "here is the control you were sent to" does
      // (lib/adminJump.ts + [data-adm-flash] in globals.css). A rule row holds three inputs and a
      // switch, so landing near it is not the same as being shown which one.
      el.setAttribute("data-adm-flash", "");
      setTimeout(() => el.removeAttribute("data-adm-flash"), 3000);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await adminFetch<{ rules: Rule[]; events: Hit[]; blocked: Blocked[]; requests: UnblockReq[] }>("/api/admin/rate-limits");
    if (r.ok) {
      setRules(r.data.rules || []);
      setHits(r.data.events || []);
      setBlocked(r.data.blocked || []);
      setRequests(r.data.requests || []);
      const d: Record<string, { max_count: number; window_seconds: number }> = {};
      for (const x of r.data.rules || []) d[x.id] = { max_count: x.max_count, window_seconds: x.window_seconds };
      setDraft(d);
      setLoadErr("");
    } else { setLoadErr(r.error || "Couldn't load the rate limits."); toast(r.error || "Couldn't load rate limits.", "err"); }
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // Honour a #rule-<key> the admin ARRIVED with, once the rules are actually on screen. Runs on
  // the load that brings rules in (not on mount), because that is the first moment the row exists.
  // `once` so an auto-refresh later in the session cannot yank him back to a rule he has moved on
  // from — being scrolled somewhere you didn't ask for is worse than not being scrolled at all.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || rules.length === 0) return;
    const key = (window.location.hash || "").replace(/^#rule-/, "");
    if (!key || key === window.location.hash) return;
    if (!rules.some((r) => r.key === key)) return; // a stale link naming no rule: leave the page alone
    jumped.current = true;
    revealRule(key);
  }, [rules, revealRule]);

  const saveRule = async (r: Rule, patch: Partial<Pick<Rule, "max_count" | "window_seconds" | "enabled">>) => {
    setBusy(r.id);
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, ...patch }),
    });
    setBusy("");
    if (res.ok) { toast("Saved."); setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x))); }
    else { toast(res.error || "Couldn't save.", "err"); load(); }
  };

  const allowHit = async (h: Hit) => {
    setHits((prev) => prev.filter((x) => x.id !== h.id));
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "allow", event_id: h.id }),
    });
    if (res.ok) toast("Allowed — their counter is reset."); else { toast(res.error || "Couldn't allow.", "err"); load(); }
  };
  const dismissHit = async (h: Hit) => {
    setHits((prev) => prev.filter((x) => x.id !== h.id));
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", event_id: h.id }),
    });
    if (!res.ok) { toast(res.error || "Couldn't dismiss.", "err"); load(); }
  };
  const blockHit = async (h: Hit) => {
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "block", event_id: h.id }),
    });
    if (res.ok) { setHits((prev) => prev.filter((x) => x.id !== h.id)); toast("Blocked from the admin panel."); load(); }
    else toast(res.error || "Couldn't block.", "err");
  };
  // "Let them try again" — the answer for a GENUINE person who mistyped (the owner forgetting his
  // own admin password is the everyday case). It lifts the short login lockout on that device and
  // marks the alert handled. The note at the bottom of "The limits" has promised this button since
  // it was written; only "Block this device" was ever rendered, so the one screen dedicated to
  // limits offered the harsh answer and not the kind one — while the Repair hub offered both
  // (T17 sweep, 2026-08-19).
  const clearHit = async (h: Hit) => {
    setHits((prev) => prev.filter((x) => x.id !== h.id));
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", event_id: h.id }),
    });
    if (res.ok) toast("Cleared — that device can try the admin password again now.");
    else { toast(res.error || "Couldn't clear that.", "err"); load(); }
  };
  const unblock = async (b: Blocked) => {
    setBlocked((prev) => prev.filter((x) => x.key !== b.key));
    setRequests((prev) => prev.filter((x) => x.key !== b.key)); // any request for that device is now moot
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unblock", key: b.key }),
    });
    if (res.ok) toast("Unblocked."); else { toast(res.error || "Couldn't unblock.", "err"); load(); }
  };
  // Approve an unblock request → lift the block on that device.
  const approveRequest = async (q: UnblockReq) => {
    setRequests((prev) => prev.filter((x) => x.id !== q.id));
    setBlocked((prev) => prev.filter((x) => x.key !== q.key));
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve_request", request_id: q.id }),
    });
    if (res.ok) toast("Unblocked — they can sign in again."); else { toast(res.error || "Couldn't unblock.", "err"); load(); }
  };
  // Deny an unblock request → clear it from the list, block stays.
  const denyRequest = async (q: UnblockReq) => {
    setRequests((prev) => prev.filter((x) => x.id !== q.id));
    const res = await adminFetch<{ ok: boolean }>("/api/admin/rate-limits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deny_request", request_id: q.id }),
    });
    if (res.ok) toast("Request dismissed."); else { toast(res.error || "Couldn't dismiss.", "err"); load(); }
  };
  const fixHit = async (h: Hit) => {
    const res = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ note: `Rate limit "${labelFor(h.key)}" reached by ${h.subject_label || h.subject}${h.restaurant_name ? ` at ${h.restaurant_name}` : ""} (${h.hit_count} in ${perLabel(h.window_seconds)}). Investigate whether this is genuine abuse or the limit is too tight.`, restaurant_id: h.restaurant_id !== "00000000-0000-0000-0000-000000000000" ? h.restaurant_id : null, mode: "overnight" }),
    });
    if (res.ok) toast("Sent to Claude for the 2:30 AM robot."); else toast(res.error || "Couldn't send.", "err");
  };
  // ── A RAW DATABASE KEY WAS REACHING THIS SCREEN (item 14, owner 2026-09-04) ─────────────────
  //
  // This read `rules.find(...)?.label || key` — and fell through to the KEY, unprettified, for any
  // limit with no editable rule row. There is exactly one of those and it is the one that fires:
  // the admin-password wall has no max and no window you can set, deliberately, which this page
  // says in its own words further down. So the live alert on this platform read:
  //
  //     admin_login          ← here
  //     Admin login          ← the same alert on Repair & support
  //
  // Two names for one wall, and one of them a database word with an underscore in it. Found by
  // sweep #8 T18 as a REGRESSION: ledger rows P08242 and P08253 were green in sweeps #6 and #7
  // ("no raw rate-limit key reaches the screen", "a rate limit reads the same on both screens")
  // and had quietly stopped being true.
  //
  // The order matters. The rule row wins, because that is the name the admin edits right here and
  // renaming it must change what he sees. Behind it sits RATE_LABELS in lib/plainError.ts, whose
  // own header calls it "THE ONE LIST" and which the phone alert already reads. The prettifier is
  // last, so a key nobody has named yet is still never printed raw.
  const labelFor = (key: string) =>
    rules.find((r) => r.key === key)?.label
    || RATE_LABELS[key]
    || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  // The one block every section shows instead of its empty state when the read failed.
  const unread = (
    <div className="rl-unread">
      <i className="fas fa-triangle-exclamation" aria-hidden="true" />
      <span>{loadErr} — so this is <b>unknown</b>, not clear.</span>
      <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={load}>Retry</button>
    </div>
  );

  // A section heading that folds its body open/shut. `anchorId` keeps the "#hits" jump target.
  const secHead = (id: string, inner: React.ReactNode, anchorId?: string) => (
    <div className="rl-sec rl-sec-btn" id={anchorId} role="button" tabIndex={0} aria-expanded={!collapsed[id]}
      onClick={() => toggleSection(id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(id); } }}>
      <i className={`fas fa-chevron-down rl-caret${collapsed[id] ? " closed" : ""}`} aria-hidden="true" />
      {inner}
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 4 }}>Rate limits</h1>
          <p className="adm-page-sub" style={{ margin: 0 }}>Stop spam &amp; abuse. Change any limit here; when one is reached it also shows in <Link href="/aevinite/repair#rate-limits" style={{ color: "var(--accent)" }}>Problems</Link>.</p>
        </div>
        <button className="adm-btn" onClick={load} disabled={loading}><i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh</button>
      </div>

      {/* Hits — a limit was reached */}
      {secHead("hits", (
        <>
          <i className="fas fa-gauge-high" aria-hidden="true" style={{ color: loadErr ? "var(--adm-warn)" : hits.length ? "var(--adm-danger)" : "var(--muted)" }} />
          <h2>Limits reached</h2>
          {hits.length ? <span className="rl-chip danger">{hits.length}</span> : null}
          <span className="adm-muted" style={{ fontSize: 12 }}>who hit a wall right now · all restaurants</span>
        </>
      ), "hits")}
      {collapsed.hits ? null : loading ? <SkelList rows={3} label="Loading limits" /> : loadErr ? unread : hits.length === 0 ? (
        <div className="rl-clear"><i className="fas fa-circle-check" aria-hidden="true" /> No limits reached right now.</div>
      ) : (
        <div style={{ marginBottom: 6 }}>
          {hits.map((h) => (
            <div key={h.id} className="rl-hit">
              <span className="rl-hit-bar" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                  <b style={{ fontSize: 13.5 }}>{labelFor(h.key)}</b>
                  <span className="rl-chip danger">{hitChip(h)}</span>
                  {h.restaurant_name ? <span className="adm-muted" style={{ fontSize: 11.5 }}><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{h.restaurant_name}</span> : null}
                  <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(h.last_at)}</span>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5 }}>Who: <b style={{ color: "var(--text)" }}>{h.subject_label || h.subject}</b></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
                  {h.key === "admin_login" ? (
                    <>
                      <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => clearHit(h)} title="Genuine person — clear the short lockout so they can try the password again now">
                        <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Let them try again
                      </button>
                      <button className="adm-btn danger" style={{ fontSize: 12 }} onClick={() => blockHit(h)} title="Bar this device/IP from reaching the admin panel">
                        <i className="fas fa-ban" aria-hidden="true" style={{ marginRight: 6 }} />Block this device
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => allowHit(h)} title="This was a real customer — reset their counter so they get through now">
                        <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Allow (reset)
                      </button>
                      <a className="adm-btn" style={{ fontSize: 12 }} href={`#rule-${h.key}`} title="Jump to this limit's setting to raise or lower it" onClick={(e) => jumpToRule(e, h.key)}>
                        <i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 6 }} />Change limit
                      </a>
                    </>
                  )}
                  <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => fixHit(h)} title="Hand it to Claude to investigate">
                    <i className="fas fa-robot" aria-hidden="true" style={{ marginRight: 6 }} />Fix
                  </button>
                  <button className="adm-btn" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => dismissHit(h)} title="Clear from the list">Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rules — the limits themselves */}
      {secHead("rules", (
        <>
          <i className="fas fa-sliders" aria-hidden="true" style={{ color: "var(--muted)" }} />
          <h2>The limits</h2>
          <span className="adm-muted" style={{ fontSize: 12 }}>change how many actions are allowed per time window</span>
        </>
      ))}
      {collapsed.rules ? null : loading ? <SkelList rows={3} label="Loading limits" /> : loadErr ? unread : (
        <div className="adm-card" style={{ marginBottom: 12 }}>
          {rules.map((r) => {
            const d = draft[r.id] || { max_count: r.max_count, window_seconds: r.window_seconds };
            const dirty = d.max_count !== r.max_count || d.window_seconds !== r.window_seconds;
            return (
              <div key={r.id} id={`rule-${r.key}`} className="rl-rule">
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <b style={{ fontSize: 13.5 }}>{r.label}</b>
                  <div className="adm-muted" style={{ fontSize: 11.5 }}>{r.enabled ? `max ${r.max_count} per ${perLabel(r.window_seconds)}` : "off"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <input type="number" min={0} max={100000} className="rl-num" value={d.max_count}
                    onChange={(e) => setDraft((p) => ({ ...p, [r.id]: { ...d, max_count: Math.max(0, Math.trunc(+e.target.value || 0)) } }))} aria-label={`${r.label} max count`} />
                  <span className="adm-muted" style={{ fontSize: 12 }}>per</span>
                  <input type="number" min={1} max={86400} className="rl-num" value={d.window_seconds}
                    onChange={(e) => setDraft((p) => ({ ...p, [r.id]: { ...d, window_seconds: Math.max(1, Math.trunc(+e.target.value || 1)) } }))} aria-label={`${r.label} window seconds`} />
                  <span className="adm-muted" style={{ fontSize: 12 }}>sec</span>
                  <button className="adm-btn" style={{ fontSize: 12 }} disabled={!dirty || busy === r.id} onClick={() => saveRule(r, d)}>
                    {busy === r.id ? "Saving…" : "Save"}
                  </button>
                  <button className={`rl-toggle${r.enabled ? " on" : ""}`} disabled={busy === r.id} onClick={() => saveRule(r, { enabled: !r.enabled })} title={r.enabled ? "On — click to turn off" : "Off — click to turn on"} aria-pressed={r.enabled}>
                    <span className="knob" /><span className="lbl">{r.enabled ? "On" : "Off"}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {/* Admin login isn't an editable limit on purpose (mig 208) — a wrong value could lock the
              owner out. It's guarded the safe way instead: the alert + block/unblock flow on this page. */}
          <div className="rl-rule rl-note">
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}><i className="fas fa-user-shield" aria-hidden="true" style={{ marginRight: 7, opacity: 0.7 }} />Your admin login</b>
              <div className="adm-muted" style={{ fontSize: 11.5 }}>Protected a safer way — not an editable number, so you can never lock yourself out.</div>
            </div>
            <span className="adm-muted" style={{ fontSize: 11.5, maxWidth: 300 }}>
              Too many wrong tries → a warning shows in <b style={{ color: "var(--text)" }}>Limits reached</b> (top) with Block / Let-them-retry; blocked devices sit in <b style={{ color: "var(--text)" }}>Blocked from the admin panel</b> (bottom).
            </span>
          </div>
        </div>
      )}

      {/* Unblock requests — blocked devices asking to be let back in (just above the block list) */}
      {secHead("requests", (
        <>
          <i className="fas fa-hand" aria-hidden="true" style={{ color: requests.length ? "var(--adm-accent,#e8a13c)" : "var(--muted)" }} />
          <h2>Unblock requests</h2>
          {requests.length ? <span className="rl-chip">{requests.length}</span> : null}
          <span className="adm-muted" style={{ fontSize: 12 }}>blocked devices asking to be let back in</span>
        </>
      ))}
      {collapsed.requests ? null : loading ? <SkelList rows={3} label="Loading limits" /> : loadErr ? unread : requests.length === 0 ? (
        <div className="adm-muted" style={{ fontSize: 12.5, padding: "2px 0 6px" }}>No requests right now.</div>
      ) : (
        <div className="adm-card" style={{ marginBottom: 12 }}>
          {requests.map((q) => (
            <div key={q.id} className="rl-rule">
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13.5 }}>{q.ip}</b>
                  {(q.asked_today ?? 0) > 1 ? <span className="rl-chip">asked {q.asked_today}× today</span> : null}
                  <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(q.created_at)}</span>
                </div>
                {q.message ? <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 3, color: "var(--text)" }}>“{q.message}”</div> : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => approveRequest(q)} title="Lift the block — let this device sign in again">
                  <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Unblock
                </button>
                <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => denyRequest(q)} title="Keep the block; clear this request">Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Blocked devices (barred from the admin panel) — the very bottom of the page */}
      {secHead("blocked", (
        <>
          <i className="fas fa-ban" aria-hidden="true" style={{ color: blocked.length ? "var(--adm-danger)" : "var(--muted)" }} />
          <h2>Blocked from the admin panel</h2>
          {blocked.length ? <span className="rl-chip danger">{blocked.length}</span> : null}
        </>
      ))}
      {collapsed.blocked ? null : loading ? <SkelList rows={3} label="Loading limits" /> : loadErr ? unread : blocked.length === 0 ? (
        <div className="adm-muted" style={{ fontSize: 12.5, padding: "2px 0 6px" }}>No devices are blocked.</div>
      ) : (
        <div className="adm-card" style={{ marginBottom: 12 }}>
          {blocked.map((b) => (
            <div key={b.key} className="rl-rule">
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{b.note || b.ip}</b>
                <div className="adm-muted" style={{ fontSize: 11.5 }}>{b.ip}</div>
              </div>
              <button className="adm-btn" style={{ fontSize: 12 }} onClick={() => unblock(b)} title="Let this device reach the admin panel again">
                <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Unblock
              </button>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .rl-sec{display:flex;align-items:center;gap:9px;margin:22px 0 11px}
        .rl-sec h2{margin:0;font-size:16px}
        .rl-sec-btn{cursor:pointer;user-select:none;width:100%;border-radius:8px;padding:4px 6px;margin-left:-6px;transition:background .12s}
        .rl-sec-btn:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
        .rl-sec-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .rl-caret{color:var(--muted);font-size:12px;width:12px;text-align:center;transition:transform .15s}
        .rl-caret.closed{transform:rotate(-90deg)}
        .rl-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--adm-accent,#e8a13c) 16%,transparent);color:var(--adm-accent,#e8a13c)}
        .rl-chip.danger{background:color-mix(in srgb,var(--adm-danger) 16%,transparent);color:var(--adm-danger)}
        /* "I couldn't read this" — deliberately not the green all-clear and not the red alarm. */
        .rl-unread{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-warn) 40%,transparent);background:color-mix(in srgb,var(--adm-warn) 8%,var(--card));color:var(--text);font-size:13.5px;margin-bottom:10px}
        .rl-unread i{color:var(--adm-warn)}
        .rl-unread > span{flex:1 1 200px;min-width:0}
        .rl-clear{display:flex;align-items:center;gap:9px;padding:16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent);background:color-mix(in srgb,var(--adm-ok,#4caf82) 8%,var(--card));color:var(--text);font-size:13.5px}
        .rl-clear i{color:var(--adm-ok,#4caf82)}
        .rl-hit{position:relative;display:flex;gap:12px;padding:13px 14px 13px 16px;border-radius:12px;border:var(--border);background:var(--card);margin-bottom:10px;overflow:hidden}
        .rl-hit-bar{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--adm-danger)}
        .rl-rule{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 0;border-bottom:var(--border)}
        .rl-rule:last-child{border-bottom:none}
        .rl-note{align-items:flex-start;gap:14px;opacity:.92}
        .rl-num{width:74px;padding:6px 8px;border-radius:8px;border:var(--border);background:var(--card);color:var(--text);font-size:13px}
        .rl-toggle{display:inline-flex;align-items:center;gap:7px;border:var(--border);background:var(--card);border-radius:999px;padding:4px 10px 4px 5px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600}
        .rl-toggle .knob{width:14px;height:14px;border-radius:999px;background:var(--muted);transition:background .15s,transform .15s}
        .rl-toggle.on{color:var(--adm-ok,#4caf82);border-color:color-mix(in srgb,var(--adm-ok,#4caf82) 45%,transparent)}
        .rl-toggle.on .knob{background:var(--adm-ok,#4caf82);transform:translateX(3px)}
      `}</style>
    </>
  );
}
