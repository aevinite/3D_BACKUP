"use client";

// React building blocks: useState remembers values, useEffect runs setup code,
// useRef holds a value that survives re-draws without causing one.
import { useEffect, useRef, useState } from "react";
// callWaiter sends a service request; getSettings reads restaurant on/off options.
import { enqueueGuestCall } from "@/lib/guestOutbox";
import { callWaiter, getSettings } from "@/lib/menu";
import { useRestaurantId } from "@/lib/restaurant-context";
// Helpers for checking/cleaning the table number and reading a scanned-QR table.
import { validateTable, flagTableInput, getScannedTable, setScannedTable } from "@/lib/table";
// Reads the saved dining session (if the guest is seated at a table).
import { getStoredSession } from "@/lib/session";
// Per-restaurant feature switches: waiter calls can be turned off entirely.
import { useFeatures } from "@/lib/features";
// Phone back button: while this popup is open, back closes it (not the site).
import { useBackClose } from "@/lib/backStack";

// ChefPopup — the little "Need something?" pop-up where a guest picks a request
// (water, cutlery, the bill, etc.) and it gets sent to the staff for their table.
export default function ChefPopup() {
  const restaurantId = useRestaurantId();
  const features = useFeatures(restaurantId); // which restaurant features are switched on
  // Tracks each piece of what the pop-up needs to remember:
  const [open, setOpen] = useState(false); // is the pop-up showing right now?
  const [tableNumber, setTableNumber] = useState(""); // the table number typed/filled in
  const [scannedTable, setScannedTableState] = useState(""); // table from a QR deep-link, if any
  const [lockedTable, setLockedTable] = useState<string | null>(null); // when in a session, locked to that table
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sessionsEnabled, setSessionsEnabled] = useState(false); // v2 dining-session system
  const [sending, setSending] = useState(false); // true while a request is being sent
  // Synchronous re-entrancy lock: `sending` (state) only blocks AFTER a re-render,
  // so a fast double-tap could fire two requests before the button disables. This
  // ref flips instantly, so the second tap is dropped in the same tick.
  const sendingRef = useRef(false);

  // Phone back button closes the popup instead of leaving the site.
  useBackClose("chef-popup", open, () => setOpen(false));

  // This runs once when the pop-up component first appears. It wires up the
  // pre-filling of the table number and listens for events that open/close it.
  useEffect(() => {
    // Pre-fill the table from a scanned QR (?table=N). Only fills an empty field.
    const prefillScanned = () => {
      const scanned = getScannedTable();
      setScannedTableState(scanned);
      if (scanned) setTableNumber((cur) => cur || scanned);
    };
    // Locked to your session's table while you're seated.
    const syncSession = () => {
      const ss = getStoredSession();
      setLockedTable(ss?.table || null);
      if (ss?.table) setTableNumber(ss.table);
    };
    // Run both pre-fill helpers once when we first load.
    prefillScanned();
    syncSession();
    // Runs when something asks the pop-up to open: show it and refresh the fields.
    const handleOpen = () => {
      setOpen(true); prefillScanned(); syncSession();
      // re-read settings on open so a freshly-toggled sessions mode is always respected
      getSettings(restaurantId).then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); }).catch(() => {});
    };
    // Runs when something asks the pop-up to close: just hide it.
    const handleClose = () => setOpen(false);

    // How many tables exist, so we can reject an out-of-range table number.
    getSettings(restaurantId)
      .then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); })
      .catch(() => {});

    // Listen for app-wide events: open the pop-up, close everything, a QR table
    // was scanned, or the session changed — and react to each.
    window.addEventListener("lfh:chef-call", handleOpen);
    window.addEventListener("lfh:close-all", handleClose);
    window.addEventListener("lfh:table-scanned", prefillScanned);
    window.addEventListener("lfh:session-changed", syncSession);

    // Cleanup when the component disappears: stop listening so nothing leaks.
    return () => {
      window.removeEventListener("lfh:chef-call", handleOpen);
      window.removeEventListener("lfh:close-all", handleClose);
      window.removeEventListener("lfh:table-scanned", prefillScanned);
      window.removeEventListener("lfh:session-changed", syncSession);
    };
    // restaurantId in deps: the global widgets resolve their restaurant async (starts at
    // #1, then fixes itself). Re-run so tableCount reflects the REAL restaurant once its
    // id lands — else the "call a waiter" popup validated table numbers against #1's count.
  }, [restaurantId]);

  // The list of things a guest can ask for — each is an icon plus a label.
  const REASONS = [
    { icon: "🙋", label: "Call waiter" },
    { icon: "💧", label: "Water" },
    { icon: "🍴", label: "Cutlery" },
    { icon: "🧻", label: "Napkins" },
    { icon: "🧹", label: "Clean table" },
    { icon: "🧾", label: "Bring the bill" },
  ];

  // This runs when the guest taps one of the request buttons (Water, Bill, etc.).
  const handleSend = async (reason: string) => {
    if (sendingRef.current || sending) return; // already sending one — ignore double taps (sync + state)
    // Table number is required AND must be a real table (see lib/table.ts).
    const check = validateTable(tableNumber, tableCount);
    if (!check.ok) {
      flagTableInput("chef-table", check.message!);
      return;
    }
    // v2: when sessions are ON, route the waiter call through the SessionGate
    // (location + session membership) instead of the open call. Lock synchronously
    // so a fast double-tap can't fire the gate flow twice.
    if (sessionsEnabled) {
      sendingRef.current = true;
      window.dispatchEvent(new Event("lfh:close-all"));
      window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "call", table: check.value, payload: { reason } } }));
      setTableNumber("");
      // The gate owns the rest; release the lock shortly so the popup can be reused.
      setTimeout(() => { sendingRef.current = false; }, 800);
      return;
    }
    // Otherwise (sessions off): send the call directly the old, simple way.
    sendingRef.current = true;
    setSending(true);
    // NO SIGNAL? SAVE IT AND SEND IT (improvement #4, 2026-08-06). Placing an order has survived
    // losing signal since the offline queue was written; calling a waiter — the thing a diner does
    // when something is WRONG, and the request most likely to come from the corner of the room
    // with thick walls — simply failed with "please try again", which is advice they cannot act on.
    // Same queue, same at-most-once id, so a reconnect rings the floor exactly once.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        const q = await enqueueGuestCall({ mode: "public", table: check.value, restaurantId, reason });
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
          message: "Saved — we'll call them the moment you're back online",
          // Only promise the automatic part when it really reached this phone's storage; if it
          // didn't, closing the page loses it, and saying so is the whole point of `persisted`.
          subtitle: q.persisted ? `${reason} · staff are told as soon as there's signal` : `${reason} · keep this page open`,
          kicker: "service", icon: "🛎",
        } }));
        window.dispatchEvent(new Event("lfh:close-all"));
        setTableNumber("");
      } catch {
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't save your call", subtitle: "please ask a member of staff", kicker: "service", variant: "error" } }));
      } finally {
        setSending(false);
        setTimeout(() => { sendingRef.current = false; }, 800);
      }
      return;
    }
    try {
      // Tell the server staff are needed at this table for this reason, and read
      // its ACTUAL answer — a blocked table or a dropped duplicate is NOT success.
      const res = await callWaiter(check.value, reason, restaurantId);
      if (res.ok && res.reason !== "already_sent" && res.reason !== "capped") {
        // A brand-new call actually landed.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
          message: "On our way!", subtitle: `${reason} · staff notified`,
          kicker: "service", variant: "success", icon: "🛎",
        } }));
        window.dispatchEvent(new Event("lfh:close-all"));
        setTableNumber("");
      } else if (res.reason === "blocked") {
        // The table is blocked from calling staff — say so, don't fake success.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Can't call staff from this table", subtitle: "please ask a member of staff directly", kicker: "service", variant: "error" } }));
      } else if (res.reason === "capped") {
        // Too many requests already pending for this table.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "You've a few requests pending", subtitle: "staff are on the way", kicker: "service", icon: "🛎" } }));
        window.dispatchEvent(new Event("lfh:close-all"));
      } else {
        // already_sent: a recent identical request — reassure without a new call.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Already sent", subtitle: `${reason} · staff are on the way`, kicker: "service", icon: "🛎" } }));
        window.dispatchEvent(new Event("lfh:close-all"));
      }
    } catch {
      // If the request failed, show an error toast asking them to try again.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't reach staff", subtitle: "please try again", kicker: "service", variant: "error" } }));
    } finally {
      // Either way, we're no longer sending — re-enable the buttons.
      setSending(false);
      sendingRef.current = false;
    }
  };

  // If the pop-up isn't open, draw nothing.
  // Waiter calls switched off for this restaurant -> the popup can never open,
  // even if a stray event asks it to (the bell button is gated separately).
  if (!features.waiter_calls) return null;
  if (!open) return null;

  // What the guest sees when the pop-up is open:
  return (
    <>
      {/* The dimmed background — tapping it closes everything. */}
      <div className="overlay active" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}></div>
      {/* The pop-up card itself. */}
      <div id="chef-popup" className="popup active">
        {/* A concierge bell icon at the top. */}
        <i className="fas fa-bell-concierge" style={{ fontSize: "48px", color: "var(--accent)" }}></i>
        <h2 style={{ fontFamily: "Playfair Display", color: "var(--text)", margin: "18px 0 8px", fontSize: "24px", fontWeight: 700 }}>
          Need something?
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", margin: "0 0 16px" }}>
          Enter your table number, then tap what you need
        </p>
        {/* If you're seated in a session, show the locked-table note; otherwise,
            if the number came from a scanned QR, show the QR note instead. */}
        {lockedTable ? (
          <div className="table-scanned-note">🔒 You&apos;re at table {lockedTable} — leave the table to use another</div>
        ) : (scannedTable && tableNumber === scannedTable && (
          // Shows for a QR-scanned AND a hand-typed number (both are remembered).
          <div className="table-scanned-note">📍 Table {scannedTable} — we&apos;ll remember this is your table</div>
        ))}
        {/* The table-number box. It's locked (read-only) when you're in a session.
            When it's NOT locked, a little ✕ lets the guest wipe an auto-filled
            number completely (box AND the remembered QR table) — so a wrong or
            stale number never gets stuck in here. */}
        <div className="table-input-wrap">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            id="chef-table"
            className="table-input"
            placeholder="Table No."
            value={lockedTable || tableNumber}
            maxLength={4} disabled={!!lockedTable} readOnly={!!lockedTable}
            onChange={(e) => {
              // Keep only digits so letters/symbols can never reach the field.
              const v = e.target.value.replace(/\D/g, "");
              setTableNumber(v);
              // Typing your table number HERE counts as telling the app where you
              // sit (owner, 2026-06-12): remember it device-wide — the same memory
              // a QR scan writes — so Add-to-cart / the join flow never re-ask.
              // The ✕ button wipes this same memory; backspacing to empty does too.
              setScannedTable(v);
              window.dispatchEvent(new Event("lfh:table-scanned"));
            }}
          />
          {!lockedTable && (tableNumber || scannedTable) && (
            <button type="button" className="table-input-clear" aria-label="Clear table number"
              onClick={() => { setTableNumber(""); setScannedTableState(""); setScannedTable(""); }}>✕</button>
          )}
        </div>
        {/* One button per request reason, built from the REASONS list above. */}
        <div className="chef-reasons">
          {REASONS.map((r) => (
            <button
              key={r.label}
              type="button"
              className="chef-reason"
              disabled={sending}
              onClick={() => handleSend(r.label)}
            >
              <span className="chef-reason-icon">{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
