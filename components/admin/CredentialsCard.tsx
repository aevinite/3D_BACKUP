"use client";
// Admin · Restaurants → a restaurant → "Logins & passwords" + the printable handover sheet
// (owner, 2026-08-16: "I could able to see owner pass and all that stuff … also make sure that
// there is a print option, which will show all the stuff").
//
// WHAT THE ADMIN GETS. Every login this restaurant has — its owner(s) and its manager / kitchen /
// tablet accounts — with the password beside it, and one button that prints the lot as a clean
// handover sheet he can give a client.
//
// COVERED UNTIL HE ASKS (owner, 2026-09-13). The passwords do not arrive with the page. The card
// loads every name, role and login id, marks which rows HAVE a stored password, and covers the
// values behind one box: type the admin password, and they show for five minutes. Signing in to the
// console is the right bar for reading a restaurant's bills; it is not the right bar for reading
// back a client's password off a screen anybody could be standing behind. lib/revealGate.ts.
//
// THE ONE THING THAT IS NOT POSSIBLE, SAID ON SCREEN RATHER THAN HIDDEN. A password created before
// migration 330 was never stored in a readable form (only its one-way hash), so it cannot be shown
// — by anyone, uncovered or not, and no amount of typing the admin password changes that. Those
// rows say so and offer **Set a new one**, which mints a password and keeps it readable from then
// on. Everything created or changed since — including a staff member changing their own password in
// their panel — is readable here without touching anything.
//
// AND CHANGING A PASSWORD NO LONGER EMPTIES THE FLOOR (owner, 2026-09-13: "the table and the
// password change no relation"). A new password decides who may sign in NEXT time; `token_version`
// decides who is signed in NOW. They were tied together, so a handover reset signed out the kitchen
// mid-service — and the server refused while any table was open to stop it. Both are gone: the
// sign-out is a tick you have to put IN, off by default, and the card just says how many tables are
// live so the decision is made with the number in front of you.
//
// PRINTING. No pop-up window (a blocked pop-up is the silent-tap bug this same sweep is fixing):
// the sheet renders in a normal modal and a `@media print` block hides the rest of the console, so
// Ctrl/⌘-P prints the sheet alone. With several owners it asks WHOSE sheet first — one owner per
// sheet, each with that owner's own login followed by the shared panel logins.
import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminFetch";
import { CopyButton } from "@/components/admin/CopyButton";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { useToast } from "@/components/admin/toast";
import { RevealChip, RevealUnlock, useReveal } from "@/components/admin/useReveal";

type Login = {
  id: string; role: string; roleLabel: string; name: string; username: string;
  active: boolean; primary: boolean;
  /** The value — only ever present while the console is uncovered. */
  password: string | null;
  /** Whether a readable copy EXISTS at all. Answered even while covered, because "this row will
   *  print blank" is the question you ask before deciding to uncover anything. */
  hasPassword: boolean;
};
type Data = {
  restaurant: { id: string; name: string; slug: string; active: boolean; binned: boolean; guestUrl: string };
  logins: Login[];
  vaultReady: boolean;
  unlocked: boolean;
  /** Live tables this second — null when the count could not be read. Advice, never a veto. */
  openTables: number | null;
  generatedAt: string;
};

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();
const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

// Is this login's display name a REAL person, or the name the restaurant builder invents for a
// starter login ("<Restaurant> kitchen")? Only a real one is worth printing next to the screen.
function personName(l: Login, restaurantName: string): boolean {
  const n = (l.name || "").trim();
  if (!n || n.toLowerCase() === l.username.toLowerCase()) return false;
  return n.toLowerCase() !== `${restaurantName} ${l.role}`.toLowerCase();
}

export default function CredentialsCard({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  // The shared console-wide uncover window. `unlocked` here and `d.unlocked` from the last read are
  // two different moments in time; the hook is the live one and it is what the card draws from.
  const { unlocked, configured } = useReveal();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string>("");   // which row is mid "are you sure?"
  const [sheetFor, setSheetFor] = useState<string | null>(null); // owner id, or "" for no-owner sheet
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const r = await adminFetch<Data>(`/api/admin/restaurants/credentials?restaurant_id=${encodeURIComponent(restaurantId)}`);
    if (r.ok) setD(r.data); else setErr(r.error);
  }, [restaurantId]);
  useEffect(() => { load(); }, [load]);

  // The values live on the SERVER's side of the gate — they were never sent while covered, so there
  // is nothing on this page to un-hide. Crossing the line in EITHER direction re-reads: uncovering
  // fetches the passwords for the first time, and re-covering throws the copy in this component's
  // memory away rather than leaving it sitting in a closed card.
  // ── COVERING CLEARS THE SCREEN ITSELF; IT MUST NOT RE-READ (fixed 2026-09-14) ─────────────────
  // This used to call load() in BOTH directions, and covering was a race it lost. `lock()` flips the
  // shared state to covered FIRST and sends the DELETE after (so the screen reacts instantly), so
  // the re-read this effect fired went out while the server still considered the console uncovered —
  // and came back WITH every password, which the card then rendered. Pressing Cover left all nine
  // passwords sitting on the page. Found by driving the deployed sites, not by reading the code:
  // the server had correctly stopped serving them, so every API-level check passed.
  //
  // There is nothing to fetch when covering. The values are already here and the only job is to drop
  // them, so drop them locally and make no request at all — a race needs two things in flight.
  // Uncovering still re-reads, because those values were never sent in the first place.
  const wasUnlocked = useRef<boolean | null>(null);
  useEffect(() => {
    if (wasUnlocked.current === null) { wasUnlocked.current = unlocked; return; }
    if (wasUnlocked.current === unlocked) return;
    wasUnlocked.current = unlocked;
    if (!unlocked) {
      setD((p) => (p ? { ...p, unlocked: false, logins: p.logins.map((l) => ({ ...l, password: null })) } : p));
      setConfirmId("");
      return;
    }
    void load();
  }, [unlocked, load]);

  const owners = (d?.logins || []).filter((l) => l.role === "owner");
  const panels = (d?.logins || []).filter((l) => l.role !== "owner");

  // Mint a NEW password for ONE login and show it — the only route for a row that never had a
  // readable copy. `signOut` is the caller's decision and defaults to off: a handover wants the new
  // password on paper, not the person's tablet dropped to a login screen.
  const reveal = async (l: Login, signOut: boolean) => {
    setConfirmId("");
    setBusy(l.id);
    const r = await adminFetch<{ password: string; signedOut: boolean }>("/api/admin/restaurants/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ restaurant_id: restaurantId, user_id: l.id, signOut }),
    });
    setBusy(null);
    if (r.ok) {
      setD((p) => (p ? { ...p, logins: p.logins.map((x) => (x.id === l.id ? { ...x, password: r.data.password, hasPassword: true } : x)) } : p));
      toast(`New password set for ${l.name}.${r.data.signedOut ? " They have been signed out." : " Their screens stayed signed in."}`);
    } else toast(r.error || "Couldn't set a password.", "err");
  };

  // ── NEW PASSWORDS FOR THE WHOLE RESTAURANT, IN ONE PRESS (owner, 2026-08-31 — item 28) ──────────
  // A handover used to be one "Show" per login, each with its own confirmation. This is one press for
  // all of them — and it is deliberately NOT the primary button on the card: the ordinary reason to
  // open this card is to READ the sheet, not to change every password on it.
  //
  // The confirm step is now a real DECISION rather than a warning to press through, because the
  // dangerous half is opt-in: the tick says whether the screens in the building get signed out, and
  // the line under it says how many tables are live this second. Off, this changes nothing anybody
  // is currently looking at. See the note above resetAll() in the route.
  const [resetAllStep, setResetAllStep] = useState<0 | 1>(0);
  const [alsoSignOut, setAlsoSignOut] = useState(false);
  const resetAll = async () => {
    setResetAllStep(0);
    setBusy("__all__");
    const signOut = alsoSignOut;
    const r = await adminFetch<{ reset: number; logins: Login[]; failed?: string[]; signedOut: boolean }>("/api/admin/restaurants/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ restaurant_id: restaurantId, action: "reset_all", signOut }),
    });
    setBusy(null);
    setAlsoSignOut(false);
    if (!r.ok) { toast(r.error || "Couldn't set the passwords.", "err"); return; }
    // Re-read rather than patching row by row: the answer carries every new password and the sheet
    // has to show exactly what the server stored, not what this component hoped it stored.
    await load();
    if (r.data.failed?.length) {
      toast(`${r.data.reset} password${r.data.reset === 1 ? "" : "s"} set — but ${r.data.failed.length} failed (${r.data.failed.join(", ")}). Press Set a new one on those.`, "err");
    } else {
      toast(`New passwords set for all ${r.data.reset} logins.${r.data.signedOut ? " Everyone has been signed out." : " Every screen stayed signed in."}`);
    }
  };

  const openSheet = () => {
    if (owners.length > 1) { setPicking(true); return; }
    setSheetFor(owners[0]?.id ?? "");
  };

  return (
    // data-adm-ctl: an alert elsewhere in the console (System health's "screens nobody has signed
    // into") sends the admin here and rings this card, so he can see which of the page's cards the
    // alert meant (owner, 2026-09-02 — see lib/adminJump.ts). The `id` is the existing ?section=
    // scroll anchor and is unchanged.
    <div className="adm-card" style={{ marginBottom: 14 }} id="det-credentials" data-adm-ctl="credentials">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0 }}>
            <i className="fas fa-key" style={{ marginRight: 8, opacity: 0.8 }} aria-hidden="true" />
            Logins &amp; passwords
          </h2>
          <p className="hint" style={{ margin: "3px 0 0" }}>
            Everyone who can sign in to this restaurant. Print this as a handover sheet for the client.
          </p>
        </div>
        <RevealChip />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="adm-btn" onClick={load} title="Reload">
            <i className="fas fa-rotate-right" style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
          <button className="adm-btn" onClick={() => setResetAllStep(1)}
            disabled={!d || d.logins.length === 0 || busy === "__all__" || !unlocked}
            title={unlocked ? "Give every login here a new password, for a handover" : "Uncover the passwords first"}>
            <i className="fas fa-key" style={{ marginRight: 7 }} aria-hidden="true" />
            {busy === "__all__" ? "Setting…" : "New passwords for all"}
          </button>
          <button className="adm-btn primary" onClick={openSheet} disabled={!d || d.logins.length === 0 || !unlocked}
            title={unlocked ? "Open a printable handover sheet" : "Uncover the passwords first"}>
            <i className="fas fa-print" style={{ marginRight: 7 }} aria-hidden="true" />Print handover sheet
          </button>
        </div>
      </div>

      {err && (
        <div className="adm-empty" style={{ marginTop: 12 }}>
          Couldn&rsquo;t load the logins. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </div>
      )}

      {/* COVERED. Shown above the list rather than instead of it — the roster is useful on its own
          (who exists, which rows will print filled in), and hiding the whole card behind a password
          box would make "who can sign in here?" cost a password too. */}
      {d && d.vaultReady && !unlocked && configured !== null && (
        <div className="pw-cover">
          <RevealUnlock note="Type the admin password — the same one you signed in with — to read these for 5 minutes. They cover themselves again automatically." />
        </div>
      )}

      {/* THE ONE PRESS, AS A DECISION. The tick is the whole point: with it off nothing anybody is
          looking at right now changes, which is what a handover actually wants. */}
      {resetAllStep === 1 && d && (
        <div className="pw-cover pw-decide" role="group" aria-label="New passwords for every login">
          <b style={{ fontSize: 14 }}>
            Give all {d.logins.length} login{d.logins.length === 1 ? "" : "s"} at {d.restaurant.name} a new password?
          </b>
          <p className="hint" style={{ margin: "3px 0 0" }}>
            Each one gets a fresh password, stored so it can be printed. The old passwords stop working.
          </p>
          <label className="pw-tick">
            <input type="checkbox" checked={alsoSignOut} onChange={(e) => setAlsoSignOut(e.target.checked)} />
            <span>
              <b>Also sign everyone out of their screens</b>
              <span className="hint" style={{ display: "block", marginTop: 2 }}>
                {alsoSignOut
                  ? "Every manager, kitchen and waiter screen at this restaurant drops to the login page the moment you press the button."
                  : "Leave this off and every screen keeps working exactly as it is — the new passwords apply the next time somebody signs in."}
              </span>
            </span>
          </label>
          {/* The number, not a veto (owner, 2026-09-13). It only matters to the ticked case, so it
              only appears there — a table count beside a decision it cannot affect is noise. */}
          {alsoSignOut && (
            <p className="pw-live" style={{ color: d.openTables ? "var(--adm-warn)" : "var(--muted)" }}>
              <i className={`fas fa-${d.openTables ? "triangle-exclamation" : "circle-check"}`} style={{ marginRight: 7 }} aria-hidden="true" />
              {d.openTables === null
                ? "Couldn't check how many tables are open right now."
                : d.openTables === 0
                  ? "No tables are open right now — nobody is mid-service."
                  : `${d.openTables} table${d.openTables === 1 ? " is" : "s are"} open right now. Those screens will go to the login page.`}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button className={`adm-btn ${alsoSignOut ? "danger" : "primary"}`} onClick={resetAll}>
              <i className="fas fa-key" style={{ marginRight: 7 }} aria-hidden="true" />
              {alsoSignOut ? `Set all ${d.logins.length} and sign everyone out` : `Set all ${d.logins.length} new passwords`}
            </button>
            <button className="adm-btn" onClick={() => { setResetAllStep(0); setAlsoSignOut(false); }}>Cancel</button>
          </div>
        </div>
      )}

      {d && !d.vaultReady && (
        <p className="hint" style={{ marginTop: 10, color: "var(--adm-warn)" }}>
          <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
          No credential key is set on this deployment, so passwords can&rsquo;t be stored or shown here.
          The sheet will still print the login names.
        </p>
      )}

      {!d && !err ? (
        <div className="adm-empty" style={{ marginTop: 12 }}>Loading logins…</div>
      ) : d && d.logins.length === 0 ? (
        <div className="adm-empty" style={{ marginTop: 12 }}>
          This restaurant has no logins yet. Create them on the <a href="/aevinite/people?tab=users" style={{ color: "var(--accent)" }}>Users</a> page.
        </div>
      ) : d ? (
        <div className="pw-list">
          {[...owners, ...panels].map((l) => (
            <div key={l.id} className="pw-row">
              <span className="pw-role">
                {l.roleLabel}
                {l.primary ? <i className="fas fa-star" style={{ marginLeft: 5, fontSize: 9, color: "#fbbf24" }} title="Primary owner" aria-hidden="true" /> : null}
              </span>
              <span className="pw-name" title={l.name}>
                {l.name}
                {!l.active ? <span className="adm-chip" style={{ marginLeft: 6, fontSize: 10 }}>suspended</span> : null}
              </span>
              <span className="pw-user" style={mono}>{l.username}</span>
              {/* FOUR STATES, AND TELLING THEM APART IS THE WHOLE JOB OF THIS CELL:
                    · the value            — uncovered, and a readable copy exists
                    · covered              — a copy EXISTS, the console is just covered (dots, not
                                             a promise; the row will print filled in)
                    · never stored         — no copy has ever existed. Uncovering changes nothing
                                             here; only minting a new password does.
                    · mid-confirm          — about to mint one, with the sign-out decision in view */}
              <span className="pw-pass">
                {l.password ? (
                  <>
                    <b style={mono}>{l.password}</b>
                    <CopyButton className="adm-btn" style={{ fontSize: 11, padding: "3px 8px", marginLeft: 8 }} text={l.password} />
                  </>
                ) : l.hasPassword ? (
                  // Dots + a lock, never a bare blank: a blank cell and "there is no password" look
                  // identical, and they are opposite facts about the handover you are about to print.
                  <span className="adm-muted" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                    <b style={{ ...mono, letterSpacing: 2, fontSize: 14 }} aria-hidden="true">••••••••••</b>
                    <span className="pw-sr">Saved, and covered</span>
                    <i className="fas fa-lock" style={{ fontSize: 10.5, opacity: .8 }} aria-hidden="true" title="Covered — uncover above" />
                  </span>
                ) : confirmId === l.id ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>Mint a new one —</span>
                    <button className="adm-btn primary" style={{ fontSize: 11.5, padding: "4px 9px", minHeight: 30 }}
                      onClick={() => reveal(l, false)} title="They stay signed in on every screen">
                      keep them signed in
                    </button>
                    <button className="adm-btn danger" style={{ fontSize: 11.5, padding: "4px 9px", minHeight: 30 }}
                      onClick={() => reveal(l, true)} title="Ends every session this person has open">
                      and sign them out
                    </button>
                    <button className="adm-btn" style={{ fontSize: 11.5, padding: "4px 9px", minHeight: 30 }} onClick={() => setConfirmId("")}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <span className="adm-muted" style={{ fontSize: 12 }}>never stored — no copy exists</span>
                    <button className="adm-btn" style={{ fontSize: 11.5, padding: "4px 9px", marginLeft: 8, minHeight: 30 }}
                      disabled={busy === l.id || !d.vaultReady || !unlocked}
                      onClick={() => setConfirmId(l.id)}
                      title={unlocked ? "Mint a password for this login and show it here" : "Uncover the passwords first"}>
                      {busy === l.id ? "Setting…" : "Set a new one"}
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
          <p className="hint" style={{ margin: "10px 0 0" }}>
            A password set before this feature existed can&rsquo;t be read back — nothing ever kept a
            readable copy of it, so uncovering does not help those rows. <b>Set a new one</b> mints a
            password for that login and keeps it visible from then on; <b>New passwords for all</b>
            does it to every login here in one press, for a handover. Neither signs anybody out unless
            you tick the box that says so. Passwords changed by staff in their own panel appear here
            automatically. Everything is stored encrypted — this card is the only screen that can open it.
          </p>
        </div>
      ) : null}

      {picking && d && (
        <OwnerPicker owners={owners} onClose={() => setPicking(false)}
          onPick={(id) => { setPicking(false); setSheetFor(id); }} />
      )}
      {sheetFor !== null && d && (
        <HandoverSheet data={d} ownerId={sheetFor} onClose={() => setSheetFor(null)} />
      )}

      <style>{`
        .pw-cover{margin-top:12px;padding:14px;border:var(--border);border-radius:12px;background:var(--bg)}
        .pw-decide{display:grid;gap:9px}
        .pw-tick{display:flex;gap:10px;align-items:flex-start;cursor:pointer;padding:9px 10px;border:var(--border);border-radius:10px;background:var(--card)}
        .pw-tick input{margin:2px 0 0;width:18px;height:18px;flex:0 0 18px;cursor:pointer;accent-color:var(--accent)}
        .pw-tick:focus-within{outline:2px solid var(--accent);outline-offset:1px}
        .pw-live{margin:0;font-size:12.5px}
        /* Visible to a screen reader, not on screen: the dots are decoration, and "Saved, and
           covered" is the fact they stand for. */
        .pw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
        .pw-list{margin-top:12px}
        .pw-row{display:grid;grid-template-columns:132px minmax(90px,1fr) 130px minmax(210px,1.3fr);gap:10px;align-items:center;padding:10px 0;border-bottom:var(--border);font-size:13px}
        .pw-row:last-of-type{border-bottom:0}
        .pw-role{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
        .pw-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .pw-user{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
        .pw-pass{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
        @media (max-width: 860px){
          .pw-row{grid-template-columns:1fr;gap:3px;padding:12px 0}
          .pw-role{order:-1}
        }
      `}</style>
    </div>
  );
}

// ── "Whose sheet?" — only when a restaurant has more than one owner ────────────────────────────
// One owner per sheet (owner, 2026-08-16: "if there are two owner, it will ask for which owner you
// want to generate that list"). The panel logins are the same on every sheet, so each owner gets a
// complete, self-contained handover document.
function OwnerPicker({ owners, onClose, onPick }: { owners: Login[]; onClose: () => void; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "admin-cred-owner-pick", onClose);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Choose whose handover sheet"
        style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 430px)" }}>
          <h2 style={{ margin: "0 0 4px" }}>Whose handover sheet?</h2>
          <p className="hint" style={{ margin: "0 0 14px" }}>
            This restaurant has {owners.length} owners. Each sheet carries one owner&rsquo;s login plus all
            the panel logins — print one per person.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {owners.map((o) => (
              <button key={o.id} className="adm-btn" style={{ justifyContent: "flex-start", textAlign: "left", padding: "11px 13px" }}
                onClick={() => onPick(o.id)}>
                <b style={{ flex: 1 }}>{o.name}</b>
                {o.primary ? <span className="adm-chip" style={{ fontSize: 10, marginLeft: 8 }}>★ primary</span> : null}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="adm-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── The sheet itself ──────────────────────────────────────────────────────────────────────────
// ── The sheet itself ──────────────────────────────────────────────────────────────────────────
//
// PRINTED FROM ITS OWN DOCUMENT, IN A HIDDEN IFRAME — not by hiding the console around it.
//
// The obvious approach (`@media print { body * { visibility:hidden } .sheet * { visible } }`) is
// what this had first, and it is quietly fragile: `visibility` hides the console's CONTENT but not
// the dark surface it is painted on, so the sheet came out correct on a full page of black; the
// obvious follow-up (forcing the ancestors white, making the sheet absolute) then fought the
// console's own grid and squeezed the document into a column. Two attempts, two wrong pages.
//
// An iframe has none of that: the sheet is written into a document that contains NOTHING else, with
// its own stylesheet, and that document is what the printer receives. It is also why this needs no
// pop-up — a blocked pop-up is the silent-tap fault this same sweep is fixing elsewhere.
//
// ONE source of markup. `sheetHtml()` builds the document, and the on-screen preview renders that
// SAME string — so what you look at and what comes out of the printer cannot drift.

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const SHEET_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#111;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.pw-sheet{background:#fff;color:#111;padding:26px 28px}
.pw-sheet-h{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}
.pw-sheet-t{font-size:21px;font-weight:800;letter-spacing:-.2px}
.pw-sheet-s{font-size:12px;color:#555;margin-top:2px}
.pw-sheet-sec{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#666;margin:18px 0 7px;border-bottom:1px solid #ddd;padding-bottom:4px}
.pw-kv{display:flex;gap:14px;padding:3px 0}
.pw-kv span{width:110px;flex:0 0 110px;color:#555}
.pw-kv b{font-weight:700;word-break:break-all}
.pw-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pw-note{font-size:11.5px;color:#666;margin-top:3px}
.pw-block{margin-bottom:11px;break-inside:avoid;page-break-inside:avoid}
.pw-block-t{font-weight:700;margin-bottom:2px}
.pw-foot{margin-top:22px;padding-top:10px;border-top:1px solid #ddd;font-size:11px;color:#555}
@page{margin:16mm}
`;

/** The document body. Same string for the on-screen preview and the printed page. */
function sheetHtml(data: Data, ownerId: string): string {
  const owner = data.logins.find((l) => l.id === ownerId && l.role === "owner") || null;
  const panels = data.logins.filter((l) => l.role !== "owner");
  const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const BLANK = "________________";
  const kv = (k: string, v: string, m = false) =>
    `<div class="pw-kv"><span>${esc(k)}</span><b${m ? ' class="pw-mono"' : ""}>${esc(v)}</b></div>`;

  return `<div class="pw-sheet">
  <div class="pw-sheet-h">
    <div class="pw-sheet-t">${esc(data.restaurant.name)}</div>
    <div class="pw-sheet-s">Sign-in details &middot; prepared ${esc(when)}</div>
  </div>
  <div class="pw-sheet-sec">Your menu</div>
  ${kv("Guest menu", data.restaurant.guestUrl, true)}
  <div class="pw-note">Guests reach this by scanning the QR code on the table — no sign-in needed.</div>
  ${owner ? `<div class="pw-sheet-sec">Owner${owner.primary ? "" : " (co-owner)"}</div>
  ${kv("Name", owner.name)}
  ${kv("Login name", owner.username, true)}
  ${kv("Password", owner.password || BLANK, true)}` : ""}
  ${panels.length ? `<div class="pw-sheet-sec">Staff screens</div>` : ""}
  ${panels.map((p) => `<div class="pw-block">
    <div class="pw-block-t">${esc(p.roleLabel)}${personName(p, data.restaurant.name) ? ` &middot; ${esc(p.name)}` : ""}</div>
    ${kv("Login name", p.username, true)}
    ${kv("Password", p.password || BLANK, true)}
  </div>`).join("")}
  <div class="pw-foot">Keep this sheet private — anyone holding it can sign in. Passwords can be changed at
  any time from inside each screen; ask your Aevidine contact if you need a new one.</div>
</div>`;
}

function HandoverSheet({ data, ownerId, onClose }: { data: Data; ownerId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "admin-cred-sheet", onClose);
  const owner = data.logins.find((l) => l.id === ownerId && l.role === "owner") || null;
  const html = sheetHtml(data, ownerId);
  const anyMissing = [owner, ...data.logins.filter((l) => l.role !== "owner")].some((l) => l && !l.password);

  // Write the document into a hidden same-origin iframe and print THAT. Removed as soon as the
  // print dialog is done with it, so nothing is left behind in the page.
  const print = () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) { frame.remove(); return; }
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.restaurant.name)} — sign-in details</title><style>${SHEET_CSS}</style></head><body>${html}</body></html>`);
    doc.close();
    const go = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
      finally { window.setTimeout(() => frame.remove(), 1000); }
    };
    // Give the document a beat to lay out; onload is not guaranteed for a written document.
    if (doc.readyState === "complete") window.setTimeout(go, 60); else frame.onload = go;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={`Handover sheet for ${data.restaurant.name}`}
        style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(96vw, 660px)", maxHeight: "92dvh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <b style={{ flex: 1, fontSize: 15 }}>Handover sheet</b>
            <button className="adm-btn primary" onClick={print}>
              <i className="fas fa-print" style={{ marginRight: 7 }} aria-hidden="true" />Print
            </button>
            <button className="adm-btn" onClick={onClose}>Close</button>
          </div>

          {anyMissing && (
            <p className="hint" style={{ margin: "0 0 12px", color: "var(--adm-warn)" }}>
              <i className="fas fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />
              Some logins have no stored password, so they print with a blank line. Press <b>Show</b> on
              those rows first if you want them filled in.
            </p>
          )}

          {/* The preview IS the printed document — the SAME string, so what you look at and what
              the printer receives cannot drift (the whole reason this is a string and not a second
              copy of the markup).
              SAFE BY CONSTRUCTION, and it has to stay that way: every value that enters sheetHtml()
              goes through esc() — there are exactly two doors, kv() and the two esc() calls in the
              header/block title, and no other interpolation of data exists in it. If you add a
              field, add it through kv(). The values are our own rows (restaurant name, login names,
              generated passwords), never anything a guest typed. */}
          <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden" }}>
            <style>{SHEET_CSS.replace(/^body\{[^}]*\}$/m, "")}</style>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </>
  );
}
