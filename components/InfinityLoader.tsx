"use client";

// Infinity-symbol loader: a faint static track shows the full loop, and a
// short bright "comet" segment traces around it forever via stroke-dashoffset.
// No external deps, no GIFs.

const PATH =
  "M 30,30 C 30,10 60,10 60,30 C 60,50 90,50 90,30 C 90,10 60,10 60,30 C 60,50 30,50 30,30";

export default function InfinityLoader({
  label = "Loading",
  size = 100,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <div className="inf-loader" role="status" aria-live="polite">
      <svg
        viewBox="0 0 120 60"
        width={size}
        height={(size * 60) / 120}
        className="inf-loader-svg"
        aria-hidden="true"
      >
        <path d={PATH} strokeWidth="2" className="inf-loader-track" />
        <path d={PATH} strokeWidth="3" className="inf-loader-comet" />
      </svg>
      <div className="inf-loader-label">{label}</div>
    </div>
  );
}
