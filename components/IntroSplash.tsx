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


// A RESTAURANT'S OWN NAME IS NEVER CUT — not on the first screen it ever shows a diner
// (owner, 2026-09-02: *"caan do 5th one and can size of name a bit small"*).
//
// `.intro-word` in app/globals.css is `display: flex` with no `flex-wrap` and no width limit, so
// the wordmark was ONE unbreakable row that simply ran off the screen. Measured on this build at
// 320 / 360 / 390px: past roughly 31 letters (about 24 in capitals) it overflows BOTH edges —
// "Aangan Garden Restaurant" measured 385px of name inside a 360px screen, running from x = −13
// to 373, so the first and last letters were off-screen on the opening animation.
//
// Two changes, and they only work together:
//
//   1. THE BOX MAY WRAP, AND ONLY BETWEEN WORDS. `flex-wrap: wrap` alone would have been the
//      WRONG fix and is the exact trap this repo already recorded once: every letter is its own
//      `display:inline-block` box, so a wrapping flex row may break between any two LETTERS —
//      "Ganztags Café & Bäcke / rei". So each WORD becomes one flex item and the letters live
//      inside it; a break can then only land where a person would put one.
//   2. THE NAME IS A LITTLE SMALLER. `clamp(17px, 5vw, 22px)` instead of
//      `clamp(20px, 6vw, 26px)` — about 17% down at phone width, which is what he asked for and
//      also buys roughly six more letters before wrapping is needed at all.
//
// Both are inline on purpose: `.intro-word` lives in app/globals.css, which is another sweep
// terminal's file this week. Inline wins over the stylesheet, so nothing there had to change.
const WORD_BOX: React.CSSProperties = {
  flexWrap: "wrap",
  justifyContent: "center",
  // 92vw, not 100%: the splash is a centred column, and a name touching the glass edge-to-edge
  // reads as broken even when every letter is technically on screen.
  maxWidth: "92vw",
  rowGap: 2,
  fontSize: "clamp(17px, 5vw, 22px)",
};
// `white-space: nowrap` is what makes the word atomic; the letters inside keep the `inline-block`
// and `white-space: pre` that `.intro-word span` already gives them.
const WORD_SEG: React.CSSProperties = { display: "inline-block", whiteSpace: "nowrap" };

/**
 * The wordmark as a list of WORDS, each a list of letters carrying its own highlight flag.
 *
 * The `*asterisk*` highlight segments and the WORDS are two different groupings that can cross
 * each other ("Aangan *Garden Bistro*" is one highlight and two words), so the string is flattened
 * to (letter, highlighted) pairs first and only then cut at the spaces. The space travels with the
 * word BEFORE it and stays a non-breaking space, exactly as it always has — the break opportunity
 * now comes from the flex box, not from the character.
 */
function wordGroups(word: string): { c: string; hi: boolean; key: string }[][] {
  const chars = splitBrandSegments(word).flatMap((seg, si) =>
    splitGraphemes(seg.text).map((c, ci) => ({
      c: c === " " ? "\u00a0" : c,
      hi: !!seg.hi,
      key: `${si}-${ci}`,
      isSpace: c === " ",
    })),
  );
  const out: { c: string; hi: boolean; key: string }[][] = [];
  let cur: { c: string; hi: boolean; key: string }[] = [];
  for (const ch of chars) {
    cur.push({ c: ch.c, hi: ch.hi, key: ch.key });
    if (ch.isSpace) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  // A name that is one long unbroken word cannot be split anywhere — it shrinks by the font size
  // above and no further. That is the honest limit of this fix, and it is the right one: breaking
  // a single word mid-letter is the fault, not the cure.
  return out;
}

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
      {/* ⛔ REJECTED (owner, 2026-08-14) — docs/REJECTED-IDEAS.md → R23. Arabic comes out of THIS
          split as disconnected, backwards letters: each grapheme gets its own inline-block span
          (app/globals.css), and a browser can neither join Arabic letters nor order them
          right-to-left ACROSS two atomic boxes. It is measured, screenshotted and PARKED — the
          owner asked not to be offered it — so do not helpfully fix it, and do not file it as new.
          The full note is at lib/i18n.ts → useTranslation. (Pointer added by the T27 sweep,
          2026-08-27, which re-found the fault, fixed it, and had to revert: the decision was three
          files away.) */}
      {/* The wordmark, split into one <span> per letter-as-a-reader-sees-it so each can pop in
          (splitGraphemes, not .split("") — a restaurant with a Devanagari name would otherwise
          have its own wordmark broken apart; see lib/brandText.ts).
          *asterisk*-marked parts use the restaurant's accent colour; the rest
          stays the default wordmark colour. #1 passes no markers → unchanged. */}
      <div className="intro-word" style={WORD_BOX}>
        {wordGroups(word).map((group, gi) => (
          // ONE FLEX ITEM PER WORD, so a line can only ever break BETWEEN words. The letters keep
          // their own spans inside it, so GSAP's ".intro-word span" target is unchanged and the
          // per-letter stagger still plays exactly as it did.
          <div key={gi} className="intro-word-seg" style={WORD_SEG}>
            {group.map((ch) => (
              <span key={ch.key} style={ch.hi && accentColor ? { color: accentColor } : undefined}>{ch.c}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
