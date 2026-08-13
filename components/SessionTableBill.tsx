"use client";
import { useRestaurantId } from "@/lib/restaurant-context";

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
// The ONE place a discount percentage is worded, shared with the printer (public/panels/billdoc.js).
// Imported the same way lib/billPreview.ts does it — the whole API object, not a named export:
// the file is a plain CommonJS IIFE, so its exports are only visible at runtime.
import BILLDOC from "@/public/panels/billdoc.js";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Money-formatting helpers so prices show in the right currency.
import { toMinor, formatAmount, getCurrency, type CurrencyMeta } from "@/lib/format";
import { RT_BACKUP_MS } from "@/lib/orderStatus"; // realtime backup-poll interval (60s)
import { allergenLabel } from "@/lib/allergens"; // turns "milk" → "Milk" for the "no …" lines

// The shape of one dish on the bill: id, name, qty, kitchen status — plus the
// customizations the guest chose when ordering (options like "Large", allergens
// they removed like "milk", and a free-text note), so the live view can show the
// SAME detail the Current-bill tab does.
interface SItem {
  id: string; title: string; qty: number; status: "received" | "preparing" | "served";
  options?: { label?: string }[] | null;
  removed?: string[] | null;
  note?: string | null;
  // Presentational only (mig 270): this dish was sold at a FINAL, locked price (an MRP
  // bottle) so no GST is added to it. It is read off the server's own frozen ticket lines
  // (orders[].items[].is_mrp), never decided here — see mrpTitles() below.
  isMrp?: boolean;
}
// One frozen line of a placed order's ticket (orders.items). lfh_price_order writes the
// resolved tax behaviour onto every line at order time; we only read the MRP stamp.
interface STicketLine { title?: string | null; is_mrp?: boolean | null }
interface SOrder { items?: STicketLine[] | null }
// The money totals for the whole table. `discount` is the whole-bill reduction staff
// applied (0 if none); tax/total are already computed discount-BEFORE-tax by the server
// (lfh_session_state, mig 126) so they equal the printed/paid bill.
//
// EVERY number here is the SERVER's. Nothing on this screen recomputes money — the guest's
// copy of a bill must be the same arithmetic the paper and the payment use, and a client-side
// figure is a second opinion nobody can reconcile. The untaxed (MRP) part of the bill is read
// under BOTH the names the RPC has used for it, and the "MRP items" row simply doesn't appear
// on a server that sends neither: inventing that number here is forbidden outright.
interface SBill { subtotal: number; discount?: number; tax: number; total: number; nontax?: number; nontax_amount?: number }

// Turns the short status codes into friendly words shown on the little pills.
// "received" reads "Awaiting accept" so the guest knows the order is placed but the
// kitchen hasn't accepted it yet — "Received" was confusing (owner, 2026-06-22).
const STATUS_LABEL: Record<string, string> = { received: "Awaiting accept", preparing: "Preparing", served: "Served" };

// This component shows the guest a live, read-only summary of everything their
// table has ordered, plus the running total — and updates it every couple seconds.
export default function SessionTableBill() {
  const restaurantId = useRestaurantId();
  // Tracks each piece of what we show on screen:
  const [active, setActive] = useState(false); // sessions on + we hold a valid session token
  const [loaded, setLoaded] = useState(false); // first server fetch is back — until then show a skeleton, NOT the empty "no dishes" message (that flash was the glitch)
  const [table, setTable] = useState(""); // which table number we're showing
  const [items, setItems] = useState<SItem[]>([]); // the list of dishes ordered
  const [bill, setBill] = useState<SBill | null>(null); // the running money totals
  const [members, setMembers] = useState(0); // how many people are sharing this table
  const [calls, setCalls] = useState<{ note?: string | null }[]>([]); // active (unattended) waiter calls for this table
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // which currency to display
  // Composition scheme (mig 270): this restaurant may not pass GST to the diner at all, so a
  // GST row must not appear on their copy of the bill.
  const [composition, setComposition] = useState(false);
  // Holds the session token. A ref (not state) because changing it shouldn't redraw.
  const tokenRef = useRef<string | null>(null);

  // This runs once when the component first appears. It checks whether we should
  // show anything at all, then starts polling the server for live updates.
  useEffect(() => {
    // "alive" guards against updating state after the component has gone away.
    let alive = true;
    // "iv" will hold the repeating timer so we can stop it later.
    let iv: ReturnType<typeof setInterval> | null = null;
    let onTick: (() => void) | null = null; // realtime nudge → refetch now
    // Figure out which currency to display prices in.
    setCurrency(getCurrency());
    (async () => {
      // Ask the server: is the dining-session system even turned on?
      let enabled = false;
      try {
        const s = await getSettings(restaurantId);
        enabled = s.sessionsEnabled;
        setComposition(s.priceTaxMode === "composition");
      } catch {}
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
        // Only a DEFINITIVE ending hides the bill; a transient network blip keeps it on
        // screen and retries next tick — otherwise the whole live bill vanished for up
        // to 60s on a single failed poll (audit fix 2026-07-08). Mirror SessionStatusWidget.
        if (!st.ok) {
          const reason = (st as { reason?: string }).reason;
          if (reason === "session_closed" || reason === "removed" || reason === "invalid_token") setActive(false);
          return;
        }
        const sess = st.session as { table_number?: string; status?: string } | undefined;
        if (sess?.status !== "open") { setActive(false); return; }
        // PENDING members must NOT see the live table. The server already withholds
        // the dishes/orders/bill from an unapproved member (migration 076), but this
        // widget would still show the "connected" shell (table header, guest count,
        // waiter-call line) to a partner the head NEVER accepted. Hide it entirely
        // until they're approved — matching the guard in OrderTracker. (Fixes the
        // "unaccepted partner looks connected / sees the live table" bug.)
        const mem = st.member as { approved?: boolean } | undefined;
        if (!mem?.approved) { setActive(false); return; }
        // Approved (now or all along): make sure the widget is shown. This MUST be
        // re-asserted on every good poll, not just once on mount — a partner who
        // started PENDING had `active` turned off above, and when the head finally
        // accepts them this is what brings their live table back WITHOUT a reload.
        setActive(true);
        // Refresh everything we display from the server's answer.
        setTable(sess?.table_number || "");
        // The guest never sees "ready" (a staff-only stage) — show a ready dish as
        // "preparing" (still cooking) until it's actually served (owner, 2026-06-14).
        // Which dish titles were sold at a locked MRP price, taken from the server's own
        // frozen ticket lines. Title is the only key the two lists share (order_items has no
        // menu_item_id) — the same match migration 270's own trigger uses, and safe for the
        // same reason: two lines with one title in one order came from one dish.
        const mrpTitles = new Set(
          ((st.orders as SOrder[]) || []).flatMap((o) => (Array.isArray(o?.items) ? o.items : []))
            .filter((ln) => ln && ln.is_mrp === true)
            .map((ln) => String(ln.title || "")),
        );
        setItems(((st.items as SItem[]) || []).map((i) => {
          const row = (i.status as string) === "ready" ? { ...i, status: "preparing" as const } : { ...i };
          row.isMrp = mrpTitles.has(String(row.title || ""));
          return row;
        }));
        setBill((st.bill as SBill) || null);
        setMembers(Array.isArray(st.members) ? (st.members as unknown[]).length : 0);
        // Active waiter calls for the table, so the live status shows "waiter called"
        // (the RPC only returns unresolved calls). (owner, 2026-06-22)
        setCalls(Array.isArray(st.calls) ? (st.calls as { note?: string | null }[]) : []);
        setLoaded(true); // real data is in — safe to show the bill (or a true empty)
      };
      // Check right away; realtime nudges drive instant refetches, with a slow 60s
      // backup poll for when the WebSocket is asleep/dropped.
      poll();
      iv = setInterval(poll, RT_BACKUP_MS);
      onTick = () => poll();
      window.addEventListener("lfh:rt-tick", onTick);
    })();
    // Cleanup when the component disappears: stop the timer, listener; ignore late replies.
    return () => { alive = false; if (iv) clearInterval(iv); if (onTick) window.removeEventListener("lfh:rt-tick", onTick); };
    // Depend on restaurantId: it starts as the #1 default and resolves from the
    // URL a beat later, so an empty dep array froze the wrong tenant's
    // sessionsEnabled (matches the fix already in CartPanel/ChefPopup). (audit)
  }, [restaurantId]);

  // If we're not in a live session, show nothing at all.
  if (!active) return null;
  // Formats a SERVER-computed USD total in the guest's currency. These are the
  // authoritative amounts the kitchen charges, so they only get minor-unit
  // rounding (whole ₹ / cents) — never the ₹10 menu snapping.
  const show = (n: number) => (currency ? formatAmount(toMinor(n * currency.rate, currency), currency) : `$${n.toFixed(2)}`);
  // Counts how many dishes have already been served (for the "X of Y served" line).
  const served = items.filter((i) => i.status === "served").length;
  // Everything the table asked to leave out across all dishes, de-duplicated —
  // shown as one clear summary line at the very bottom of the live view.
  const excluded = [...new Set(items.flatMap((i) => i.removed || []))];

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
      {/* Active waiter call(s): reassure the table that staff have been notified and
          are on the way. Shows what was asked for if a note was given. (owner, 2026-06-22) */}
      {calls.length > 0 && (
        <div className="stb-called">
          <i className="fas fa-bell" aria-hidden="true" /> Waiter called — on the way
          {(() => {
            const notes = calls.map((c) => (c.note || "").trim()).filter(Boolean);
            return notes.length ? <span className="stb-called-note"> · {notes.join(", ")}</span> : null;
          })()}
        </div>
      )}
      {/* Until the FIRST server fetch is back, show a shimmer skeleton — never the
          "no dishes" empty message (that split-second flash before data loaded was
          the glitch). (owner, 2026-06-19) */}
      {!loaded ? (
        <div className="stb-loading" aria-live="polite" aria-label="Loading your table…">
          <span className="stb-skel" /><span className="stb-skel" /><span className="stb-skel short" />
        </div>
      ) : items.length === 0 ? (
        <div className="stb-empty">No dishes sent to the kitchen yet. When anyone at your table orders, it shows up here with its live status.</div>
      ) : (
        // ...otherwise show the progress line, the dish list, and the totals.
        <>
          {/* How many dishes are served out of the total. */}
          <div className="stb-progress">{served} of {items.length} served</div>
          {/* A segmented progress bar: one segment per dish, so it scales to any
              number of orders (1 dish = one wide bar, 20 = 20 thin ticks). Each
              segment turns amber while preparing and green once served, so the
              table can see its progress fill up at a glance. */}
          <div
            className="stb-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={served}
            aria-label={`${served} of ${items.length} dishes served`}
          >
            {items.map((it) => (
              <span key={it.id} className={`stb-seg ${it.status}`} />
            ))}
          </div>
          {/* The list of ordered dishes, each with its name, quantity, status, and
              the same customizations the Current-bill tab shows: chosen options,
              the allergens left out (in red), and any note. */}
          <div className="stb-items">
            {items.map((it) => (
              <div key={it.id} className="stb-item">
                <span className="stb-item-name">
                  {it.title} <span className="stb-qty">×{it.qty}</span>
                  {/* A locked, final price — nothing is added to it, nothing comes off it.
                      Saying so is what makes this dish carrying no GST read as correct. */}
                  {it.isMrp && (
                    <span className="stb-item-detail" title="Maximum Retail Price — this price is final, no tax is added">MRP</span>
                  )}
                  {it.options && it.options.length > 0 && (
                    <span className="stb-item-detail">{it.options.map((o) => o.label).filter(Boolean).join(", ")}</span>
                  )}
                  {it.removed && it.removed.length > 0 && (
                    <span className="stb-item-detail stb-item-removed">No {it.removed.map((r) => allergenLabel(r).toLowerCase()).join(", ")}</span>
                  )}
                  {it.note && <span className="stb-item-detail">“{it.note}”</span>}
                </span>
                <span className={`stb-pill ${it.status}`}>{STATUS_LABEL[it.status] || it.status}</span>
              </div>
            ))}
          </div>
          {/* The money breakdown, only shown once the server sends totals. */}
          {bill && (() => {
          // The untaxed (MRP) part of this table's bill, exactly as the server sent it —
          // under either name the RPC has used. Absent ⇒ 0 ⇒ the row is simply not drawn.
          // Under the composition scheme EVERY line is untaxed, so the server's "untaxed" figure
          // is simply the whole bill — calling that "MRP items" would be a plain lie about why
          // there is no GST. The row belongs to a MIXED bill only.
          const nontax = composition ? 0 : Number(bill.nontax ?? bill.nontax_amount) || 0;
          return (
            <div className="bill-rows stb-bill">
              <div className="bill-line"><span>Subtotal</span><span>{show(Number(bill.subtotal) || 0)}</span></div>
              {Number(bill.discount) > 0 && (
                // The PERCENTAGE goes next to the amount (owner, 2026-08-03: "make sure in the
                // bill also the discount percentage is being shown"). The guest's own copy of the
                // bill has to say the same thing the printed one does, and it is the same
                // sentence-maker — billdoc.js — that writes it on the paper.
                <div className="bill-line">
                  <span>Discount{BILLDOC.discPct(Number(bill.subtotal) || 0, Number(bill.discount) || 0) ? ` (${BILLDOC.discPct(Number(bill.subtotal) || 0, Number(bill.discount) || 0)})` : ""}</span>
                  <span>− {show(Number(bill.discount) || 0)}</span>
                </div>
              )}
              {/* MRP / exempt money on this bill — shown ONLY when the SERVER sends the split
                  (lfh_session_state, mig 271). No split in the payload → no row; the
                  alternative (adding it up here) would be inventing a bill line. */}
              {nontax > 0 && (
                <div className="bill-line"><span>MRP items (no GST)</span><span>{show(nontax)}</span></div>
              )}
              {/* A composition-scheme restaurant may not pass GST to the diner, so no GST row is
                  printed on their copy. It is hidden only when the server AGREES (tax is 0) — if
                  the server still charged tax, hiding the row would hide a real charge that is
                  inside the total below, and that is worse than an unexpected line. */}
              {!(composition && !(Number(bill.tax) > 0)) && (
                <div className="bill-line"><span>GST</span><span>{show(Number(bill.tax) || 0)}</span></div>
              )}
              <div className="bill-line grand"><span>Table total</span><span>{show(Number(bill.total) || 0)}</span></div>
            </div>
          );
          })()}
          {/* Bottom summary: a single clear line of what the table left out, so the
              kitchen's exclusions are confirmed at a glance for this order. */}
          {excluded.length > 0 && (
            <div className="stb-exclusions">
              <i className="fas fa-circle-info" aria-hidden="true" /> Left out for your table: no {excluded.map((r) => allergenLabel(r).toLowerCase()).join(", ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
