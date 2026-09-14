// Draws the little India-style food-type badge you see on each dish.
// It's the classic square-with-a-symbol marker: a dot inside a green box means
// vegetarian, a triangle inside a brown box means non-vegetarian.
// `isVeg` decides which one to draw; `size` is how big it is in pixels.
//
// role="img" is not decoration (owner, 2026-09-14, item 4). The badge already NAMED itself
// with aria-label, but a bare <svg> has no implicit role, and several screen readers drop the
// label of an element whose role they cannot resolve — so on those, the one mark that tells a
// diner whether a dish is vegetarian was announced as nothing at all. One attribute each,
// nothing visual changes.
export default function VegIcon({ isVeg, size = 20 }: { isVeg: boolean; size?: number }) {
  // If this dish is vegetarian, draw the green box with a dot in the middle.
  if (isVeg) {
    return (
      // An <svg> is a hand-drawn picture made of shapes. The CSS classes
      // (veg-box, veg-dot) give it its green colour.
      <svg role="img" width={size} height={size} viewBox="0 0 64 64" aria-label="Vegetarian">
        {/* The outer rounded square (the "box" of the badge) */}
        <rect className="veg-box" x="6" y="6" width="52" height="52" rx="8" />
        {/* The filled circle in the centre that signals "veg" */}
        <circle className="veg-dot" cx="32" cy="32" r="14" />
      </svg>
    );
  }
  // Otherwise (not vegetarian), draw the box with a triangle inside instead.
  return (
    <svg role="img" width={size} height={size} viewBox="0 0 64 64" aria-label="Non-Vegetarian">
      {/* The outer rounded square */}
      <rect className="nv-box" x="6" y="6" width="52" height="52" rx="8" />
      {/* The triangle in the centre that signals "non-veg" */}
      <polygon className="nv-tri" points="32,14 52,50 12,50" />
    </svg>
  );
}
