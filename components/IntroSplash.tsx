"use client";

// Intro: the logo scales in from a soft blur with a sweeping ring, the wordmark
// assembles letter by letter, a small heartbeat, then the curtain lifts to reveal
// the menu. Runs once per load.

import { useEffect, useRef, useState } from "react";
// GSAP is the animation library that drives the logo/wordmark motion.
import { gsap } from "gsap";
import { splitBrandSegments, splitGraphemes } from "@/lib/brandText";

// The logo image and the words that spell out one letter at a time.
const LOGO = "/lfh-logo.png";
const WORDMARK = "little French house";

// The opening "splash" screen shown once when the app first loads: the logo
// fades in, the wordmark assembles, then the whole curtain slides up to reveal
// the menu. After it finishes it removes itself from the page.
export default function IntroSplash({ wordmark, accentColor, logoUrl, scopeKey }: { wordmark?: string; accentColor?: string; logoUrl?: string; scopeKey?: string }) {
  // Has the intro finished? When true, this component renders nothing.
  const [done, setDone] = useState(false);
  // A handle to the outer splash <div> so GSAP can animate it.
  const root = useRef<HTMLDivElement>(null);

  // Runs once on first load. Decides whether to play the intro and, if so,
  // builds the animation timeline; always cleans up afterwards.
  useEffect(() => {
    // Marks the intro as over and tells the rest of the app it's done.
    // `finished` guards against running twice (timer AND visibility can both fire).
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setDone(true);
      window.dispatchEvent(new Event("lfh:intro-done")); // cue the hero text
    };
    // Play the intro only ONCE per visit — not every time the menu re-mounts
    // (e.g. coming back from a dish page). A full refresh / new tab plays it again.
    // sessionStorage remembers things only for THIS browser tab/visit. The key is
    // scoped PER RESTAURANT (bug G3/L1, 2026-07-05): a single global "lfh_intro_seen"
    // meant that after seeing restaurant A's splash, opening restaurant B in the same
    // tab skipped B's own branded intro entirely — a white-label violation. Keying by
    // the restaurant id (falls back to the wordmark) shows each tenant its own splash once.
    const seenKey = "lfh_intro_seen:" + (scopeKey || wordmark || "default");
    let seen = false;
    try { seen = sessionStorage.getItem(seenKey) === "1"; } catch {}
    // If we've shown it already this visit (or the visitor prefers reduced
    // motion), skip straight to the finished state.
    if (seen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    // Otherwise, remember that we're showing it now so it won't replay.
    try { sessionStorage.setItem(seenKey, "1"); } catch {}
    // gsap.context groups all these animations so we can cleanly undo them later.
    const ctx = gsap.context(() => {
      // A timeline plays the steps below back-to-back in order.
      const tl = gsap.timeline();
      tl.timeScale(1.25); // 25% faster
      // Step by step: make the splash visible, scale the logo up out of a blur,
      // grow a ring around it, fade the ring away, pop the wordmark letters in
      // one by one, then slide the whole splash up off the screen.
      // (The "<", "-=", "+=" bits just say "start relative to the step before".)
      tl.set(root.current, { autoAlpha: 1 });
      // Only animate the logo when this restaurant actually renders one. A non-#1
      // tenant with no uploaded logo has NO .intro-logo element, and animating a
      // missing target logged a GSAP "target not found" warning on every load while
      // doing nothing (audit fix 2026-07-08). The ring + wordmark still play.
      if (root.current?.querySelector(".intro-logo")) {
        tl.from(".intro-logo", { scale: 0.35, autoAlpha: 0, filter: "blur(16px)", duration: 1.0, ease: "back.out(1.7)" });
      }
      tl.from(".intro-ring", { scale: 0, autoAlpha: 0, duration: 0.9, ease: "power3.out" }, "<")
        .to(".intro-ring", { autoAlpha: 0, scale: 1.25, duration: 0.7, ease: "power1.out" }, "-=0.3")
        .from(".intro-word span", { y: 26, autoAlpha: 0, stagger: 0.035, duration: 0.5, ease: "power3.out" }, "-=0.6")
        // brief hold once formed, then slide straight up (no heartbeat pause)
        .to(root.current, { yPercent: -100, duration: 0.55, ease: "power3.in" }, "+=0.2");
    }, root);
    // Dismiss via a timer (not the timeline's onComplete) so React StrictMode's
    // mount/cleanup/mount in dev can't leave the splash stuck in the DOM.
    // Safety net: hide the splash after 2.3s no matter what the animation does.
    const timer = setTimeout(finish, 2300);
    // MOBILE FIX: on phones, backgrounding the tab freezes both setTimeout and
    // GSAP's ticker. If the user switches apps during the 2.3s intro and comes
    // back, the timer never fires and the full-screen splash (z-index 9999) stays
    // mounted, swallowing every tap until a manual refresh. Catch the return-to-
    // foreground and finish immediately so the curtain can never get stuck.
    const onVisible = () => { if (!document.hidden) finish(); };
    document.addEventListener("visibilitychange", onVisible);
    // pageshow also fires when the page is restored from the bfcache (iOS Safari
    // swipe-back / app switch), which visibilitychange can miss.
    window.addEventListener("pageshow", onVisible);
    // Cleanup: cancel the timer, drop the listeners, and undo all the GSAP animations.
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once per mount; scopeKey/wordmark are stable for a page load

  // Once the intro is over, render nothing at all.
  if (done) return null;

  // Per-restaurant intro: a tenant passes its OWN wordmark + accent, so its splash
  // shows ITS name in ITS colour with NO French House logo. The flagship (#1) passes
  // nothing → the original LFH logo + "little French house" wordmark (unchanged).
  const isDefault = !wordmark;
  const word = wordmark || WORDMARK;
  const splashStyle = !isDefault && accentColor
    ? { background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${accentColor} 38%, #0d0805) 0%, #0a0a0f 68%, #000 100%)` }
    : undefined;

  return (
    // aria-hidden hides this purely-decorative screen from screen readers.
    <div ref={root} className="intro-splash" aria-hidden="true" style={splashStyle}>
      {/* The expanding ring — tinted to the restaurant's accent for non-#1. */}
      <div className="intro-ring" style={!isDefault && accentColor ? { borderColor: accentColor } : undefined} />
      {/* Logo: the flagship's hardcoded mark for #1; any other restaurant shows its
          OWN uploaded logo if it has one (else just its name — white-label). */}
      {logoUrl ? <img className="intro-logo" src={logoUrl} alt="" /> : (isDefault && <img className="intro-logo" src={LOGO} alt="" />)}
      {/* The wordmark, split into one <span> per letter-as-a-reader-sees-it so each can pop in
          (splitGraphemes, not .split("") — a restaurant with a Devanagari name would otherwise
          have its own wordmark broken apart; see lib/brandText.ts).
          *asterisk*-marked parts use the restaurant's accent colour; the rest
          stays the default wordmark colour. #1 passes no markers → unchanged. */}
      <div className="intro-word">
        {splitBrandSegments(word).flatMap((seg, si) =>
          splitGraphemes(seg.text).map((c, ci) => (
            <span key={`${si}-${ci}`} style={seg.hi && accentColor ? { color: accentColor } : undefined}>{c === " " ? " " : c}</span>
          ))
        )}
      </div>
    </div>
  );
}
