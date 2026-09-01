"use client";
// Owner · Settings — the owner's ACCOUNT page (not the restaurant's admin config, which
// stays with Aevidine/admin). Three safe things an owner controls or should see:
//   1. Appearance — light/dark, shared with the header toggle (localStorage + cookie).
//   2. Change password — self-service, verified server-side; re-login after.
//   3. What's enabled — a read-only view of the owner-panel sections the admin turned on,
//      plus the restaurants they own. Everything money/branding stays admin-controlled.
import { useCallback, useEffect, useState } from "react";
import { asSuffix } from "@/lib/ownerPin";

type Module = { restaurant_id: string; name: string; key: string; label: string; enabled: boolean };
type PrintingState = {
  // WHICH restaurant this answer is about. The route answers for exactly one, and this page renders a
  // LIST — see the note in the map below for what went wrong when the two were not matched up.
  // Optional so an older deployment's answer still parses; an absent id means "don't apply it".
  restaurantId?: string;
  allowed: boolean; on: boolean; waiting: number;
  computers: { name: string; connected: boolean; secondsAgo: number | null; printers: string[] }[];
  routes: { kind: string; printer: string | null; computer: string | null; connected: boolean }[];
};
const KIND_WORDS: Record<string, string> = {
  kot: "Kitchen slips", bill: "Bills", banquet: "Banquet sheets", label: "Parcel labels", test: "Test pages",
};

type Data = {
  name: string; isAdmin: boolean; canChangePassword: boolean;
  sections: Record<string, boolean>; restaurants: { id: string; name: string }[];
  // Kitchen printing, per restaurant that HAS it on (mig 336/338). Absent or empty = nothing to show,
  // and the card does not render at all — his rule: if printing is off, no option appears.
  printing?: { restaurant_id: string; name: string; target: string; station: string | null; stale: boolean }[];
  // false = the read behind the list failed, so an empty list means "we could not look", NOT
  // "this restaurant has printing off". Without this the two are the same screen: nothing at all.
  printingOk?: boolean;
  modules?: Module[];
};
// REJECTED (owner, 2026-08-18): DO NOT show the owner which sections are switched OFF.
// *"owner can't know which option are not given to them only admin should know that"* — said after
// being shown a card that listed nine sections with a ✓ or a ✗ on each. What is withheld from a
// restaurant is Aevidine's business and the admin's alone; a ✗ here tells the owner a feature
// exists that he has not been given, which is an invitation to ask for it. Row R36 in
// docs/REJECTED-IDEAS.md.
//
// So this card lists ONLY what is ON, and there is no off-state on the screen at all. Do not
// re-add the ✗ chip, do not grey a withheld section, do not add a count ("6 of 9"), and do not
// re-report the missing ones as a gap — a section he does not have simply is not mentioned, which
// is the same thing his sidebar already does.
//
// The MAP still holds every section, and that is not disclosure: it is what stops a section he DOES
// have from having no chip. Before 2026-08-17 the map held six of the nine, so a restaurant with
// Menu, Audit & logs or Manager mode switched ON was missing those chips from a card headed "the
// sections Aevidine has switched on for you" — the card under-reported what he HAD, which is the
// opposite fault and is the half of this that survives. Names and order mirror the sidebar
// (components/owner/OwnerShell.tsx) so the two read side by side; "Staff & powers" and "Feedback &
// issues" were names of screens that no longer exist.
//
// logs_signins / logs_service / logs_staff_changes are deliberately absent: they are which KINDS of
// row the Audit & logs page shows, not sections. Pay Later and Inventory are MODULES, not sections.
const SECTION_LABEL: Record<string, string> = {
  manager_mode: "Manager mode", menu: "Menu", reports: "Reports", staff: "Team",
  customers: "Customers", logs: "Audit & logs", issues: "Feedback & complaints",
  ratings: "Guest ratings", settings: "Settings",
};

export default function OwnerSettings() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const scp = scopePin ? `?scope=${scopePin}${asSuffix()}` : "";

  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // WHERE THE PAPER COMES OUT (mig 341). An owner at the counter — who at Aangan is also the manager —
  // must be able to SEE this without asking us: is that computer awake, which printer gets the kitchen
  // slips, is anything waiting. Read-only: printing is hardware and the admin grants it.
  // `allowed:false` (or a failed read) means NOTHING renders — the owner never sees what is withheld.
  const [printing, setPrinting] = useState<PrintingState | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/settings${scp}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setData(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scp]);
  useEffect(() => { load(); }, [load]);

  // Its own small read, refreshed while the page is open so "connected · seen 2s ago" is true rather
  // than a snapshot from whenever the page was opened. 15s is slow enough to cost nothing.
  const loadPrinting = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/printing${scp}`, { cache: "no-store" })).json();
      setPrinting(j && j.allowed ? j : null);
    } catch { /* leave whatever we had; this card never blocks the page */ }
  }, [scp]);
  useEffect(() => { loadPrinting(); }, [loadPrinting]);
  // IT KEPT ASKING WITH THE TAB HIDDEN, AND WITH NOTHING ON SCREEN TO ASK FOR (T13 sweep,
  // 2026-08-27 — measured: 4 requests in 40s with the tab in front, and 2 more in the next 35s
  // after the tab was hidden).
  //
  // Two separate costs, both avoidable:
  //   • NOTHING TO REFRESH. The interval was unconditional, but this whole card only renders when
  //     `data.printing` has a row — a restaurant whose printing is switched off shows nothing at all
  //     (R36), and still paid four requests a minute for it, for as long as the page was open.
  //   • A BACKGROUND TAB. Every other page in this console — Customers, Pay Later, Feedback &
  //     complaints — polls on 60s, skips the tick while `document.hidden`, and stops and restarts on
  //     visibilitychange. Settings was the one that did not, so an owner who opened it once and left
  //     the tab behind kept a poll running all night. `/api/owner/printing` is five reads a call
  //     (the scope, `settings`, then agents + routes + the waiting count), so that is ~1,200 reads
  //     an hour for a card nobody is looking at. "This product's cost is egress, not effort."
  //
  // 15s is KEPT while the card is on screen and the tab is in front, deliberately: the admin's own
  // Printing screen refreshes on the same cadence for the same reason — "is that computer awake" has
  // a 30s truth window (HELPER_STALE_MS), so a slower tick would let this card say "ready" about a
  // computer that had already gone to sleep. The fix is not a slower clock, it is not running the
  // clock when there is no card and no one watching.
  const showsPrinting = !!printing;
  useEffect(() => {
    if (!showsPrinting) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) loadPrinting(); }, 15000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { loadPrinting(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [showsPrinting, loadPrinting]);

  // ── Appearance (mirrors OwnerShell.toggleSkin) ──
  const [skin, setSkin] = useState<"light" | "dark">("dark");
  useEffect(() => { try { const s = localStorage.getItem("aevidine_skin"); if (s === "light" || s === "dark") setSkin(s); } catch {} }, []);
  const applySkin = (next: "light" | "dark") => {
    setSkin(next);
    try { localStorage.setItem("aevidine_skin", next); } catch {}
    try { document.cookie = `aevidine_skin=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
    // The shell reads the skin on mount, so reload once to repaint the whole panel.
    location.reload();
  };

  // ── Change password ──
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [cf, setCf] = useState("");
  const [pwBusy, setPwBusy] = useState(false); const [pwMsg, setPwMsg] = useState<string | null>(null); const [pwErr, setPwErr] = useState<string | null>(null);
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr(null); setPwMsg(null);
    if (nw !== cf) { setPwErr("The new passwords don't match."); return; }
    if (nw.length < 6) { setPwErr("New password must be at least 6 characters."); return; }
    setPwBusy(true);
    try {
      const r = await fetch(`/api/owner/settings${scp}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: cur, next: nw }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setPwMsg("Password changed — signing you out so you can log in with the new one…");
      setCur(""); setNw(""); setCf("");
      setTimeout(() => { window.location.href = "/login"; }, 1600);
    } catch (e) { setPwErr(e instanceof Error ? e.message : String(e)); }
    finally { setPwBusy(false); }
  };

  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Your account and what&apos;s switched on. Taxes, branding and billing are managed for you by Aevidine.</p>

      {err && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}>
          <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={load}>Try again</button>
        </div>
      )}

      {/* Appearance */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Appearance</div>
        <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Choose how the owner panel looks on this device.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="adm-btn" aria-pressed={skin === "light"} onClick={() => applySkin("light")}
            style={skin === "light" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            <i className="fas fa-sun" aria-hidden="true" /> Light
          </button>
          <button className="adm-btn" aria-pressed={skin === "dark"} onClick={() => applySkin("dark")}
            style={skin === "dark" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            <i className="fas fa-moon" aria-hidden="true" /> Dark
          </button>
        </div>
      </div>

      {/* ═══ KITCHEN PRINTING (owner, 2026-08-18) ═══
          "Tell me how the printer will work and inside the setting how it will be… it should be shown
          in kitchen panel… manager also and owner. Also a quick written guide… it should take me to
          the page." The owner panel holds NO printing controls on purpose — automatic printing and
          which screen prints are the admin's, and the per-device answer belongs to the computer with
          the printer, not to this account. What belongs here is the DOOR to the guide, which is the
          thing an owner actually needs when a new restaurant is being set up. */}
      {/* THE SECTION CAN NOW SAY IT WAS SHORTENED. Three states, not two:
            · rows        → printing is on here, and this is where the paper comes out
            · nothing     → printing is off for this restaurant (his rule, unchanged: what is
                            withheld is never mentioned — see R36 above)
            · this line   → the read failed, so we genuinely do not know which of the two it is
          The third used to be silently drawn as the second, which is how a section he had been
          given disappeared and came back with nothing said. */}
      {data && data.printingOk === false && !(data.printing && data.printing.length) && (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Kitchen printing</div>
        <div className="adm-muted" style={{ fontSize: 13 }}>
          Couldn&rsquo;t load this just now. Nothing has changed &mdash; refresh the page to try again.
        </div>
      </div>
      )}
      {!!(data?.printing && data.printing.length) && (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Kitchen printing</div>
        {/* WHERE THE PAPER IS COMING OUT, per restaurant (mig 338). One screen prints at a time; this
            says which, and whether it has gone quiet. No controls here on purpose — the owner is not
            standing at the printer, the two switches belong to the admin, and the per-screen switch
            belongs to the computer the printer is attached to. */}
        <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          {data.printing.map((p) => {
            // ── ONE ANSWER, ONE RESTAURANT ─────────────────────────────────────────────────────
            // T13 (sweep #7) found this independently on 2026-08-27 and fixed it the only way its
            // own territory allowed — by using the answer only when the list held exactly one row.
            // T20 had already fixed it PROPERLY the same week, by making the route say which
            // restaurant it answered for, which is the version kept here: it is right for two
            // restaurants as well as one, and T13's workaround is superseded, not discarded.
            // ── ONLY FOR THE RESTAURANT THIS ANSWER IS ACTUALLY ABOUT (T20 round 2, 2026-08-31) ────
            // /api/owner/printing answers for ONE restaurant, and this is a LIST — so looking the
            // answer up once and using it for every row named one restaurant's printer and computer
            // on another restaurant's line. The comment here already said "answers for one"; the code
            // then used it for all of them.
            // The route now echoes `restaurantId`, so the match is explicit. `!printing.restaurantId`
            // keeps an older deployment's answer working (it falls back to the screen branch, which
            // is what a restaurant with no helper shows anyway) rather than trusting it blindly.
            const kotHelper = (printing && printing.restaurantId === p.restaurant_id)
              ? (printing.routes.find((r) => r.kind === "kot" && r.printer) || null)
              : null;
            return (
            <div key={p.restaurant_id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", border: "var(--border)", borderRadius: 9, padding: "8px 11px" }}>
              <b style={{ fontSize: 13 }}>{p.name || "This restaurant"}</b>
              {/* A COMPUTER MAY OWN THE KITCHEN SLIPS NOW (mig 341), and then this row must not still
                  talk about screens: it said "tickets print on the kitchen screen · printing now:
                  Kitchen screen" directly above a card explaining that a program on a computer does
                  it — two answers to one question, on one screen. Seen in a screenshot, 2026-08-20. */}
              {kotHelper ? (
                <>
                  <span className="adm-muted" style={{ fontSize: 12 }}>
                    tickets print on <b>{kotHelper.printer}</b> — no screen needed
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12.5 }}>
                    printing now: <b>{kotHelper.computer}</b>
                    {kotHelper.connected ? null : <span className="adm-muted"> · asleep, tickets waiting</span>}
                  </span>
                </>
              ) : (
                <>
                  {/* "both" is GONE, not defaulted (owner, 2026-08-30). It meant "the kitchen prints
                      and the counter picks up what it leaves" — the backup screen, which was removed —
                      and the route stopped being able to answer it, so this branch was dead code that
                      still LOOKED like a supported answer. */}
                  <span className="adm-muted" style={{ fontSize: 12 }}>
                    tickets print on {p.target === "counter" ? "the counter screen" : "the kitchen screen"}
                  </span>
                  {/* ── "GONE QUIET" IS A WARNING, NOT A FOOTNOTE (owner, 2026-08-31 — item 29) ─────
                      This said "printing now: Kitchen screen · gone quiet" with the second half in
                      muted grey, i.e. styled as background detail. It is not background detail: the
                      screen that is supposed to be printing has not checked in for three minutes, so
                      tickets may not be coming out of the printer at all. That is the one thing on
                      this card worth interrupting somebody for.
                      The helper branch above already gets this right — it says "asleep, tickets
                      waiting", naming the CONSEQUENCE rather than the symptom. This branch now matches
                      it in both wording and weight: amber, and it says what it means for the food. */}
                  <span style={{ marginLeft: "auto", fontSize: 12.5 }}>
                    {p.station
                      ? p.stale
                        ? <>printing now: <b>{p.station}</b>
                            <span style={{ color: "var(--adm-warn, #d97706)", fontWeight: 700 }}> · gone quiet for 3+ min — tickets may not be printing</span>
                          </>
                        : <>printing now: <b>{p.station}</b></>
                      : <span style={{ color: "var(--adm-warn, #d97706)", fontWeight: 700 }}>no screen has taken it yet — tickets are waiting</span>}
                  </span>
                </>
              )}
            </div>
          ); })}
        </div>
        {printing ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            {/* ── AND SAY WHICH RESTAURANT THIS BOX IS ABOUT (T20 round 4, 2026-09-01) ────────────
                Item 30 stopped a printing ROW borrowing another restaurant's printer. This box below
                the rows had the same fault one level up and kept it: everything in it — the waiting
                count, the printer names, the computers — comes from /api/owner/printing, which answers
                for exactly ONE restaurant, and nothing here named it. Under a one-row list that is
                fine. Under a TWO-row list the owner reads "4 things are waiting to print" and cannot
                tell whose four.
                Found by MAKING the two-row case reachable: printing was switched on for a second
                restaurant, the page was rendered, and the box sat under both names describing one.
                (Round 3 recorded this case as unreachable on today's data; round 4's job was to reach
                it.) The route already echoes `restaurantId` for item 30, so the name is free. */}
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              Where your paper comes out right now
              {(data.printing?.length ?? 0) > 1 && printing.restaurantId ? (
                <span className="adm-muted" style={{ fontWeight: 600 }}>
                  {" · "}{data.printing.find((x) => x.restaurant_id === printing.restaurantId)?.name
                    ?? data.restaurants.find((x) => x.id === printing.restaurantId)?.name
                    ?? "one of your restaurants"}
                </span>
              ) : null}
            </div>
            <p className="adm-muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
              {/* ── THE TWO SENTENCES READ AS AN ARGUMENT (owner, 2026-08-31 — item 29) ──────────
                  The row above says "printing now: Kitchen screen" and this said "No computer is set
                  up to print yet". Both are true and they are about different things — which screen is
                  taking the paper, versus whether a dedicated printer computer exists — but read one
                  after the other they sound like the page contradicting itself. Seen in a screenshot
                  during the T20 sweep's visual pass.
                  Reworded so the pair is ONE statement: the second sentence now explains the first
                  rather than appearing to deny it. */}
              {printing.computers.length
                ? "A printer program on your own computer does this — no screen has to be open, and nothing you close can stop it."
                : "A screen is doing this because no printer computer is set up here yet — so whichever screen has taken it has to stay open. Ask us to set one up and it becomes automatic."}
            </p>
            {printing.computers.map((c) => (
              <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "5px 0" }}>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: c.connected ? "#30a46c" : "#e5484d" }} />
                <b style={{ fontSize: 13.5 }}>{c.name}</b>
                <span className="adm-muted" style={{ fontSize: 12 }}>
                  {c.connected ? `ready · seen ${c.secondsAgo ?? 0}s ago`
                    : c.secondsAgo == null ? "has never checked in"
                    : `asleep — last seen ${c.secondsAgo > 3600 ? Math.round(c.secondsAgo / 3600) + "h" : Math.round(c.secondsAgo / 60) + " min"} ago`}
                </span>
                {c.printers.length ? <span className="adm-muted" style={{ fontSize: 12 }}>· {c.printers.join(" · ")}</span> : null}
              </div>
            ))}
            {printing.routes.length ? (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                {printing.routes.map((r) => (
                  <div key={r.kind} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0", flexWrap: "wrap" }}>
                    <span className="adm-muted" style={{ minWidth: 130 }}>{KIND_WORDS[r.kind] || r.kind}</span>
                    <b>{r.printer}</b>
                    {r.computer ? <span className="adm-muted">on {r.computer}{r.connected ? "" : " (asleep — waiting)"}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <p className="adm-muted" style={{ fontSize: 12, marginTop: 9 }}>
              {printing.on ? "" : "Automatic printing is switched off at the moment — tickets wait and nothing is lost. "}
              {printing.waiting > 0
                ? `${printing.waiting} ${printing.waiting === 1 ? "thing is" : "things are"} waiting to print.`
                : "Nothing is waiting to print."}
              {" "}Changing which printer gets which paper is done for you by Aevidine — ask and it is one line.
            </p>
          </div>
        ) : null}
        {/* THE EXPLANATION IS BEHIND A TAP (owner, 2026-09-01 — "you can do 14th").
            Fourteen lines of it sat between "where your paper comes out" and the four guide buttons,
            so on a phone the owner scrolled past the whole thing to reach the button they came for.
            NOT ONE WORD IS CHANGED and nothing is summarised — it is the same paragraph, one tap
            away, with the status and the buttons now next to each other. Closed by default on every
            width: on a laptop it was five lines of prose doing the same job. `<details>` is the same
            control the Add form already uses for "Add their details now", so it is not a new idea on
            this screen, and it needs no JavaScript and no back-button layer. */}
        <details className="prn-how">
          <summary>How printing works <span className="adm-muted">· the short version, and what the guide covers</span></summary>
          <p className="adm-muted" style={{ fontSize: 12.5, margin: "8px 0 10px" }}>
          A kitchen ticket is queued by the server the moment an order is placed, so it can never be
          lost — it waits until a printer takes it, whether that is a computer running the printer
          program or a screen. The full written guide covers setting a printer up
          on <b>Windows</b>, a <b>Mac</b>, <b>Linux</b> or a <b>Raspberry Pi</b>: the printer itself, the
          paper settings, the printer program that prints with no window open at all, and what
          to do when something goes wrong. It opens as its own page and can be saved as a PDF. There is
          nothing to download — the guide has one menu per operating system and every command has a Copy
          button, because a downloaded script is blocked by macOS and warned about by Windows.
        </p>
        </details>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* The icon is spaced off its label by `gap` on `.owx .adm-btn` in app/globals.css — a flex
              container TRIMS the leading whitespace of a text run, so `<i/> Open the…` rendered as
              one word: the book glyph touching "Open" (measured 0px, T13 sweep, 2026-08-27). This
              button carried its own inline gap for one commit; the shared rule replaced it on
              2026-09-01 because four more buttons in this console had the same fault and a per-button
              override would have hidden the next regression in the shared rule rather than catching
              it. Do not put the inline gap back — verify:owner-panel §13 now watches the rule. */}
          <a className="adm-btn" href="/print-setup.html" target="_blank" rel="noopener">
            <i className="fas fa-book-open" aria-hidden="true" /> Open the printer setup guide
          </a>
          {/* Straight into one OS menu — the guide is three by-hand menus now, and the person setting a
              printer up already knows which computer is under the counter. */}
          <a className="adm-btn" href="/print-setup.html#windows" target="_blank" rel="noopener">🪟 Windows steps</a>
          <a className="adm-btn" href="/print-setup.html#mac" target="_blank" rel="noopener">🍎 Mac steps</a>
          <a className="adm-btn" href="/print-setup.html#linux" target="_blank" rel="noopener">🐧 Linux / Pi steps</a>
        </div>
        <style>{`
          .prn-how { margin: 2px 0 10px; }
          .prn-how summary { cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--muted); padding: 4px 0; }
          .prn-how summary::marker { color: var(--muted); }
        `}</style>
        <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
          Turning printing on, and choosing whether it comes out in the kitchen or at the counter, is
          done for you by Aevidine — ask and it is one switch. The screen that prints is chosen ON that
          computer: manager screen → <b>Settings → Printing</b>, kitchen screen → <b>☰ → Settings</b>.
        </p>
      </div>
      )}

      {/* Change password */}
      {data?.canChangePassword && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Change password</div>
          <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>You&apos;ll be signed out and asked to log in again with the new password.</p>
          <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 340 }}>
            <input className="adm-input" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <input className="adm-input" type="password" autoComplete="new-password" placeholder="New password (min 6 characters)" value={nw} onChange={(e) => setNw(e.target.value)} required />
            <input className="adm-input" type="password" autoComplete="new-password" placeholder="Repeat new password" value={cf} onChange={(e) => setCf(e.target.value)} required />
            {pwErr && <div style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{pwErr}</div>}
            {pwMsg && <div style={{ color: "var(--adm-ok, #16a34a)", fontSize: 12.5 }}>{pwMsg}</div>}
            <div><button className="adm-btn" type="submit" disabled={pwBusy}>{pwBusy ? "Saving…" : "Update password"}</button></div>
          </form>
        </div>
      )}

      {/* What's enabled */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>What&apos;s enabled</div>
        <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>The sections Aevidine has switched on for you. To change these, contact Aevidine.</p>
        {err ? <div className="adm-empty">Not available.</div> : !data ? <div className="adm-empty">Loading…</div> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {/* ON only — see the REJECTED note above. `!== false` matches the server's own rule
                (an absent key means ON), so nothing he has can be missed. */}
            {Object.keys(SECTION_LABEL).filter((k) => data.sections[k] !== false).map((k) => (
              <span key={k} className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 14%, transparent)", color: "var(--adm-ok,#16a34a)" }}>
                <i className="fas fa-check" aria-hidden="true" /> {SECTION_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* "Features you control" was removed in the access rebuild (owner, 2026-07-31):
          owners configure no features at all now — every switch lives on the admin's
          Access & permissions screen, so a feature can never be on in one place and off
          in another. The API still answers `modules` for older clients; nothing renders it. */}

      {/* Your restaurants */}
      {data && data.restaurants.length > 0 && (
        <div className="adm-card">
          <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Your restaurants <span className="adm-muted" style={{ fontWeight: 500 }}>· {data.restaurants.length}</span></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {data.restaurants.map((r) => <span key={r.id} className="adm-chip">{r.name}</span>)}
          </div>
        </div>
      )}
    </>
  );
}
