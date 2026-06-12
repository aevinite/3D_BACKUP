"use client";

// React building blocks: useState remembers values, useEffect runs setup code.
import { useEffect, useState } from "react";
// callWaiter sends a service request; getSettings reads restaurant on/off options.
import { callWaiter, getSettings } from "@/lib/menu";
// Helpers for checking/cleaning the table number and reading a scanned-QR table.
import { validateTable, flagTableInput, getScannedTable, setScannedTable } from "@/lib/table";
// Reads the saved dining session (if the guest is seated at a table).
import { getStoredSession } from "@/lib/session";

// ChefPopup — the little "Need something?" pop-up where a guest picks a request
// (water, cutlery, the bill, etc.) and it gets sent to the staff for their table.
export default function ChefPopup() {
  // Tracks each piece of what the pop-up needs to remember:
  const [open, setOpen] = useState(false); // is the pop-up showing right now?
  const [tableNumber, setTableNumber] = useState(""); // the table number typed/filled in
  const [scannedTable, setScannedTableState] = useState(""); // table from a QR deep-link, if any
  const [lockedTable, setLockedTable] = useState<string | null>(null); // when in a session, locked to that table
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sessionsEnabled, setSessionsEnabled] = useState(false); // v2 dining-session system
  const [sending, setSending] = useState(false); // true while a request is being sent

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
      getSettings().then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); }).catch(() => {});
    };
    // Runs when something asks the pop-up to close: just hide it.
    const handleClose = () => setOpen(false);

    // How many tables exist, so we can reject an out-of-range table number.
    getSettings()
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
  }, []);

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
    if (sending) return; // already sending one — ignore double taps
    // Table number is required AND must be a real table (see lib/table.ts).
    const check = validateTable(tableNumber, tableCount);
    if (!check.ok) {
      flagTableInput("chef-table", check.message!);
      return;
    }
    // v2: when sessions are ON, route the waiter call through the SessionGate
    // (location + session membership) instead of the open call.
    if (sessionsEnabled) {
      window.dispatchEvent(new Event("lfh:close-all"));
      window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "call", table: check.value, payload: { reason } } }));
      setTableNumber("");
      return;
    }
    // Otherwise (sessions off): send the call directly the old, simple way.
    setSending(true);
    try {
      // Tell the server staff are needed at this table for this reason.
      await callWaiter(check.value, reason);
      // Show a friendly "On our way!" confirmation toast.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: "On our way!",
        subtitle: `${reason} · staff notified`,
        kicker: "service",
        variant: "success",
        icon: "🛎",
      } }));
      // Close the pop-up and clear the field now that the request went through.
      window.dispatchEvent(new Event("lfh:close-all"));
      setTableNumber("");
    } catch {
      // If the request failed, show an error toast asking them to try again.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't reach staff", subtitle: "please try again", kicker: "service", variant: "error" } }));
    } finally {
      // Either way, we're no longer sending — re-enable the buttons.
      setSending(false);
    }
  };

  // If the pop-up isn't open, draw nothing.
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
          <div className="table-scanned-note">📍 Table {scannedTable} — from your table&apos;s QR</div>
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
            // Keep only digits so letters/symbols can never reach the field.
            onChange={(e) => setTableNumber(e.target.value.replace(/\D/g, ""))}
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
