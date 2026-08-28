"use client";

// The hero greeting + tagline, revealed letter by letter. It re-plays whenever
// the intro finishes (the menu "opens") and whenever the theme is toggled, so
// the page always feels alive. Calm, staggered, GSAP-driven.

import { useEffect, useRef } from "react";
// GSAP is the animation library we use to move/fade things smoothly.
import { gsap } from "gsap";
import { splitBrandSegments, stripBrandMarkers, hasBrandMarkers, splitGraphemes } from "@/lib/brandText";

// Shows the greeting + tagline at the top of the menu, revealing them letter
// by letter. `greeting` is the small badge line, `title` is the big tagline.
export default function HeroTitle({ greeting, title }: { greeting: string; title: string }) {
  // A handle to the wrapping <div> so we can find the letters to animate.
  const ref = useRef<HTMLDivElement>(null);

  // Sets up the entrance animation once the component is on screen, and wires
  // it to replay on certain events. Re-runs if the greeting/title text changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect the visitor's "reduce motion" setting; if on, we skip animating.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // The actual animation routine. We define it once and reuse it for replays.
    const animate = () => {
      if (reduce || !ref.current) return;
      // Grab the individual letter <span>s of the greeting and the tagline.
      const greet = ref.current.querySelectorAll(".greet-badge span");
      const titleLetters = ref.current.querySelectorAll(".hero-title span");
      // A GSAP "timeline" lets us play several animations one after another.
      const tl = gsap.timeline();
      // greeting rises in (solid colour — safe to transform)
      // (fromTo = animate FROM the first state TO the second; stagger = a tiny
      //  delay between each letter so they cascade in sequence.)
      tl.fromTo(greet,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.03, ease: "power2.out", overwrite: true });
      // tagline letters fade in one by one (opacity only — keeps the gradient clip intact)
      // (Only the fade is animated, not movement, so the text's gradient fill stays put.)
      tl.fromTo(titleLetters,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, stagger: 0.04, ease: "power2.out", overwrite: true },
        "-=0.2");
    };

    // play on mount, again when the intro lifts, and on every theme switch
    // requestAnimationFrame waits for the next paint so the letters exist first.
    const id = requestAnimationFrame(animate);
    // "lfh:intro-done" fires when the opening splash finishes; "lfh:theme-changed"
    // fires when the visitor flips light/dark. Both replay the reveal.
    window.addEventListener("lfh:intro-done", animate);
    window.addEventListener("lfh:theme-changed", animate);
    // Cleanup: cancel the pending frame and remove both event listeners.
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("lfh:intro-done", animate);
      window.removeEventListener("lfh:theme-changed", animate);
    };
  }, [greeting, title]);

  // ⛔ REJECTED (owner, 2026-08-14) — docs/REJECTED-IDEAS.md → R23. Arabic comes out of THIS split
  // as disconnected, backwards letters: each grapheme gets its own `display:inline-block` span
  // (app/globals.css), and a browser can neither join Arabic letters nor order them right-to-left
  // ACROSS two atomic boxes. It is measured, screenshotted and PARKED — *"don't suggest that
  // improvement right now"* — so do not "helpfully" fix it, and do not file it as new. The full
  // note is at lib/i18n.ts → useTranslation. (Pointer added by the T27 sweep, 2026-08-27, which
  // re-found the fault, fixed it, and had to revert: the decision was three files away.)
  // Turns a piece of text into one <span> per letter AS A READER SEES IT, so each can be
  // animated on its own. Spaces are kept as-is so words don't run together.
  // splitGraphemes, never .split(""): a Devanagari vowel sign cut off from its consonant
  // renders on a dotted placeholder circle — see lib/brandText.ts for the whole story.
  const split = (text: string) =>
    splitGraphemes(stripBrandMarkers(text)).map((c, i) => <span key={i}>{c === " " ? " " : c}</span>);

  // The title supports *asterisk* highlight markers: marked letters use the accent,
  // the rest the mode-adaptive --text. With markers we add `has-split` so the CSS
  // drops the gradient (per-letter solid colours). No markers → original gradient.
  //
  // A REAL SPACE, NOT A NON-BREAKING ONE (T4 sweep, 2026-08-17).
  //
  // Every space used to become ` `. Combined with the letters being `inline-block` — an atomic
  // box, so the browser may end a line between any two of them — the heading could break between any
  // two LETTERS and at none of its SPACES, which is exactly backwards. Measured on a Samsung A35
  // (360×780), screenshots read: German showed "Ganztags Café & Bäcke / rei" and French
  // "Café & Boulangerie To / ute la Journée". English hid it, because "All-Day Café & Bakery" fits
  // on one line — which is why it survived this long, on the biggest text on the guest menu.
  //
  // The pair of changes has to be made together, or one half looks worse than the bug:
  //   · here — a real U+0020, so there IS a break opportunity between words;
  //   · app/globals.css — the tagline's spans become `display: inline` (they animate opacity only,
  //     so they never needed to be blocks) with `white-space: pre-wrap`, which preserves the space
  //     and allows the break. Switching only the CSS leaves the NBSPs in place and the heading
  //     overflows off the side instead of wrapping — measured, so do not split these two up.
  //
  // The GREETING is deliberately left on ` ` in split() below: it animates `y`, so it still
  // needs an inline-block, and it is one short tracked word that never wraps.
  const titleSplit = hasBrandMarkers(title);
  const titleLetters = splitBrandSegments(title).flatMap((seg, si) =>
    splitGraphemes(seg.text).map((c, ci) => (
      <span key={`${si}-${ci}`} className={seg.hi ? "hi" : undefined}>{c === " " ? " " : c}</span>
    ))
  );

  return (
    <div ref={ref} className="hero-title-wrap">
      {/* The small greeting badge, split into individual letters */}
      <span className="greet-badge">{split(greeting)}</span>
      {/* The large tagline — letters with optional *accent* highlights */}
      <h2 className={`hero-title${titleSplit ? " has-split" : ""}`}>{titleLetters}</h2>
    </div>
  );
}
