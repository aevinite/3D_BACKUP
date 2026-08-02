// components/admin/Skeleton.tsx — the shared skeleton placeholders for the admin panel
// (owner, 2026-08-02: "not just for one second — even less than one second, it ruins
// everything I have built").
//
// THE RULE THESE EXIST TO ENFORCE. A screen must never paint in a half-built state. There
// are two different ways that used to happen and they need two different answers:
//
//   1. UNSTYLED MARKUP. A page whose CSS is injected by its own JavaScript paints with raw
//      browser controls until the bundle loads. No spinner can fix that — the spinner would
//      be unstyled too. The answer is to ship the CSS in the document (globals.css, or a
//      plain <style> that server-renders), which is why every class used below is defined in
//      app/globals.css and NOT here.
//   2. STYLED BUT EMPTY. The screen is correct, its data just hasn't landed. That is what
//      these components are for: a grey shape the size of the real thing, so the layout is
//      already final when the data arrives and nothing jumps.
//
// Never write the word "Loading" as body text again — use a shape.

import type { CSSProperties } from "react";

/** One grey bar. `w` accepts any CSS width ("70%", 120). */
export function SkelLine({ w = "100%", size = "md", style }: {
  w?: string | number; size?: "sm" | "md" | "lg"; style?: CSSProperties;
}) {
  return <span className={`skel skel-line${size === "md" ? "" : ` ${size}`}`} style={{ display: "block", width: w, ...style }} />;
}

/** A square avatar / thumbnail block. */
export function SkelAvatar({ size = 40 }: { size?: number }) {
  return <span className="skel skel-av" style={{ width: size, height: size }} />;
}

/** A pill-shaped control placeholder (filter chip, small button). */
export function SkelChip({ w = 84 }: { w?: string | number }) {
  return <span className="skel skel-chip" style={{ width: w }} />;
}

/**
 * One list row shaped like a real person/restaurant row: avatar, a name line, a meta line,
 * and a trailing pill. `lines={1}` drops the meta line for denser lists.
 */
export function SkelRow({ lines = 2, avatar = true, trailing = true }: {
  lines?: 1 | 2; avatar?: boolean; trailing?: boolean;
}) {
  return (
    <div className="skel-row">
      {avatar ? <SkelAvatar /> : null}
      <span className="txt">
        <SkelLine w="42%" size="lg" />
        {lines === 2 ? <SkelLine w="26%" size="sm" /> : null}
      </span>
      {trailing ? <span className="skel skel-chip" style={{ width: 64, height: 22 }} /> : null}
    </div>
  );
}

/**
 * The usual "a list is loading" block: `rows` shaped rows with a staggered shimmer.
 * aria-hidden + a polite live region, so a screen reader hears "Loading users" once
 * instead of reading a wall of empty boxes.
 */
export function SkelList({ rows = 5, lines = 2, avatar = true, label = "Loading" }: {
  rows?: number; lines?: 1 | 2; avatar?: boolean; label?: string;
}) {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      <div className="skel-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => <SkelRow key={i} lines={lines} avatar={avatar} />)}
      </div>
    </>
  );
}

/** A card-shaped block for a stat tile or a panel whose contents aren't known yet. */
export function SkelCard({ h = 96, label }: { h?: number; label?: string }) {
  return (
    <div className="skel-card" aria-hidden="true">
      {label ? <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{label}</div> : null}
      <span className="skel" style={{ display: "block", width: "100%", height: h, borderRadius: 10 }} />
    </div>
  );
}

/** A chart placeholder — same height as the real chart so the page doesn't resize. */
export function SkelChart({ h = 240 }: { h?: number }) {
  return <span className="skel" style={{ display: "block", width: "100%", height: h, borderRadius: 12 }} aria-hidden="true" />;
}

/** The toolbar above a list: a search box, a select, and a few filter chips. */
export function SkelToolbar() {
  return (
    <div className="skel-toolbar" aria-hidden="true">
      <span className="skel skel-btn" style={{ width: "min(260px, 46%)" }} />
      <SkelChip w={140} />
      <SkelChip w={62} /><SkelChip w={86} /><SkelChip w={78} />
    </div>
  );
}
