"use client";
// Admin dropdown — a small, theme-aware select ported from the shadcn "Select"
// pattern (trigger button + popover list + a check on the active row), but built
// in plain CSS on the panel's own --adm-* / --accent tokens instead of pulling in
// Radix + Tailwind (this panel has neither — see CLAUDE.md: shadcn CLI bails on
// this Tailwind-4 stack, so we hand-wire to match shadcn's structure/behaviour).
// Closes on outside-click, Escape, or a pick. Keyboard: ↑/↓ move, Enter selects.
import { useEffect, useRef, useState } from "react";

export type Opt = { value: string; label: string };

export default function Dropdown({
  value, onChange, options, ariaLabel, minWidth = 168, align = "right",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  ariaLabel: string;
  minWidth?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // highlighted index for keyboard nav
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Close on click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // When opening, highlight the current value.
  useEffect(() => { if (open) setHi(Math.max(0, options.findIndex((o) => o.value === value))); }, [open, options, value]);

  const pick = (v: string) => { onChange(v); setOpen(false); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); pick(options[hi]?.value ?? value); }
    else if (e.key === " " && !open) { e.preventDefault(); setOpen(true); }
  };

  return (
    <div className="adm-dd" ref={wrapRef}>
      <button type="button" className="adm-dd-trig" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown} style={{ minWidth }}>
        <span className="adm-dd-val">{current?.label ?? "Select"}</span>
        <i className={`fas fa-chevron-down adm-dd-chev${open ? " up" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="adm-dd-pop" role="listbox" style={{ [align]: 0 } as React.CSSProperties}>
          {options.map((o, i) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              className={`adm-dd-opt${o.value === value ? " sel" : ""}${i === hi ? " hi" : ""}`}
              onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}>
              <i className="fas fa-check adm-dd-tick" aria-hidden="true" style={{ opacity: o.value === value ? 1 : 0 }} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
      <style jsx>{`
        .adm-dd { position: relative; display: inline-block; }
        .adm-dd-trig {
          display: inline-flex; align-items: center; gap: 8px; justify-content: space-between;
          background: var(--card); color: var(--text); border: var(--border); border-radius: 10px;
          padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
          transition: border-color .15s, box-shadow .15s, filter .15s; line-height: 1.1;
        }
        .adm-dd-trig:hover { filter: brightness(1.03); }
        .adm-dd-trig:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 26%, transparent); }
        .adm-dd-val { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .adm-dd-chev { font-size: 10px; color: var(--muted); transition: transform .16s; }
        .adm-dd-chev.up { transform: rotate(180deg); }
        .adm-dd-pop {
          position: absolute; top: calc(100% + 6px); z-index: 60; min-width: 100%;
          background: var(--card); border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border-c, rgba(128,128,128,.28)));
          border-radius: 12px; padding: 6px; box-shadow: 0 14px 38px -10px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.12);
          animation: adm-dd-in .12s ease-out;
        }
        @keyframes adm-dd-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .adm-dd-opt {
          display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
          background: transparent; border: 0; border-radius: 8px; padding: 8px 10px;
          font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer; white-space: nowrap;
        }
        .adm-dd-opt.hi { background: color-mix(in srgb, var(--accent) 14%, transparent); }
        .adm-dd-opt.sel { color: var(--accent); }
        .adm-dd-tick { font-size: 10px; width: 12px; color: var(--accent); transition: opacity .12s; }
      `}</style>
    </div>
  );
}
