"use client";
import { useRestaurantId } from "@/lib/restaurant-context";

// SessionStatusWidget — a small, DRAGGABLE, collapsible status card that tells a
// guest they're connected to a table and lets them act on that connection:
//   • Head  → "👑 Hosting Table N"
//   • Guest → "🤝 On Table N — let in by the host" (or "⏳ waiting" before approval)
// Actions: Change table (leave + go pick another) and Leave (disconnect — your
// device reverts to its own private cart; the table keeps its order). If the head
// leaves, ownership passes on / the table closes (handled server-side).
//
// It only shows when dining sessions are ON and this device holds a session. When
// the session ends (anyone closes it, or the head leaves with no one left), the
// widget detects it on the next poll, clears the local token + cart, and hides.
//
// Behaviour mirrors the live OrderTracker: a floating glass card, draggable by its
// grip (position persists), tap the collapsed bubble to reopen.

// React building blocks plus the TypeScript types for pointer (touch/mouse)
// events and inline CSS styles, used by the drag-to-move code below.
import { useEffect, useRef, useState, type PointerEvent as RPE, type CSSProperties } from "react";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Lets us clear the "pre-fill this table" hint when you leave a table.
import { setScannedTable } from "@/lib/table";
// Helpers that talk to the server about the table's dining session.
import { getStoredSession, storeSession, clearStoredSession, getSessionState, leaveSession, touchSession } from "@/lib/session";
// Publish the live "can this guest order?" answer so the Add-to-cart gate can read
// it synchronously (this widget already polls the session, so we reuse that poll).
import { setTableConnection } from "@/lib/tableConnection";
import { RT_BACKUP_MS } from "@/lib/orderStatus"; // realtime backup-poll interval (60s)
// Phone back button: while a confirm/blocked popup shows, back closes it (not the site).
import { useBackClose } from "@/lib/backStack";

// localStorage keys for remembering where the user dragged the card and whether
// they collapsed it to the small bubble.
const POS_KEY = "lfh_sess_widget_pos_v2"; // v2: dropped older saved spots that sat too low
const COLLAPSED_KEY = "lfh_sess_widget_collapsed";
// Default resting spot: top-right, tucked just under the header controls
// ($/EN/theme/cart) — close to the cart, not drifting toward the middle.
const DEFAULT_POS = { right: 16, top: 88 };

// A snapshot of the table connection we display: table number, your role, whether
// you've been approved, how many people are at the table, and any active waiter
// calls (so we can show "You called: Water").
interface SState { table: string; role: "owner" | "guest"; approved: boolean; count: number; calls: { note: string }[]; }
// Turn a waiter-call reason into a little emoji for the "you called" row.
const callIcon = (note: string) => {
  const n = (note || "").toLowerCase();
  if (n.includes("water")) return "💧";
  if (n.includes("napkin")) return "🧻";
  if (n.includes("clean")) return "🧹";
  if (n.includes("cutlery") || n.includes("fork")) return "🍴";
  if (n.includes("bill") || n.includes("check")) return "🧾";
  return "🔔";
};
// Tiny helper to pop a notification toast.
const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

// SessionStatusWidget — the small floating card (draggable, collapsible) that tells
// a guest they're connected to a table and lets them leave or switch tables.
export default function SessionStatusWidget() {
  const restaurantId = useRestaurantId();
  // Tracks each piece of what we show and how the card behaves:
  const [enabled, setEnabled] = useState(false); // is the session system turned on?
  const [st, setSt] = useState<SState | null>(null); // the live table info, or null when not connected
  const [collapsed, setCollapsed] = useState(false); // shrunk to the little bubble?
  const [busy, setBusy] = useState(false); // true while a leave/change is in flight
  const [confirming, setConfirming] = useState(false); // showing the "are you sure you want to leave?" step
  const [orderActive, setOrderActive] = useState(false); // does the table have an in-progress (unserved) order?
  const [blocked, setBlocked] = useState(false); // showing the "can't leave mid-order — call a waiter" popup
  const [pos, setPos] = useState<{ right: number; top: number } | null>(null); // where the card sits on screen
  const tokenRef = useRef<string | null>(null); // our session token
  const wasActive = useRef(false); // were we connected last check? (used to detect the session ending)
  const introToken = useRef<string | null>(null); // session we've already played the open-then-shrink intro for
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // timer for the auto-shrink
  // Scratch data captured while dragging: where the drag started, the card's
  // starting position, the pointer id, and whether it actually moved (vs a tap).
  const dragRef = useRef<{ sx: number; sy: number; or: number; ot: number; pid: number; moved: boolean } | null>(null);

  // Disconnect this device locally: drop the token AND the (now-shared) cart, so a
  // left/closed table leaves no stale state. The cart reverts to private + empty.
  // We ALSO drop the live order records (lfh_active_orders): once you're off the
  // table — whether you left, were removed, or staff CLOSED the table — the floating
  // "order preparing / served" tracker should disappear instead of lingering after
  // the meal is over (owner, 2026-06-16). The lfh:order-placed nudge makes the
  // OrderTracker re-read straight away and draw nothing.
  const clearLocal = () => {
    clearStoredSession();
    try { localStorage.removeItem("lfh_cart"); } catch {}
    try { localStorage.removeItem("lfh_active_orders"); } catch {}
    setScannedTable("");                                    // stop pre-filling the table you just left
    window.dispatchEvent(new Event("lfh:cart-updated"));
    window.dispatchEvent(new Event("lfh:table-scanned"));
    window.dispatchEvent(new Event("lfh:session-changed"));
    window.dispatchEvent(new Event("lfh:order-placed"));    // make the live tracker re-read + hide
  };

  // This runs once on first appear: restore where the card was last dragged to
  // and whether it was left collapsed.
  // load persisted position + collapsed state
  useEffect(() => {
    // Only accept the new {right,top} shape; ignore any stale {x,y} from an older
    // build so it falls back to the clean default instead of landing mid-screen.
    try { const o = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (o && typeof o.right === "number" && typeof o.top === "number") setPos(o); } catch {}
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);

  // This runs once on first appear: check if sessions are on, and if so keep
  // polling the server every 3s so the card always reflects the live table state.
  // settings gate + live poll of the session state
  useEffect(() => {
    let alive = true; // guards against updating state after the component is gone
    let iv: ReturnType<typeof setInterval> | null = null; // the poll timer
    let onTick: (() => void) | null = null; // realtime nudge → refetch now
    (async () => {
      // Is the session system even turned on? If not, we'll never show anything.
      let on = false;
      try { on = (await getSettings(restaurantId)).sessionsEnabled; } catch {}
      if (!alive) return;
      setEnabled(on);
      if (!on) return;
      // Asks the server for the latest table state and copies it into our screen values.
      const poll = async () => {
        const s = getStoredSession();
        // No saved session on this device -> nothing to show.
        if (!s) { tokenRef.current = null; if (alive) setSt(null); return; }
        tokenRef.current = s.token;
        // Ask the server how this session is doing right now.
        const state = await getSessionState(s.token);
        if (!alive) return;
        // Three DEFINITIVE endings (anything else = network blip, retry next tick):
        //  • 'session_closed' — staff closed the whole table: clean up + tell them.
        //  • 'removed'        — this guest was kicked/declined: clean up + say so.
        //  • 'invalid_token'  — the token simply died: clean up quietly.
        // (Closing a table marks every member removed, so a closed table reports
        //  'session_closed' here — the ok:true status check below rarely fires.)
        if (!state.ok) {
          const reason = state.reason as string | undefined;
          if (reason === "session_closed") {
            const tellThem = wasActive.current; // only toast someone who was actually connected
            wasActive.current = false; tokenRef.current = null;
            if (tellThem) { clearLocal(); toast("This table’s session ended — scan the QR again to start a new one", "table"); }
            else clearStoredSession();
            setSt(null);
          } else if (reason === "removed") {
            const tellThem = wasActive.current;
            wasActive.current = false; tokenRef.current = null;
            if (tellThem) { clearLocal(); toast("You’ve been removed from this table", "table"); }
            else clearStoredSession();
            setSt(null);
          } else if (reason === "invalid_token") {
            clearStoredSession(); tokenRef.current = null; wasActive.current = false; setSt(null);
          }
          return;
        }
        // If the table is no longer open, the meal ended: if we were connected,
        // clean up and tell the guest; otherwise just quietly drop the token.
        const sess = state.session as { table_number?: string; status?: string } | undefined;
        if (sess?.status !== "open") {
          if (wasActive.current) { wasActive.current = false; clearLocal(); toast("This table’s session ended", "table"); }
          else { clearStoredSession(); }
          setSt(null);
          return;
        }
        // We're connected to an open table — remember that and refresh the display.
        wasActive.current = true;
        // If staff SHIFTED us to a new table, our locally-stored table is now stale.
        // Sync it and announce the change so realtime resubscribes to the NEW table's
        // topic (otherwise we'd keep listening on the old table and miss updates).
        const newTable = sess.table_number || s.table;
        if (newTable && s.table !== newTable) {
          storeSession({ ...s, table: newTable });
          setScannedTable(newTable);
          window.dispatchEvent(new Event("lfh:session-changed"));
        }
        const m = state.member as { role: "owner" | "guest"; approved?: boolean } | undefined;
        // ROLE PROMOTION SYNC. When the head leaves, the server hands ownership to
        // the next member (us) — but our STORED role stays "guest" until we write it
        // back. SessionOwner's approve-prompt poller only runs while the stored role
        // is "owner", so without this the new head silently never sees anyone asking
        // to join. Persist the new role + nudge SessionOwner to start polling.
        if (m?.role && m.role !== s.role) {
          storeSession({ ...s, role: m.role });
          window.dispatchEvent(new Event("lfh:session-changed"));
        }
        setSt({
          table: sess.table_number || s.table,
          role: m?.role || "guest",
          approved: !!m?.approved,
          count: Array.isArray(state.members) ? (state.members as unknown[]).length : 1,
          calls: Array.isArray(state.calls) ? (state.calls as { note: string }[]) : [],
        });
        // Is the table mid-meal? If ANY ordered dish isn't served yet, an order is
        // "going on" — we use this to block leaving/switching (the guest must ask a
        // waiter to transfer the table instead of walking off with food in flight).
        const sItems = Array.isArray(state.items) ? (state.items as { status: string }[]) : [];
        setOrderActive(sItems.some((i) => i.status !== "served"));
        // First time we see this session (you just got the table): show the full
        // card for 2s, then auto-shrink to the circle.
        if (introToken.current !== s.token) {
          introToken.current = s.token;
          setCollapsed(false);
          if (introTimer.current) clearTimeout(introTimer.current);
          introTimer.current = setTimeout(() => setCollapsed(true), 2000);
        }
      };
      // Check right away; realtime nudges drive instant refetches after that, with
      // a slow 60s backup poll for when the WebSocket is asleep/dropped.
      poll();
      iv = setInterval(poll, RT_BACKUP_MS);
      onTick = () => poll();
      window.addEventListener("lfh:rt-tick", onTick);
    })();
    // Cleanup when the component disappears: stop the poll, listener and intro timer.
    return () => { alive = false; if (iv) clearInterval(iv); if (onTick) window.removeEventListener("lfh:rt-tick", onTick); if (introTimer.current) clearTimeout(introTimer.current); };
    // restaurantId in deps: the global widgets resolve their restaurant async (starts at
    // #1, then fixes itself). Reading `sessionsEnabled` once at mount cached restaurant
    // #1's value — on a NON-#1 restaurant that published `sessionsEnabled:false` to
    // tableConnection, so gateAddToCart added straight to the cart and the guest was
    // NEVER prompted to open/join a table (owner: "open table isn't working"). Re-running
    // on the real id fixes it.
  }, [restaurantId]);

  // ── PRESENCE HEARTBEAT (migration 099) ──────────────────────────────────────
  // While this guest's menu tab is VISIBLE and we're connected to an OPEN table,
  // ping the server every 60s so "someone is actively viewing this table" keeps
  // the session from being auto-closed. We run this as its OWN effect — NOT a
  // line in the poll above — because that poll keeps ticking even when the tab is
  // hidden; bumping liveness from it would keep a backgrounded phone's table alive
  // forever (the exact phantom-table bug). So: beat only while !document.hidden,
  // STOP on hide, and beat once immediately on re-show. (The server also guards
  // "open only" so a stray beat can never create/reopen a table.)
  // Depend on a derived boolean (not the whole `st` object): the poll rebuilds
  // `st` on every realtime tick, so depending on `st` would tear down + restart
  // the timer (and fire an extra beat) on every tick — needless anon writes
  // against the owner's connection budget. `connected` only flips when we join
  // or leave an open table, so the 60s timer runs steadily.
  const connected = enabled && !!st;
  useEffect(() => {
    // Only heartbeat when sessions are on AND we hold an open table.
    if (!connected) return;
    let hbTimer: ReturnType<typeof setInterval> | null = null;
    const beat = () => {
      const token = tokenRef.current;
      if (token && !document.hidden) { touchSession(token); }
    };
    const start = () => {
      if (hbTimer) return;           // already running
      beat();                        // one immediate beat (e.g. on re-show)
      hbTimer = setInterval(beat, 60000);
    };
    const stop = () => { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    // Kick off only if we're currently visible; if hidden, wait for re-show.
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [connected]);

  // Publish the live "is this guest allowed to add to the cart?" answer for the
  // Add-to-cart gate (lib/tableConnection). Connected = sessions ON, in an open
  // table, AND approved (a partner still waiting for the head does NOT count).
  useEffect(() => {
    setTableConnection({ sessionsEnabled: enabled, connected: !!st && !!st.approved });
  }, [enabled, st]);

  // Phone back button closes these confirmations instead of leaving the site.
  useBackClose("ssw-blocked", blocked, () => setBlocked(false));
  useBackClose("ssw-confirm-leave", confirming, () => setConfirming(false));

  // ── actions ────────────────────────────────────────────────────────────────
  // This runs when the guest taps "Leave": tell the server, clean up locally,
  // and show a confirmation. Their cart goes back to private + empty.
  const doLeave = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await leaveSession(token);
    clearLocal(); // also drops lfh_active_orders + nudges the tracker to hide
    wasActive.current = false;
    setSt(null);
    setBusy(false);
    toast("You left the table", "table");
  };
  // This runs when the guest taps "Change table": leave the current one, clean
  // up, then send them back to the menu to pick/scan a different table.
  const doChange = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await leaveSession(token);
    clearLocal(); // also drops lfh_active_orders so the old table's tracker won't follow you
    window.location.href = "/menu"; // go pick / scan another table
  };

  // ── drag (grip on the card, or the whole collapsed bubble) ──────────────────
  // Keeps a number between a minimum and maximum (so the card can't be dragged
  // off-screen).
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  // Pointer pressed down: remember the start point and the card's current spot.
  const onDown = (e: RPE<HTMLElement>) => {
    const cur = pos || DEFAULT_POS;
    dragRef.current = { sx: e.clientX, sy: e.clientY, or: cur.right, ot: cur.top, pid: e.pointerId, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  // Pointer moving while held down: reposition the card to follow the finger.
  const onMove = (e: RPE<HTMLElement>) => {
    const d = dragRef.current; if (!d) return;
    // How far we've moved from where the press started.
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // tap, not a drag
    d.moved = true;
    // Right-anchored: moving the pointer right shrinks the right offset. Both the
    // bubble and the wider card share this, so expand/collapse never shifts it.
    setPos({
      right: clamp(d.or - dx, 8, window.innerWidth - 56),
      top: clamp(d.ot + dy, 64, window.innerHeight - 90),
    });
  };
  // Pointer released: if it was a real drag, save the new spot; if it was just a
  // tap on the collapsed bubble, reopen the full card.
  const onUp = (e: RPE<HTMLElement>) => {
    const d = dragRef.current; dragRef.current = null; if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (d.moved) {
      setPos((p) => { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {} return p; });
    } else if (collapsed) {
      setCollapsed(false); try { localStorage.setItem(COLLAPSED_KEY, "0"); } catch {}
    }
  };
  // Shrink the card down to the little bubble (and remember that choice).
  const collapse = () => { setCollapsed(true); try { localStorage.setItem(COLLAPSED_KEY, "1"); } catch {} };

  // Show nothing unless sessions are on AND we're actually connected to a table.
  if (!enabled || !st) return null;

  // Work out the labels/icon from your role and approval status.
  const isHost = st.role === "owner"; // you opened this table
  const waiting = !isHost && !st.approved; // you're a guest still awaiting the host's OK
  const faIcon = isHost ? "fa-crown" : st.approved ? "fa-user-check" : "fa-hourglass-half";
  const title = isHost ? `Hosting Table ${st.table}` : `Table ${st.table}`;
  const sub = isHost
    ? (st.count > 1 ? `${st.count} at this table` : "You opened this table")
    : st.approved ? "You’re in — let in by the host" : "Waiting for the host to let you in…";

  // Default to the top-right, tucked under the header controls; once dragged, the
  // saved right/top wins. When NOT dragged yet (pos === null), we let CSS place it
  // via the `.ssw-anchor` class — that uses the safe-area inset so a notched phone's
  // taller header can never sit on top of the cart button / the widget.
  const style: CSSProperties | undefined = pos ? { right: pos.right, top: pos.top } : undefined;
  const anchor = pos ? "" : " ssw-anchor";

  // When collapsed, draw just the small round bubble (tap or drag it).
  if (collapsed) {
    return (
      <button
        type="button"
        className={`ssw-bubble${waiting ? " waiting" : ""}${anchor}`}
        style={style}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        aria-label={`${title} — tap to manage`}
      >
        <i className={`fas ${faIcon}`} aria-hidden="true"></i>
        <span className="ssw-bubble-dot" aria-hidden="true" />
      </button>
    );
  }

  // Otherwise draw the full card: a drag handle on top, then the status and the
  // Change-table / Leave buttons.
  return (
    <>
    <div className={`ssw-card${anchor}`} style={style} role="dialog" aria-label="Your table">
      {/* The top bar: grip to drag, and a chevron to collapse back to the bubble. */}
      <div className="ssw-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="ssw-grip" aria-hidden="true"><i className="fas fa-grip-lines"></i></span>
        <button type="button" className="ssw-collapse" aria-label="Hide" onPointerDown={(e) => e.stopPropagation()} onClick={collapse}>
          <i className="fas fa-chevron-up" aria-hidden="true"></i>
        </button>
      </div>
      <div className="ssw-body">
        {/* The status line: an icon, the title (e.g. "Hosting Table 4"), and a subtitle. */}
        <div className="ssw-status">
          <span className="ssw-avatar" aria-hidden="true"><i className={`fas ${faIcon}`}></i></span>
          <div className="ssw-text">
            <div className="ssw-title">{title}<span className={`ssw-live${waiting ? " pending" : ""}`} aria-hidden="true" /></div>
            <div className="ssw-sub">{sub}</div>
          </div>
        </div>
        {/* If you've asked for things (water, napkins…), show them here so you
            know the staff have been told. */}
        {st.calls.length > 0 && (
          <div className="ssw-called">
            <span className="ssw-called-label">You called for</span>
            <span className="ssw-called-list">
              {st.calls.map((c, i) => (
                <span key={i} className="ssw-called-chip">{callIcon(c.note)} {c.note}</span>
              ))}
            </span>
          </div>
        )}
        {/* Actions. Leaving goes through a quick "are you sure?" so you don't drop
            the table by accident — your placed order stays with the table either way. */}
        {confirming ? (
          <>
            <div className="ssw-confirm-q">Leave this table? Your order stays with the table for the bill.</div>
            <div className="ssw-actions">
              <button type="button" className="ssw-btn" disabled={busy} onClick={() => setConfirming(false)}>Stay</button>
              <button type="button" className="ssw-btn danger" disabled={busy} onClick={doLeave}>Yes, leave</button>
            </div>
          </>
        ) : (
          <div className="ssw-actions">
            {/* While an order is in progress, both leaving and switching are blocked —
                they pop the "call a waiter to transfer" dialog instead. */}
            <button type="button" className="ssw-btn" disabled={busy} onClick={() => (orderActive ? setBlocked(true) : doChange())}>Change table</button>
            <button type="button" className="ssw-btn danger" disabled={busy} onClick={() => (orderActive ? setBlocked(true) : setConfirming(true))}>{isHost ? "Leave" : "Leave / own cart"}</button>
          </div>
        )}
      </div>
    </div>

    {/* "Order in progress — can't leave" popup. Reuses the app's standard
        overlay+popup styling (themed) so it matches the waiter-call dialog. The
        Call-a-waiter button fires the same event that opens the service popup,
        where staff can be asked to transfer the table. */}
    {blocked && (
      <>
        <div className="overlay active" onClick={() => setBlocked(false)} />
        <div className="popup active" role="dialog" aria-modal="true" aria-label="Order in progress">
          <i className="fas fa-utensils" style={{ fontSize: 44, color: "var(--accent)" }} aria-hidden="true"></i>
          <h2 style={{ fontFamily: "Playfair Display", color: "var(--text)", margin: "16px 0 8px", fontSize: 22, fontWeight: 700 }}>
            Your order&apos;s on its way
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>
            You can&apos;t leave this table while an order is in progress. To move to another table, ask a waiter to transfer you.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className="btn btn-gold" onClick={() => { setBlocked(false); window.dispatchEvent(new CustomEvent("lfh:chef-call")); }}>
              <i className="fas fa-bell" aria-hidden="true"></i> Call a waiter
            </button>
            <button type="button" className="ssw-btn" onClick={() => setBlocked(false)}>Stay at table</button>
          </div>
        </div>
      </>
    )}
    </>
  );
}
