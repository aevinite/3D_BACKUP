"use client";

// Intro: the logo scales in from a soft blur with a sweeping ring, the wordmark
// assembles letter by letter, a small heartbeat, then the curtain lifts to reveal
// the menu. Runs once per load.

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

const LOGO = "/lfh-logo.png";
const WORDMARK = "little French house";

export default function IntroSplash() {
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finish = () => {
      setDone(true);
      window.dispatchEvent(new Event("lfh:intro-done")); // cue the hero text
    };
    // Play the intro only ONCE per visit — not every time the menu re-mounts
    // (e.g. coming back from a dish page). A full refresh / new tab plays it again.
    let seen = false;
    try { seen = sessionStorage.getItem("lfh_intro_seen") === "1"; } catch {}
    if (seen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    try { sessionStorage.setItem("lfh_intro_seen", "1"); } catch {}
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.timeScale(1.25); // 25% faster
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
    const timer = setTimeout(finish, 2300);
    return () => {
      clearTimeout(timer);
      ctx.revert();
    };
  }, []);

  if (done) return null;

  return (
    <div ref={root} className="intro-splash" aria-hidden="true">
      <div className="intro-ring" />
      <img className="intro-logo" src={LOGO} alt="" />
      <div className="intro-word">
        {WORDMARK.split("").map((c, i) => (
          <span key={i}>{c === " " ? " " : c}</span>
        ))}
      </div>
    </div>
  );
}
