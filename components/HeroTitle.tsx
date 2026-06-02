"use client";

// The hero greeting + tagline, revealed letter by letter. It re-plays whenever
// the intro finishes (the menu "opens") and whenever the theme is toggled, so
// the page always feels alive. Calm, staggered, GSAP-driven.

import { useEffect, useRef } from "react";
// GSAP is the animation library we use to move/fade things smoothly.
import { gsap } from "gsap";

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

  // Turns a piece of text into one <span> per character, so each letter can be
  // animated on its own. Spaces are kept as-is so words don't run together.
  const split = (text: string) =>
    text.split("").map((c, i) => <span key={i}>{c === " " ? " " : c}</span>);

  return (
    <div ref={ref} className="hero-title-wrap">
      {/* The small greeting badge, split into individual letters */}
      <span className="greet-badge">{split(greeting)}</span>
      {/* The large tagline, also split into individual letters */}
      <h2 className="hero-title">{split(title)}</h2>
    </div>
  );
}
