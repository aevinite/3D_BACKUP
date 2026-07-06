"use client";
// Owner dashboard date-range control (redesign 2026-07-06, owner picked "A").
// A refined segmented control with an emerald thumb that GLIDES between ranges,
// hover feedback on inactive ranges, and a caption spelling out the exact days —
// replacing the flat, motionless pills the owner called "no UI/UX". On phones it
// drops to a 2-column grid (big tap targets) and the sliding thumb is hidden (the
// active cell just fills), so nothing depends on pixel measuring in a wrapped grid.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Item<T extends string> = { k: T; label: string };

export default function RangeSlider<T extends string>({ items, value, onChange, caption }: {
  items: Item<T>[]; value: T; onChange: (v: T) => void; caption?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  const place = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const on = wrap.querySelector<HTMLButtonElement>("button[data-on='1']");
    // Grid (mobile) layout hides the thumb via CSS — skip measuring there so a wrapped
    // row never leaves the thumb stranded at a stale x.
    if (!on || getComputedStyle(wrap).gridAutoFlow === "row") { setThumb(null); return; }
    setThumb({ left: on.offsetLeft, width: on.offsetWidth });
  }, []);

  useLayoutEffect(place, [place, value, items.length]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [place]);

  return (
    <div className="ownrs">
      <div className="ownrs-seg" ref={wrapRef} role="tablist" aria-label="Date range">
        {thumb && <span className="ownrs-thumb" style={{ left: thumb.left, width: thumb.width }} aria-hidden="true" />}
        {items.map((it) => (
          <button key={it.k} type="button" role="tab" aria-selected={value === it.k}
            data-on={value === it.k ? "1" : "0"} className={value === it.k ? "on" : ""}
            onClick={() => onChange(it.k)}>{it.label}</button>
        ))}
      </div>
      {caption && <div className="ownrs-cap">Showing: <b>{caption}</b></div>}
      <style jsx>{`
        .ownrs { display: inline-flex; flex-direction: column; gap: 6px; min-width: 0; }
        .ownrs-seg {
          position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
          background: var(--muted2, rgba(128,128,128,.1)); border: var(--border); border-radius: 12px;
          padding: 4px; gap: 2px; isolation: isolate;
        }
        .ownrs-seg button {
          position: relative; z-index: 2; border: 0; background: none; color: var(--muted);
          font: inherit; font-size: 12.5px; font-weight: 700; padding: 9px 13px; border-radius: 9px;
          cursor: pointer; white-space: nowrap; transition: color .2s ease;
        }
        .ownrs-seg button:hover { color: var(--text, inherit); }
        .ownrs-seg button.on { color: #04231a; }
        .ownrs-thumb {
          position: absolute; z-index: 1; top: 4px; bottom: 4px; border-radius: 9px; background: var(--accent);
          transition: left .28s cubic-bezier(.4,1.3,.5,1), width .28s cubic-bezier(.4,1.3,.5,1);
          box-shadow: 0 2px 10px -2px color-mix(in srgb, var(--accent) 70%, transparent);
        }
        .ownrs-cap { font-size: 11.5px; color: var(--muted); }
        .ownrs-cap b { color: var(--text, inherit); font-weight: 700; }
        @media (max-width: 560px) {
          .ownrs { display: flex; align-self: stretch; }
          .ownrs-seg { grid-auto-flow: row; grid-auto-columns: auto; grid-template-columns: repeat(2, 1fr); }
          .ownrs-seg button { padding: 11px 10px; font-size: 13px; }
          .ownrs-seg button.on { background: var(--accent); }
        }
      `}</style>
    </div>
  );
}
