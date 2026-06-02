"use client";

// SessionTableBill — the guest's live view of their SHARED table bill when the
// v2 dining-session system is ON. It mirrors what the editor's session panel
// drives: every dish the table has ordered, each with its kitchen status
// (received -> preparing -> served), plus the merged subtotal/tax/total.
//
// It renders nothing unless sessions are on AND this device is in a session, so
// in normal (sessions-off) mode it's invisible. It's mounted inside the cart's
// "Previous orders" tab, so it only polls while the guest is looking at it.

// React building blocks: useState remembers values, useEffect runs setup code,
// useRef keeps a value that survives re-draws without causing a re-draw.
import { useEffect, useRef, useState } from "react";
// Helpers that talk to the server about the table's dining session.
import { getStoredSession, getSessionState } from "@/lib/session";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Money-formatting helpers so prices show in the right currency.
import { formatMoney, getCurrency, type CurrencyMeta } from "@/lib/format";

// The shape of one dish on the bill: an id, its name, how many, and where it is
// in the kitchen (just received, being prepared, or already served).
interface SItem { id: string; title: string; qty: number; status: "received" | "preparing" | "served"; }
// The money totals for the whole table.
interface SBill { subtotal: number; tax: number; total: number; }

// Turns the short status codes into friendly words shown on the little pills.
const STATUS_LABEL: Record<string, string> = { received: "Received", preparing: "Preparing", served: "Served" };

// This component shows the guest a live, read-only summary of everything their
// table has ordered, plus the running total — and updates it every couple seconds.
export default function SessionTableBill() {
  // Tracks each piece of what we show on screen:
  const [active, setActive] = useState(false); // sessions on + we hold a valid session token
  const [table, setTable] = useState(""); // which table number we're showing
  const [items, setItems] = useState<SItem[]>([]); // the list of dishes ordered
  const [bill, setBill] = useState<SBill | null>(null); // the running money totals
  const [members, setMembers] = useState(0); // how many people are sharing this table
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // which currency to display
  // Holds the session token. A ref (not state) because changing it shouldn't redraw.
  const tokenRef = useRef<string | null>(null);

  // This runs once when the component first appears. It checks whether we should
  // show anything at all, then starts polling the server for live updates.
  useEffect(() => {
    // "alive" guards against updating state after the component has gone away.
    let alive = true;
    // "iv" will hold the repeating timer so we can stop it later.
    let iv: ReturnType<typeof setInterval> | null = null;
    // Figure out which currency to display prices in.
    setCurrency(getCurrency());
    (async () => {
      // Ask the server: is the dining-session system even turned on?
      let enabled = false;
      try { enabled = (await getSettings()).sessionsEnabled; } catch {}
      // Do we have a saved session on this device?
      const s = getStoredSession();
      if (!alive || !enabled || !s) return; // not in session mode → stay hidden
      // Remember our token and reveal the widget.
      tokenRef.current = s.token;
      setActive(true);
      // Asks the server for the latest table state and copies it into our screen values.
      const poll = async () => {
        const token = tokenRef.current; if (!token) return;
        const st = await getSessionState(token);
        if (!alive) return;
        if (!st.ok) { setActive(false); return; } // token gone / session ended
        const sess = st.session as { table_number?: string; status?: string } | undefined;
        if (sess?.status !== "open") { setActive(false); return; }
        // Refresh everything we display from the server's answer.
        setTable(sess?.table_number || "");
        setItems((st.items as SItem[]) || []);
        setBill((st.bill as SBill) || null);
        setMembers(Array.isArray(st.members) ? (st.members as unknown[]).length : 0);
      };
      // Check right away, then keep checking every 2 seconds for live updates.
      poll();
      iv = setInterval(poll, 2000);
    })();
    // Cleanup when the component disappears: stop the timer and ignore late replies.
    return () => { alive = false; if (iv) clearInterval(iv); };
  }, []);

  // If we're not in a live session, show nothing at all.
  if (!active) return null;
  // Formats a number as money (falls back to a simple dollar amount if needed).
  const show = (n: number) => (currency ? formatMoney(n, currency) : `$${n.toFixed(2)}`);
  // Counts how many dishes have already been served (for the "X of Y served" line).
  const served = items.filter((i) => i.status === "served").length;

  // What the guest actually sees on screen:
  return (
    <div className="stb">
      {/* The header: a little live dot, the table number, and a guest count. */}
      <div className="stb-head">
        <span className="stb-dot" aria-hidden="true" />
        Your table{table ? ` · Table ${table}` : ""}
        {/* Only show the guest count when more than one person shares the table. */}
        {members > 1 && <span className="stb-members">{members} guests</span>}
      </div>
      {/* If nothing's been ordered yet, show a friendly empty message... */}
      {items.length === 0 ? (
        <div className="stb-empty">No dishes sent to the kitchen yet. When anyone at your table orders, it shows up here with its live status.</div>
      ) : (
        // ...otherwise show the progress line, the dish list, and the totals.
        <>
          {/* How many dishes are served out of the total. */}
          <div className="stb-progress">{served} of {items.length} served</div>
          {/* The list of ordered dishes, each with its name, quantity and status. */}
          <div className="stb-items">
            {items.map((it) => (
              <div key={it.id} className="stb-item">
                <span className="stb-item-name">{it.title} <span className="stb-qty">×{it.qty}</span></span>
                <span className={`stb-pill ${it.status}`}>{STATUS_LABEL[it.status] || it.status}</span>
              </div>
            ))}
          </div>
          {/* The money breakdown, only shown once the server sends totals. */}
          {bill && (
            <div className="bill-rows stb-bill">
              <div className="bill-line"><span>Subtotal</span><span>{show(Number(bill.subtotal) || 0)}</span></div>
              <div className="bill-line"><span>Tax</span><span>{show(Number(bill.tax) || 0)}</span></div>
              <div className="bill-line grand"><span>Table total</span><span>{show(Number(bill.total) || 0)}</span></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
