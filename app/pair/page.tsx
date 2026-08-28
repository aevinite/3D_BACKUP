"use client";
// /pair — the ALLOW page. The one screen a person sees when a printer's computer links itself.
//
// Owner, 2026-08-27: *"zero typing one, yeah"* — so this page exists precisely so that nobody has to
// copy a code anywhere. The helper on the shop's computer opens it here, on its OWN machine, with
// the code already in the URL. The person reads what the machine said about itself and presses one
// button.
//
// It stands OUTSIDE the admin shell on purpose: it is opened by a program, on a machine where nobody
// may be signed in yet, and it must be readable with no sidebar, no restaurant pinned, and nothing
// else on screen. One card, one decision.
import { useCallback, useEffect, useState } from "react";

type Printer = { name: string; desc?: string; paper?: { wMm: number; hMm: number } };
type State = {
  signedIn: boolean; found?: boolean; already?: boolean;
  who?: "admin" | "staff"; person?: string;
  machine?: { hostname: string | null; os: string | null; printers: Printer[] };
  restaurants?: { id: string; name: string }[];
  expiresAt?: string;
};

const OS_WORD: Record<string, string> = { mac: "a Mac", windows: "a Windows PC", linux: "a Linux computer" };

export default function PairPage() {
  const [code, setCode] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [rid, setRid] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string } | null>(null);
  // WHO pressed Allow, remembered separately from `st` — the done screen needs it to decide where
  // its one button goes, and a later poll could arrive with a different shape.
  const [who, setWho] = useState<"admin" | "staff" | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const c = (new URLSearchParams(location.search).get("c") || "").toUpperCase();
    setCode(c);
  }, []);

  const load = useCallback(async () => {
    if (!code) { setSt({ signedIn: false, found: false }); return; }
    try {
      const r = await fetch(`/api/pair?c=${encodeURIComponent(code)}`, { cache: "no-store" });
      const d = (await r.json()) as State;
      setSt(d);
      if (d.who) setWho(d.who);
      // The machine's own name is the default, so the box is already right and nobody has to think
      // about it (owner: "what the fuck is a computer name"). It stays editable for the one case
      // that matters — two shops both called "Main PC" in his head, not the machine's.
      if (d.machine?.hostname && !name) setName(d.machine.hostname);
      if (d.restaurants?.length && !rid) setRid(d.restaurants[0].id);
    } catch { setErr("Could not reach the site. Check this computer is online."); }
  }, [code, name, rid]);

  useEffect(() => { void load(); }, [load]);

  // A pairing dies in ten minutes, and a person may be walking from the printer to the till while it
  // does. Re-reading every 15s means the page tells them it has expired instead of failing on the
  // button press.
  useEffect(() => {
    if (done || !code) return;
    const t = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(t);
  }, [done, code, load]);

  const allow = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/pair", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, rid, name: name.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(String(d.error || "That did not work.")); setBusy(false); return; }
      setDone({ name: String(d.name || name) });
    } catch { setErr("Could not reach the site. Check this computer is online."); }
    setBusy(false);
  };

  const body = () => {
    if (done) return (
      <>
        <div className="pr-tick" aria-hidden="true">✓</div>
        <h1>This computer can print now</h1>
        <p className="pr-lead">
          It is called <b>{done.name}</b>. Nothing else to do here — you can close this page.
        </p>
        <p className="pr-note">
          The helper is already asking for work. It will start again by itself every time this
          computer is switched on, so you never have to come back to this page.
        </p>
        {/* ── WHERE THIS BUTTON GOES DEPENDS ON WHO PRESSED ALLOW (owner's review, 2026-08-28) ──
            It went to the Aevidine console for everybody. But the printing board lives in TWO
            places — the console, and the restaurant's own Manager panel under Settings → Printing —
            and the person standing at the printer is usually the manager. So tapping it bounced them
            to a staff-password screen they have no answer to, which reads like their own login had
            just failed, at the exact moment the guide says "now go and choose printers". */}
        {who === "admin"
          ? <a className="pr-btn ghost" href="/aevinite/printing">Choose which printer prints what →</a>
          : <>
              <a className="pr-btn ghost" href="/manager">Choose which printer prints what →</a>
              <p className="pr-note">You will land on your own panel — it is under <b>Settings → Printing</b>.</p>
            </>}
      </>
    );
    if (!st) return <p className="pr-lead">Reading…</p>;

    if (!st.signedIn) return (
      <>
        <div className="pr-ico" aria-hidden="true">🔒</div>
        <h1>Sign in on this computer first</h1>
        <p className="pr-lead">
          A computer can only be allowed to print by somebody who is signed in <b>on that computer</b>.
          That is what proves it is the machine standing at the printer.
        </p>
        <div className="pr-actions">
          <a className="pr-btn" href={`/login?next=${encodeURIComponent(`/pair?c=${code}`)}`}>Sign in</a>
        </div>
        <p className="pr-note">
          Sign in with the login for this restaurant, then this page will show the <b>Allow</b> button.
          Aevidine&apos;s own admin sign-in works here too.
        </p>
      </>
    );

    if (st.already) return (
      <>
        <div className="pr-tick" aria-hidden="true">✓</div>
        <h1>Already linked</h1>
        <p className="pr-lead">This computer has been allowed to print. There is nothing left to do.</p>
        {/* Same rule as the green screen above: a manager gets their own panel, not our console. */}
        {who === "admin"
          ? <a className="pr-btn ghost" href="/aevinite/printing">Open Printing →</a>
          : <>
              <a className="pr-btn ghost" href="/manager">Open Printing →</a>
              <p className="pr-note">On your own panel, under <b>Settings → Printing</b>.</p>
            </>}
      </>
    );

    if (!st.found) return (
      <>
        <div className="pr-ico" aria-hidden="true">⏳</div>
        <h1>That link has expired</h1>
        <p className="pr-lead">
          A link is only good for ten minutes, so an old one can never be used by somebody else.
        </p>
        <p className="pr-note">
          Start the helper on that computer again — double-click the file — and it will open a fresh
          page here by itself.
        </p>
      </>
    );

    const m = st.machine;
    return (
      <>
        <div className="pr-ico" aria-hidden="true">🖨</div>
        <h1>Let this computer print?</h1>
        <p className="pr-lead">
          A printing helper is running on this computer and is asking to be allowed to print
          {st.who === "staff" ? " for your restaurant" : ""}.
        </p>

        {/* WHAT THE MACHINE SAID ABOUT ITSELF. It is shown before the button, not after, because the
            whole job of this page is letting a person recognise the machine in front of them rather
            than approve a code they cannot check. */}
        <div className="pr-card">
          <div className="pr-row"><span>This computer</span><b>{m?.hostname || "unnamed"}</b></div>
          <div className="pr-row"><span>It is</span><b>{OS_WORD[m?.os || ""] || "a computer"}</b></div>
          <div className="pr-row">
            <span>Printers on it</span>
            <b>{m?.printers?.length ? m.printers.map((p) => p.name).join(", ") : "none it could find"}</b>
          </div>
        </div>

        {!m?.printers?.length ? (
          <p className="pr-warn">
            It found <b>no printers</b>. You can still allow it, but nothing will print until a printer
            is plugged in and switched on — then it picks it up by itself within a couple of seconds.
          </p>
        ) : null}

        <label className="pr-field">
          <span>Call it</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            placeholder={m?.hostname || "Counter PC"} />
        </label>

        {st.who === "admin" && (st.restaurants?.length || 0) > 1 ? (
          <label className="pr-field">
            <span>For which restaurant</span>
            <select value={rid} onChange={(e) => setRid(e.target.value)}>
              {(st.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="pr-row plain">
            <span>For</span><b>{(st.restaurants || [])[0]?.name || "this restaurant"}</b>
          </div>
        )}

        {err ? <p className="pr-err">{err}</p> : null}

        <div className="pr-actions">
          <button className="pr-btn" onClick={() => void allow()} disabled={busy || !rid}>
            {busy ? "Linking…" : "Allow this computer to print"}
          </button>
          {/* A full page load, not a client route: this page is opened by a program and "Not now"
              means "I am done with this window", so leaving the app entirely is the honest action. */}
          <button className="pr-btn ghost" type="button" onClick={() => { location.href = "/"; }}>Not now</button>
        </div>
        <p className="pr-note">
          You are {st.person ? <b>{st.person}</b> : "signed in"}. This lets us send this restaurant&apos;s
          own bills and kitchen slips to the printers listed above — nothing else on this computer is
          reachable, and you can undo it at any time from the Printing screen.
        </p>
      </>
    );
  };

  return (
    <main className="pr-wrap">
      <div className="pr-sheet">
        <div className="pr-brand">Aevidine</div>
        {body()}
      </div>
      <Style />
    </main>
  );
}

function Style() {
  return (
    <style>{`
  /* Its own small stylesheet: this page is opened by a program on a machine that may never have
     loaded the console, so it must look finished with nothing else on the page. Dark, because the
     helper's own window is a terminal and the two should feel like one thing. */
  .pr-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(1200px 600px at 50% -10%, #1d2438, #0d1017 60%); color: #e9edf5;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .pr-sheet { width: 100%; max-width: 470px; background: #141924; border: 1px solid rgba(255,255,255,.11);
    border-radius: 18px; padding: 30px 28px 26px; box-shadow: 0 30px 70px rgba(0,0,0,.5); text-align: center; }
  .pr-brand { font-size: 12.5px; letter-spacing: .16em; text-transform: uppercase; opacity: .5; margin-bottom: 18px; }
  .pr-ico, .pr-tick { font-size: 34px; line-height: 1; margin-bottom: 12px; }
  .pr-tick { width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 999px; display: grid;
    place-items: center; background: rgba(48,163,108,.16); color: #4ade80; font-size: 28px; font-weight: 800; }
  .pr-sheet h1 { font-size: 21px; line-height: 1.25; margin: 0 0 10px; font-weight: 700; }
  .pr-lead { font-size: 14.5px; line-height: 1.55; margin: 0 0 16px; opacity: .84; }
  .pr-note { font-size: 12.5px; line-height: 1.55; margin: 14px 0 0; opacity: .58; text-align: left; }
  .pr-warn { font-size: 12.5px; line-height: 1.5; margin: 12px 0 0; text-align: left; padding: 10px 12px;
    border-radius: 10px; background: rgba(245,165,36,.12); border: 1px solid rgba(245,165,36,.35); }
  .pr-err { font-size: 13px; margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; text-align: left;
    background: rgba(229,72,77,.14); border: 1px solid rgba(229,72,77,.4); }

  .pr-card { text-align: left; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px; padding: 4px 14px; margin: 0 0 14px; }
  .pr-row { display: flex; gap: 12px; align-items: baseline; padding: 9px 0; font-size: 13.5px;
    border-bottom: 1px solid rgba(255,255,255,.07); }
  .pr-row:last-child { border-bottom: 0; }
  .pr-row > span { opacity: .6; flex: none; min-width: 108px; }
  .pr-row > b { margin-left: auto; text-align: right; word-break: break-word; }
  .pr-row.plain { border: 0; padding: 2px 0 12px; }

  .pr-field { display: flex; align-items: center; gap: 12px; text-align: left; margin: 0 0 12px; font-size: 13.5px; }
  .pr-field > span { opacity: .6; flex: none; min-width: 108px; }
  .pr-field input, .pr-field select { flex: 1; min-width: 0; min-height: 44px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(0,0,0,.28);
    color: inherit; font: inherit; font-size: 14px; }
  .pr-field input:focus, .pr-field select:focus { outline: none; border-color: #63b3ff;
    box-shadow: 0 0 0 3px rgba(99,179,255,.18); }

  .pr-actions { display: flex; flex-direction: column; gap: 9px; margin-top: 18px; }
  /* 52px, because this is the one button on the page and it is pressed by somebody standing at a
     counter, often on a touchscreen till. */
  .pr-btn { display: block; min-height: 52px; line-height: 52px; border-radius: 12px; border: 0;
    background: linear-gradient(180deg, #4f8cff, #3a6fe0); color: #fff; font: inherit; font-size: 15px;
    font-weight: 650; cursor: pointer; text-decoration: none; text-align: center; }
  .pr-btn:hover { filter: brightness(1.07); }
  .pr-btn:disabled { opacity: .55; cursor: not-allowed; filter: none; }
  .pr-btn:focus-visible { outline: 2px solid #9ec7ff; outline-offset: 3px; }
  .pr-btn.ghost { background: none; border: 1px solid rgba(255,255,255,.16); color: #cfd7e6;
    min-height: 44px; line-height: 44px; font-weight: 550; font-size: 14px; }
`}</style>
  );
}
