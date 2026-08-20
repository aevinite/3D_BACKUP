"use client";
// Admin · System health — read-only platform diagnostics. Deliberately cheap: one
// small API call (/api/admin/health) that times a trivial round-trip, reads
// planner ROW ESTIMATES (not exact counts) for the big tables, and a couple of
// small bounded queries. No secrets, no food revenue. Manual Refresh +
// useActiveAutoRefresh (60s, only while visible & in use) — this page must never
// itself become a load source.
//
// ── REBUILT 2026-08-20 (owner: "I'm not able to see properly how the thing is in system health.
//    I have seen that setting for the first time") ─────────────────────────────────────────────
// What was wrong was not the data, it was that the page never ANSWERED anything. It opened with a
// strip of four tiny coloured pills — "Database 26ms · 9 restaurants live · 1 staff online now ·
// 1 open issue" — which the owner asked to be removed outright, and he was right twice over:
//   · a pill is a number with no sentence, so "26ms" only means something if you already know what
//     good looks like, and the amber "1 open issue" pill was amber on almost every load (the same
//     always-on-warning fault as the panels bar below);
//   · everything underneath it was written for a developer — "planner estimates", "realtime host",
//     five table names — so the two cards that filled the screen were the two he never needs, and
//     the thing he DOES need (is anything wrong, and where do I go) was nowhere.
//
// So the shape is now: one plain verdict → a labelled list of every check with what it MEANS and
// where to go → the actionable lists → and the developer detail folded away, still one tap from
// view. Nothing was dropped: the database timing and the complaint count, the only two facts the
// pills carried that were not already further down the page, are rows in that list.
//
// REJECTED (owner, 2026-08-20): the four-pill status strip that used to open this page — see R42 in
// docs/REJECTED-IDEAS.md. His words, with a screenshot of it: "we don't want the top thing. Shows
// four things here is the image". Do not re-add a pill strip, a chip row or a KPI band here.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { timeAgo, useActiveAutoRefresh } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type Health = {
  dbOk: boolean;
  latencyMs: number;
  tableEstimates: { table: string; estRows: number }[];
  tableEstimatesError: string | null;
  restaurants: { active: number; suspended: number; total: number };
  restaurantsError?: string | null;
  staffOnlineNow: number;
  staffTotal: number;
  staffError?: string | null;
  realtime: { configuredHost: string | null };
  openIssues: number | null;
  issuesFeedWired: boolean;
  // Dishes ticked "4D" whose model file was never uploaded, so their 3D view cannot open.
  // null = the read failed (say "unreadable", never a reassuring zero).
  broken3d: { count: number; dishes: { slug: string; title: string; restaurantId: string; missing: string }[] } | null;
  broken3dError: string | null;
  checkedAt: string;
  error?: string;
};

const TABLE_LABEL: Record<string, string> = {
  orders: "Orders", order_items: "Order items", sessions: "Sessions", staff_users: "Staff users", restaurants: "Restaurants",
};

// What the database's answering time actually MEANS. The old pill printed "26ms" and left the
// reader to know whether that was good — which is the whole problem with a pill.
function latencyTier(ms: number): { tone: Tone; word: string } {
  if (ms < 300) return { tone: "good", word: "fast" };
  if (ms < 900) return { tone: "warn", word: "slow, but working" };
  return { tone: "bad", word: "very slow" };
}

// ── Panels & devices — folded in from the old separate "Panel status" page (2026-07-23):
// per-restaurant panel CONNECTIVITY (last-seen → online/idle/quiet/never), from
// /api/admin/panels-health. Two health screens were one job; this is now a section here.
type Panel = { role: string; on: boolean; lastSeen: string | null; status: "off" | "never" | "online" | "idle" | "offline" };
type PRow = { id: string; name: string; slug: string; active: boolean; panels: Panel[] };
type PData = { rows: PRow[]; roles: string[]; attention: number; generatedAt: string };

const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner" };
const PSTATUS = {
  online: { c: "var(--adm-ok)", t: "Online" },
  idle: { c: "#d4a574", t: "Idle" },
  offline: { c: "var(--adm-danger)", t: "Quiet" },
  never: { c: "var(--adm-danger)", t: "Never seen" },
  off: { c: "var(--muted)", t: "Off" },
} as const;

function PanelCell({ p }: { p: Panel }) {
  // The OWNER panel is left OUT of the attention count (owners don't sit logged in), so a
  // red "never/quiet" owner cell was a false alarm — render it neutral instead.
  const ownerQuiet = p.role === "owner" && (p.status === "never" || p.status === "offline");
  const s = ownerQuiet ? { c: "var(--muted)", t: p.status === "never" ? "Not signed in" : "Quiet" } : PSTATUS[p.status];
  const hollow = p.status === "never" && !ownerQuiet;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }} title={p.on ? (p.lastSeen ? `Last active ${timeAgo(p.lastSeen)}` : "Never seen active") : "Panel disabled for this restaurant"}>
      <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", border: hollow ? `1px solid ${s.c}` : undefined, backgroundColor: hollow ? "transparent" : s.c }} aria-hidden="true" />
      <span style={{ fontSize: 12.5, color: p.status === "off" || ownerQuiet ? "var(--muted)" : "var(--text)" }}>
        {s.t}{p.on && p.lastSeen && (p.status === "idle" || p.status === "offline") ? ` · ${timeAgo(p.lastSeen)}` : ""}
      </span>
    </span>
  );
}

// ── One check, one row ────────────────────────────────────────────────────────────────────────
// A row says four things in a fixed order, and the order is the point: WHAT was checked, WHAT the
// answer is, WHAT that means in plain words, and WHERE to go if it needs you. A coloured dot alone
// (the old pills) says only the last quarter of that, and only to someone who already knows.
//
// `unknown` is its own tone on purpose and is never green: a check that could not run is not a
// check that passed — the fault this page was fixed for on 2026-08-19, kept in the new shape.
type Tone = "good" | "warn" | "bad" | "unknown" | "plain";
const TONE_COLOR: Record<Tone, string> = {
  good: "var(--adm-ok, #4caf82)",
  warn: "#d4a574",
  bad: "var(--adm-danger)",
  unknown: "var(--muted)",
  plain: "var(--muted)",
};

type Check = {
  key: string;
  label: string;          // what was checked
  value: string;          // the answer, big enough to read
  means: string;          // what it means, in words a non-developer reads
  tone: Tone;
  /** Only when there is somewhere useful to go. A link on every row is a link on no row. */
  go?: { href: string; label: string };
  /** True = this is one of the things that needs him. Drives the verdict line at the top. */
  needsYou?: boolean;
};

function CheckRow({ c }: { c: Check }) {
  return (
    <div className="hx-check">
      <span className="hx-dot" style={{ background: TONE_COLOR[c.tone] }} aria-hidden="true" />
      <span className="hx-label">{c.label}</span>
      <span className="hx-value" style={{ color: c.tone === "bad" ? "var(--adm-danger)" : undefined }}>{c.value}</span>
      <span className="hx-means">{c.means}</span>
      {c.go ? <Link className="hx-go" href={c.go.href}>{c.go.label} <i className="fas fa-arrow-right" aria-hidden="true" style={{ fontSize: 9 }} /></Link> : <span />}
    </div>
  );
}

export default function AdminHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [pd, setPd] = useState<PData | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The developer detail is folded away by default — see the header note. It is one tap, not a
  // different page: the estimates and the backend host are still the fastest way to answer "is this
  // pointed at the right database" when something is genuinely wrong.
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setPErr(null);
    // Both health checks in parallel; they're independent, so a panels failure never blocks
    // the diagnostics above and vice-versa.
    const [healthRes, panelsRes] = await Promise.allSettled([
      fetch("/api/admin/health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      fetch("/api/admin/panels-health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    ]);
    if (healthRes.status === "fulfilled" && healthRes.value.ok) setH(healthRes.value.j);
    else setErr(healthRes.status === "fulfilled" ? (healthRes.value.j?.error || "Couldn't load health.") : "Couldn't load health.");
    if (panelsRes.status === "fulfilled" && panelsRes.value.ok) setPd(panelsRes.value.j);
    else setPErr(panelsRes.status === "fulfilled" ? (panelsRes.value.j?.error || "Couldn't load panel status.") : "Couldn't load panel status.");
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  // Restaurant id → name, from the panels-health rows this page already has. No extra request.
  const restaurantName = (id: string) => pd?.rows.find((r) => r.id === id)?.name || "unknown restaurant";

  // ── The panel counts, needed by BOTH the check list and the bar further down ─────────────────
  // A WARNING THAT IS ALWAYS UP IS NOT A WARNING (T17 sweep, 2026-08-19). This once counted every
  // enabled panel not seen in the last HOUR and called all of them "a device or login may be down".
  // A restaurant that is shut has every panel quiet, so on this platform it read "23 enabled panels
  // quiet or never seen" on every single load, for ever — twenty of the twenty-three were closed
  // restaurants. An admin who sees the same amber bar every morning stops reading it, and the three
  // that DO matter go with it. NEVER SEEN is the one that is genuinely wrong at any hour: an enabled
  // panel nobody has ever signed into is a setup that was not finished. That keeps the warning;
  // "quiet for over an hour" is stated as the plain fact it is.
  const liveRows = (pd?.rows || []).filter((r) => r.active);
  const neverSeen = liveRows.reduce((n, r) => n + r.panels.filter((x) => x.role !== "owner" && x.status === "never").length, 0);
  const quietNow = liveRows.reduce((n, r) => n + r.panels.filter((x) => x.role !== "owner" && x.status === "offline").length, 0);

  // ── Every check, in one list ─────────────────────────────────────────────────────────────────
  const checks: Check[] = [];
  if (h && h.dbOk) {
    const lat = latencyTier(h.latencyMs);
    checks.push({
      key: "db", label: "Database", value: `${h.latencyMs} ms`, tone: lat.tone,
      means: `How long one simple read took — ${lat.word}.`,
      needsYou: lat.tone === "bad",
    });
    checks.push(h.restaurantsError ? {
      key: "rest", label: "Restaurants", value: "unknown", tone: "unknown",
      means: "Couldn't read the restaurant list, so this is unknown — not zero.", needsYou: true,
    } : {
      key: "rest", label: "Restaurants", value: String(h.restaurants.active), tone: h.restaurants.suspended > 0 ? "warn" : "good",
      means: h.restaurants.suspended > 0
        ? `Open for business. ${h.restaurants.suspended} more ${h.restaurants.suspended === 1 ? "is" : "are"} suspended.`
        : "All open for business — none suspended.",
      go: { href: "/aevinite/restaurants", label: "Restaurants" },
    });
    checks.push(h.staffError ? {
      key: "staff", label: "Staff signed in", value: "unknown", tone: "unknown",
      means: "Couldn't read who is signed in, so this is unknown — not nobody.", needsYou: true,
    } : {
      // 0 staff online is NORMAL (overnight, between shifts) — it is not a fault, so it is never
      // amber. Only a failed READ is (audit 2026-07-23, kept).
      key: "staff", label: "Staff signed in", value: `${h.staffOnlineNow} of ${h.staffTotal}`, tone: "plain",
      means: h.staffOnlineNow > 0
        ? "Active in the last 3 minutes. Nobody signed in is normal out of hours."
        : "Nobody in the last 3 minutes — normal when the restaurants are closed.",
      go: { href: "/aevinite/staff-online", label: "Who's online" },
    });
    checks.push(!h.issuesFeedWired ? {
      key: "issues", label: "Complaints", value: "unknown", tone: "unknown",
      means: "Couldn't reach the complaints list, so this is unknown — not clear.", needsYou: true,
    } : {
      // REJECTED (owner, 2026-08-20): an amber light for a single open complaint — R43 in
      // docs/REJECTED-IDEAS.md, his answer to T17 decision 16 ("this is not need").
      // NOT AMBER FOR ONE OPEN COMPLAINT. With ten restaurants
      // there is nearly always one open, so an amber light here was amber most days, which is how
      // you teach someone to ignore amber. An open complaint is work, not a fault: it gets a plain
      // dot and a way straight to it, and only an unusual pile-up is worth a colour.
      key: "issues", label: "Complaints", value: String(h.openIssues ?? 0), tone: (h.openIssues || 0) >= 10 ? "warn" : "plain",
      means: (h.openIssues || 0) === 0
        ? "Nothing raised by staff or owners is waiting."
        : (h.openIssues || 0) >= 10
        ? "That is an unusual number waiting — worth a look today."
        : "Raised by staff or owners and waiting for you. Normal to have a few.",
      go: { href: "/aevinite/repair#complaints", label: "Repair" },
      needsYou: (h.openIssues || 0) >= 10,
    });
    checks.push(h.broken3d === null ? {
      key: "3d", label: "3D dishes", value: "unknown", tone: "unknown",
      means: `Couldn't check the model files${h.broken3dError ? ` (${h.broken3dError})` : ""} — unknown, not zero.`, needsYou: true,
    } : {
      key: "3d", label: "3D dishes", value: h.broken3d.count === 0 ? "all fine" : String(h.broken3d.count),
      tone: h.broken3d.count === 0 ? "good" : "warn",
      means: h.broken3d.count === 0
        ? "Every dish marked 4D has its model files uploaded."
        : `Marked 4D but the model file was never uploaded, so their 3D view can't open.`,
      needsYou: h.broken3d.count > 0,
    });
  }
  if (pd) {
    checks.push({
      key: "panels", label: "Staff screens", value: neverSeen === 0 ? "all set up" : String(neverSeen),
      tone: neverSeen === 0 ? "good" : "warn",
      means: neverSeen === 0
        ? `Every switched-on screen has been signed into at least once.${quietNow > 0 ? ` ${quietNow} ${quietNow === 1 ? "is" : "are"} quiet right now — normal for a closed restaurant.` : ""}`
        : `Switched on but never signed into — that setup was never finished.${quietNow > 0 ? ` ${quietNow} more ${quietNow === 1 ? "is" : "are"} simply quiet, which is normal.` : ""}`,
      needsYou: neverSeen > 0,
    });
  } else if (pErr) {
    checks.push({ key: "panels", label: "Staff screens", value: "unknown", tone: "unknown", means: "Couldn't read the panel list, so this is unknown — not fine.", needsYou: true });
  }

  const needs = checks.filter((c) => c.needsYou);
  const anyUnknown = checks.some((c) => c.tone === "unknown");

  return (
    <>
      <h1 className="adm-page-h">System health</h1>
      <p className="adm-page-sub">Is the platform working, and is anything waiting for you. {h ? <>Last checked {timeAgo(h.checkedAt)}.</> : null}</p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {h === null && err ? (
        // A FAILED CHECK IS NOT A CHECK IN PROGRESS (T17 sweep, 2026-08-19). The error line was
        // printed and then the page fell through to "Checking…" underneath it — so the one screen
        // that answers "is the platform up?" sat saying it was still looking, for ever.
        <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", borderColor: "var(--adm-warn)" }}>
          <span className="adx-pill warn"><span className="dot" />Couldn&apos;t check</span>
          <span className="adm-muted" style={{ fontSize: 13 }}>{err} This is <b>unknown</b>, not healthy.</span>
          <button className="adm-btn" style={{ marginLeft: "auto" }} disabled={loading} onClick={load}>Retry</button>
        </div>
      ) : null}

      {h === null ? (
        err ? null : <div className="adm-empty">Checking…</div>
      ) : !h.dbOk ? (
        // Database ping failed → the API omits every summary field, so we must NOT
        // fall through to the normal render (it reads h.restaurants.* and would crash
        // the whole page exactly when the DB is down — the one moment this page matters).
        <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="adx-pill bad"><span className="dot" />Database unreachable</span>
          <span className="adm-muted" style={{ fontSize: 13 }}>
            The health check couldn&apos;t reach the database{h.latencyMs ? ` (after ${h.latencyMs}ms)` : ""}.
            {h.error ? <> Details: <span className="mono">{h.error}</span></> : null} Press Refresh to retry.
          </span>
        </div>
      ) : (
        <>
          {/* ── THE VERDICT ──────────────────────────────────────────────────────────────────────
              One sentence, in words, before any number. This is what replaces the strip of four
              pills: it answers the question the page is opened with, and it NAMES what needs him
              rather than making him decode five colours. It goes green only when every check both
              ran and passed — a check that could not run is called out, never coloured green. */}
          <div className={`hx-verdict ${needs.length ? "hx-attn" : anyUnknown ? "hx-part" : "hx-ok"}`}>
            <i className={`fas ${needs.length ? "fa-triangle-exclamation" : anyUnknown ? "fa-circle-question" : "fa-circle-check"}`} aria-hidden="true" />
            <span>
              {needs.length ? (
                <>
                  <b>{needs.length} thing{needs.length === 1 ? "" : "s"} need{needs.length === 1 ? "s" : ""} you</b> — {needs.map((c) => c.label.toLowerCase()).join(", ")}.
                  {" "}The list below says what and where.
                </>
              ) : anyUnknown ? (
                <><b>Mostly fine, but some checks couldn&rsquo;t run.</b> That is unknown, not healthy — press Refresh.</>
              ) : (
                <><b>Everything is working.</b> Nothing on this page needs you right now.</>
              )}
            </span>
          </div>

          {/* ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────── */}
          <div className="adm-card hx-checks" style={{ padding: 0, marginBottom: 14, overflow: "hidden" }}>
            <div className="hx-checks-h">
              <h2 style={{ margin: 0, fontSize: 14 }}>What was checked</h2>
              <span className="adm-muted" style={{ fontSize: 11.5 }}>{checks.length} checks · refreshes itself every minute while you&rsquo;re here</span>
            </div>
            {checks.map((c) => <CheckRow key={c.key} c={c} />)}
          </div>

          {/* 3D THAT CANNOT OPEN (owner, 2026-08-12). A dish ticked "4D" whose model file was never
              uploaded used to wear a "4D" badge on the menu and then tell the diner "3D view isn't
              ready for this dish". The badge no longer lies (components/FoodCard.tsx → has3d), and
              this is where the owner finds out there is something to upload. Read-only and quiet on
              purpose — no phone alert for a missing file.
              Only drawn when there IS something to do: the "all fine" case is a row in the list
              above, and a whole card saying "nothing to fix" is how a page gets too long to read. */}
          {h.broken3d !== null && h.broken3d.count > 0 && (
            <div className="adm-card" style={{ marginBottom: 14 }}>
              <div className="adm-cardbody">
                <h2>3D dishes with no model file</h2>
                <p className="hint">
                  A dish marked <strong>4D</strong> needs its model uploaded before a diner can spin it.
                  These are ticked but have no file, so their 3D view cannot open — the menu quietly shows
                  them as ordinary dishes until the file is there.
                </p>
                {/* WHICH RESTAURANT — otherwise this is a dish name and nothing to do with it
                    (T17 sweep, 2026-08-19). There are nine restaurants on this platform; a row
                    reading "Truffle Fries · missing: small" does not tell the admin whose menu to
                    open. The name comes from the panels-health rows already fetched below, so it
                    costs no extra request. */}
                <div className="adm-logwrap hx-kv">
                  {h.broken3d.dishes.map((d) => (
                    <div key={`${d.restaurantId}-${d.slug}`} className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}>
                      <span style={{ minWidth: 0 }}>
                        {d.title || d.slug}
                        <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />
                          {restaurantName(d.restaurantId)}
                        </span>
                      </span>
                      <span className="mono adm-muted">missing: {d.missing}</span>
                    </div>
                  ))}
                </div>
                {h.broken3d.count > h.broken3d.dishes.length && (
                  <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                    Showing the first {h.broken3d.dishes.length} of {h.broken3d.count}.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Panels & devices (was the separate "Panel status" page) — per-restaurant connectivity.
          The amber BAR that used to sit here is gone: it said the same thing as the "Staff screens"
          row in the list above, so it was one fact wearing two coats — and the coat it wore was a
          warning triangle, on every load. The grid itself is the actionable part and is untouched. */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "18px 0 11px" }}>
        <i className="fas fa-signal" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2 style={{ margin: 0, fontSize: 16 }}>Every staff screen, restaurant by restaurant</h2>
      </div>
      <p className="adm-muted" style={{ fontSize: 12.5, margin: "-4px 0 10px" }}>
        <b style={{ color: "var(--text)" }}>Online</b> = used in the last few minutes · <b style={{ color: "var(--text)" }}>Idle</b> = a little while ago ·{" "}
        <b style={{ color: "var(--text)" }}>Quiet</b> = nothing for over an hour, which is normal when a restaurant is closed ·{" "}
        <b style={{ color: "var(--text)" }}>Never seen</b> = switched on but nobody has ever signed in, so that setup was never finished ·{" "}
        <b style={{ color: "var(--text)" }}>Off</b> = you haven&rsquo;t given that restaurant this screen.
      </p>
      {pErr && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{pErr} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}
      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!pd ? (pErr ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={4} label="Loading" />) : pd.rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          // Horizontal scroll on narrow screens (the 5-col grid is ~560px min). Deliberate here:
          // you read DOWN a column to compare restaurants, so squeezing it would destroy the point.
          <div className="adm-logwrap" style={{ border: 0, overflowX: "auto" }}>
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560 }}>
              <span>Restaurant</span>
              {pd.roles.map((r) => <span key={r}>{ROLE_LABEL[r] || r}</span>)}
            </div>
            {pd.rows.map((row) => (
              <div key={row.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{row.name}</span>
                  {!row.active && <span style={{ fontSize: 11, color: "var(--muted)" }}>suspended</span>}
                </span>
                {row.panels.map((p) => <PanelCell key={p.role} p={p} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── The developer detail, folded ────────────────────────────────────────────────────────
          Row estimates and the backend host are real and worth keeping — they are the fastest way
          to answer "is this even pointed at the right database" — but they are not what this page
          is opened for, and they were taking the top half of the screen. One tap away, not gone. */}
      {h && h.dbOk && (
        <div style={{ marginTop: 16 }}>
          <button className="hx-fold" onClick={() => setDetailOpen((v) => !v)} aria-expanded={detailOpen}>
            <i className={`fas fa-chevron-${detailOpen ? "down" : "right"}`} aria-hidden="true" style={{ fontSize: 10, marginRight: 8 }} />
            Technical detail <span className="adm-muted" style={{ fontWeight: 400 }}>· table sizes and which backend this is pointed at</span>
          </button>
          {detailOpen && (
            <div className="adx-grid2col" style={{ marginTop: 10 }}>
              <div className="adm-card" style={{ marginBottom: 14 }}>
                <h2>Row count estimates</h2>
                <p className="hint">Postgres&apos; own row-count metadata, not exact counts — an exact COUNT(*) on these tables would itself be a heavy scan.</p>
                {h.tableEstimatesError ? (
                  <div className="adm-empty">Couldn&apos;t read estimates: {h.tableEstimatesError}</div>
                ) : (
                  <div className="adm-logwrap hx-kv">
                    <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 120px" }}><span>Table</span><span style={{ textAlign: "right" }}>~ rows</span></div>
                    {h.tableEstimates.map((t) => (
                      <div key={t.table} className="adm-logrow" style={{ gridTemplateColumns: "1fr 120px" }}>
                        <span>{TABLE_LABEL[t.table] || t.table}</span>
                        <span style={{ textAlign: "right", fontWeight: 700 }}>{t.estRows.toLocaleString("en-US")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="adm-card" style={{ marginBottom: 14 }}>
                <h2>Backend &amp; live updates</h2>
                <p className="hint">Confirms the app is pointed at the right backend — no keys shown.</p>
                <div className="adm-logwrap hx-kv">
                  <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Live-updates host</span><span className="mono adm-muted">{h.realtime.configuredHost || "not configured"}</span></div>
                  <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Database answered in</span><span style={{ fontWeight: 700 }}>{h.latencyMs} ms</span></div>
                  <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Staff accounts (live restaurants)</span><span style={{ fontWeight: 700 }}>{h.staffTotal}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style href="adm-health" precedence="default">{`
        /* ── The verdict line ───────────────────────────────────────────────────────────────── */
        .hx-verdict{display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border-radius:12px;border:var(--border);background:var(--card);font-size:13.5px;line-height:1.55;margin-bottom:14px}
        .hx-verdict i{margin-top:2px;flex:0 0 auto}
        .hx-verdict.hx-ok{border-color:color-mix(in srgb,var(--adm-ok,#4caf82) 35%,transparent);background:color-mix(in srgb,var(--adm-ok,#4caf82) 8%,var(--card))}
        .hx-verdict.hx-ok i{color:var(--adm-ok,#4caf82)}
        .hx-verdict.hx-attn{border-color:color-mix(in srgb,#d4a574 45%,transparent);background:color-mix(in srgb,#d4a574 8%,var(--card))}
        .hx-verdict.hx-attn i{color:#d4a574}
        /* "Some checks couldn't run" is NEITHER green nor a warning about the platform — it is a
           warning about our own reading, so it gets the neutral tone and says so in words. */
        .hx-verdict.hx-part i{color:var(--muted)}

        /* ── One check per row ──────────────────────────────────────────────────────────────── */
        .hx-checks-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:var(--border)}
        .hx-check{display:grid;grid-template-columns:10px 150px 92px 1fr auto;align-items:center;gap:12px;padding:12px 16px;border-bottom:var(--border);font-size:13px}
        .hx-checks > .hx-check:last-child{border-bottom:0}
        .hx-dot{width:9px;height:9px;border-radius:999px;flex:0 0 auto}
        .hx-label{font-weight:600}
        .hx-value{font-weight:800;font-variant-numeric:tabular-nums;font-size:14.5px}
        .hx-means{color:var(--muted);font-size:12.5px;line-height:1.5;min-width:0}
        .hx-go{color:var(--accent);font-size:12px;white-space:nowrap;text-decoration:none}
        .hx-go:hover{text-decoration:underline}

        /* ON A PHONE a five-column row is unreadable, and the console's own 540px min-width rule
           would push the value off the right edge with nothing hinting you could drag it — the
           measured fault this page was fixed for on 2026-08-19. So the row becomes a small block:
           name and answer on one line, the meaning under it, the link last. Nothing is dropped. */
        @media (max-width:720px){
          .hx-check{grid-template-columns:10px 1fr auto;grid-template-areas:"dot label value" ". means means" ". go go";row-gap:4px;padding:12px 14px}
          .hx-check > .hx-dot{grid-area:dot;align-self:start;margin-top:5px}
          .hx-check > .hx-label{grid-area:label}
          .hx-check > .hx-value{grid-area:value;text-align:right}
          .hx-check > .hx-means{grid-area:means}
          .hx-check > .hx-go{grid-area:go;justify-self:start}
        }

        /* ── The folded technical detail ────────────────────────────────────────────────────── */
        .hx-fold{display:flex;align-items:center;width:100%;background:none;border:var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:left;min-height:42px}
        .hx-fold:hover{background:color-mix(in srgb,var(--text) 4%,transparent)}

        /* THE NUMBERS ARE THE WHOLE POINT OF THESE CARDS (T17 sweep, 2026-08-19).
           The console's phone rule gives every .adm-logrow a 540px min-width and lets the wrapper
           scroll sideways. That is the right call for the admin's comparison tables — you read
           down a column there. It is the wrong call for a two-column key -> value list: measured on
           a 360px screen the card is 296px wide and the row is 540px, so "Row count estimates"
           showed five table names and NOT ONE number. These lists fit instead, the value sitting
           under its label. Same rows, same order. */
        @media (max-width: 560px) {
          .hx-kv .adm-logrow { min-width: 0; grid-template-columns: 1fr !important; gap: 3px; padding: 10px 14px; }
          .hx-kv .adm-logrow > :nth-child(2) { text-align: left !important; font-size: 12.5px; }
          .hx-kv .adm-logrow.head { display: none !important; }
        }
      `}</style>
    </>
  );
}
