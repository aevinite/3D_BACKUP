"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
// Phone back button: while this dropdown is open, back closes it (not the site).
import { useBackClose } from "@/lib/backStack";

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

  // Phone back button closes the dropdown instead of leaving the site. The id is
  // keyed off buttonLabel so the language and currency pickers register separately.
  useBackClose(`nav-${buttonLabel}`, open, () => setOpen(false));

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
      {/* Only show the list when `open` is true.

          THE OPTIONS ARE THE LIST'S OWN CHILDREN (guest sweep T1, sweep #7, 2026-08-22).
          Each button carrying `role="option"` used to sit inside an <li>, and a `listbox` must OWN
          its options directly — an element in between breaks that. Read out of Chrome's own
          accessibility tree, this dropdown was `listbox "Language"` containing plain `button`s and
          ZERO options: a screen reader announced a list box and then found nothing selectable in
          it, no "3 of 6" position, and `aria-selected` — the only thing marking which language is
          currently on — was never conveyed. Exactly the shape that was corrected in the search
          suggestions, never looked for here.

          Dropping the <li> is the whole change. `.nav-picker-list` is already `list-style: none`
          and `.nav-picker-item` is already `width: 100%`, so the buttons render identically as
          direct children — no CSS touched, nothing moves on screen. */}
      {open && (
        <ul
          role="listbox"
          aria-label={buttonLabel}
          className="nav-picker-list"
        >
          {/* Draw one row for each option passed in */}
          {options.map((opt) => (
            <button
              key={opt.key}
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
          ))}
        </ul>
      )}
    </div>
  );
}
