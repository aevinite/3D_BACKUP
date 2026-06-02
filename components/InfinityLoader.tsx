"use client";

// Infinity-symbol loader: a faint static track shows the full loop, and a
// short bright "comet" segment traces around it forever via stroke-dashoffset.
// No external deps, no GIFs.

// This long string is the recipe for drawing the figure-8 (infinity) shape.
// The letters/numbers are drawing instructions: "M" = move the pen here,
// "C" = draw a curve. You don't need to read it — it just traces the loop.
const PATH =
  "M 30,30 C 30,10 60,10 60,30 C 60,50 90,50 90,30 C 90,10 60,10 60,30 C 60,50 30,50 30,30";

// A small spinning "loading" graphic shaped like an infinity symbol.
// `label` is the text shown under it; `size` is how wide it is in pixels.
export default function InfinityLoader({
  label = "Loading",
  size = 100,
}: {
  label?: string;
  size?: number;
}) {
  return (
    // role="status" + aria-live tells screen readers "something is loading".
    <div className="inf-loader" role="status" aria-live="polite">
      <svg
        viewBox="0 0 120 60"
        width={size}
        height={(size * 60) / 120}
        className="inf-loader-svg"
        aria-hidden="true"
      >
        {/* The faint, always-visible background loop (the "track") */}
        <path d={PATH} strokeWidth="2" className="inf-loader-track" />
        {/* The bright dash that chases around the loop — the CSS animation
            slides it along the path to create the moving "comet" effect */}
        <path d={PATH} strokeWidth="3" className="inf-loader-comet" />
      </svg>
      {/* The word(s) shown beneath the symbol, e.g. "Loading" */}
      <div className="inf-loader-label">{label}</div>
    </div>
  );
}
