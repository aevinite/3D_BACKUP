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

type Rest = { id: string; slug: string; name: string };
type Paper = { name?: string; wMm: number; hMm: number };
type Printer = { name: string; desc?: string; paper?: Paper };
type Agent = {
  id: string; name: string; printers: Printer[]; last_seen_at: string | null;
  connected: boolean; secondsAgo: number | null; fingerprintClash: boolean;
};
type Route = { agent: string | null; printer: string | null; backupAgent?: string | null; backupPrinter?: string | null; paper?: Paper };
type Job = { id: string; kind: string; status: string; printer: string | null; printed_by: string | null; attempts: number; error: string | null; created_at: string; done_at: string | null };
type State = {
  agents: Agent[]; routes: Record<string, Route>; waiting: number; recent: Job[];
  kinds: string[]; printing: { allowed: boolean; on: boolean; target: string };
};
type Scripts = Record<string, { filename: string; autostart: string; text: string }>;

// The words a restaurant uses, not ours. "kot" means nothing to anybody outside this codebase.
const KIND_LABEL: Record<string, string> = {
  kot: "Kitchen slips", bill: "Bills", banquet: "Banquet sheets", label: "Parcel labels", test: "Test pages",
};
const KIND_WHAT: Record<string, string> = {
  kot: "One slip per order, the moment it is sent. This is the one that must never wait.",
  bill: "What the guest is handed when they pay.",
  banquet: "The big event sheet — usually a paper printer, not a till roll.",
  label: "Stickers for parcel bags, if the restaurant uses them.",
  test: "Where the “send a test page” button below prints.",
};
const OS_LABEL: Record<string, string> = { mac: "Mac", windows: "Windows", linux: "Linux / Raspberry Pi" };
// Common sheets, so nobody has to know that A6 is 105 × 148. "As the printer says" is first because
// it is right almost always: the machine reads its own paper out of its driver.
const PAPER_PRESETS: { id: string; label: string; paper: Paper | null }[] = [
  { id: "auto", label: "As the printer says", paper: null },
  { id: "a4", label: "A4 · 210 × 297", paper: { wMm: 210, hMm: 297 } },
  { id: "a5", label: "A5 · 148 × 210 (half of A4)", paper: { wMm: 148, hMm: 210 } },
  { id: "a6", label: "A6 · 105 × 148 (quarter of A4)", paper: { wMm: 105, hMm: 148 } },
  { id: "roll80", label: "80mm till roll", paper: { wMm: 79.7, hMm: 64.2 } },
  { id: "roll58", label: "58mm till roll", paper: { wMm: 57.8, hMm: 64.2 } },
];
const paperLabel = (p?: Paper | null) => (p ? `${p.wMm} × ${p.hMm} mm` : "as the printer says");

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
  const [newName, setNewName] = useState("");
  const [made, setMade] = useState<{ name: string; code: string; scripts: Scripts } | null>(null);
  const [os, setOs] = useState<string>("mac");
  const [draft, setDraft] = useState<Record<string, Route>>({});

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const urlRid = q.get("rid") || "";
    adminFetch<Rest[] | { restaurants: Rest[] }>("/api/admin/restaurants").then((r) => {
      if (!r.ok) { setLoadErr(r.error); setLoading(false); return; }
      const all: Rest[] = Array.isArray(r.data) ? r.data : r.data.restaurants || [];
      setRests(all);
      const pick = all.find((x) => x.id === urlRid) || all.find((x) => x.slug === urlRid) || all[0];
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

  const addComputer = async () => {
    const name = newName.trim();
    if (!name) { toast("Give the computer a name first.", "err"); return; }
    const d = await post("agents", { name });
    if (!d) return;
    setMade({ name, code: String(d.code), scripts: d.scripts as Scripts });
    setNewName(""); void load();
  };

  const saveRoute = async (kind: string) => {
    const r = draft[kind] || {};
    const d = await post("routes", { routes: { [kind]: {
      agent: r.agent, printer: r.printer, backupAgent: r.backupAgent, backupPrinter: r.backupPrinter, paper: r.paper,
    } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind} saved.`, "ok"); void load(); }
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
        <span>{rest?.name || "…"}</span><span className="sep">›</span><span>Printing</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 4 }}>Printing</h1>
          <p className="adm-page-sub" style={{ margin: 0, maxWidth: "72ch" }}>
            Which computer prints which piece of paper. A small helper program on a computer asks us every
            two seconds whether there is anything for it — so paper comes out with no window open, nothing
            logged in, and nothing to keep in front. <Link href="/print-setup.html" style={{ color: "var(--accent)" }}>The restaurant's own guide →</Link>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="adm-input" value={rid} onChange={(e) => { setRid(e.target.value); setMade(null); }} style={{ minWidth: 190 }}>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className="adm-btn" onClick={() => void load()} disabled={loading}>
            <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      {loadErr ? (
        <div className="adm-card" style={{ marginTop: 14, borderLeft: "3px solid var(--adm-danger, #e5484d)" }}>
          <b>This page could not be read.</b> <span className="adm-muted">{loadErr}</span>
          <button className="adm-btn" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      {loading && !st ? <SkelList rows={4} label="Loading printing" /> : null}

      {st ? (
        <>
          {/* ── 1 · is printing on at all ───────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Is printing on for this restaurant</h2>
            <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Both must be on. With the first one off, nothing about printing appears anywhere in their
              panels — no greyed-out buttons, nothing at all.
            </p>
            {[
              { key: "allowed", on: st.printing.allowed, label: "We allow this restaurant to print", what: "Your switch. Off means the whole feature does not exist for them." },
              { key: "on", on: st.printing.on, label: "Auto-print is on", what: "Their pause button — off while a printer is being serviced. Tickets wait; nothing is lost." },
            ].map((sw) => (
              <div key={sw.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <button className={`adm-btn${sw.on ? " primary" : ""}`} style={{ fontSize: 12, minWidth: 74 }}
                  disabled={busy === "switch"}
                  onClick={async () => { const d = await post("switch", { [sw.key]: !sw.on }); if (d) void load(); }}>
                  {sw.on ? "On" : "Off"}
                </button>
                <div>
                  <b style={{ fontSize: 13.5 }}>{sw.label}</b>
                  <div className="adm-muted" style={{ fontSize: 12.5 }}>{sw.what}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── 2 · the computers ───────────────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Computers that can print</h2>
            <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Each one runs the helper. It reports its own printers, so every dropdown below is built from
              what that machine really has — nobody types a printer name.
            </p>

            {agents.length === 0 ? (
              <div className="adm-muted" style={{ fontSize: 13, padding: "6px 0 12px" }}>
                No computer has the helper yet. Add one below and this restaurant's paper starts coming out
                without anybody watching a screen.
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
                    <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!busy}
                      title="The old code stops working at once. Use this if a code was lost, or a machine was sold."
                      onClick={async () => {
                        if (!confirm(`Give “${a.name}” a new code? The old one stops working immediately.`)) return;
                        const d = await post(`agents/${a.id}/newcode`, {});
                        if (d) { setMade({ name: a.name, code: String(d.code), scripts: d.scripts as Scripts }); void load(); }
                      }}>New code</button>
                    <button className="adm-btn danger" style={{ fontSize: 12 }} disabled={!!busy}
                      onClick={async () => {
                        if (!confirm(`Remove “${a.name}”? Its code dies at once, and any paper routed to it will say “no printer chosen”.`)) return;
                        const d = await post(`agents/${a.id}/revoke`, {});
                        if (d) { toast(`${a.name} removed.`, "ok"); void load(); }
                      }}>Remove</button>
                  </div>
                </div>

                {a.fingerprintClash ? (
                  <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--adm-warn, #f5a524)" }}>
                    <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 6 }} />
                    This code has been used on more than one computer. No paper is duplicated, but half the
                    tickets will come out in the wrong room — press <b>New code</b> and set the other machine
                    up as its own computer.
                  </div>
                ) : null}

                {a.printers.length ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {a.printers.map((p) => (
                      <span key={p.name} className="adm-muted" style={{ fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <i className="fas fa-print" aria-hidden="true" style={{ opacity: 0.6 }} />
                        <b style={{ color: "var(--text)" }}>{p.name}</b>
                        {p.desc ? <span>· {p.desc}</span> : null}
                        {p.paper ? <span>· {paperLabel(p.paper)}</span> : null}
                        <button className="adm-btn" style={{ fontSize: 11, padding: "3px 8px" }} disabled={!!busy}
                          onClick={async () => { const d = await post("test", { agentId: a.id, printer: p.name }); if (d) toast(String(d.note || "Sent."), "ok"); }}>
                          Send a test page
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

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <input className="adm-input" placeholder="Name a computer — “Shop's computer”" value={newName}
                onChange={(e) => setNewName(e.target.value)} style={{ minWidth: 220 }} />
              <button className="adm-btn primary" onClick={() => void addComputer()} disabled={busy === "agents"}>
                <i className="fas fa-plus" aria-hidden="true" style={{ marginRight: 6 }} />Add a computer
              </button>
            </div>
          </div>

          {/* ── the install text, shown ONCE ────────────────────────────────────────────── */}
          {made ? (
            <div className="adm-card" style={{ marginTop: 14, borderLeft: "3px solid var(--accent)" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Set up “{made.name}” — this is shown only once</h2>
              <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
                We keep only a fingerprint of this code, never the code itself, so it cannot be read back
                later. If it is lost, press <b>New code</b> — nothing is recovered, a fresh one is made.
                <b> Nothing is downloaded:</b> the person types this file themselves, which is why no
                security warning can block it.
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {Object.keys(made.scripts).map((k) => (
                  <button key={k} className={`adm-btn${os === k ? " primary" : ""}`} style={{ fontSize: 12 }} onClick={() => setOs(k)}>
                    {OS_LABEL[k] || k}
                  </button>
                ))}
              </div>
              <ol className="adm-muted" style={{ fontSize: 13, margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.7 }}>
                <li>Open the plain text editor on that computer — <b>{os === "windows" ? "Notepad" : os === "mac" ? "TextEdit, then Format → Make Plain Text" : "nano"}</b>.</li>
                <li>Press <b>Copy</b> below and paste it in.</li>
                <li>Save it as <b>{made.scripts[os]?.filename}</b>{os === "windows" ? " with “Save as type: All Files”" : ""}.</li>
                <li>{os === "mac" ? "In Terminal: chmod +x ~/Desktop/print-helper.command — then double-click it." : "Double-click it."}</li>
                <li>Make it start by itself: <b>{made.scripts[os]?.autostart}</b></li>
              </ol>
              <div style={{ position: "relative" }}>
                <button className="adm-btn" style={{ position: "absolute", top: 8, right: 8, fontSize: 12, zIndex: 2 }}
                  onClick={() => void copy(made.scripts[os]?.text || "")}>Copy</button>
                <pre style={{ background: "#0f1420", color: "#e7ecf5", padding: "14px 16px", borderRadius: 11, overflowX: "auto", fontSize: 12, lineHeight: 1.5, maxHeight: 330 }}>
                  {made.scripts[os]?.text}
                </pre>
              </div>
              <button className="adm-btn" style={{ marginTop: 10, fontSize: 12 }} onClick={() => setMade(null)}>I have saved it — hide this</button>
            </div>
          ) : null}

          {/* ── 3 · the address book ────────────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Which printer gets which paper</h2>
            <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
              One line each. A line left empty says so on their screens — it never goes quietly. The backup
              takes over only if the first printer has printed nothing for a minute.
            </p>
            {(st.kinds || []).map((kind) => {
              const r = draft[kind] || { agent: null, printer: null };
              const a = r.agent ? byId.get(r.agent) : undefined;
              const ba = r.backupAgent ? byId.get(r.backupAgent) : undefined;
              const preset = PAPER_PRESETS.find((p) => (p.paper ? r.paper && p.paper.wMm === r.paper.wMm && p.paper.hMm === r.paper.hMm : !r.paper));
              return (
                <div key={kind} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14 }}>{KIND_LABEL[kind] || kind}</b>
                    <span className="adm-muted" style={{ fontSize: 12 }}>{KIND_WHAT[kind]}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                    <select className="adm-input" style={{ minWidth: 170 }} value={r.agent || ""}
                      onChange={(e) => setR(kind, { agent: e.target.value || null, printer: null })}>
                      <option value="">— no computer —</option>
                      {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <select className="adm-input" style={{ minWidth: 190 }} value={r.printer || ""} disabled={!a}
                      onChange={(e) => setR(kind, { printer: e.target.value || null })}>
                      <option value="">— no printer —</option>
                      {(a?.printers || []).map((p) => <option key={p.name} value={p.name}>{p.name}{p.paper ? ` (${paperLabel(p.paper)})` : ""}</option>)}
                    </select>
                    <select className="adm-input" style={{ minWidth: 175 }} value={preset?.id || "custom"}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id === "custom") {
                          const w = Number(prompt("Paper width in millimetres?", String(r.paper?.wMm || 105)));
                          const h = Number(prompt("Paper height in millimetres?", String(r.paper?.hMm || 148)));
                          if (w > 20 && h > 20) setR(kind, { paper: { wMm: w, hMm: h } });
                          return;
                        }
                        setR(kind, { paper: PAPER_PRESETS.find((p) => p.id === id)?.paper || undefined });
                      }}>
                      {PAPER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      <option value="custom">Type the two numbers…</option>
                    </select>
                    <button className="adm-btn primary" style={{ fontSize: 12 }} disabled={busy === "routes"} onClick={() => void saveRoute(kind)}>Save</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7, alignItems: "center" }}>
                    <span className="adm-muted" style={{ fontSize: 12 }}>If that prints nothing for a minute:</span>
                    <select className="adm-input" style={{ minWidth: 150, fontSize: 12 }} value={r.backupAgent || ""}
                      onChange={(e) => setR(kind, { backupAgent: e.target.value || null, backupPrinter: null })}>
                      <option value="">— no backup —</option>
                      {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <select className="adm-input" style={{ minWidth: 170, fontSize: 12 }} value={r.backupPrinter || ""} disabled={!ba}
                      onChange={(e) => setR(kind, { backupPrinter: e.target.value || null })}>
                      <option value="">— no printer —</option>
                      {(ba?.printers || []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── 4 · what has happened ───────────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14, marginBottom: 30 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>
              Waiting to print: {st.waiting}
            </h2>
            <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              The last few pieces of paper, and what became of them. Nothing here is a guess: a job says
              “done” only after the printer confirmed it.
            </p>
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
