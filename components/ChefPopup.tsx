"use client";

import { useEffect, useState } from "react";
import { callWaiter, getSettings } from "@/lib/menu";
import { validateTable, flagTableInput } from "@/lib/table";

export default function ChefPopup() {
  const [open, setOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    // How many tables exist, so we can reject an out-of-range table number.
    getSettings()
      .then((s) => setTableCount(s.tableCount))
      .catch(() => {});

    window.addEventListener("lfh:chef-call", handleOpen);
    window.addEventListener("lfh:close-all", handleClose);

    return () => {
      window.removeEventListener("lfh:chef-call", handleOpen);
      window.removeEventListener("lfh:close-all", handleClose);
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
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          id="chef-table"
          className="table-input"
          placeholder="Table No."
          value={tableNumber}
          maxLength={4}
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
