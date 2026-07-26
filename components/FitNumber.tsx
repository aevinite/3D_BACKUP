"use client";
// Auto-fit for big figures (owner rule 2026-07-26): a number must NEVER clip or spill out of
// its card — when it outgrows the space, ITS OWN font shrinks until it fits, and it grows back
// when the value gets shorter again. Pure client-side measurement (no container queries, no
// layout changes to the card), so it drops into any existing tile.
//
// Use one of:
//   • <FitNumber className="…">₹18,595,555</FitNumber>  — wrap an ad-hoc big number
//   • useFitNumber(textDep)                              — ref for a span you already render
// AnimatedNumber/AnimatedStatValue already use the hook, so anything rendered through them
// fits automatically. Vanilla panels have the sibling: public/panels/fitnums.js.
import { useLayoutEffect, useRef } from "react";

// The measured element must be a non-wrapping box capped by its container: inline-block +
// max-width lets clientWidth report the available width while scrollWidth reports the full
// text width — the ratio between them is exactly the shrink factor we need.
export const FIT_STYLE: React.CSSProperties = {
  display: "inline-block",
  maxWidth: "100%",
  whiteSpace: "nowrap",
  minWidth: 0,
};

// Shrink `el`'s font so its content fits its available width. Resets to the element's own
// base size first so a value that got SHORTER grows back to full size instead of staying tiny.
export function fitNumberEl(el: HTMLElement) {
  // Remember any inline font-size the tile came with (some set one via the style prop): the
  // reset must restore THAT, not "" — wiping it would permanently shrink the tile.
  if (el.dataset.lfhFitBase == null) el.dataset.lfhFitBase = el.style.fontSize || "";
  const cs = getComputedStyle(el);
  // Inline elements report clientWidth 0 — make them measurable, capped by their container.
  if (cs.display === "inline") { el.style.display = "inline-block"; el.style.maxWidth = "100%"; }
  // Single-line ONLY for pure-text numbers. A composite box (number + chip/suffix) keeps
  // its normal wrapping so fixed-size decorations can drop to the next line when tight —
  // they can't shrink with the font, so forcing them onto the number's line would either
  // clip or crush the number for no gain. The font-shrink below still kicks in when the
  // NUMBER itself (one unbreakable token) is the wide part.
  if (el.childElementCount === 0 && cs.whiteSpace !== "nowrap") el.style.whiteSpace = "nowrap";
  el.style.fontSize = el.dataset.lfhFitBase;
  // Shrink by the OVERFLOW DELTA, not the content ratio: a box can hold fixed-size
  // decorations (chips, small suffixes) next to the number — those never shrink with the
  // font, so a ratio-of-total loop grinds the number toward zero. Removing just the missing
  // pixels each pass converges on "number exactly small enough that number + decorations
  // fit". Up to 5 passes because the available width itself can move in flex/grid layouts;
  // +1 forgives sub-pixel rounding so a perfectly-fitting number never jitters. MIN_PX is
  // the readability floor — below ~9px a figure is unreadable anyway, so clipping becomes
  // the lesser evil and we stop.
  for (let pass = 0; pass < 5; pass++) {
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 1) return;
    const w = el.getBoundingClientRect().width || 1;
    const cur = parseFloat(cs.fontSize) || 16; // cs is live — reads the current size
    const next = Math.max(MIN_PX, Math.floor(cur * ((w - over) / w) * 10) / 10);
    if (next >= cur) return;
    el.style.fontSize = next + "px";
    if (next === MIN_PX) return;
  }
}
const MIN_PX = 9;

// Ref-based hook: re-fits whenever `text` changes and whenever the container resizes.
export function useFitNumber<T extends HTMLElement>(text: unknown) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitNumberEl(el);
    const parent = el.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    // Watch the PARENT: our own font change resizes `el` itself, which would loop forever if
    // we observed it directly. The parent's width only moves on real layout changes.
    let w = parent.clientWidth;
    const ro = new ResizeObserver(() => {
      if (parent.clientWidth !== w) { w = parent.clientWidth; fitNumberEl(el); }
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text]);
  return ref;
}

export function FitNumber({ children, className, style, title }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; title?: string;
}) {
  const ref = useFitNumber<HTMLSpanElement>(fitKey(children));
  return (
    <span ref={ref} className={className} style={{ ...FIT_STYLE, ...style }} title={title}>
      {children}
    </span>
  );
}

// Stable dep for the effect: refit when the visible text actually changes.
function fitKey(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  try { return JSON.stringify(children, (_k, v) => (typeof v === "function" ? undefined : v)); }
  catch { return String(children); }
}
