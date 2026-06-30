// Brand-text highlight markers. The admin writes a wordmark / hero with *asterisks*
// around the part that should use the restaurant's ACCENT colour; everything else
// renders in the mode-adaptive plain colour (white in dark, black in light — same as
// restaurant #1's "little [French] house"). Pure + tiny so every render site (header,
// intro splash, hero, the admin live preview) divides text identically.

export type BrandSegment = { text: string; hi: boolean };

// Split on single '*' markers into alternating plain / highlighted segments.
// "Demo *Bistro*" -> [{text:"Demo ",hi:false},{text:"Bistro",hi:true}]
// Unmatched/odd markers are tolerated (the trailing run is just plain). Empty
// segments are dropped so we never emit blank spans.
export function splitBrandSegments(input: string): BrandSegment[] {
  const s = typeof input === "string" ? input : "";
  const parts = s.split("*");
  const out: BrandSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    out.push({ text: parts[i], hi: i % 2 === 1 });
  }
  return out;
}

// Remove markers without colouring (for spots that are a single solid colour,
// e.g. the greeting badge) so a literal '*' never shows on screen.
export function stripBrandMarkers(input: string): string {
  return (typeof input === "string" ? input : "").replace(/\*/g, "");
}

// True if the text actually contains a highlight marker — lets a render site keep
// its existing styling (e.g. the hero gradient) when no markers are present.
export function hasBrandMarkers(input: string): boolean {
  return typeof input === "string" && input.includes("*");
}
