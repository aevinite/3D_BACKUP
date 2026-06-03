"use client";

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
import { getStoredSession, clearStoredSession, getSessionState, leaveSession } from "@/lib/session";

// localStorage keys for remembering where the user dragged the card and whether
// they collapsed it to the small bubble.
const POS_KEY = "lfh_sess_widget_pos_v2"; // v2: dropped older saved spots that sat too low
const COLLAPSED_KEY = "lfh_sess_widget_collapsed";
// Default resting spot: top-right, tucked just under the header controls
// ($/EN/theme/cart) — close to the cart, not drifting toward the middle.
const DEFAULT_POS = { right: 16, top: 88 };

// A snapshot of the table connection we display: table number, your role, whether
// you've been approved, and how many people are at the table.
interface SState { table: string; role: "owner" | "guest"; approved: boolean; count: number; }
// Tiny helper to pop a notification toast.
const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

// SessionStatusWidget — the small floating card (draggable, collapsible) that tells
// a guest they're connected to a table and lets them leave or switch tables.
export default function SessionStatusWidget() {
  // Tracks each piece of what we show and how the card behaves:
  const [enabled, setEnabled] = useState(false); // is the session system turned on?
  const [st, setSt] = useState<SState | null>(null); // the live table info, or null when not connected
  const [collapsed, setCollapsed] = useState(false); // shrunk to the little bubble?
  const [busy, setBusy] = useState(false); // true while a leave/change is in flight
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
  const clearLocal = () => {
    clearStoredSession();
    try { localStorage.removeItem("lfh_cart"); } catch {}
    setScannedTable("");                                    // stop pre-filling the table you just left
    window.dispatchEvent(new Event("lfh:cart-updated"));
    window.dispatchEvent(new Event("lfh:table-scanned"));
    window.dispatchEvent(new Event("lfh:session-changed"));
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
    (async () => {
      // Is the session system even turned on? If not, we'll never show anything.
      let on = false;
      try { on = (await getSettings()).sessionsEnabled; } catch {}
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
        // A network blip returns ok:false with a non-"invalid_token" reason — DON'T
        // disconnect on that, just retry next tick. Only a confirmed dead token or a
        // genuinely closed session ends the connection.
        if (!state.ok) {
          if (state.reason === "invalid_token") { clearStoredSession(); tokenRef.current = null; wasActive.current = false; setSt(null); }
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
        const m = state.member as { role: "owner" | "guest"; approved?: boolean } | undefined;
        setSt({
          table: sess.table_number || s.table,
          role: m?.role || "guest",
          approved: !!m?.approved,
          count: Array.isArray(state.members) ? (state.members as unknown[]).length : 1,
        });
        // First time we see this session (you just got the table): show the full
        // card for 2s, then auto-shrink to the circle.
        if (introToken.current !== s.token) {
          introToken.current = s.token;
          setCollapsed(false);
          if (introTimer.current) clearTimeout(introTimer.current);
          introTimer.current = setTimeout(() => setCollapsed(true), 2000);
        }
      };
      // Check right away, then keep checking every 3 seconds.
      poll();
      iv = setInterval(poll, 3000);
    })();
    // Cleanup when the component disappears: stop the poll and the intro timer.
    return () => { alive = false; if (iv) clearInterval(iv); if (introTimer.current) clearTimeout(introTimer.current); };
  }, []);

  // ── actions ────────────────────────────────────────────────────────────────
  // This runs when the guest taps "Leave": tell the server, clean up locally,
  // and show a confirmation. Their cart goes back to private + empty.
  const doLeave = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await leaveSession(token);
    clearLocal();
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
    clearLocal();
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
        {/* The two action buttons. */}
        <div className="ssw-actions">
          <button type="button" className="ssw-btn" disabled={busy} onClick={doChange}>Change table</button>
          <button type="button" className="ssw-btn danger" disabled={busy} onClick={doLeave}>{isHost ? "Leave" : "Leave / own cart"}</button>
        </div>
      </div>
    </div>
  );
}
