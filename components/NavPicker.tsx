"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Option {
  key: string;
  label: ReactNode;
  active: boolean;
  onSelect: () => void;
}

export default function NavPicker({
  buttonLabel,
  buttonContent,
  options,
}: {
  buttonLabel: string;
  buttonContent: ReactNode;
  options: Option[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="nav-btn"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}
      >
        {buttonContent}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={buttonLabel}
          className="nav-picker-list"
        >
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="option"
                aria-selected={opt.active}
                className={`nav-picker-item ${opt.active ? "active" : ""}`}
                onClick={() => {
                  opt.onSelect();
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
