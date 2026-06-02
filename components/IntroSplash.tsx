"use client";

// Intro: the logo scales in from a soft blur with a sweeping ring, the wordmark
// assembles letter by letter, a small heartbeat, then the curtain lifts to reveal
// the menu. Runs once per load.

import { useEffect, useRef, useState } from "react";
// GSAP is the animation library that drives the logo/wordmark motion.
import { gsap } from "gsap";

// The logo image and the words that spell out one letter at a time.
const LOGO = "/lfh-logo.png";
const WORDMARK = "little French house";

// The opening "splash" screen shown once when the app first loads: the logo
// fades in, the wordmark assembles, then the whole curtain slides up to reveal
// the menu. After it finishes it removes itself from the page.
export default function IntroSplash() {
  // Has the intro finished? When true, this component renders nothing.
  const [done, setDone] = useState(false);
  // A handle to the outer splash <div> so GSAP can animate it.
  const root = useRef<HTMLDivElement>(null);

  // Runs once on first load. Decides whether to play the intro and, if so,
  // builds the animation timeline; always cleans up afterwards.
  useEffect(() => {
    // Marks the intro as over and tells the rest of the app it's done.
    const finish = () => {
      setDone(true);
      window.dispatchEvent(new Event("lfh:intro-done")); // cue the hero text
    };
    // Play the intro only ONCE per visit — not every time the menu re-mounts
    // (e.g. coming back from a dish page). A full refresh / new tab plays it again.
    // sessionStorage remembers things only for THIS browser tab/visit. We use
    // the key "lfh_intro_seen" to note we've already shown the splash.
    let seen = false;
    try { seen = sessionStorage.getItem("lfh_intro_seen") === "1"; } catch {}
    // If we've shown it already this visit (or the visitor prefers reduced
    // motion), skip straight to the finished state.
    if (seen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    // Otherwise, remember that we're showing it now so it won't replay.
    try { sessionStorage.setItem("lfh_intro_seen", "1"); } catch {}
    // gsap.context groups all these animations so we can cleanly undo them later.
    const ctx = gsap.context(() => {
      // A timeline plays the steps below back-to-back in order.
      const tl = gsap.timeline();
      tl.timeScale(1.25); // 25% faster
      // Step by step: make the splash visible, scale the logo up out of a blur,
      // grow a ring around it, fade the ring away, pop the wordmark letters in
      // one by one, then slide the whole splash up off the screen.
      // (The "<", "-=", "+=" bits just say "start relative to the step before".)
      tl.set(root.current, { autoAlpha: 1 })
        .from(".intro-logo", { scale: 0.35, autoAlpha: 0, filter: "blur(16px)", duration: 1.0, ease: "back.out(1.7)" })
        .from(".intro-ring", { scale: 0, autoAlpha: 0, duration: 0.9, ease: "power3.out" }, "<")
        .to(".intro-ring", { autoAlpha: 0, scale: 1.25, duration: 0.7, ease: "power1.out" }, "-=0.3")
        .from(".intro-word span", { y: 26, autoAlpha: 0, stagger: 0.035, duration: 0.5, ease: "power3.out" }, "-=0.6")
        // brief hold once formed, then slide straight up (no heartbeat pause)
        .to(root.current, { yPercent: -100, duration: 0.55, ease: "power3.in" }, "+=0.2");
    }, root);
    // Dismiss via a timer (not the timeline's onComplete) so React StrictMode's
    // mount/cleanup/mount in dev can't leave the splash stuck in the DOM.
    // Safety net: hide the splash after 2.3s no matter what the animation does.
    const timer = setTimeout(finish, 2300);
    // Cleanup: cancel the timer and undo all the GSAP animations.
    return () => {
      clearTimeout(timer);
      ctx.revert();
    };
  }, []);

  // Once the intro is over, render nothing at all.
  if (done) return null;

  return (
    // aria-hidden hides this purely-decorative screen from screen readers.
    <div ref={root} className="intro-splash" aria-hidden="true">
      {/* The expanding ring behind the logo */}
      <div className="intro-ring" />
      {/* The logo image */}
      <img className="intro-logo" src={LOGO} alt="" />
      {/* The wordmark, split into one <span> per letter so each can pop in */}
      <div className="intro-word">
        {WORDMARK.split("").map((c, i) => (
          <span key={i}>{c === " " ? " " : c}</span>
        ))}
      </div>
    </div>
  );
}
