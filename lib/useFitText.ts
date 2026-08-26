"use client";

import { useEffect, useRef } from "react";

// ── A NAME MUST NEVER BE CUT — SHRINK IT UNTIL IT FITS (owner, 2026-08-05) ─────────────────────
//
// His instruction, about guest dish names on a tablet: "you can make the name small or do
// anything — you have to make it dynamic so that for every screen it should fit… and don't change
// any kind of box UI or stuff like that. You have to manage that thing."
//
// So the BOX stays exactly as designed (the guest menu's two-line name area is what makes short
// and long dish names line up across a row). What changes is the TEXT: if the full name doesn't
// fit in the box at its normal size, the font steps down until it does. Nothing is ever replaced
// with "…". Measured before: at 6 cards across on an iPad the cards are 169px wide and names like
// "Spicy Watermelon Cooler", "Minty Cucumber Cream Cheese" and "Avocado & Cream Cheese" were all
// cut off, on a screen with room to spare.
//
// WHY MEASURE INSTEAD OF SCALING WITH THE CARD WIDTH: a container query (`font-size: …cqw`) scales
// with how wide the card is, which says nothing about how LONG this particular name is — "Espresso"
// and "Minty Cucumber Cream Cheese" would get the same size and the long one would still be cut.
// Only measuring the actual text answers the actual question.
//
// COST — this reads layout, so it is written to be cheap:
//  · ONE read for a name that already fits, which is most of them. It only searches when the text
//    genuinely overflows at full size.
//  · a binary search when it does overflow — at most 5 steps between the floor and the full size,
//    never a 1px-at-a-time crawl.
//  · re-runs only when the text changes or the element's own box changes size (ResizeObserver), so
//    rotating the device or changing the column count re-fits, and scrolling never does.
//
// It also degrades safely: no ResizeObserver, no layout, or a zero-height box (still painting) and
// it simply leaves the CSS size alone rather than guessing.

/** Steps `ref`'s font size down (never up past the CSS size) until its text stops overflowing.
 *
 * BOTH AXES (2026-08-26). This only ever asked whether the text was too TALL, which is the right
 * question for the guest menu's two-line dish-name box. The restaurant's own wordmark in the top
 * bar is the opposite shape — one `nowrap` line that runs out of WIDTH — so the helper saw nothing
 * to do and the name was cut to "little French …" on a 320px phone. Asking both questions makes
 * the same promise ("a name is never cut") true for a name of either shape, and it can only help
 * the dish names: a single word wider than its card used to be clipped and now shrinks instead.
 */
export function useFitText<T extends HTMLElement = HTMLDivElement>(text: string, minPx = 11) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const fit = () => {
      // Always start from the stylesheet's own size, so a re-fit after the card grows can go back
      // UP again — otherwise a name shrunk on a phone would stay small after rotating to landscape.
      el.style.fontSize = "";
      const full = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(full) || full <= 0) return;

      // Nothing to do for the common case — one layout read and out.
      // The HEIGHT test keeps its 1px slack (a wrapped box is measured in whole lines, so a stray
      // pixel means nothing). The WIDTH test must NOT: both numbers are rounded to whole pixels, so
      // a single pixel over is a real overflow — and on a `nowrap` line one pixel is all it takes
      // for the browser to draw the "…". Measured: the wordmark stopped at 99 against 98 and still
      // read "little French hou…". No slack here.
      const overflows = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth;
      if ((el.clientHeight === 0 && el.clientWidth === 0) || !overflows()) return;

      // Binary search between the floor and the full size for the largest size that fits.
      let lo = minPx;
      let hi = full;
      let best = minPx;
      for (let i = 0; i < 5 && hi - lo > 0.4; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (overflows()) hi = mid;
        else { best = mid; lo = mid; }
      }
      el.style.fontSize = `${best.toFixed(2)}px`;

      // VERIFY WHAT WE ACTUALLY APPLIED, then step down until it truly fits.
      // The search above records a size as "fits" from a measurement taken at that moment, but the
      // box is clamped to whole LINES — one extra wrap is a whole 20px — so a size that measured
      // fine can stop fitting after something re-wraps the text (a webfont swapping in is the usual
      // culprit: the element's box never changes, so no ResizeObserver fires, and the old code left
      // one name per screen still cut). Measured 1 of 59 names on the iPad, the phone AND desktop.
      // A handful of 0.5px steps costs nothing and makes "never cut" actually true.
      let guard = 12;
      while (overflows() && guard-- > 0) {
        best -= 0.5;
        if (best < minPx) { best = minPx; el.style.fontSize = `${minPx}px`; break; }
        el.style.fontSize = `${best.toFixed(2)}px`;
      }
      // If even the floor cannot hold it (an extraordinarily long name in a very narrow card),
      // leave it at the floor and let the box's own overflow rule handle the remainder — the
      // alternative is text spilling over the price and the buttons.
    };

    // Fit after the browser has painted, so we measure the real box and not a half-built one.
    raf = requestAnimationFrame(fit);

    // …and again once the webfonts have swapped in. A font change alters how the text wraps WITHOUT
    // changing the element's box, so ResizeObserver never hears about it — this is the one signal
    // that catches it. Cheap: it resolves once per page load.
    let cancelled = false;
    try {
      document.fonts?.ready.then(() => { if (!cancelled) { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); } });
    } catch { /* no Font Loading API — the rAF fit above still stands */ }

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      // Re-fit when THIS name's box changes width (column count, rotation, a font finishing load).
      // Guarded by an rAF so a resize storm coalesces into one measurement.
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(fit);
      });
      ro.observe(el);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [text, minPx]);

  return ref;
}
