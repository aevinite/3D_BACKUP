"use client";

import { useEffect, useState } from "react";
import { callWaiter, getSettings } from "@/lib/menu";
import { validateTable, flagTableInput, getScannedTable } from "@/lib/table";
import { getStoredSession } from "@/lib/session";

export default function ChefPopup() {
  const [open, setOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [scannedTable, setScannedTableState] = useState(""); // table from a QR deep-link, if any
  const [lockedTable, setLockedTable] = useState<string | null>(null); // when in a session, locked to that table
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sessionsEnabled, setSessionsEnabled] = useState(false); // v2 dining-session system
  const [sending, setSending] = useState(false);

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
    prefillScanned();
    syncSession();
    const handleOpen = () => {
      setOpen(true); prefillScanned(); syncSession();
      // re-read settings on open so a freshly-toggled sessions mode is always respected
      getSettings().then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); }).catch(() => {});
    };
    const handleClose = () => setOpen(false);

    // How many tables exist, so we can reject an out-of-range table number.
    getSettings()
      .then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); })
      .catch(() => {});

    window.addEventListener("lfh:chef-call", handleOpen);
    window.addEventListener("lfh:close-all", handleClose);
    window.addEventListener("lfh:table-scanned", prefillScanned);
    window.addEventListener("lfh:session-changed", syncSession);

    return () => {
      window.removeEventListener("lfh:chef-call", handleOpen);
      window.removeEventListener("lfh:close-all", handleClose);
      window.removeEventListener("lfh:table-scanned", prefillScanned);
      window.removeEventListener("lfh:session-changed", syncSession);
    };
  }, []);

  const REASONS = [
    { icon: "🙋", label: "Call waiter" },
    { icon: "💧", label: "Water" },
    { icon: "🍴", label: "Cutlery" },
    { icon: "🧻", label: "Napkins" },
    { icon: "🧹", label: "Clean table" },
    { icon: "🧾", label: "Bring the bill" },
  ];

  const handleSend = async (reason: string) => {
    if (sending) return;
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
    setSending(true);
    try {
      await callWaiter(check.value, reason);
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: "On our way!",
        subtitle: `${reason} · staff notified`,
        kicker: "service",
        variant: "success",
        icon: "🛎",
      } }));
      window.dispatchEvent(new Event("lfh:close-all"));
      setTableNumber("");
    } catch {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't reach staff", subtitle: "please try again", kicker: "service", variant: "error" } }));
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="overlay active" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}></div>
      <div id="chef-popup" className="popup active">
        <i className="fas fa-bell-concierge" style={{ fontSize: "48px", color: "var(--accent)" }}></i>
        <h2 style={{ fontFamily: "Playfair Display", color: "var(--text)", margin: "18px 0 8px", fontSize: "24px", fontWeight: 700 }}>
          Need something?
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "14px", margin: "0 0 16px" }}>
          Enter your table number, then tap what you need
        </p>
        {lockedTable ? (
          <div className="table-scanned-note">🔒 You&apos;re at table {lockedTable} — leave the table to use another</div>
        ) : (scannedTable && tableNumber === scannedTable && (
          <div className="table-scanned-note">📍 Table {scannedTable} — from your table&apos;s QR</div>
        ))}
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
