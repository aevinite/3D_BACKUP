"use client";
// Admin · Rate Limits — see and change every abuse limit in one place (owner, 2026-07-26).
// Limits are enforced in the DB (mig 205); when one is reached it shows here AND in the Problems
// section. Per limit: how many / per how long / on-off. Hits can be Allowed (reset that person's
// counter) or handed to Claude. Admin-only.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";
import { timeAgo } from "@/components/admin/shared";

type Rule = { id: string; key: string; label: string; max_count: number; window_seconds: number; enabled: boolean; updated_at: string };
type Hit = { id: string; restaurant_id: string; restaurant_name: string | null; key: string; subject: string; subject_label: string | null; hit_count: number; max_count: number; window_seconds: number; last_at: string };

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();

// Friendly "per X" from a seconds window.
function perLabel(s: number): string {
  if (s % 3600 === 0) return `${s / 3600} hour${s / 3600 === 1 ? "" : "s"}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} sec`;
}

export default function AdminRateLimits() {
  const toast = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, { max_count: number; window_seconds: number }>>({});
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await adminFetch<{ rules: Rule[]; events: Hit[] }>("/api/admin/rate-limits");
    if (r.ok) {
      setRules(r.data.rules || []);
      setHits(r.data.events || []);
      const d: Record<string, { max_count: number; window_seconds: number }> = {};
      for (const x of r.data.rules || []) d[x.id] = { max_count: x.max_count, window_seconds: x.window_seconds };
      setDraft(d);
    } else toast(r.error || "Couldn't load rate limits.", "err");
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

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
  const fixHit = async (h: Hit) => {
    const res = await adminFetch<{ ok: boolean }>("/api/admin/fix-request", {
      method: "POST", headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ note: `Rate limit "${labelFor(h.key)}" reached by ${h.subject_label || h.subject}${h.restaurant_name ? ` at ${h.restaurant_name}` : ""} (${h.hit_count} in ${perLabel(h.window_seconds)}). Investigate whether this is genuine abuse or the limit is too tight.`, restaurant_id: h.restaurant_id !== "00000000-0000-0000-0000-000000000000" ? h.restaurant_id : null, mode: "overnight" }),
    });
    if (res.ok) toast("Sent to Claude for the 2:30 AM robot."); else toast(res.error || "Couldn't send.", "err");
  };
  const labelFor = (key: string) => rules.find((r) => r.key === key)?.label || key;

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
      <div className="rl-sec" id="hits">
        <i className="fas fa-gauge-high" aria-hidden="true" style={{ color: hits.length ? "var(--adm-danger)" : "var(--muted)" }} />
        <h2>Limits reached</h2>
        {hits.length ? <span className="rl-chip danger">{hits.length}</span> : null}
        <span className="adm-muted" style={{ fontSize: 12 }}>who hit a wall right now · all restaurants</span>
      </div>
      {loading ? <div className="adm-empty">Loading…</div> : hits.length === 0 ? (
        <div className="rl-clear"><i className="fas fa-circle-check" aria-hidden="true" /> No limits reached right now.</div>
      ) : (
        <div style={{ marginBottom: 6 }}>
          {hits.map((h) => (
            <div key={h.id} className="rl-hit">
              <span className="rl-hit-bar" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                  <b style={{ fontSize: 13.5 }}>{labelFor(h.key)}</b>
                  <span className="rl-chip danger">{h.hit_count} / {h.max_count} per {perLabel(h.window_seconds)}</span>
                  {h.restaurant_name ? <span className="adm-muted" style={{ fontSize: 11.5 }}><i className="fas fa-store" aria-hidden="true" style={{ marginRight: 4, opacity: 0.6 }} />{h.restaurant_name}</span> : null}
                  <span className="adm-muted" style={{ fontSize: 11.5 }}>{timeAgo(h.last_at)}</span>
                </div>
                <div className="adm-muted" style={{ fontSize: 12.5 }}>Who: <b style={{ color: "var(--text)" }}>{h.subject_label || h.subject}</b></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
                  <button className="adm-btn primary" style={{ fontSize: 12 }} onClick={() => allowHit(h)} title="This was a real customer — reset their counter so they get through now">
                    <i className="fas fa-unlock" aria-hidden="true" style={{ marginRight: 6 }} />Allow (reset)
                  </button>
                  <a className="adm-btn" style={{ fontSize: 12 }} href={`#rule-${h.key}`} title="Jump to this limit's setting to raise or lower it">
                    <i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 6 }} />Change limit
                  </a>
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
      <div className="rl-sec">
        <i className="fas fa-sliders" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2>The limits</h2>
        <span className="adm-muted" style={{ fontSize: 12 }}>change how many actions are allowed per time window</span>
      </div>
      {loading ? <div className="adm-empty">Loading…</div> : (
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
        </div>
      )}

      <style>{`
        .rl-sec{display:flex;align-items:center;gap:9px;margin:22px 0 11px}
        .rl-sec h2{margin:0;font-size:16px}
        .rl-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--adm-accent,#e8a13c) 16%,transparent);color:var(--adm-accent,#e8a13c)}
        .rl-chip.danger{background:color-mix(in srgb,var(--adm-danger) 16%,transparent);color:var(--adm-danger)}
        .rl-clear{display:flex;align-items:center;gap:9px;padding:16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent);background:color-mix(in srgb,var(--adm-ok,#4caf82) 8%,var(--card));color:var(--text);font-size:13.5px}
        .rl-clear i{color:var(--adm-ok,#4caf82)}
        .rl-hit{position:relative;display:flex;gap:12px;padding:13px 14px 13px 16px;border-radius:12px;border:var(--border);background:var(--card);margin-bottom:10px;overflow:hidden}
        .rl-hit-bar{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--adm-danger)}
        .rl-rule{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 0;border-bottom:var(--border)}
        .rl-rule:last-child{border-bottom:none}
        .rl-num{width:74px;padding:6px 8px;border-radius:8px;border:var(--border);background:var(--card);color:var(--text);font-size:13px}
        .rl-toggle{display:inline-flex;align-items:center;gap:7px;border:var(--border);background:var(--card);border-radius:999px;padding:4px 10px 4px 5px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600}
        .rl-toggle .knob{width:14px;height:14px;border-radius:999px;background:var(--muted);transition:background .15s,transform .15s}
        .rl-toggle.on{color:var(--adm-ok,#4caf82);border-color:color-mix(in srgb,var(--adm-ok,#4caf82) 45%,transparent)}
        .rl-toggle.on .knob{background:var(--adm-ok,#4caf82);transform:translateX(3px)}
      `}</style>
    </>
  );
}
