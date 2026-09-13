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
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";
import { useBackClose } from "@/lib/backStack";
import { SkelList } from "@/components/admin/Skeleton";
// THE WORDS ARE SHARED WITH THE RESTAURANT'S OWN SCREEN (owner, 2026-08-27: "the UI/UX is also not
// identical"). Four steps, three kinds of paper, one sentence each — declared once in
// lib/printBoardWords.ts and printed verbatim by both boards, so they cannot drift apart again.
import { STEPS, WAYS, KIND_LABEL, KIND_WHAT, KIND_OFF_LABEL, paperLabel, waitedWords, waitedShort, whenWords } from "@/lib/printBoardWords";
import type { WayId } from "@/lib/printBoardWords";

type Rest = { id: string; slug: string; name: string };
type Paper = { name?: string; wMm: number; hMm: number };
type Printer = { name: string; desc?: string; paper?: Paper };
type Agent = {
  id: string; name: string; printers: Printer[]; last_seen_at: string | null;
  connected: boolean; secondsAgo: number | null; fingerprintClash: boolean;
};
type Route = { agent: string | null; printer: string | null; paper?: Paper;
  via?: "computer" | "screen" | "off"; panel?: string | null; person?: string | null; personName?: string | null; device?: string | null;
  /** The second screen allowed to take what the first leaves sitting — the retired "both" (mig 369). */
};
type Person = { id: string; name: string; role: string; panels: string[] };
type Device = { device_id: string; label?: string | null; panel?: string | null; last_seen_at?: string | null };
type Job = { id: string; kind: string; status: string; printer: string | null; printed_by: string | null; attempts: number; error: string | null; created_at: string; done_at: string | null };
type Stuck = { n: number; oldestMs: number | null; afterMs: number };
type State = {
  agents: Agent[]; routes: Record<string, Route>; waiting: number; stuck?: Stuck; recent: Job[];
  kinds: string[]; printing: { allowed: boolean; on: boolean };
  panels?: string[]; people?: Person[]; devices?: Device[]; managerMayPrint?: boolean;
  // no `mode` — see lib/printBoard.ts. Kept out of the type on purpose so a stale server
  // sending one cannot quietly bring the toggle back.
  /** The queue is STOPPED: tickets keep being made and keep waiting until it is restarted. Not the
   *  same as printing being switched off, which stops them being made at all. */
  paused?: boolean;
  files?: Record<string, { filename: string; autostart: string; text: string }>;
  stationFiles?: Record<string, { filename: string; firstRun: string; text: string }>;
  /** Whether a ten-minute setup code is still live, and until when — NEVER the code (mig 380). It
   *  is stored hashed, so a reloaded board can honestly know only this much, and that is enough:
   *  it says "a code is live, 6 min left" and offers a fresh one. */
  setupCode?: { live: boolean; expiresAt: string | null; oldFileAt: string | null };
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
  // ONE COPY OF THE WORDS, and it knows about days (lib/printBoardWords.ts). This used to stop at
  // hours, so a shop whose printer died on Tuesday sat in this list reading "76h".
  const age = (ms: number | null) => waitedShort(ms);
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
  // A SECTION, NOT A CARD OF ITS OWN (owner, 2026-09-13: "it looks dark and unmerged"). Both callers
  // now live inside the way-card, so a nested card drew a second border and let the dark page show
  // through between blocks.
  return (
    <div className="adm-waysec">
      <h2 style={{ margin: "0 0 4px", fontSize: 15.5 }}>{title}</h2>
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

/** HOW LONG IS LEFT, in the words a person says. Ticked by the card, not stored on the server:
 *  the server sends an instant, and a clock is the screen's job. */
function leftWords(ms: number): string {
  if (ms <= 0) return "expired";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** ── THE SETUP CODE (mig 380) ─────────────────────────────────────────────────────────────────
 *
 *  Owner, 2026-09-13: *"you can generate code for each restaurant from printing menu and like the
 *  helper ask for that code and that generated code only works for 10 min."* This card is the
 *  "printing menu" half of that sentence.
 *
 *  It replaced a page that asked for a STAFF LOGIN on the restaurant's own counter machine — which
 *  is the waiter's login too, and that is exactly what he objected to. Nobody signs in there now.
 *
 *  Three decisions that look like detail and are not:
 *   · THE CODE IS SHOWN ONCE. It is stored hashed, so this component's state is the only copy. A
 *     reload does not lose the SETUP — the board still says a code is live and for how long — it
 *     loses the digits, and the honest answer to that is a fresh code, never a second copy.
 *   · THE COUNTDOWN IS ON SCREEN, not implied. "Ten minutes" said once, next to a code somebody is
 *     carrying to another room, is a number they have to guess at from then on.
 *   · IT IS BIG AND SPACED. It is read out loud down a phone as often as it is typed, and the
 *     alphabet already leaves out every character that sounds like another one.
 */
function SetupCodeCard({ live, onShow, copy, busy }: {
  live: { live: boolean; expiresAt: string | null; oldFileAt: string | null } | undefined;
  onShow: () => Promise<{ code: string; pretty: string; expiresAt: string } | null>;
  /** THE PAGE'S OWN copy(), not a bare navigator.clipboard call. It is the half that SAYS SO —
   *  "Copied." at the bottom of the screen, and a plain sentence when the browser refuses. The
   *  first version of this button called the clipboard directly: the code really was copied and
   *  nothing on the screen moved, so the only way to find out was to paste somewhere and look
   *  (owner, 2026-09-13: "im also not able to copy the code or code is being copy but it not show
   *  button click animation and also at bottom copied written"). A tap is never dropped in silence. */
  copy: (t: string) => void | Promise<void>;
  busy: boolean;
}) {
  const [shown, setShown] = useState<{ pretty: string; code: string; expiresAt: string } | null>(null);
  // The button's own answer, beside the toast. A toast at the bottom of a tall page can be off
  // screen while the thumb is up here on the code, so the control the person actually pressed says
  // it too — the standing rule that an alert lands on the CONTROL, not the page.
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // One second, and only while something is actually counting down — a timer left running behind a
  // card with nothing on it is the kind of thing that is never noticed and never stops.
  const ticking = !!shown || !!live?.expiresAt;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const mineMs = shown ? new Date(shown.expiresAt).getTime() - now : 0;
  const liveMs = live?.expiresAt ? new Date(live.expiresAt).getTime() - now : 0;
  const mineAlive = !!shown && mineMs > 0;

  return (
    <div className="adm-card" style={{ marginTop: 14 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Set a computer up — one code, ten minutes</h2>
      <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.6 }}>
        Press the button, then type the code into the helper on the computer the printer is plugged
        into. <b>Nobody signs in on that computer</b> — not now, and not ever. The code works once,
        for one computer, for this restaurant only.
      </p>

      {/* ── THE ONE THING AN OLD HELPER CANNOT SAY FOR ITSELF (mig 381) ──────────────────────
          Reading our reply is the very thing that is broken in a file from before 2026-09-13, so
          its window shows a PowerShell error and nothing else — which is how the owner came to
          photograph the identical failure twice, an hour apart, after it had been fixed. The code
          is deliberately not spent by such an attempt, so this sits above a code that is still
          good, and it says the only thing that helps: replace the file. */}
      {live?.oldFileAt ? (
        <p style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.6,
          background: "color-mix(in srgb, var(--adm-warn, #f5a524) 12%, transparent)",
          border: "1px solid color-mix(in srgb, var(--adm-warn, #f5a524) 45%, transparent)" }}>
          <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 7 }} />
          <b>That computer is running an out-of-date helper file.</b> Nothing was used up — the code
          below still works. Press <b>Copy</b> on the helper file further down, paste it over the file
          on that computer, save it, and run it again.
        </p>
      ) : null}

      {mineAlive ? (
        <div className="adm-setupcode">
          <div className="adm-setupcode-digits" aria-label={`Setup code ${shown!.code.split("").join(" ")}`}>
            {shown!.pretty}
          </div>
          <div className="adm-setupcode-side">
            <div className="adm-setupcode-left">{leftWords(mineMs)} left</div>
            <button className={`adm-btn${copied ? " primary" : ""}`} style={{ fontSize: 12, minWidth: 74 }}
              onClick={async () => {
                await copy(shown!.code);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
        </div>
      ) : shown ? (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--adm-warn, #f5a524)" }}>
          <i className="fas fa-clock" aria-hidden="true" style={{ marginRight: 6 }} />
          That code has run out. Show a new one — they last ten minutes on purpose.
        </p>
      ) : live?.live && liveMs > 0 ? (
        <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
          A code is already live for another <b>{leftWords(liveMs)}</b>. If you have lost it, show a
          new one — the old one stops working the moment you do.
        </p>
      ) : null}

      <button className="adm-btn primary" disabled={busy}
        onClick={async () => { const d = await onShow(); if (d) { setShown(d); setCopied(false); } }}>
        {busy ? "Making one…" : mineAlive || (live?.live && liveMs > 0) ? "Show a new setup code" : "Show a setup code"}
      </button>
      <p className="adm-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.6 }}>
        It is shown here once and nowhere else — we keep only a scrambled copy, so it can never be
        read back off a screen or out of a log. Lost it? Show a new one.
      </p>
    </div>
  );
}

export default function AdminPrinting() {
/** The mechanism, in the two words a person would use. */
// MODE_CHOICES is gone (owner, 2026-08-31): the two big buttons, "A computer" and "A screen".
// Both are now simply true at once — the helper prints if it is set up, the kitchen screen prints
// the slips if it is not — so there was nothing left for the buttons to choose between.

const PANEL_GROUPS: [ string, string ][] = [
  ["kitchen", "Kitchen screen"],
  ["manager", "Manager panel"],
  ["tablet", "Waiter tablet"],
  ["owner", "Owner screen"],
];

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
  // The mode confirmation strip is gone with the toggle it confirmed — there is no longer a switch
  // whose cost has to be explained before it is paid.
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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // THE TWO WAYS, AND WHETHER EACH ONE IS ON — READ OFF THE PAPER LINES, NEVER STORED
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Owner, 2026-09-13: *"on top of printer there should be 2 menu — one for screen printing by
  // chrome kiosk and one for helper, and they should have colour of red or green according to they
  // are on and off."*
  //
  // ⚠️ READ THIS BEFORE "RESTORING" ANYTHING: this is NOT the mechanism toggle that was deleted on
  // 2026-08-31 (*"in admin panel also we don't need toggle"*, migration 372). That one STORED a
  // choice — `settings.modules.printing.mode` — which could disagree with the routes, which is why
  // `writeMode()` had to drag all three paper lines behind it. Nothing here is stored, nothing is
  // posted, and the cards are a MIRROR: they answer the same question `resolveTarget()` answers on
  // the server, off the same three route rows. The proof that it is a mirror and not a switch is
  // that BOTH can be green at the same time — a computer on the bills while the kitchen screen
  // keeps the slips is a perfectly ordinary restaurant.
  //
  // What the cards DO change is which setup is rendered underneath, which is the surviving half of
  // his 2026-08-28 ask: *"you only see the option you have selected."*
  //
  // The rules below are copied from lib/printHelpers.ts → resolveTarget, and must not drift:
  //   · via:"off"                      → nobody prints it
  //   · an agent + printer that EXISTS → that computer prints it   (a removed machine does not count)
  //   · anything else, for kitchen slips → a screen prints it
  const agentById = (id: string | null | undefined) => agents.find((a) => a.id === id) || null;
  const routedToComputer = (r: Route | undefined) =>
    r?.via !== "off" && !!r?.agent && !!r?.printer && !!agentById(r.agent);
  const computerKinds = (st?.kinds || []).filter((k) => routedToComputer(draft[k]));
  const computerOn = computerKinds.length > 0;
  // The machines actually carrying paper right now that are not answering. A helper being asleep
  // does not turn the way OFF — the tickets wait for it on purpose (mig 335) — so it is said as a
  // warning INSIDE the green card rather than by flipping the colour, which would read as "nothing
  // is set up" when the truth is "it is set up and the PC is off".
  const sleeping = [...new Set(computerKinds.map((k) => draft[k]?.agent))]
    .map((id) => agentById(id)).filter((a): a is Agent => !!a && !a.connected);
  const kotOnComputer = routedToComputer(draft.kot);
  const kotOff = draft.kot?.via === "off";
  const screenOn = !kotOff && !kotOnComputer;
  // ── AND NEITHER WAY IS "ON" IF THE RESTAURANT MAY NOT PRINT AT ALL ─────────────────────────
  // Caught in my own screenshot of this rewrite, on a restaurant with printing switched off: the
  // screen tab still read a green ON, because the kitchen-slip line was untouched underneath. It is
  // the SAME fault he had just sworn at, the other way round — a green word for something that
  // cannot produce a single sheet of paper. The entitlement multiplies both ways, and the tab says
  // so in words as well.
  const wayOn = { computer: !!st?.printing.allowed && computerOn, screen: !!st?.printing.allowed && screenOn };

  // WHICH SETUP IS OPEN. Local to this screen and this visit: it is a view, not a setting, so it is
  // never sent anywhere and never remembered against the restaurant.
  const [way, setWay] = useState<WayId>("computer");
  const [wayPicked, setWayPicked] = useState(false);
  // THE ⓘ. A popover, so it obeys every way a person expects to close one: the button again, the ×,
  // Escape, a click outside, and the phone's BACK button — the last one through lib/backStack, which
  // is what every other overlay in this console registers with.
  const [info, setInfo] = useState(false);
  // ── A WAY THAT IS OFF SHOWS ONE LINE, NOT A SCREENFUL (owner, 2026-09-13) ───────────────────
  // *"When on, then only show the bottom thing — otherwise hide them. Kind of like a dropdown: if
  // you turn it on, the dropdown comes."*
  //
  // Its setup is open when the way is ON — or when you asked for it by hand, which is the only way
  // a COMPUTER can ever be set up: switching that one on means naming a printer, and the printer
  // lives in the setup. So "Switch on" there OPENS it rather than guessing a machine, and the tab
  // stays honestly OFF until a printer really is chosen. Nothing here is stored: it is a view.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const popWrap = useRef<HTMLSpanElement | null>(null);
  useBackClose("admin-printing-info", info, () => setInfo(false));
  useEffect(() => {
    if (!info) return;
    const away = (e: MouseEvent) => { if (!popWrap.current?.contains(e.target as Node)) setInfo(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setInfo(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [info]);
  // It never survives a change of subject: a different restaurant, or a different way, is a
  // different answer to "what am I looking at".
  useEffect(() => { setInfo(false); }, [rid, way]);
  useEffect(() => { setOpened({}); }, [rid]);
  useEffect(() => { setWayPicked(false); }, [rid]);
  // IT OPENS ON THE ONE THERE IS SOMETHING TO DO WITH. A restaurant with a computer (set up, or
  // half set up) opens on the helper; a restaurant with no computer at all opens on the screen,
  // which is the way its paper is coming out today.
  useEffect(() => {
    if (!st || wayPicked) return;
    setWayPicked(true);
    setWay(computerOn || agents.length > 0 ? "computer" : "screen");
  }, [st, wayPicked, computerOn, agents.length]);

  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(path);
    const r = await adminFetch<Record<string, unknown>>(`/api/admin/printing/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid, ...body }),
    });
    setBusy("");
    if (!r.ok) { toast(r.error, "err"); return null; }
    return r.data;
  };



  // THE ONE TOGGLE'S VALUE. Read from the server, never guessed from the routes — the board has to

  /** The person the kitchen tickets belong to right now — looked up so the screen can say their
   *  name and which panel it means, instead of leaving an id in a dropdown as the only feedback. */
  const chosenPerson = (st?.people || []).find((x) => x.id === (draft.kot?.person || "")) || null;

  /**
   * ── EACH WAY HAS ITS OWN ON/OFF (owner, 2026-09-13: *"both should have separate on off, right now
   * they have same"*) ─────────────────────────────────────────────────────────────────────────────
   *
   * He was right: one button sat at the end of the row and it was the RESTAURANT-WIDE entitlement,
   * so both tabs shared it. Each tab now switches ITS OWN way, and the entitlement moved inside the
   * ⓘ (and onto the red banner, which is the only time it is urgent).
   *
   * These switches write the SAME route rows the tabs read, so the colour above the button and the
   * button's own verb can never disagree — there is still no second stored copy of anything.
   *
   *   A SCREEN, off → kitchen slips are `via:"off"`: nothing prints them by itself, anywhere.
   *   A SCREEN, on  → clear the kitchen-slip line. It falls back to the kitchen screen, which is
   *                   the default with nobody named. Works whether it was OFF or a computer had it.
   *   A COMPUTER, off → clear every paper that names a computer. Kitchen slips fall back to the
   *                   kitchen screen, bills and banquet sheets to whoever presses Print.
   *   A COMPUTER, on  → REFUSED, on purpose. Turning it on means naming a printer, and this screen
   *                   must never invent one (the writeMode lesson: going back to a computer does not
   *                   guess a machine). The button says what to do instead.
   */
  const wayBlocked: Record<WayId, string> = {
    computer: computerOn ? "" : agents.length
      ? "Pick a printer for a paper below — that is what switches a computer on."
      : "No computer has the helper yet. Set one up below, then choose which printer gets which paper.",
    screen: "",
  };
  const flipWay = async (id: WayId) => {
    if (id === "screen") {
      if (screenOn) { setOpened((o) => ({ ...o, screen: false })); await saveOff("kot"); return; }
      const d = await post("routes", { routes: { kot: null } });
      if (d) { toast(kotOnComputer ? "Kitchen slips are back on the kitchen screen." : "Kitchen slips print on the kitchen screen again.", "ok"); void load(); }
      return;
    }
    // A COMPUTER CANNOT BE SWITCHED ON BY A BUTTON — it is switched on by a printer being named, and
    // this screen must never guess one. So "Switch on" opens the setup where that choice is made.
    // Pressed while it is already open = "I have changed my mind", so it shuts again. There is no
    // state where this button does nothing: a dead control is the thing he objected to in the first
    // place, and "disabled because you already pressed me" is the worst kind.
    if (!computerOn) { setOpened((o) => ({ ...o, computer: !o.computer })); return; }
    const patch: Record<string, null> = {};
    computerKinds.forEach((k) => { patch[k] = null; });
    setOpened((o) => ({ ...o, computer: false }));
    const d = await post("routes", { routes: patch });
    if (d) { toast(`Taken off the computer: ${computerKinds.map((k) => KIND_LABEL[k] || k).join(", ")}.`, "ok"); void load(); }
  };
  /** Is this way's setup on screen? ON, asked for by hand — or HALF DONE.
   *
   *  ── THE THIRD CASE IS THE ONE THAT MATTERS (2026-09-13) ────────────────────────────────────
   *  A computer that is linked but has no paper pointed at it yet is not "off", it is **half set
   *  up** — and it was the worst state on this board to be in. The card read `OFF`, the machine you
   *  had just linked was nowhere on screen, and the printer dropdowns that are the only way to
   *  finish were behind a button called "Switch on". Every screen was telling the truth; together
   *  they said "nothing happened".
   *
   *  Found by driving the whole join on Pizza Palace: link a computer, reload, and the board hides
   *  the computer you just linked. That is exactly where the owner would have been standing for a
   *  fourth time, having done everything right.
   *
   *  The strip already says it in words — "A computer is set up, but no paper is pointed at it yet"
   *  — so this only makes the screen agree with its own sentence. It is not "on": `wayOn` is
   *  untouched, the card still reads OFF, and it goes green only when a printer is actually named.
   */
  const wayOpen = (id: WayId) =>
    wayOn[id] || !!opened[id] || (id === "computer" && agents.length > 0 && !computerOn);

  /** What is true for each way TODAY, in one sentence — the line under the tab strip. */
  const wayState: Record<WayId, string> = {
    computer: computerOn
      ? `${computerKinds.map((k) => KIND_LABEL[k] || k).join(" · ")} come out of a computer.`
      : agents.length ? "A computer is set up, but no paper is pointed at it yet."
      : "No computer is named for any paper yet.",
    screen: screenOn
      ? (chosenPerson ? `Kitchen slips come out on ${chosenPerson.name}'s screen.`
         : "Kitchen slips come out on the kitchen screen — anyone signed in there.")
      : kotOff ? "Kitchen slips are switched off — no screen prints them."
      : "A computer prints the kitchen slips instead.",
  };

  /** "Nobody prints this" — saved as a decision, so screens say so instead of "no printer chosen". */
  const saveOff = async (kind: string) => {
    const d = await post("routes", { routes: { [kind]: { via: "off" } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind}: nobody.`, "ok"); void load(); }
  };
  /**
   * ONE CONTROL PER PAPER (owner, 2026-08-29: "I'm seeing so much buttons and it is getting very
   * complicated").
   *
   * A line used to need four: an On button, a Nobody button, a computer picker, a printer picker,
   * and a Save. All five asked one question — where does this paper come out? — so they are now one
   * dropdown whose options ARE the answers:
   *
   *     Nobody / Whoever presses Print        →  via:"off"
   *     — not chosen yet —                    →  the line stays unanswered
   *     <computer> ▸ <printer>                →  via:"computer", that machine, that printer
   *
   * It saves on change, because a dropdown that needs a Save button beside it is two controls
   * pretending to be one.
   */
  const pickPrinter = async (kind: string, value: string) => {
    if (value === "off") { await saveOff(kind); return; }
    if (!value) { const d = await post("routes", { routes: { [kind]: null } }); if (d) void load(); return; }
    const [agent, ...rest] = value.split("\u0000");
    const printer = rest.join("\u0000");
    const d = await post("routes", { routes: { [kind]: { via: "computer", agent, printer } } });
    if (d) { toast(`${KIND_LABEL[kind] || kind} → ${printer}.`, "ok"); void load(); }
  };
  /** The value that dropdown is currently showing, in the same encoding. */
  const printerValue = (r: Route | undefined) =>
    r?.via === "off" ? "off" : r?.agent && r?.printer ? `${r.agent}\u0000${r.printer}` : "";

  /**
   * SCREEN MODE IS ONE QUESTION: whose screen prints the KITCHEN TICKETS.
   *
   * Owner, 2026-08-29: *"the person will be only choose for KOT… other user will work as they work
   * — from the manager panel you can print the bill."* Bills and banquet sheets are never dragged
   * onto that person's screen; they stay "whoever presses Print", which is what a restaurant with no
   * helper has always done. The server enforces that when the route is saved, so this really is one
   * control.
   *
   * (Said `writeMode()` until 2026-08-31. There is no printing MODE any more — another lane removed the
   * global toggle and migration 372 dropped the dead `printing.mode` key, because each paper's route
   * already carries its own answer: a computer, a screen, or nobody. A comment naming a function that
   * no longer exists sends the next person looking for it.)
   */
  const pickPerson = async (value: string) => {
    if (value === "off") { await saveOff("kot"); return; }
    // NARROWING, NOT SWITCHING ON. The kitchen screen already prints the slips with nobody named
    // (lib/printHelpers → resolveTarget), so this only ever says "and it must be THIS person's
    // screen". Clearing it goes back to the default rather than to silence.
    if (!value) {
      const d = await post("routes", { routes: { kot: null } });
      if (d) { toast("Back to the kitchen screen.", "ok"); void load(); }
      return;
    }
    // The panel FOLLOWS the person (lib/printHelpers → panelForRole), so nobody picks a "panel":
    // writeRoutes refuses a person whose role cannot stand at the panel named, and this sends the
    // one the board already knows they are on.
    const who = (st?.people || []).find((x) => x.id === value);
    const panel = (who?.panels || [])[0] || "manager";
    const d = await post("routes", { routes: { kot: { via: "screen", panel, person: value } } });
    if (d) { toast("Saved.", "ok"); void load(); }
  };

  // THE SAVE-BUTTON MACHINERY IS GONE (owner's standing rule: a new way replaces the old one).
  // When this screen became ONE DROPDOWN PER PAPER that saves on change, six things were left behind
  // and every one of them still type-checked: `saveRoute` (the Save handler), `setR` (the draft
  // mutator it needed), `byId` (an agent lookup only it used) and the three paper-preset imports
  // `PAPER_PRESETS` / `papersFor` / `PAPER_ELSEWHERE` — the paper size is read off the machine now,
  // never picked from a list. Do not reintroduce a Save button here: a dropdown whose options ARE the
  // answers has nothing left to confirm, which is the whole reason he asked for it.

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
            {/* …AND IT NO LONGER POINTS AT A TOGGLE THAT IS NOT THERE (T11 sweep #8, 2026-09-04).
                It said "there are two ways to do it … and the toggle below picks one" — the first
                sentence an admin reads on this screen, naming a control that was deleted on
                2026-08-31 (owner: "in admin panel also we don't need toggle"; migration 372 dropped
                the stored key). This same file says so twice further down, in the past tense, while
                the header went on telling people to go and use it. Nothing below has picked between
                the two ways since; each paper line answers for itself. So the header now states
                what actually decides, which is the one sentence lib/printHelpers.ts already
                carries: a computer prints if one is set up and named; if none is, the kitchen
                screen does. */}
            Where this restaurant&apos;s paper comes out. A computer prints it if one is set up and named
            below; if none is, the restaurant&apos;s own screen does. {/* A NEW TAB, like the four other places that offer this guide (owner's review, 2026-08-28).
                It is read WHILE a printer is being set up, so opening it in place threw away the
                screen you were halfway through — and the guide has no way back to it. */}
            <a href="/print-setup.html" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>The restaurant&apos;s own guide →</a>
{/* The link to Access lives on the address book below, where the permission actually bites — two
                links to one place in one screenful is the clutter that made this header hard to read. */}
          </p>
        </div>
        {/* ── AND IT ALL FITS ON A PHONE (T11 sweep #8, 2026-09-04) ─────────────────────────────
            This row could not wrap. The OUTER flex above wraps, so the heading dropped onto its own
            line and looked fine — but this inner group had no flexWrap and a select with a hard
            minWidth:180, so at 360px it simply ran off the right-hand edge. Measured on the real
            page at 360×780:

              the restaurant picker   140 → 373   (13px clipped)
              ↻ Refresh               381 → 480   (entirely off screen)

            …and `document.documentElement.scrollWidth` was exactly the viewport width, so there was
            no sideways scroll to reveal them and nothing on screen hinting anything was missing.
            An admin on a phone had no Refresh button at all. (The "Take it out" / "Print it again"
            buttons in step 5's table also sit past the edge, and those are FINE — that table is in
            an overflow-x container, so they are reachable by scrolling it.)

            Two changes, both plain CSS: let this group wrap, and let the picker shrink instead of
            insisting on 180px. Nothing moves on a desktop. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "100%" }}>
          {rid ? (
            <>
              <button className="adm-btn" onClick={() => { setRid(""); setSt(null); setLoadErr(""); }}>
                ← All restaurants
              </button>
              <select className="adm-input" value={rid} onChange={(e) => { setRid(e.target.value); }} style={{ flex: "1 1 180px", minWidth: 0, maxWidth: "100%" }}>
                {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </>
          ) : null}
          {/* (The entitlement chip stood here for one pass — "● Printing allowed for this
              restaurant · Switch off". Owner, 2026-09-13: *"I don't want this option printing
              allowed for this restaurant."* It is one button at the end of the tab row now, and what
              it means lives inside the ⓘ beside it. The page header is back to navigation only.) */}
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
          {/* ═══════════════════════════════════════════════════════════════════════════════════
              THE MENU — FIRST THING ON THE PAGE (owner, 2026-09-13, second pass)
              ═══════════════════════════════════════════════════════════════════════════════════
              *"I want proper menu change on very top… I want menu at top, completely different menu.
              And why the fuck I'm on OFF one and on top it show YES it's on."*

              WHAT WAS WRONG WITH THE FIRST TRY. The two ways were card number TWO, under a card
              whose whole job was the entitlement switch — so the first thing on the page was a
              numbered walk-through, not the choice. And that card printed a big green **YES** above
              a tab reading **OFF**: two different switches (may this restaurant print at all · is
              the helper carrying any paper) in the same words, inches apart. The "1 · Is printing
              switched on" card is GONE from this board; its switch is the chip in the header above,
              worded "Printing allowed", and the words ON and OFF now belong to the two ways alone.

              WHAT IT IS. A menu, first thing under the title, and the page below it is that one
              way's setup — nothing else. It is OUTSIDE the greyed-out block on purpose: when
              printing is switched off for a restaurant you can still read both ways to decide
              whether to switch it on, you just cannot change anything.

              STILL NOT A STORED MODE (the thing deleted on 2026-08-31, migration 372). Nothing is
              posted, nothing is remembered against the restaurant, and BOTH tabs can be green at
              once — see the derivation above `post`, and lib/printBoardWords.ts → WAYS. */}
          <div className="adm-waycard">
          <div className="adm-waybar" role="tablist" aria-label="How this restaurant prints">
            {(["computer", "screen"] as WayId[]).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={way === id}
                className={way === id ? "active" : ""} onClick={() => setWay(id)}>
                <span className={wayOn[id] ? "on" : "off"} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <span className="dot" aria-hidden="true" />
                  {WAYS[id].title}
                  {/* THE WORD, not only the colour — about one man in twelve cannot tell this red
                      from this green (WCAG 1.4.1), and a dot on its own is not read anyway. */}
                  <span className="w hue-ink">{wayOn[id] ? "ON" : "OFF"}</span>
                </span>
              </button>
            ))}

            {/* ── AFTER THE TABS: what am I looking at, and does this restaurant print at all ─────
                Owner, 2026-09-13: *"there should be an on-and-off feature button after the underline
                toggle thing, and also make an i button and put this written info inside that, not
                here."* Both sit at the end of the row, so the tabs stay the loudest thing on it. */}
            <span className="acts" ref={popWrap}>
              <button type="button" className="adm-ibtn" aria-expanded={info} aria-controls="print-way-info"
                title="What am I looking at?" onClick={() => setInfo((v) => !v)}>
                <i className="fas fa-info" aria-hidden="true" />
                <span className="sr-only">What am I looking at?</span>
              </button>
              {/* THE VERB CARRIES THE STATE, and it belongs to THE TAB YOU ARE ON — "Switch off" is how
                  you read that this way is currently on. Disabled where switching on would mean
                  guessing a printer, and it says so rather than sitting there dead. */}
              {/* PRIMARY ONLY WHEN IT IS THE ACTION. "Cancel" kept the filled style and measured
                  3.43-3.94:1 for its white text on the accent — and it is not the thing you want
                  pressed anyway once the setup is open. */}
              <button className={`adm-btn${wayOn[way] || (way === "computer" && opened.computer) ? "" : " primary"}`}
                style={{ fontSize: 12 }}
                disabled={!!busy || !st.printing.allowed}
                title={!st.printing.allowed ? "Printing is switched off for this restaurant — switch it on first."
                  : (way === "computer" && !computerOn) ? (opened.computer ? "Close it again — nothing has changed." : wayBlocked.computer)
                  : (wayOn[way]
                    ? (way === "computer"
                        ? "Take every paper off the computer. Kitchen slips go back to the kitchen screen; bills and banquet sheets go back to whoever presses Print."
                        : "Stop kitchen slips printing by themselves anywhere. Orders still reach the kitchen screen to be read.")
                    : "Let the kitchen screen print the kitchen slips again.")}
                onClick={() => void flipWay(way)}>
                {wayOn[way] ? "Switch off" : (way === "computer" && opened.computer) ? "Cancel" : "Switch on"}
              </button>
              {info ? (
                <div className="adm-pop" id="print-way-info" role="dialog" aria-label="What am I looking at">
                  <p className="hd">
                    <b>{WAYS[way].title}</b>
                    <span className={`w ${wayOn[way] ? "on" : "off"}`}
                      style={{ fontSize: 12, fontWeight: 850, letterSpacing: ".07em",
                               color: wayOn[way] ? "var(--adm-ok, #30a46c)" : "var(--adm-danger, #e5484d)" }}>
                      {wayOn[way] ? "ON" : "OFF"}
                    </span>
                    <button type="button" className="x" aria-label="Close" onClick={() => setInfo(false)}>×</button>
                  </p>
                  <p>
                    Everything below is the setup for this way.{" "}
                    {!st.printing.allowed ? "Printing is switched off for this restaurant altogether, so neither way can be on."
                      : wayOn[way] ? wayState[way]
                      : `${wayState[way]} Setting it up below is what turns it on.`}
                  </p>
                  <p>{WAYS[way].what}</p>
                  {way === "computer" && st.printing.allowed && sleeping.length ? (
                    <p style={{ color: "var(--adm-warn, #f5a524)", fontWeight: 600 }}>
                      <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 6 }} />
                      {sleeping.map((a) => a.name).join(", ")} {sleeping.length === 1 ? "is" : "are"} asleep — that paper is waiting.
                    </p>
                  ) : null}
                  {/* WHAT THE BUTTON BESIDE THIS DOES — it only shows a verb. */}
                  <p>
                    <b>The button beside this</b> switches <b>this way</b> on or off.{" "}
                    {wayBlocked[way] || (wayOn[way]
                      ? (way === "computer"
                          ? "Switching it off takes every paper off the computer: kitchen slips go back to the kitchen screen, bills and banquet sheets back to whoever presses Print."
                          : "Switching it off stops kitchen slips printing by themselves anywhere. Orders still reach the kitchen screen to be read.")
                      : "Switching it on gives the kitchen slips back to the kitchen screen.")}
                  </p>
                  {/* THE RESTAURANT-WIDE SWITCH, one level down — it is not one of the two ways, it is
                      whether printing exists for them at all (owner, 2026-09-13: he wanted the two ways
                      to own the row). When it is OFF the red banner carries this same button, because
                      that is the one moment it must not be hidden behind an ⓘ. */}
                  <p style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                              paddingTop: 10, borderTop: "1px solid var(--border-c, rgba(128,128,128,.25))" }}>
                    <span style={{ flex: "1 1 200px" }}>
                      <b>The whole feature:</b>{" "}
                      {st.printing.allowed
                        ? "Aevidine allows this restaurant to print. Off means it stops existing for them — no greyed-out buttons in their panels, nothing at all."
                        : "Printing is switched off for this restaurant, so neither way can be on."}
                    </span>
                    <button className={`adm-btn${st.printing.allowed ? "" : " primary"}`} style={{ fontSize: 12 }}
                      disabled={busy === "switch"}
                      onClick={async () => { const d = await post("switch", { allowed: !st.printing.allowed }); if (d) { setInfo(false); void load(); } }}>
                      {st.printing.allowed ? "Switch printing off" : "Switch printing on"}
                    </button>
                  </p>
                </div>
              ) : null}
            </span>
          </div>

          {/* LOUD, because its card is gone. With the entitlement now a chip in the header, a quiet
              grey line would be the only thing left saying why a whole screen of controls is dead.
              It sits ABOVE the fieldset on purpose — inside it, `.adm-offblock` would dim the one
              sentence that explains the dimming. */}
          {!st.printing.allowed ? (
            <div className="adm-card" style={{ marginTop: 0, marginBottom: 14, borderLeft: "3px solid var(--adm-danger, #e5484d)" }}>
              <b>Printing is switched off for this restaurant.</b>{" "}
              <span className="adm-muted">
                The whole feature does not exist for them — no greyed-out buttons anywhere in their
                panels, nothing at all. Neither way above can be on until you switch it on.
              </span>{" "}
              <button className="adm-btn primary" style={{ fontSize: 12, marginLeft: 4 }}
                disabled={busy === "switch"}
                onClick={async () => { const d = await post("switch", { allowed: true }); if (d) void load(); }}>
                Switch printing on
              </button>
            </div>
          ) : null}

          {/* ── PRINTING IS OFF: everything below is dead, and it LOOKS dead ────────────────────
              Owner, 2026-08-29: "if the printing is off, grey out the stuff which is at the bottom.
              This is the basic thing I don't have to tell you." Right — a screen that lets you set a
              printer up for a feature that is switched off is a screen that lies about what it does.
              The cards stay VISIBLE (so the setup can be read and understood before switching it on)
              but nothing in them can be touched. The TAB STRIP is deliberately outside this: reading
              both ways is how you decide whether to switch it on at all. */}
          <fieldset disabled={!st.printing.allowed} className={st.printing.allowed ? "" : "adm-offblock"}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>

          {/* ── SWITCHED OFF? ONE LINE, NOT A SCREENFUL (owner, 2026-09-13) ──────────────────────
              *"When on, then only show the bottom thing — otherwise hide them. Kind of like a
              dropdown: if you turn it on, the dropdown comes."* A way that is not running has
              nothing worth scrolling: it says so, and says what turns it on. */}
          {st.printing.allowed && !wayOpen(way) ? (
            <p className="adm-wayshut">
              <span className="k" aria-hidden="true" />
              <span style={{ flex: "1 1 240px" }}>
                <b style={{ color: "var(--text)" }}>{WAYS[way].title}</b> is switched off.{" "}
                {way === "screen"
                  ? (kotOnComputer
                      ? "A computer prints the kitchen slips instead — switch this on to give them back to a screen."
                      : "No slip prints by itself, on any screen. Switching it on gives the kitchen slips back to the kitchen screen.")
                  : "No computer prints anything for this restaurant. Switch it on to set one up and choose which printer gets which paper."}
              </span>
            </p>
          ) : null}

          {/* ── ONLY THE CHOSEN WAY'S SETUP — one of these two, never both ───────────────────── */}
          {way === "computer" && wayOpen("computer") ? (
          <div role="tabpanel">
              {!computerOn ? (
                <p className="adm-waysec" style={{ margin: 0, fontSize: 13, color: "var(--adm-warn, #f5a524)", fontWeight: 600 }}>
                  <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 7 }} />
                  {/* THE HONEST HALF OF "SWITCH ON". The tab still reads OFF, and it should: this way
                      is not printing anything until a printer is named, which is the last step below. */}
                  This way is still <b>off</b>. Add the computer, then give a paper a printer below — that is what switches it on.
                </p>
              ) : null}
              <div className="adm-waysec">
                <h2 style={{ margin: "0 0 4px", fontSize: 15.5 }}>{STEPS.two}</h2>
                <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                  It runs the helper and reports its own printers, so the dropdowns in the card below are built from
                  what that machine really has — nobody types a printer name.
                </p>
                {agents.length === 0 ? (
                  <div className="adm-muted" style={{ fontSize: 13, padding: "6px 0 12px" }}>
                    No computer has the helper yet. Press <b>Show a setup code</b> below, make the helper
                    file on the machine the printer is plugged into, and type that code into it — the computer
                    appears here by itself.
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
                          title="Its code dies at once and anything routed to it needs choosing again. To bring it back: show a setup code, run the file on that computer, and type the code in."
                          onClick={async () => {
                            if (!confirm(`Unlink “${a.name}”?\n\nIts code stops working at once, and any paper routed to it will need a printer choosing again.\n\nTo bring it back: show a setup code here, run the helper file on that computer, and type the code in.`)) return;
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
                    {!a.printers.length ? (
                      <div className="adm-muted" style={{ fontSize: 12.5, marginTop: 7 }}>
                        It has not reported any printers yet — it reports them the first time the helper runs.
                      </div>
                    ) : null}
                  </div>
                ))}
                {/* ── LINKED, BUT NOT YET DOING ANYTHING ────────────────────────────────────────
                    The state a person lands in the moment their computer joins, and the one that
                    reads as "nothing happened": the machine is right there, connected, and not a
                    sheet of paper is pointed at it. The card above says it is connected, the card
                    below offers the dropdowns — and nothing joined the two. Said here, beside the
                    computer it is about, because that is where the eye already is. */}
                {agents.length > 0 && !computerOn ? (
                  <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--adm-warn, #f5a524)" }}>
                    <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6 }} />
                    <b>Linked, but not printing anything yet.</b> Choose a printer on the lines just below —
                    that is what starts it.
                  </p>
                ) : null}
              </div>

              {/* ═══ 4 · ONE DROPDOWN PER PAPER ═════════════════════════════════════════════════
                  Owner, 2026-08-29, describing exactly this: *"if you add something like computer,
                  then only printer option will come and you have to choose — or maybe the printer
                  option is there but greyed out, and when you hover it, it tells you have to choose
                  the computer."* So the dropdown is always here, and until a computer exists it is
                  disabled and SAYS why, on hover and to a screen reader.

                  A line used to be five controls (On, Nobody, computer, printer, Save). It is one:
                  the options ARE the answers, grouped by machine, saved on change. */}
              <SetupCodeCard live={st.setupCode} copy={copy} busy={busy === "setup-code"}
                onShow={async () => {
                  const d = await post("setup-code", {});
                  if (!d) return null;
                  // The board is re-read so its own "a code is live" line agrees with the card
                  // immediately — two places saying different things about one code is the whole
                  // fault this feature replaced.
                  void load();
                  return { code: String(d.code), pretty: String(d.pretty), expiresAt: String(d.expiresAt) };
                }} />
              <FileCard title="The helper file — the same one for every restaurant"
                lead={<>There is <b>nothing secret in it</b>, so keep it, email it, put it on a USB stick. The
                  first time it runs it asks for the setup code above — that is the only thing anybody types.
                  <b> Nothing is downloaded by hand</b> — a downloaded script is blocked outright by a Mac and
                  warned about by Windows.</>}
                files={st.files} os={os} setOs={setOs} copy={copy}
                steps={(k: string) => [
                  <>On the computer with the printer, open <b>{k === "windows" ? "Notepad" : k === "mac" ? "TextEdit, then Format → Make Plain Text" : "nano"}</b>.</>,
                  <>Press <b>Copy</b> below and paste it in.</>,
                  <>Save it on the Desktop as <b>{st.files?.[k]?.filename}</b>{k === "windows" ? " with “Save as type: All Files”" : ""}.</>,
                  k === "mac" ? <>In Terminal, once: <b>chmod +x ~/Desktop/print-helper.command</b> — then double-click it.</> : <>Double-click it.</>,
                  <>It asks <b>Setup code</b>. Type the six characters from above. That is the whole setup —
                    <b> no sign-in on that computer</b>.</>,
                ]}
                footer={(k: string) => <><b>Starting up again:</b> {st.files?.[k]?.autostart}</>} />
              <div className="adm-waysec">
                <h2 style={{ margin: "0 0 4px", fontSize: 15.5 }}>{STEPS.three}</h2>
                <p className="adm-muted" style={{ margin: "0 0 4px", fontSize: 13 }}>
                  Tick the papers the helper takes — those come out on their own, with no window. Anything
                  left on <b>normal</b> prints the way it always has: a window opens when somebody taps Print.
                </p>
                {agents.length === 0 ? (
                  <p style={{ margin: "0 0 4px", fontSize: 12.5, color: "var(--adm-warn, #f5a524)" }}>
                    <i className="fas fa-circle-info" aria-hidden="true" style={{ marginRight: 6 }} />
                    Add the computer in the card above first — the printers in these lists come from it.
                  </p>
                ) : null}
                {(st.kinds || []).map((kind) => {
                  const r = draft[kind] || { agent: null, printer: null };
                  const val = printerValue(r);
                  const chosen = r.via !== "off" && r.agent && r.printer;
                  return (
                    <div key={kind} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ minWidth: 190 }}>
                          <b style={{ fontSize: 14 }}>{KIND_LABEL[kind] || kind}</b><br />
                          <span className="adm-muted" style={{ fontSize: 12 }}>{KIND_WHAT[kind]}</span>
                        </span>
                        <select className="adm-input" style={{ minWidth: 250, flex: "1 1 250px" }}
                          value={val} disabled={busy === "routes" || agents.length === 0}
                          title={agents.length === 0 ? "Add the computer in the card above first — the printers come from it." : undefined}
                          aria-describedby={agents.length === 0 ? "no-computer-yet" : undefined}
                          onChange={(e) => void pickPrinter(kind, e.target.value)}>
                          <option value="off">{KIND_OFF_LABEL[kind] || "Nobody"}</option>
                          <option value="">— not decided yet —</option>
                          {/* THE COMPUTER IS THE GROUP, AND IT SAYS HOW IT IS (owner, 2026-08-29:
                              "there should be a dropdown that how many printers it has and how many
                              are connected… if the PC is disconnected, both printers will be
                              disconnected only"). A printer is only reachable through its machine,
                              so a sleeping machine's printers are not offerable — they are shown,
                              greyed, under a group that says the computer is asleep. */}
                          {agents.map((a) => (
                            <optgroup key={a.id}
                              label={`${a.name} · ${a.printers.length} printer${a.printers.length === 1 ? "" : "s"} · ${a.connected ? "connected" : "asleep — its printers cannot be used"}`}>
                              {a.printers.map((pr) => (
                                <option key={pr.name} value={`${a.id}\u0000${pr.name}`} disabled={!a.connected}>
                                  {pr.name}{pr.paper ? ` · ${paperLabel(pr.paper)}` : ""}{a.connected ? "" : " (asleep)"}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {/* A test page is only a question worth asking once a printer is chosen. */}
                        {chosen ? (
                          <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!busy}
                            onClick={async () => { const d = await post("test", { agentId: r.agent, printer: r.printer }); if (d) toast(String(d.note || "Sent."), "ok"); }}>
                            Print a test page
                          </button>
                        ) : null}
                      </div>
                      {r.via === "off" ? (
                        <p className="adm-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                          {kind === "kot"
                            ? "No slip comes out by itself. Orders still reach the kitchen screen, and this is the same switch as the restaurant's auto-print."
                            : "No printer does it silently. The ordinary print window opens for whoever presses Print."}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {agents.length === 0 ? <span id="no-computer-yet" className="adm-muted" style={{ fontSize: 12 }}>Add the computer in the card above first — the printers come from it.</span> : null}
              </div>
          </div>
          ) : null}

          {way === "screen" && wayOpen("screen") ? (
          <div role="tabpanel">
              {/* ═══ THE KITCHEN SCREEN — ON BY DEFAULT, NOTHING TO SWITCH ═════════════════════
                  *"kitchen panel will always be on and there will be guide for it"* (owner,
                  2026-08-31). So this card does not ask a question: it states what already happens,
                  and offers the one thing a restaurant might want to change — WHICH screen, if not
                  just "the kitchen".

                  His earlier ask still holds inside it: *"the person will be only choose for KOT…
                  other user will work as they work — from the manager panel you can print the
                  bill."* Naming somebody narrows the kitchen slips to their screen and touches
                  nothing else; bills and banquet sheets stay with whoever presses Print. */}
              <div className="adm-waysec">
                <h2 style={{ margin: "0 0 4px", fontSize: 15.5 }}>{STEPS.screen}</h2>
                {/* ── AND IT SAYS THE TRUE THING WHEN THE SLIPS ARE SWITCHED OFF ────────────────
                    T11 sweep #8, 2026-09-04. This line was two answers wide — a computer is named,
                    or the kitchen screen is doing it — and "Nobody" is a third answer the owner
                    added on purpose (2026-08-27: "I WANT A PROPER OPTION TO ON AND OFF IT"). With
                    Kitchen slips set to Nobody it fell through to the second branch, so the card
                    read, under a GREEN TICK:

                      ✓ Kitchen slips print on the kitchen screen already — there is nothing to
                        switch on. No computer is set to print them, so the kitchen screen is
                        doing it.
                        [ Nobody — kitchen slips do not print by themselves ]
                        Kitchen slips do not print by themselves for this restaurant.

                    — the tick asserting the opposite of the grey line four rows under it, with the
                    dropdown between them agreeing with the grey line. Driven on French House and
                    put back. `via:"off"` is exactly what resolveTarget() answers "off" to and what
                    screenMayPrint() refuses with why:"off", so the screen was the only layer that
                    had not been told. Three states, three sentences, and the tick only where
                    something really is printing. */}
                {draft.kot?.via === "off" ? (
                  <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                    <i className="fas fa-circle-minus" aria-hidden="true" style={{ color: "var(--adm-warn, #f5a524)", marginRight: 7 }} />
                    Kitchen slips are switched <b>off</b> for this restaurant &mdash; no slip comes out by
                    itself, on any screen or any computer. Orders still reach the kitchen screen to be read.
                  </p>
                ) : kotOnComputer ? (
                  /* ── AND IT NAMES THE SCREEN IT ACTUALLY MEANS (2026-09-13) ────────────────────
                     There was a FOURTH state this line got wrong, the mirror of the "off" one fixed
                     on 2026-09-04: with a PERSON named it still read "Kitchen slips print on the
                     kitchen screen already", four rows above a green tick saying they print on
                     diagm1's manager panel. Seen on French House while shooting the new board. The
                     card now answers in the same three shapes the way-card above it does, so the
                     two cannot disagree. */
                  <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                    <i className="fas fa-circle-info" aria-hidden="true" style={{ color: "var(--muted)", marginRight: 7 }} />
                    A <b>computer</b> is set to print the kitchen slips, so it does that instead and no screen
                    prints them. Change that on the other card if you want a screen to have them back.
                  </p>
                ) : chosenPerson ? (
                  <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                    <i className="fas fa-circle-check" aria-hidden="true" style={{ color: "var(--adm-ok, #30a46c)", marginRight: 7 }} />
                    Kitchen slips print on <b>{chosenPerson.name}</b>&apos;s screen &mdash; not on the kitchen
                    screen. Set it back to <b>the kitchen screen</b> below to let anyone signed in there print them.
                  </p>
                ) : (
                  <p style={{ margin: "0 0 4px", fontSize: 13 }}>
                    <i className="fas fa-circle-check" aria-hidden="true" style={{ color: "var(--adm-ok, #30a46c)", marginRight: 7 }} />
                    Kitchen slips print on the <b>kitchen screen</b> already &mdash; there is nothing to switch on.
                    No computer is set to print them, so the kitchen screen is doing it.
                  </p>
                )}
                <p className="adm-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                  Only change this to send the slips to <b>one particular person&apos;s</b> screen instead.
                  Bills and banquet sheets are never affected &mdash; whoever presses Print gets the window.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="adm-muted" style={{ fontSize: 12, minWidth: 96 }}>The person</span>
                  <select className="adm-input" style={{ minWidth: 280, flex: "1 1 280px" }}
                    disabled={busy === "routes"}
                    value={draft.kot?.via === "off" ? "off" : (draft.kot?.person || "")}
                    onChange={(e) => void pickPerson(e.target.value)}>
                    <option value="off">Nobody — kitchen slips do not print by themselves</option>
                    <option value="">The kitchen screen (anyone signed in there)</option>
                    {PANEL_GROUPS.map(([panel, groupLabel]) => {
                      const inGroup = (st.people || []).filter((x) => (x.panels || [])[0] === panel);
                      if (!inGroup.length) return null;
                      return (
                        <optgroup key={panel} label={groupLabel}>
                          {inGroup.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                {chosenPerson ? (
                  <p style={{ fontSize: 13, margin: "10px 0 0" }}>
                    <i className="fas fa-circle-check" aria-hidden="true" style={{ color: "var(--adm-ok, #30a46c)", marginRight: 7 }} />
                    Kitchen tickets print on <b>{chosenPerson.name}</b>&apos;s screen — the{" "}
                    <b>{(chosenPerson.panels || [])[0] === "kitchen" ? "kitchen" : (chosenPerson.panels || [])[0] === "tablet" ? "waiter tablet" : "manager"}</b> panel.
                    They need it open, with the print station file below running.
                  </p>
                ) : (
                  <p className="adm-muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
                    {draft.kot?.via === "off"
                      ? "Kitchen slips do not print by themselves for this restaurant."
                      : "Anyone signed in on the kitchen screen prints them — no person to choose, nothing to set up."}
                  </p>
                )}
              </div>

              <FileCard title="The print-station file — the same one for every restaurant"
                lead={<>It opens a <b>separate</b> Chrome with its own profile, <b>out of the way</b>, with silent
                  printing on — so it never comes to the front and never touches their own tabs or logins.</>}
                files={st.stationFiles} os={os} setOs={setOs} copy={copy}
                steps={(k: string) => [
                  <>On {chosenPerson ? <b>{chosenPerson.name}</b> : "that person"}&apos;s computer, open <b>{k === "windows" ? "Notepad" : k === "mac" ? "TextEdit, then Format → Make Plain Text" : "nano"}</b>.</>,
                  <>Press <b>Copy</b> below and paste it in.</>,
                  <>Save it on the Desktop as <b>{st.stationFiles?.[k]?.filename}</b>{k === "windows" ? " with “Save as type: All Files”" : ""}.</>,
                  k === "mac" ? <>In Terminal, once: <b>chmod +x ~/Desktop/print-station.command</b> — then double-click it.</> : <>Double-click it.</>,
                  <>Sign in as {chosenPerson ? <b>{chosenPerson.name}</b> : "that person"} once. Leave it running — it stays out of the way.</>,
                ]}
                footer={(k: string) => <><b>The first time it runs:</b> {st.stationFiles?.[k]?.firstRun}</>} />
          </div>
          ) : null}

          </fieldset>
          </div>

          {/* ── 4 · what has happened ───────────────────────────────────────────────────── */}
          <div className="adm-card" style={{ marginTop: 14, marginBottom: 30 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>
              {/* NO NUMBER ANY MORE. The log belongs to BOTH ways and sits outside them, and the
                  steps above it now end at 4 on the computer side and at 3 on the screen side — a
                  hard-coded "5 ·" would be wrong on one of the two every time. (printBoardWords
                  says exactly this: the last one is numbered by the caller, and that is why.) */}
              {STEPS.four} — waiting: {st.waiting}
            </h2>
            <p className="adm-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              The last few pieces of paper, and what became of them. Nothing here is a guess: a job says
              “done” only after the printer confirmed it.
            </p>
            {/* ── STOP / RESTART THE QUEUE (owner, 2026-08-29) ────────────────────────────────
                Deliberately NOT the same as switching printing off in step 1. Stopped, the tickets
                go on being MADE and go on waiting — restart it and they all come out, in order.
                Switching printing off stops them being made at all, and that paper never exists. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0 0 12px" }}>
              {st.paused ? (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--adm-warn, #f5a524)", fontWeight: 700 }}>
                    <i className="fas fa-circle-pause" aria-hidden="true" style={{ marginRight: 6 }} />
                    The queue is stopped — tickets are piling up, nothing is printing
                  </span>
                  <button className="adm-btn primary" style={{ fontSize: 12 }} disabled={!!busy}
                    onClick={async () => { const d = await post("queue", { paused: false }); if (d) { toast("The queue is running again.", "ok"); void load(); } }}>
                    Restart the queue
                  </button>
                </>
              ) : (
                <button className="adm-btn" style={{ fontSize: 12 }} disabled={!!busy}
                  onClick={async () => { const d = await post("queue", { paused: true }); if (d) { toast("The queue is stopped — tickets will wait.", "ok"); void load(); } }}>
                  Stop the queue
                </button>
              )}
              {/* ── THE WAY OUT OF A BACKLOG (owner, 2026-09-13) ────────────────────────────────
                  "I have not been able to delete the queue which pend up till now even after
                  restarting queue… so that all don't print together." Stopping the queue is only
                  half an answer — it HOLDS the paper, and restarting it prints every held ticket at
                  once. This is the other half: the waiting ones are taken out for good.
                  They are DISMISSED, not deleted and never marked printed — the rows and their
                  reason stay in the log below, because a log that says a ticket printed when it did
                  not is worse than no log. Nothing about the orders, the bills or the money moves. */}
              {(st.waiting || 0) > 0 ? (
                <button className="adm-btn danger" style={{ fontSize: 12 }} disabled={!!busy}
                  onClick={async () => {
                    if (!confirm(`Clear ${st.waiting} waiting ticket${st.waiting === 1 ? "" : "s"}?\n\nThey will never print — this is how you stop a whole backlog coming out at once when the printer comes back.\n\nThe orders themselves are untouched and stay on the kitchen screen, and every cleared ticket stays in the list below with its reason. New orders from now on print normally.`)) return;
                    const d = await post("queue/clear", {});
                    if (d) { toast(`Cleared ${(d as { cleared?: number }).cleared ?? 0} — none of them will print.`, "ok"); void load(); }
                  }}>
                  Clear the {st.waiting} waiting {st.waiting === 1 ? "ticket" : "tickets"}
                </button>
              ) : null}
            </div>
            {/* Said where the button is, because "I restarted it and they all came out" is exactly
                what happened to him. */}
            {(st.waiting || 0) > 0 ? (
              <p className="adm-muted" style={{ margin: "-6px 0 12px", fontSize: 12 }}>
                Restarting the queue does not empty it — every waiting ticket still prints, in order.
                Clearing takes them out for good, so only new orders come out.
              </p>
            ) : null}
            {/* HOW FAR BEHIND, not just how many (owner, 2026-08-27: "'the printer is off' and 'the
                printer is off and eleven orders are stacked up' stop looking the same"). The same
                field, the same words and the same threshold as the kitchen's own 🖨 sheet and the
                manager's floor strip — the server sends `afterMs`, so no screen holds its own idea
                of how long is too long. */}
            {st.stuck && st.stuck.n > 0 ? (() => {
              const sk = st.stuck as Stuck;
              const stuck = (sk.oldestMs ?? 0) >= sk.afterMs;
              // A DURATION, not a timestamp: "nothing since 14 min ago" says when twice. Past a day
              // it says DAYS — see lib/printBoardWords.ts for why "76 hours" was a real complaint.
              const age = waitedWords(sk.oldestMs);
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
                    <th style={{ padding: "6px 8px" }} />
                  </tr></thead>
                  <tbody>
                    {st.recent.map((j) => (
                      <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px" }}>{KIND_LABEL[j.kind] || j.kind}</td>
                        <td style={{ padding: "6px 8px" }}>{j.printer || "—"}{j.printed_by ? <span className="adm-muted"> · {j.printed_by}</span> : null}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {j.status === "done" ? <span style={{ color: "var(--adm-ok, #30a46c)" }}>printed</span>
                            : j.status === "failed" ? <span style={{ color: "var(--adm-danger, #e5484d)" }}>gave up after {j.attempts}</span>
                            : j.status === "dismissed" ? <span className="adm-muted">{/^(cleared|cancelled)/.test(j.error || "") ? "taken out — never printed" : "nothing to print"}</span>
                            : <span style={{ color: "var(--adm-warn, #f5a524)" }}>{j.status}{j.attempts ? ` · try ${j.attempts + 1}` : ""}</span>}
                          {j.error ? <div className="adm-muted" style={{ fontSize: 11.5 }}>{j.error}</div> : null}
                        </td>
                        {/* IST, NOT THE READER'S OWN CLOCK (T11 sweep #8, 2026-09-04). This asked for
                            en-IN and then let the machine decide the TIME ZONE, so the "What has
                            printed" log — the thing you read to answer "why did table 6's slip never
                            come out" — timestamped every job in whatever zone the admin's laptop is
                            set to, while the restaurant, its kitchen slips, its bills and its
                            banquet sheets are all pinned to Asia/Kolkata. It is the same fault the
                            printed bill had fixed on 2026-08-05, the banquet sheet on 2026-08-06 and
                            the kitchen ticket on 2026-08-17; this log was the one left on device
                            time. One time zone everywhere, like the money and the logs.
                            AND A DAY, NOT JUST A CLOCK (owner, 2026-09-13: "it only show time").
                            "07:14 am" reads the same whether the slip is from this morning or last
                            Tuesday — which is the very question this table exists to answer.
                            whenWords() adds the day to anything that is not today. */}
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }} className="adm-muted">{whenWords(j.created_at)}</td>
                        {/* ONE TICKET AT A TIME. "Take it out" DISMISSES it — the row and its reason
                            stay, so "why did table 6's slip never come out" still has an answer
                            months later. Nothing here deletes anything. */}
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {j.status === "queued" || j.status === "printing" ? (
                            <button className="adm-btn" style={{ fontSize: 11.5, padding: "3px 8px" }} disabled={!!busy}
                              onClick={async () => { const d = await post(`job/${j.id}/cancel`, {}); if (d) { toast("Taken out of the queue.", "ok"); void load(); } }}>
                              Take it out
                            </button>
                          ) : j.status === "failed" || j.status === "dismissed" ? (
                            <button className="adm-btn" style={{ fontSize: 11.5, padding: "3px 8px" }} disabled={!!busy}
                              onClick={async () => { const d = await post(`job/${j.id}/retry`, {}); if (d) { toast("Back in the queue.", "ok"); void load(); } }}>
                              Print it again
                            </button>
                          ) : null}
                        </td>
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
