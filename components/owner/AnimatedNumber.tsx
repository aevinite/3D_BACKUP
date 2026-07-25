"use client";
// Shared count-up animation for owner-panel numbers. Every stat rolls UP from zero and
// "forms" its value; while the data is still loading it keeps a gentle rolling climb
// (dimmed) instead of a dead "…", so the animation overlaps the fetch and masks it —
// even a 1–2s load feels alive. Eases exactly onto the true value the instant it lands.
// Respects prefers-reduced-motion (snaps straight to the value). Pure UI.
import { useEffect, useRef, useState } from "react";
import { inr } from "@/components/admin/shared";

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

// Core: drives a displayed number toward `value`, or keeps a "building" roll while loading.
function useAnimatedValue(value: number, loading?: boolean): number {
  const reduce = usePrefersReducedMotion();
  const [disp, setDisp] = useState(0);
  const fromRef = useRef(0);   // where the live animation currently sits
  const rafRef = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (reduce) {
      const v = loading ? fromRef.current : value;
      fromRef.current = v; setDisp(v); return;
    }
    const t0 = performance.now();
    const from = fromRef.current;
    if (loading) {
      // Alive "building" roll: a decelerating climb + slow creep so it never freezes while
      // we wait. Magnitude is loose — the reveal below sweeps to the real figure regardless.
      const tick = (t: number) => {
        const el = t - t0;
        const v = from + (1 - Math.exp(-el / 600)) * 6000 + el * 0.25;
        fromRef.current = v; setDisp(v);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      const dur = 900;   // reveal: ease from wherever we are up to the true value
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        const v = from + (value - from) * e;
        fromRef.current = v; setDisp(v);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
        else { fromRef.current = value; setDisp(value); }
      };
      rafRef.current = requestAnimationFrame(tick);
    }
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
  const fmt = format ?? (money ? inr : (n: number) => Math.round(n).toLocaleString("en-US"));
  return <span className={`anim-num${loading ? " num-rolling" : ""}${className ? " " + className : ""}`}>{fmt(disp)}</span>;
}

// String-aware API: takes an already-formatted value (e.g. inr()/nfmt() output) and animates
// it in place, preserving the exact prefix (₹), grouping style, and any suffix (%). Anything
// that isn't a plain integer string renders unchanged. Lets the shared <Stat> auto-animate
// every report number with zero call-site changes.
export function AnimatedStatValue({ value, loading }: { value: React.ReactNode; loading?: boolean }) {
  const parsed = typeof value === "number"
    ? { pre: "", num: value, locale: "en-US", suf: "" }
    : parseFormatted(value);
  const disp = useAnimatedValue(parsed ? parsed.num : 0, loading);
  if (!parsed) return <>{value}</>;
  return <span className={`anim-num${loading ? " num-rolling" : ""}`}>
    {parsed.pre + Math.round(disp).toLocaleString(parsed.locale) + parsed.suf}
  </span>;
}

// "₹42,361,012" → {pre:"₹", num, locale:"en-US"}; "1,234" → en-IN; "5%" → suffix kept.
// inr formats with en-US grouping, nfmt with en-IN — inferred from the ₹ prefix so the
// re-rendered grouping matches the original exactly. Returns null for non-integers.
function parseFormatted(value: React.ReactNode): { pre: string; num: number; locale: string; suf: string } | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\D*?)([\d,]+)(\D*)$/);
  if (!m) return null;
  const numStr = m[2].replace(/,/g, "");
  if (!/^\d+$/.test(numStr)) return null;
  const num = Number(numStr);
  if (!isFinite(num)) return null;
  return { pre: m[1], num, locale: m[1].includes("₹") ? "en-US" : "en-IN", suf: m[3] };
}
