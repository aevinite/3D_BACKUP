"use client";

// The hero greeting + tagline, revealed letter by letter. It re-plays whenever
// the intro finishes (the menu "opens") and whenever the theme is toggled, so
// the page always feels alive. Calm, staggered, GSAP-driven.

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export default function HeroTitle({ greeting, title }: { greeting: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const animate = () => {
      if (reduce || !ref.current) return;
      const greet = ref.current.querySelectorAll(".greet-badge span");
      const titleLetters = ref.current.querySelectorAll(".hero-title span");
      const tl = gsap.timeline();
      // greeting rises in (solid colour — safe to transform)
      tl.fromTo(greet,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.03, ease: "power2.out", overwrite: true });
      // tagline letters fade in one by one (opacity only — keeps the gradient clip intact)
      tl.fromTo(titleLetters,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, stagger: 0.04, ease: "power2.out", overwrite: true },
        "-=0.2");
    };

    // play on mount, again when the intro lifts, and on every theme switch
    const id = requestAnimationFrame(animate);
    window.addEventListener("lfh:intro-done", animate);
    window.addEventListener("lfh:theme-changed", animate);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("lfh:intro-done", animate);
      window.removeEventListener("lfh:theme-changed", animate);
    };
  }, [greeting, title]);

  const split = (text: string) =>
    text.split("").map((c, i) => <span key={i}>{c === " " ? " " : c}</span>);

  return (
    <div ref={ref} className="hero-title-wrap">
      <span className="greet-badge">{split(greeting)}</span>
      <h2 className="hero-title">{split(title)}</h2>
    </div>
  );
}
