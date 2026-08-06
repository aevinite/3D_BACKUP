"use client";
// Shared count-up animation for owner-panel numbers. While a value is still loading we show a
// calm shimmer skeleton — NOT a fabricated rolling number — so a stat never looks "half
// calculated". The instant the real figure lands it counts up ONCE, smoothly, from where it
// was to the true value (never downward from a fake overshoot). Snappy by design (~520ms
// ease-out). Respects prefers-reduced-motion (snaps straight to the value). Pure UI.
import { useEffect, useRef, useState } from "react";
import { inr } from "@/components/admin/shared";
import { FIT_STYLE, useFitNumber } from "@/components/FitNumber";

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

const DUR = 460; // reveal duration — snappy; expo ease-out lands fast then settles

// Drives a displayed number toward `value` with a single ease-out count-up. While `loading`
// it HOLDS at the last real value (the component shows a skeleton instead), so we never
// animate a made-up figure and never count the wrong direction when data lands.
function useAnimatedValue(value: number, loading?: boolean): number {
  const reduce = usePrefersReducedMotion();
  const [disp, setDisp] = useState(0);
  const fromRef = useRef(0);   // last committed displayed value
  const rafRef = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (loading) return;                         // hold; skeleton is shown by the component
    if (reduce || fromRef.current === value) {   // no motion needed → snap
      fromRef.current = value; setDisp(value); return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    const tick = (t: number) => {
      // expo ease-out: sprints to ~90% almost immediately, then eases onto the exact value —
      // reads as "instant but smooth" rather than a slow linear crawl.
      const p = Math.min(1, (t - t0) / DUR), e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
      const v = from + (value - from) * e;
      fromRef.current = v; setDisp(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else { fromRef.current = value; setDisp(value); }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, loading, reduce]);
  return disp;
}

// Numeric API: pass a raw number. `money` → ₹ formatting (matches inr); or pass your own
// `format` (e.g. the en-IN `nfmt`). Used by the dashboard tiles + the reports hero.
export function AnimatedNumber({ value, loading, money, format, className }: {
  value: number; loading?: boolean; money?: boolean;
  format?: (n: number) => string; className?: string;
}) {
  const disp = useAnimatedValue(value, loading);
  // en-IN, not en-US: this console writes Indian money and Indian counts everywhere else
  // (components/admin/shared → inr / nfmt are both en-IN). A plain count over 9,999 used to
  // print "1,234,567" here beside a table saying "12,34,567".
  const fmt = format ?? (money ? inr : (n: number) => Math.round(n).toLocaleString("en-IN"));
  // Auto-fit: shrink the font when the figure outgrows its tile (see components/FitNumber).
  // Keyed on the rendered text, so it re-measures every count-up frame — mid-roll digits only
  // ever grow, so this reads as the number settling into the exact size that fits.
  const text = fmt(Math.round(disp));
  const fitRef = useFitNumber<HTMLSpanElement>(loading ? null : text);
  if (loading) return <span key="skel" className={`anim-num anim-skel${className ? " " + className : ""}`} aria-hidden="true" />;
  // Round before formatting — a custom `format` (e.g. the en-IN count formatter) would
  // otherwise print the fractional mid-roll value as "5,216.473" (a broken-looking bill count).
  // key differs from the skeleton so the number REMOUNTS on reveal → the fade/slide-in runs
  // once; live (non-loading) value changes keep the same node and just count the delta.
  return <span key="num" ref={fitRef} style={FIT_STYLE} className={`anim-num anim-num-in${className ? " " + className : ""}`}>{text}</span>;
}

// String-aware API: takes an already-formatted value (e.g. inr()/nfmt() output) and animates
// it in place, preserving the exact prefix (₹), grouping style, and any suffix (%). Anything
// that isn't a plain integer string renders unchanged. Lets the shared <Stat> auto-animate
// every report number with zero call-site changes.
export function AnimatedStatValue({ value, loading }: { value: React.ReactNode; loading?: boolean }) {
  const parsed = typeof value === "number"
    ? { pre: "", num: value, locale: "en-IN", suf: "" }
    : parseFormatted(value);
  const disp = useAnimatedValue(parsed ? parsed.num : 0, loading);
  const text = parsed ? parsed.pre + Math.round(disp).toLocaleString(parsed.locale) + parsed.suf : "";
  const fitRef = useFitNumber<HTMLSpanElement>(!parsed || loading ? null : text);
  if (!parsed) return <>{value}</>;
  if (loading) return <span key="skel" className="anim-num anim-skel" aria-hidden="true" />;
  return <span key="num" ref={fitRef} style={FIT_STYLE} className="anim-num anim-num-in">
    {text}
  </span>;
}

// "₹83,59,670" → {pre:"₹", num}; "1,234" → plain; "5%" → suffix kept. Returns null for
// non-integers (a paise figure from inrP renders unchanged).
//
// THE GROUPING IS ALWAYS en-IN, AND THAT IS THE WHOLE POINT (T5 sweep, 2026-08-06).
// This helper takes an ALREADY-FORMATTED string apart and puts it back together, so the
// grouping it chooses must match the formatter the caller used. It used to pick en-US
// whenever it saw a ₹ — on the belief, written into the old comment here, that
// "inr formats with en-US grouping". It does not: components/admin/shared → inr is
// toLocaleString("en-IN"), and so is nfmt. So every <Stat> in the Reports Studio — the
// headline number of all eight reports — was silently re-grouped the American way while
// the table underneath it, which prints inr() straight, stayed Indian. Measured live:
// the Sales report read ₹8,359,670 above a Total row of ₹83,59,670, and the Tax report
// read ₹398,074 above a CGST/SGST split of ₹3,98,074 on a panel captioned "ready to copy
// into a return". Both formatters this helper can ever be fed are en-IN, so there is
// nothing to infer.
function parseFormatted(value: React.ReactNode): { pre: string; num: number; locale: string; suf: string } | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\D*?)([\d,]+)(\D*)$/);
  if (!m) return null;
  const numStr = m[2].replace(/,/g, "");
  if (!/^\d+$/.test(numStr)) return null;
  const num = Number(numStr);
  if (!isFinite(num)) return null;
  return { pre: m[1], num, locale: "en-IN", suf: m[3] };
}
