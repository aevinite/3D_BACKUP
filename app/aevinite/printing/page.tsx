"use client";
// Admin · Printing — the one screen that decides where a restaurant's paper comes out.
//
// WHY IT IS ITS OWN MENU (owner, 2026-08-20: "maybe we can create whole new printing menu in the
// admin panel for setup and all"). Printing was spread across three places — a hidden switch on the
// restaurant card, a target dropdown in settings, and a strip inside the manager panel — and none of
// them could answer the question a restaurant actually asks: WHICH printer does this piece of paper
// come out of. That question now has one screen.
//
// It is the ADMIN's screen because printing is hardware: which computers may print, and what each
// prints, is granted, not chosen by the restaurant. The owner is shown only what is allowed (R36).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";
import { SkelList } from "@/components/admin/Skeleton";
// THE WORDS ARE SHARED WITH THE RESTAURANT'S OWN SCREEN (owner, 2026-08-27: "the UI/UX is also not
// identical"). Four steps, three kinds of paper, one sentence each — declared once in
// lib/printBoardWords.ts and printed verbatim by both boards, so they cannot drift apart again.
import { STEPS, KIND_LABEL, KIND_WHAT, KIND_OFF_LABEL, PAPER_PRESETS, paperLabel } from "@/lib/printBoardWords";

type Rest = { id: string; slug: string; name: string };
type Paper = { name?: string; wMm: number; hMm: number };
type Printer = { name: string; desc?: string; paper?: Paper };
type Agent = {
  id: string; name: string; printers: Printer[]; last_seen_at: string | null;
  connected: boolean; secondsAgo: number | null; fingerprintClash: boolean;
};
type Route = { agent: string | null; printer: string | null; backupAgent?: string | null; backupPrinter?: string | null; paper?: Paper;
  via?: "computer" | "screen" | "off"; panel?: string | null; person?: string | null; personName?: string | null; device?: string | null;
  /** The second screen allowed to take what the first leaves sitting — the retired "both" (mig 369). */
  backupPanel?: string | null };
type Person = { id: string; name: string; role: string; panels: string[] };
type Device = { device_id: string; label?: string | null; panel?: string | null; last_seen_at?: string | null };
type Job = { id: string; kind: string; status: string; printer: string | null; printed_by: string | null; attempts: number; error: string | null; created_at: string; done_at: string | null };
type Stuck = { n: number; oldestMs: number | null; afterMs: number };
type State = {
  agents: Agent[]; routes: Record<string, Route>; waiting: number; stuck?: Stuck; recent: Job[];
  kinds: string[]; printing: { allowed: boolean; on: boolean };
  panels?: string[]; people?: Person[]; devices?: Device[]; managerMayPrint?: boolean;
  mode?: "computer" | "screen";
  files?: Record<string, { filename: string; autostart: string; text: string }>;
  stationFiles?: Record<string, { filename: string; firstRun: string; text: string }>;
};
/** ONE ROW PER RESTAURANT (owner, 2026-08-27: "it will be messy when there will be too much
 *  restaurants… I could be able to differentiate all the restaurants"). */
type OverRow = {
  id: string; slug: string; name: string; allowed: boolean; on: boolean;
  computers: number; connected: number; secondsAgo: number | null; names: string[];
  routed: number; waiting: number; oldestMs: number | null;
};
type Over = { rows: OverRow[]; staleMs: number; stuckAfterMs: number };

const OS_LABEL: Record<string, string> = { mac: "Mac", windows: "Windows", linux: "Linux / Raspberry Pi" };


/** THE WATCH SCREEN. Not a form — a list you glance at, ordered so the worst thing is at the top.
 *
 *  Every row answers three questions in the order they are asked: is a computer awake, is paper
 *  stacked up behind it, and has anybody said which printer gets what. A shop that is fine is one
 *  quiet line; a shop that is broken is red at the top of the page. */
function Overview({ over, onOpen }: { over: Over; onOpen: (id: string) => void }) {
  const stuckAfter = over.stuckAfterMs || 60000;
  const rank = (r: OverRow) => {
    // Lower sorts first. The order IS the design: a pile-up outranks a sleeping computer, which
    // outranks "nobody has set this up", which outranks a shop that is simply not entitled.
    if (r.waiting > 0 && (r.oldestMs ?? 0) >= stuckAfter) return 0;
    if (r.allowed && r.computers > 0 && r.connected === 0) return 1;
    if (r.allowed && r.computers === 0) return 2;
    if (r.allowed && r.routed === 0) return 3;
    if (!r.allowed) return 5;
    return 4;
  };
  const rows = [...over.rows].sort((a, b) => rank(a) - rank(b) || b.waiting - a.waiting || a.name.localeCompare(b.name));
  const age = (ms: number | null) => !ms ? "" : ms < 60000 ? "under a minute" : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3600000)}h`;
  const seen = (r: OverRow) =>
    !r.computers ? "no computer yet"
    : r.connected ? `awake · seen ${r.secondsAgo ?? 0}s ago`
    : r.secondsAgo == null ? "never started"
    : r.secondsAgo > 3600 ? `asleep · ${Math.round(r.secondsAgo / 3600)}h` : `asleep · ${Math.round(r.secondsAgo / 60)} min`;

  const verdict = (r: OverRow) => {
    if (!r.allowed) return { cls: "off", word: "not switched on", what: "Printing does not exist for them — nothing appears in their panels." };
    if (r.waiting > 0 && (r.oldestMs ?? 0) >= stuckAfter)
      return { cls: "warn", word: `${r.waiting} stuck`, what: `Nothing has printed for ${age(r.oldestMs)}. Their kitchen screen is saying so too.` };
    if (r.computers > 0 && r.connected === 0) return { cls: "warn", word: "asleep", what: "Its helper is not running. Anything sent is waiting." };
    if (r.computers === 0) return { cls: "todo", word: "no computer", what: "Nobody has run the helper yet, so nothing can print." };
    if (r.routed === 0) return { cls: "todo", word: "not routed", what: "A computer is here, but nobody has said which printer gets which paper." };
    return { cls: "ok", word: "printing", what: `${r.connected} computer${r.connected === 1 ? "" : "s"} awake · ${r.routed} of 3 papers routed` };
  };

  return (
    <div className="adm-card" style={{ marginTop: 14, marginBottom: 30 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Every restaurant</h2>
      <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Anything that needs you is at the top. Click a row to set that restaurant up.
      </p>
      <div className="adm-over">
        {rows.map((r) => {
          const v = verdict(r);
          return (
            <button key={r.id} type="button" className={`adm-over-row ${v.cls}`} onClick={() => onOpen(r.id)}>
              <span className="dot" aria-hidden="true" />
              <span className="nm">
                <b>{r.name}</b>
                {/* No leading em-dash when there is nothing to name: "— · no computer yet" reads
                    like a missing value beside a real one. */}
                <small>{r.names.length ? `${r.names.join(", ")} · ${seen(r)}` : seen(r)}</small>
              </span>
              <span className="what">{v.what}</span>
              {/* The word carries the state as well as the colour — colour alone is not an answer
                  for anyone who cannot tell green from amber (WCAG 1.4.1). */}
              <span className="tag">{v.word}</span>
              <span className="go" aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>
      {!rows.length ? <p className="adm-muted" style={{ fontSize: 13, margin: 0 }}>No restaurants yet.</p> : null}
    </div>
  );
}

/** ONE CARD SHAPE FOR BOTH LAUNCHER FILES.
 *
 *  The helper file and the print-station file are the same idea told twice — a per-OS tab strip,
 *  numbered steps, a Copy button and a dark code box. Two copies of that markup is two places for
 *  the wording to drift, which is the whole reason the printing screens were "not identical" in the
 *  first place. One component, two callers. */
function FileCard({ title, lead, files, os, setOs, copy, steps, footer }: {
  title: string;
  lead: React.ReactNode;
  files?: Record<string, { filename: string; text: string }>;
  os: string;
  setOs: (v: string) => void;
  copy: (t: string) => void | Promise<void>;
  steps: (os: string) => React.ReactNode[];
  footer: (os: string) => React.ReactNode;
}) {
  const f = files?.[os];
  if (!files || !f) return null;
  return (
    <div className="adm-card" style={{ marginTop: 14 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>{title}</h2>
      <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>{lead}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.keys(files).map((k) => (
          <button key={k} className={`adm-btn${os === k ? " primary" : ""}`} style={{ fontSize: 12 }} onClick={() => setOs(k)}>
            {OS_LABEL[k] || k}
          </button>
        ))}
      </div>
      <ol className="adm-muted" style={{ fontSize: 13, margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.75 }}>
        {steps(os).map((n, i) => <li key={i}>{n}</li>)}
      </ol>
      <p className="adm-muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>{footer(os)}</p>
      <div style={{ position: "relative" }}>
        <button className="adm-btn" style={{ position: "absolute", top: 8, right: 8, fontSize: 12, zIndex: 2 }}
          onClick={() => void copy(f.text)}>Copy</button>
        <pre style={{ background: "#0f1420", color: "#e7ecf5", padding: "14px 16px", borderRadius: 11, overflowX: "auto", fontSize: 12, lineHeight: 1.5, maxHeight: 300 }}>
          {f.text}
        </pre>
      </div>
    </div>
  );
}

export default function AdminPrinting() {
  const toast = useToast();
  const [rests, setRests] = useState<Rest[]>([]);
  const [rid, setRid] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  // A FAILED LOAD IS NOT AN ALL-CLEAR: without this the page would render "no computers yet" and an
  // empty address book after a request that never arrived — four confident answers to a question it
  // failed to ask (the fault the T17 sweep found on three other admin pages).
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [os, setOs] = useState<string>("mac");
  const [draft, setDraft] = useState<Record<string, Route>>({});
  const [over, setOver] = useState<Over | null>(null);
  const [overErr, setOverErr] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const urlRid = q.get("rid") || "";
    adminFetch<Rest[] | { restaurants: Rest[] }>("/api/admin/restaurants").then((r) => {
      if (!r.ok) { setLoadErr(r.error); setLoading(false); return; }
      const all: Rest[] = Array.isArray(r.data) ? r.data : r.data.restaurants || [];
      setRests(all);
      // IT OPENS ON THE OVERVIEW, not on whichever restaurant happens to be first alphabetically.
      // A restaurant is drilled into deliberately, from a row — that is what makes this screen a
      // place to WATCH from rather than a form to hunt through.
      const pick = all.find((x) => x.id === urlRid) || all.find((x) => x.slug === urlRid);
      if (pick) setRid(pick.id); else setLoading(false);
    });
  }, []);

  const load = useCallback(async () => {
    if (!rid) return;
    setLoading(true);
    const r = await adminFetch<State>(`/api/admin/printing/state?rid=${encodeURIComponent(rid)}`);
    setLoading(false);
    if (!r.ok) { setLoadErr(r.error); setSt(null); return; }
    setLoadErr(""); setSt(r.data); setDraft(r.data.routes as Record<string, Route>);
  }, [rid]);
  useEffect(() => { void load(); }, [load]);

  const loadOver = useCallback(async () => {
    const r = await adminFetch<Over>("/api/admin/printing/overview");
    // A FAILED READ IS NOT AN ALL-CLEAR. Without this the table would render "no restaurants" after
    // a request that never arrived — a confident wrong answer, which is the fault the T17 sweep
    // found on three other admin pages.
    if (!r.ok) { setOverErr(r.error); setOver(null); return; }
    setOverErr(""); setOver(r.data);
  }, []);
  useEffect(() => { if (!rid) void loadOver(); }, [rid, loadOver]);
  // Only while it is the screen being looked at: "seen 3s ago" is the one live thing on it.
  useEffect(() => {
    if (rid) return;
    const t = setInterval(() => { void loadOver(); }, 12000);
    return () => clearInterval(t);
  }, [rid, loadOver]);

  // While a helper is connected its "seen 2s ago" is the only live thing on the page, so the page
  // re-reads itself every 10s — slow enough to cost nothing, fast enough that "connected" is true.
  useEffect(() => {
    if (!rid) return;
    const t = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(t);
  }, [rid, load]);

  const rest = rests.find((r) => r.id === rid);
  const agents = st?.agents || [];
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(path);
    const r = await adminFetch<Record<string, unknown>>(`/api/admin/printing/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid, ...body }),
    });
    setBusy("");
    if (!r.ok) { toast(r.error, "err"); return null; }
    return r.data;
  };


  const saveRoute = async (kind: string) => {
    const r = draft[kind] || {};
    const d = await post("routes", { routes: { [kind]: {
      via: r.via || (r.agent ? "computer" : undefined),
      agent: r.agent, printer: r.printer, backupAgent: r.backupAgent, backupPrinter: r.backupPrinter, paper: r.paper,
      panel: r.panel, person: r.person, device: r.device, backupPanel: r.backupPanel,
    } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind} saved.`, "ok"); void load(); }
  };

  // THE ONE TOGGLE'S VALUE. Read from the server, never guessed from the routes — the board has to
  // show ONE setup before any paper has been answered, and a derived mode has no answer then.
  const mode: "computer" | "screen" = st?.mode === "screen" ? "screen" : "computer";

  /** "Nobody prints this" — saved as a decision, so screens say so instead of "no printer chosen". */
  const saveOff = async (kind: string) => {
    const d = await post("routes", { routes: { [kind]: { via: "off" } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind}: nobody.`, "ok"); void load(); }
  };
  /** Switching a paper back ON in SCREEN mode needs no picker — the person is the restaurant's one
   *  choice, made above. So this is genuinely one tap. */
  const saveScreen = async (kind: string) => {
    const person = draft.kot?.person || null;
    const d = await post("routes", { routes: { [kind]: { via: "screen", panel: "manager", person } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind}: on.`, "ok"); void load(); }
  };

  const setR = (kind: string, patch: Partial<Route>) =>
    setDraft((d) => ({ ...d, [kind]: { ...(d[kind] || { agent: null, printer: null }), ...patch } }));

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast("Copied.", "ok"); }
    catch { toast("Could not copy — select the text and copy it by hand.", "err"); }
  };

  const dot = (a: Agent) => (
    <span title={a.connected ? "talking to us right now" : "not heard from"} style={{
      width: 9, height: 9, borderRadius: "50%", display: "inline-block", flex: "0 0 auto",
      background: a.connected ? "var(--adm-ok, #30a46c)" : "var(--adm-danger, #e5484d)",
    }} />
  );

  return (
    <>
      <div className="adm-crumbs" style={{ marginBottom: 10 }}>
        <Link href="/aevinite/restaurants">Restaurants</Link><span className="sep">›</span>
        {/* No "…" placeholder on the overview: there is no restaurant to name yet, and an ellipsis
            where a name belongs reads as "still loading" for ever. */}
        {rid ? <><span>{rest?.name || "…"}</span><span className="sep">›</span></> : null}
        <span>Printing</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 4 }}>
            {rid ? `Printing · ${rest?.name || "…"}` : "Printing"}
          </h1>
          <p className="adm-page-sub" style={{ margin: 0, maxWidth: "72ch" }}>
            {/* NEUTRAL NOW. This described the HELPER only ("a small helper program… asks us every two
                seconds"), which read as the whole truth while the screen offers two ways to print. */}
            Where this restaurant&apos;s paper comes out. There are two ways to do it — a small program on a
            computer, or the restaurant&apos;s own Chrome — and the toggle below picks one. {/* A NEW TAB, like the four other places that offer this guide (owner's review, 2026-08-28).
                It is read WHILE a printer is being set up, so opening it in place threw away the
                screen you were halfway through — and the guide has no way back to it. */}
            <a href="/print-setup.html" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>The restaurant&apos;s own guide →</a>
{/* The link to Access lives on the address book below, where the permission actually bites — two
                links to one place in one screenful is the clutter that made this header hard to read. */}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {rid ? (
            <>
              <button className="adm-btn" onClick={() => { setRid(""); setSt(null); setLoadErr(""); }}>
                ← All restaurants
              </button>
              <select className="adm-input" value={rid} onChange={(e) => { setRid(e.target.value); }} style={{ minWidth: 180 }}>
                {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </>
          ) : null}
          <button className="adm-btn" onClick={() => (rid ? void load() : void loadOver())} disabled={loading}>
            <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      {/* ── EVERY RESTAURANT, WORST FIRST ────────────────────────────────────────────────────────
          Owner, 2026-08-27: "it will be messy when there will be too much restaurants." The order is
          the whole point: a shop with paper stacked up behind a dead printer is at the TOP, and a
          shop that is quietly fine is at the bottom. Nobody has to go looking. */}
      {!rid ? (
        <>
          {overErr ? (
            <div className="adm-card" style={{ marginTop: 14, borderLeft: "3px solid var(--adm-danger, #e5484d)" }}>
              <b>This could not be read.</b> <span className="adm-muted">{overErr}</span>
              <button className="adm-btn" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => void loadOver()}>Try again</button>
            </div>
          ) : null}
          {!over && !overErr ? <SkelList rows={6} label="Reading every restaurant" /> : null}
          {over ? <Overview over={over} onOpen={(id) => { setRid(id); setSt(null); }} /> : null}
        </>
      ) : null}

      {rid && loadErr ? (
        <div className="adm-card" style={{ marginTop: 14, borderLeft: "3px solid var(--adm-danger, #e5484d)" }}>
          <b>This page could not be read.</b> <span className="adm-muted">{loadErr}</span>
          <button className="adm-btn" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      {rid && loading && !st ? <SkelList rows={4} label="Loading printing" /> : null}

      {rid && st ? (
        <>
          {/* ── 1 · is printing on at all ───────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>{STEPS.one}</h2>
            <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Off means the whole feature does not exist for them — no greyed-out buttons anywhere in
              their panels, nothing at all. Whether kitchen slips actually come out is the{" "}
              <b>Kitchen slips</b> line in step 3; it is the same switch, asked where it makes sense.
            </p>
            {/* THE SAME STATE-PAIR PATTERN AS THE ACCESS CARD (owner, 2026-08-26: "the printer menu ui
                is also diff and shit too… make both the option looks on the both mode are clearly
                visible and easy to access"). Two boards were describing the same two facts in two
                visual languages — a person had to learn each one separately. One pattern, one place
                to learn it: the fact on the left, YES/NO on the right, and the action only where
                there is something to do. */}
            <div className="adm-state">
              {/* ONE FACT, ONE CONTROL. "The restaurant has auto-print on" used to sit here as a second
                  row — and it is the SAME column the Kitchen slips line writes (settings.auto_print_kot),
                  so two controls were editing one value in two places and disagreeing on screen. It
                  moved down to step 3, where a person is already deciding what happens to kitchen
                  slips. Removed 2026-08-27; do not put it back. */}
              {[
                { key: "allowed", on: st.printing.allowed, label: "Aevidine allows this restaurant to print", what: "Your switch, and only yours. Off means the whole feature does not exist for them." },
              ].map((sw) => (
                <div key={sw.key} className={`adm-state-row ${sw.on ? "yes" : "no"}`}>
                  <span className="adm-state-dot" aria-hidden="true" />
                  <span className="who"><b>{sw.label}</b><br />{sw.what}</span>
                  <span className="adm-state-val">{sw.on ? "YES" : "NO"}</span>
                  <button className={`adm-btn${sw.on ? "" : " primary"}`} style={{ fontSize: 12, minWidth: 82 }}
                    disabled={busy === "switch"}
                    onClick={async () => { const d = await post("switch", { [sw.key]: !sw.on }); if (d) void load(); }}>
                    {sw.on ? "Switch off" : "Switch on"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── 2 · the computers ───────────────────────────────────────────────────────── */}
          {/* ═══════════════════════════════════════════════════════════════════════════════════
              2 + 3 · HOW THIS RESTAURANT PRINTS — ONE TOGGLE, AND ONLY ITS OWN SETTINGS
              ═══════════════════════════════════════════════════════════════════════════════════
              Owner, 2026-08-28, looking at the old version: "tell me what is this all setting for,
              like no use… I want a simple toggle… and do one thing: you only see the option you have
              selected — only the setting for that option will be shown."

              WHAT IT WAS. Three papers × (two shape buttons + a computer + a printer + a paper size
              + a screen + a person + a device + two backup pickers) and FIVE Save buttons. About
              twenty controls to answer one question, and every one of them on screen at once whether
              it applied or not.

              WHAT IT IS. One toggle picks the MECHANISM, and only that mechanism's setup renders —
              the helper's computers and printers, or the Chrome station's one named person. The three
              papers then answer the only thing left: which printer (or "nobody"). Nothing on screen
              belongs to the other mode. That is the UI skill's progressive-disclosure rule, and it is
              also just what he asked for in his own words.

              The toggle is not cosmetic: writeMode() rewrites the three paper lines into the new
              mode's shape, so the board and the paper can never say different things. */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>2 · How this restaurant prints</h2>
            <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Pick one. Everything below changes to match it, and nothing from the other way stays on
              screen. You can switch back at any time — it takes effect within a couple of seconds.
            </p>

            <div className="adm-who" role="group" aria-label="How this restaurant prints">
              {([
                ["computer", "A computer", "A small program prints silently. No window, nobody logged in. Each paper can have its own printer."],
                ["screen", "A screen (Chrome)", "The restaurant's own Chrome prints, out of the way, signed in as one person. Nothing to install."],
              ] as const).map(([m, label, what]) => (
                <button key={m} type="button" className={`adm-mode${mode === m ? " on" : ""}`}
                  aria-pressed={mode === m} disabled={busy === "mode"}
                  onClick={async () => {
                    if (mode === m) return;
                    if (!confirm(`Switch this restaurant to “${label}”?\n\nThe three paper lines below move with it — anything you had chosen for the other way is cleared, and a line set to “nobody” stays that way.`)) return;
                    const d = await post("mode", { mode: m });
                    if (d) { toast("Saved.", "ok"); void load(); }
                  }}>
                  <b>{label}</b>
                  <small>{what}</small>
                </button>
              ))}
            </div>
          </div>

          {/* ── the chosen mode's SETUP — one of these two, never both ───────────────────────── */}
          {mode === "computer" ? (
            <>
              <div className="adm-card" style={{ marginTop: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>The computers that can print</h2>
                <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                  Each one runs the helper. It reports its own printers, so every dropdown below is built
                  from what that machine really has — nobody types a printer name.
                </p>
                {agents.length === 0 ? (
                  <div className="adm-muted" style={{ fontSize: 13, padding: "6px 0 12px" }}>
                    No computer has the helper yet. Make the file below on the machine the printer is
                    plugged into, double-click it, and press <b>Allow</b> — it appears here by itself.
                  </div>
                ) : agents.map((a) => (
                  <div key={a.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      {dot(a)}
                      <b style={{ fontSize: 14 }}>{a.name}</b>
                      <span className="adm-muted" style={{ fontSize: 12 }}>
                        {a.connected ? `connected · seen ${a.secondsAgo ?? 0}s ago`
                          : a.last_seen_at ? `last seen ${a.secondsAgo != null && a.secondsAgo > 3600 ? Math.round(a.secondsAgo / 3600) + "h" : Math.round((a.secondsAgo ?? 0) / 60) + " min"} ago`
                          : "never said hello yet"}
                      </span>
                      <span className="adm-muted" style={{ fontSize: 12 }}>· {a.printers.length} printer{a.printers.length === 1 ? "" : "s"}</span>
                      <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
                        <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!busy}
                          onClick={async () => {
                            const name = prompt("What should this computer be called?", a.name);
                            if (name && name.trim() && name !== a.name) { const d = await post(`agents/${a.id}/rename`, { name: name.trim() }); if (d) void load(); }
                          }}>Rename</button>
                        <button className="adm-btn danger" style={{ fontSize: 12 }} disabled={!!busy}
                          title="Its code dies at once and anything routed to it needs choosing again. To bring it back: run the file on that computer and press Allow."
                          onClick={async () => {
                            if (!confirm(`Unlink “${a.name}”?\n\nIts code stops working at once, and any paper routed to it will need a printer choosing again.\n\nTo bring it back, run the helper file on that computer and press Allow.`)) return;
                            const d = await post(`agents/${a.id}/revoke`, {});
                            if (d) { toast(`${a.name} unlinked.`, "ok"); void load(); }
                          }}>Unlink</button>
                      </div>
                    </div>
                    {a.fingerprintClash ? (
                      <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--adm-warn, #f5a524)" }}>
                        <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 6 }} />
                        This code has been used on more than one computer. No paper is duplicated, but half the
                        tickets will come out in the wrong room — unlink it and set the other machine up as its own.
                      </div>
                    ) : null}
                    {a.printers.length ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {a.printers.map((pr) => (
                          <span key={pr.name} className="adm-muted" style={{ fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <i className="fas fa-print" aria-hidden="true" style={{ opacity: 0.6 }} />
                            <b style={{ color: "var(--text)" }}>{pr.name}</b>
                            {pr.paper ? <span>· {paperLabel(pr.paper)}</span> : null}
                            <button className="adm-btn" style={{ fontSize: 11, padding: "3px 8px" }} disabled={!!busy}
                              onClick={async () => { const d = await post("test", { agentId: a.id, printer: pr.name }); if (d) toast(String(d.note || "Sent."), "ok"); }}>
                              Test page
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 7 }}>
                        It has not reported any printers yet — it reports them the first time the helper runs.
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <FileCard title="The helper file — the same one for every restaurant"
                lead={<>There is <b>nothing secret in it</b>, so keep it, email it, put it on a USB stick. It links
                  itself the first time it runs: the browser opens and you press <b>Allow</b>. <b>Nothing is
                  downloaded by hand</b> — a downloaded script is blocked outright by a Mac and warned about by Windows.</>}
                files={st.files} os={os} setOs={setOs} copy={copy}
                steps={(k: string) => [
                  <>On the computer with the printer, open <b>{k === "windows" ? "Notepad" : k === "mac" ? "TextEdit, then Format → Make Plain Text" : "nano"}</b>.</>,
                  <>Press <b>Copy</b> below and paste it in.</>,
                  <>Save it on the Desktop as <b>{st.files?.[k]?.filename}</b>{k === "windows" ? " with “Save as type: All Files”" : ""}.</>,
                  k === "mac" ? <>In Terminal, once: <b>chmod +x ~/Desktop/print-helper.command</b> — then double-click it.</> : <>Double-click it.</>,
                  <>A page opens in that computer&apos;s browser. Press <b>Allow</b>. That is the whole setup.</>,
                ]}
                footer={(k: string) => <><b>Starting up again:</b> {st.files?.[k]?.autostart}</>} />
            </>
          ) : (
            <>
              <div className="adm-card" style={{ marginTop: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Whose screen prints</h2>
                <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                  One person. The launcher below opens a Chrome signed in as them, out of the way, and that
                  Chrome does the printing — on whatever printer that machine is set to.
                </p>
                <div className="adm-elsewhere" style={{ marginBottom: 12 }}>
                  <span className="lbl">Who <b>may</b> be a printing screen is a person&apos;s own permission, on</span>
                  <b>Access &amp; permissions</b>
                  <a href={rid ? `/aevinite/access?rid=${encodeURIComponent(rid)}` : "/aevinite/access"}>Open Access →</a>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="adm-muted" style={{ fontSize: 12, minWidth: 96 }}>The person</span>
                  <select className="adm-input" style={{ minWidth: 240 }} value={draft.kot?.person || ""}
                    onChange={async (e) => {
                      const person = e.target.value || null;
                      const d = await post("mode", { mode: "screen", person });
                      if (d) { toast("Saved.", "ok"); void load(); }
                    }}>
                    <option value="">Anyone allowed on the manager screen</option>
                    {(st.people || []).filter((x) => x.panels.includes("manager")).map((x) => (
                      <option key={x.id} value={x.id}>{x.name} ({x.role})</option>
                    ))}
                  </select>
                </div>
                {st.managerMayPrint === false ? (
                  <p className="adm-muted" style={{ fontSize: 12.5, margin: "9px 0 0" }}>
                    No manager is offered because <b>“May be the printer”</b> is switched off for every manager
                    on Access &amp; permissions.
                  </p>
                ) : null}
              </div>
              <FileCard title="The print-station file — the same one for every restaurant"
                lead={<>It opens a <b>separate</b> Chrome with its own profile, <b>out of the way</b>, with silent
                  printing on — so it never comes to the front and never touches their own tabs or logins.
                  Nothing secret is in it: the person signs in <b>once</b> in the window it opens.</>}
                files={st.stationFiles} os={os} setOs={setOs} copy={copy}
                steps={(k: string) => [
                  <>On the computer by the printer, open <b>{k === "windows" ? "Notepad" : k === "mac" ? "TextEdit, then Format → Make Plain Text" : "nano"}</b>.</>,
                  <>Press <b>Copy</b> below and paste it in.</>,
                  <>Save it on the Desktop as <b>{st.stationFiles?.[k]?.filename}</b>{k === "windows" ? " with “Save as type: All Files”" : ""}.</>,
                  k === "mac" ? <>In Terminal, once: <b>chmod +x ~/Desktop/print-station.command</b> — then double-click it.</> : <>Double-click it.</>,
                  <>{st.stationFiles?.[k]?.firstRun}</>,
                ]}
                footer={() => <>Leave it running. It keeps the computer awake, because a sleeping machine prints nothing.</>} />
            </>
          )}

          {/* ── 3 · the three papers — the ONLY question left ────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>3 · The three papers</h2>
            <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
              {mode === "computer"
                ? "Three lines, because this app prints three pieces of paper. Each one just needs a printer — or “nobody”."
                : "Three lines, because this app prints three pieces of paper. Each one is simply on, or “nobody”."}
            </p>
            {(st.kinds || []).map((kind) => {
              const r = draft[kind] || { agent: null, printer: null };
              const off = r.via === "off";
              const a = r.agent ? byId.get(r.agent) : undefined;
              const preset = PAPER_PRESETS.find((pp) => (pp.paper ? r.paper && pp.paper.wMm === r.paper.wMm && pp.paper.hMm === r.paper.hMm : !r.paper));
              return (
                <div key={kind} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14 }}>{KIND_LABEL[kind] || kind}</b>
                    <span className="adm-muted" style={{ fontSize: 12 }}>{KIND_WHAT[kind]}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                    {/* ON / NOBODY — the only two states a paper has now. The mechanism is the mode. */}
                    <button className={`adm-btn${off ? "" : " primary"}`} style={{ fontSize: 12, minWidth: 74 }}
                      disabled={busy === "routes"}
                      onClick={() => {
                        if (mode === "screen") { void saveScreen(kind); return; }
                        setR(kind, { via: "computer" });
                      }}>
                      {off ? "Switch on" : "On"}
                    </button>
                    <button className={`adm-btn${off ? " primary" : ""}`} style={{ fontSize: 12 }}
                      disabled={busy === "routes"}
                      onClick={() => void saveOff(kind)}>
                      {KIND_OFF_LABEL[kind] || "Nobody"}
                    </button>

                    {/* …and in computer mode, the one thing still to choose. */}
                    {!off && mode === "computer" ? (
                      <>
                        <select className="adm-input" style={{ minWidth: 165 }} value={r.agent || ""}
                          onChange={(e) => setR(kind, { via: "computer", agent: e.target.value || null, printer: null })}>
                          <option value="">— which computer —</option>
                          {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <select className="adm-input" style={{ minWidth: 195 }} value={r.printer || ""} disabled={!a}
                          onChange={(e) => setR(kind, { printer: e.target.value || null })}>
                          <option value="">— which printer —</option>
                          {(a?.printers || []).map((pr) => <option key={pr.name} value={pr.name}>{pr.name}{pr.paper ? ` (${paperLabel(pr.paper)})` : ""}</option>)}
                        </select>
                        <button className="adm-btn primary" style={{ fontSize: 12 }} disabled={busy === "routes"} onClick={() => void saveRoute(kind)}>Save</button>
                      </>
                    ) : null}
                  </div>

                  {off ? (
                    <p className="adm-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                      {kind === "kot"
                        ? "No slip comes out by itself. Orders still reach the kitchen screen, and this is the same switch as the restaurant's auto-print."
                        : "No printer does it silently. The ordinary print window opens for whoever presses Print."}
                    </p>
                  ) : mode === "screen" ? (
                    <p className="adm-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                      Printed by that screen, on whatever printer the machine is set to.
                    </p>
                  ) : !r.agent || !r.printer ? (
                    <p className="adm-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                      Their screens say <b>&ldquo;no printer chosen&rdquo;</b> rather than going quiet — pick a computer and a printer.
                    </p>
                  ) : null}

                  {/* Everything that is a refinement rather than an answer. */}
                  {!off && mode === "computer" && r.agent ? (
                    <details className="adm-more" style={{ marginTop: 8 }}>
                      <summary>More — paper size, and a backup printer</summary>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                        <span className="adm-muted" style={{ fontSize: 12 }}>Paper:</span>
                        <select className="adm-input" style={{ minWidth: 185 }} value={preset?.id || "custom"}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id === "custom") {
                              const w = Number(prompt("Paper width in millimetres?", String(r.paper?.wMm || 105)));
                              const h = Number(prompt("Paper height in millimetres?", String(r.paper?.hMm || 148)));
                              if (w > 20 && h > 20) setR(kind, { paper: { wMm: w, hMm: h } });
                              return;
                            }
                            setR(kind, { paper: PAPER_PRESETS.find((pp) => pp.id === id)?.paper || undefined });
                          }}>
                          {PAPER_PRESETS.map((pp) => <option key={pp.id} value={pp.id}>{pp.label}</option>)}
                          <option value="custom">Type the two numbers…</option>
                        </select>
                        <span className="adm-muted" style={{ fontSize: 12 }}>If it prints nothing for a minute:</span>
                        <select className="adm-input" style={{ minWidth: 150, fontSize: 12 }} value={r.backupAgent || ""}
                          onChange={(e) => setR(kind, { backupAgent: e.target.value || null, backupPrinter: null })}>
                          <option value="">— no backup —</option>
                          {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <select className="adm-input" style={{ minWidth: 165, fontSize: 12 }} value={r.backupPrinter || ""}
                          disabled={!r.backupAgent}
                          onChange={(e) => setR(kind, { backupPrinter: e.target.value || null })}>
                          <option value="">— no printer —</option>
                          {(byId.get(r.backupAgent || "")?.printers || []).map((pr) => <option key={pr.name} value={pr.name}>{pr.name}</option>)}
                        </select>
                        <button className="adm-btn" style={{ fontSize: 12 }} disabled={busy === "routes"} onClick={() => void saveRoute(kind)}>Save</button>
                      </div>
                      <p className="adm-muted" style={{ fontSize: 12, margin: "7px 0 0" }}>
                        The paper size is what stops a driver rotating a ticket or shrinking it to half —
                        leave it on <b>as the printer says</b> unless you know the roll is different.
                      </p>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
          {/* ── 4 · what has happened ───────────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14, marginBottom: 30 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>
              {STEPS.four} — waiting: {st.waiting}
            </h2>
            <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              The last few pieces of paper, and what became of them. Nothing here is a guess: a job says
              “done” only after the printer confirmed it.
            </p>
            {/* HOW FAR BEHIND, not just how many (owner, 2026-08-27: "'the printer is off' and 'the
                printer is off and eleven orders are stacked up' stop looking the same"). The same
                field, the same words and the same threshold as the kitchen's own 🖨 sheet and the
                manager's floor strip — the server sends `afterMs`, so no screen holds its own idea
                of how long is too long. */}
            {st.stuck && st.stuck.n > 0 ? (() => {
              const sk = st.stuck as Stuck;
              const stuck = (sk.oldestMs ?? 0) >= sk.afterMs;
              // A DURATION, not a timestamp: "nothing since 14 min ago" says when twice.
              const age = !sk.oldestMs ? "" : sk.oldestMs < 60000 ? "under a minute"
                : sk.oldestMs < 3600000 ? `${Math.round(sk.oldestMs / 60000)} minutes`
                : `${Math.round(sk.oldestMs / 3600000)} hours`;
              return (
                <div className="adm-state" style={{ marginBottom: 12 }}>
                  <div className={`adm-state-row ${stuck ? "warn" : "yes"}`}>
                    <span className="adm-state-dot" aria-hidden="true" />
                    <span className="who">
                      <b>{sk.n} kitchen slip{sk.n === 1 ? "" : "s"} waiting to print</b><br />
                      {stuck
                        ? <>Nothing has come out for <b>{age}</b>. The kitchen screen shows this too, and tells the cooks to read the orders off it — every slip still prints, in order, once the printer works.</>
                        : <>The oldest has been waiting {age} — they are going through normally.</>}
                    </span>
                    <span className="adm-state-val">{stuck ? "STUCK" : "OK"}</span>
                  </div>
                </div>
              );
            })() : null}
            {st.recent.length === 0 ? (
              <div className="adm-muted" style={{ fontSize: 13 }}>Nothing has been printed yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "6px 8px" }}>What</th><th style={{ padding: "6px 8px" }}>Where</th>
                    <th style={{ padding: "6px 8px" }}>Result</th><th style={{ padding: "6px 8px" }}>When</th>
                  </tr></thead>
                  <tbody>
                    {st.recent.map((j) => (
                      <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px" }}>{KIND_LABEL[j.kind] || j.kind}</td>
                        <td style={{ padding: "6px 8px" }}>{j.printer || "—"}{j.printed_by ? <span className="adm-muted"> · {j.printed_by}</span> : null}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {j.status === "done" ? <span style={{ color: "var(--adm-ok, #30a46c)" }}>printed</span>
                            : j.status === "failed" ? <span style={{ color: "var(--adm-danger, #e5484d)" }}>gave up after {j.attempts}</span>
                            : j.status === "dismissed" ? <span className="adm-muted">nothing to print</span>
                            : <span style={{ color: "var(--adm-warn, #f5a524)" }}>{j.status}{j.attempts ? ` · try ${j.attempts + 1}` : ""}</span>}
                          {j.error ? <div className="adm-muted" style={{ fontSize: 11.5 }}>{j.error}</div> : null}
                        </td>
                        <td style={{ padding: "6px 8px" }} className="adm-muted">{new Date(j.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
