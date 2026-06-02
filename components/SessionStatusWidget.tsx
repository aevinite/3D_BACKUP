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

import { useEffect, useRef, useState, type PointerEvent as RPE, type CSSProperties } from "react";
import { getSettings } from "@/lib/menu";
import { setScannedTable } from "@/lib/table";
import { getStoredSession, clearStoredSession, getSessionState, leaveSession } from "@/lib/session";

const POS_KEY = "lfh_sess_widget_pos";
const COLLAPSED_KEY = "lfh_sess_widget_collapsed";
// Default resting spot: right edge, a little below the header controls so it never
// covers the $/EN/theme/cart buttons.
const DEFAULT_POS = { right: 16, top: 140 };

interface SState { table: string; role: "owner" | "guest"; approved: boolean; count: number; }
const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

export default function SessionStatusWidget() {
  const [enabled, setEnabled] = useState(false);
  const [st, setSt] = useState<SState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const wasActive = useRef(false);
  const introToken = useRef<string | null>(null); // session we've already played the open-then-shrink intro for
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // load persisted position + collapsed state
  useEffect(() => {
    // Only accept the new {right,top} shape; ignore any stale {x,y} from an older
    // build so it falls back to the clean default instead of landing mid-screen.
    try { const o = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (o && typeof o.right === "number" && typeof o.top === "number") setPos(o); } catch {}
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);

  // settings gate + live poll of the session state
  useEffect(() => {
    let alive = true;
    let iv: ReturnType<typeof setInterval> | null = null;
    (async () => {
      let on = false;
      try { on = (await getSettings()).sessionsEnabled; } catch {}
      if (!alive) return;
      setEnabled(on);
      if (!on) return;
      const poll = async () => {
        const s = getStoredSession();
        if (!s) { tokenRef.current = null; if (alive) setSt(null); return; }
        tokenRef.current = s.token;
        const state = await getSessionState(s.token);
        if (!alive) return;
        // A network blip returns ok:false with a non-"invalid_token" reason — DON'T
        // disconnect on that, just retry next tick. Only a confirmed dead token or a
        // genuinely closed session ends the connection.
        if (!state.ok) {
          if (state.reason === "invalid_token") { clearStoredSession(); tokenRef.current = null; wasActive.current = false; setSt(null); }
          return;
        }
        const sess = state.session as { table_number?: string; status?: string } | undefined;
        if (sess?.status !== "open") {
          if (wasActive.current) { wasActive.current = false; clearLocal(); toast("This table’s session ended", "table"); }
          else { clearStoredSession(); }
          setSt(null);
          return;
        }
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
      poll();
      iv = setInterval(poll, 3000);
    })();
    return () => { alive = false; if (iv) clearInterval(iv); if (introTimer.current) clearTimeout(introTimer.current); };
  }, []);

  // ── actions ────────────────────────────────────────────────────────────────
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
  const doChange = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await leaveSession(token);
    clearLocal();
    window.location.href = "/menu"; // go pick / scan another table
  };

  // ── drag (grip on the card, or the whole collapsed bubble) ──────────────────
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const onDown = (e: RPE<HTMLElement>) => {
    const cur = pos || DEFAULT_POS;
    dragRef.current = { sx: e.clientX, sy: e.clientY, or: cur.right, ot: cur.top, pid: e.pointerId, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onMove = (e: RPE<HTMLElement>) => {
    const d = dragRef.current; if (!d) return;
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
  const onUp = (e: RPE<HTMLElement>) => {
    const d = dragRef.current; dragRef.current = null; if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (d.moved) {
      setPos((p) => { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {} return p; });
    } else if (collapsed) {
      setCollapsed(false); try { localStorage.setItem(COLLAPSED_KEY, "0"); } catch {}
    }
  };
  const collapse = () => { setCollapsed(true); try { localStorage.setItem(COLLAPSED_KEY, "1"); } catch {} };

  if (!enabled || !st) return null;

  const isHost = st.role === "owner";
  const waiting = !isHost && !st.approved;
  const faIcon = isHost ? "fa-crown" : st.approved ? "fa-user-check" : "fa-hourglass-half";
  const title = isHost ? `Hosting Table ${st.table}` : `Table ${st.table}`;
  const sub = isHost
    ? (st.count > 1 ? `${st.count} at this table` : "You opened this table")
    : st.approved ? "You’re in — let in by the host" : "Waiting for the host to let you in…";

  // Default to the top-right, tucked under the header controls; once dragged, the
  // saved x/y wins. Right-anchored so it never collides with the centred hero.
  const style: CSSProperties = pos ? { right: pos.right, top: pos.top } : DEFAULT_POS;

  if (collapsed) {
    return (
      <button
        type="button"
        className={`ssw-bubble${waiting ? " waiting" : ""}`}
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

  return (
    <div className="ssw-card" style={style} role="dialog" aria-label="Your table">
      <div className="ssw-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="ssw-grip" aria-hidden="true"><i className="fas fa-grip-lines"></i></span>
        <button type="button" className="ssw-collapse" aria-label="Hide" onPointerDown={(e) => e.stopPropagation()} onClick={collapse}>
          <i className="fas fa-chevron-up" aria-hidden="true"></i>
        </button>
      </div>
      <div className="ssw-body">
        <div className="ssw-status">
          <span className="ssw-avatar" aria-hidden="true"><i className={`fas ${faIcon}`}></i></span>
          <div className="ssw-text">
            <div className="ssw-title">{title}<span className={`ssw-live${waiting ? " pending" : ""}`} aria-hidden="true" /></div>
            <div className="ssw-sub">{sub}</div>
          </div>
        </div>
        <div className="ssw-actions">
          <button type="button" className="ssw-btn" disabled={busy} onClick={doChange}>Change table</button>
          <button type="button" className="ssw-btn danger" disabled={busy} onClick={doLeave}>{isHost ? "Leave" : "Leave / own cart"}</button>
        </div>
      </div>
    </div>
  );
}
