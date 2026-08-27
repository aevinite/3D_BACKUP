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

// Split text into the units a READER sees, not the units JavaScript stores.
//
// WHY THIS EXISTS (T15 sweep, 2026-08-05). The hero title and the intro wordmark animate one
// <span> per character, and both used `text.split("")`, which cuts by UTF-16 code unit. In
// Devanagari a vowel sign (मात्रा) is its own code point that MUST stay attached to the
// consonant before it. Put it alone in a <span> and the browser has no base letter to attach
// it to, so the font draws it on a dotted placeholder circle. The Hindi greeting
// "शुभ संध्या" rendered as "श ◌ु भ  स ◌ं ध ◌् य ◌ा" — the biggest text on the guest's screen,
// visibly corrupted, while `innerText` stayed correct so every existing check passed.
//
// `Intl.Segmenter` with granularity "grapheme" gives exactly the reader's units: "डे", "कै" and
// the conjunct "ध्या" each come back as ONE string, so each still animates as one unit and the
// text renders normally. Latin is unchanged (one letter = one grapheme), so #1's English hero
// animates exactly as before. Arabic benefits too — its letters keep their joining forms.
//
// ⛔ THAT LAST SENTENCE IS WRONG, AND IT STAYS — REJECTED (owner, 2026-08-14),
// docs/REJECTED-IDEAS.md → R23. Grapheme splitting fixes Devanagari and CANNOT fix Arabic: the
// hero greeting and the intro wordmark put each grapheme in a `display:inline-block` span, and a
// browser can neither join Arabic letters nor order them right-to-left across two atomic boxes,
// so every letter falls back to its isolated form and the word reads backwards. Measured with a
// screenshot (T15, 2026-08-13) and PARKED — *"don’t suggest that improvement right now"*. Do not
// fix it here, do not add a script check, do not file it as new. Full note: the R23 block in lib/i18n.ts. (Pointer added by T27, 2026-08-27, which re-found it and had to revert.)
//
// Falls back to the old behaviour on any runtime without Segmenter (all current browsers and
// Node 18+ have it); a fallback that splits Latin correctly is better than throwing.
export function splitGraphemes(input: string): string[] {
  const s = typeof input === "string" ? input : "";
  if (!s) return [];
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
    if (Seg) return [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
  } catch { /* fall through to the code-unit split below */ }
  return s.split("");
}
