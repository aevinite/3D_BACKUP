"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The shape of one choice in the dropdown. For each option we know:
// a unique `key`, what to show (`label`), whether it's currently picked
// (`active`), and what to do when it's chosen (`onSelect`).
interface Option {
  key: string;
  label: ReactNode;
  active: boolean;
  onSelect: () => void;
}

// A reusable little dropdown menu used in the top nav (e.g. language or
// currency pickers). You give it a button to show and a list of options;
// clicking the button reveals the list, and picking an option runs its action.
export default function NavPicker({
  buttonLabel,
  buttonContent,
  options,
}: {
  buttonLabel: string;
  buttonContent: ReactNode;
  options: Option[];
}) {
  // Is the dropdown list currently showing? Starts closed.
  const [open, setOpen] = useState(false);
  // A handle to the wrapping <div> so we can tell if a click landed inside it.
  const ref = useRef<HTMLDivElement>(null);

  // While the dropdown is open, watch for ways to close it: clicking anywhere
  // outside it, or pressing the Escape key. We add these listeners only when
  // open, and tidy them up when it closes (the returned function).
  useEffect(() => {
    if (!open) return;
    // Clicked somewhere on the page? If it wasn't inside our dropdown, close.
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Pressing Escape also closes the dropdown.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    // Cleanup: remove both listeners so they don't pile up.
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* The button you tap to open/close the list. The aria-* attributes
          describe it to screen readers (it's a menu trigger that's open/closed). */}
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
      {/* Only show the list when `open` is true */}
      {open && (
        <ul
          role="listbox"
          aria-label={buttonLabel}
          className="nav-picker-list"
        >
          {/* Draw one row for each option passed in */}
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="option"
                aria-selected={opt.active}
                className={`nav-picker-item ${opt.active ? "active" : ""}`}
                onClick={() => {
                  // Run this option's action, then close the dropdown.
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
