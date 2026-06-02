"use client";

// This is a fancy 5-star rating picker with a playful animation: tapping a
// star makes the lower stars "dive" up and back down with a happy face, and
// un-picking "crushes" them away. Most of this file is the hand-rolled
// animation maths; a beginner can safely skim it and focus on the comments.
import { useEffect, useRef } from "react";

// We always show 5 stars.
const STAR_COUNT = 5;

// "Easing" functions shape how an animation speeds up and slows down over time.
// They take a progress value t (0 = start, 1 = end) and bend it into a curve.
// easeOutPow: starts fast, eases to a gentle stop.
const easeOutPow = (t: number, p = 2) => 1 - Math.pow(1 - t, p);
// easeInPow: starts slow, then accelerates.
const easeInPow = (t: number, p = 2) => Math.pow(t, p);
// elasticOut: overshoots and wobbles like a spring before settling — the bouncy feel.
const elasticOut = (t: number) => {
  if (t === 0 || t === 1) return t;
  return (
    Math.pow(2, -10 * t) * Math.sin(((t - 0.075) * (2 * Math.PI)) / 0.3) + 1
  );
};

// Shorthand type: an easing function takes progress (0–1) and returns a curve value.
type Ease = (t: number) => number;

// A tiny animation helper. It smoothly changes one CSS custom property (e.g.
// "--y") on an element from `from` to `to` over `dur` milliseconds, using the
// given easing, then calls `cb` when done. The "U" version adds a unit (px/deg).
function tweenU(
  el: HTMLElement,
  prop: string,
  from: number,
  to: number,
  unit: string,
  dur: number,
  ease: Ease,
  delay: number,
  cb?: () => void
) {
  // The moment the animation should actually begin (now + any delay).
  const t0 = performance.now() + delay * 1000;
  // Runs ~60 times a second; each call nudges the property a little further.
  function tick(now: number) {
    const e = now - t0;
    if (e < 0) {
      // Still inside the delay — wait for the next frame.
      requestAnimationFrame(tick);
      return;
    }
    // p = how far along we are, 0 to 1.
    const p = Math.min(e / dur, 1);
    // Set the property to the eased value between `from` and `to`.
    el.style.setProperty(prop, from + (to - from) * ease(p) + unit);
    // Keep going until we reach the end, then fire the optional callback.
    if (p < 1) requestAnimationFrame(tick);
    else if (cb) cb();
  }
  requestAnimationFrame(tick);
}

// Same idea as tweenU but for a unit-less number (e.g. a scale like 1, 0.4).
function tween(
  el: HTMLElement,
  prop: string,
  from: number,
  to: number,
  dur: number,
  ease: Ease,
  delay: number,
  cb?: () => void
) {
  const t0 = performance.now() + delay * 1000;
  function tick(now: number) {
    const e = now - t0;
    if (e < 0) {
      requestAnimationFrame(tick);
      return;
    }
    const p = Math.min(e / dur, 1);
    el.style.setProperty(prop, String(from + (to - from) * ease(p)));
    if (p < 1) requestAnimationFrame(tick);
    else if (cb) cb();
  }
  requestAnimationFrame(tick);
}

// Briefly flashes the little "hole" graphic under a star and squishes it,
// like the star punched through the surface. Fades it back out afterwards.
function punchHole(li: HTMLElement) {
  const hole = li.querySelector<HTMLElement>(".sr-hole");
  if (!hole) return;
  hole.style.opacity = "1";
  let start: number | null = null;
  function anim(ts: number) {
    if (!start) start = ts;
    const p = Math.min((ts - start) / 500, 1);
    const s = elasticOut(p) * 0.85;
    hole!.style.transform = `translateX(-50%) scale(${s}, ${s * 0.55})`;
    if (p < 1) requestAnimationFrame(anim);
    else
      setTimeout(() => {
        hole!.style.transition = "opacity .25s";
        hole!.style.opacity = "0";
        setTimeout(() => (hole!.style.transition = ""), 300);
      }, 200);
  }
  requestAnimationFrame(anim);
}

// The "turn a star ON" animation: the star leaps up, spins, drops down with a
// springy bounce, and lands happy. It's a chain of tweens, each starting when
// the previous one finishes. (You don't need to follow every number — the
// gist is "jump up, flip, bounce down, settle".)
function diveIn(li: HTMLElement, cb?: () => void) {
  const toggle = li.querySelector<HTMLElement>(".sr-toggle");
  if (!toggle) return;
  // Don't start a new animation if this star is already mid-animation.
  if (toggle.dataset.animating === "1") return;
  toggle.dataset.animating = "1";

  // Flash the hole underneath at the same time.
  punchHole(li);

  tweenU(toggle, "--y", 0, -48, "px", 300, easeOutPow, 0, () => {
    toggle.classList.add("sr-round");
    tweenU(toggle, "--y", -48, 50, "px", 320, (t) => t * t, 0, () => {
      li.classList.add("active");
      setTimeout(() => toggle.classList.remove("sr-round"), 80);
      tweenU(toggle, "--y", 50, -60, "px", 400, easeOutPow, 0, () => {
        tweenU(toggle, "--y", -60, 0, "px", 380, easeInPow, 0, () => {
          toggle.classList.add("sr-bottom");
          setTimeout(() => toggle.classList.remove("sr-bottom"), 200);
          tweenU(toggle, "--toggle-y", 0, 3, "px", 180, (t) => t, 0, () => {
            tweenU(toggle, "--toggle-y", 3, 0, "px", 120, (t) => t, 0, () => {
              tween(toggle, "--face-scale", 0.4, 1, 150, (t) => t, 0, () => {
                toggle.dataset.animating = "";
                toggle.style.removeProperty("--toggle-y");
                toggle.style.removeProperty("--face-scale");
                if (cb) cb();
              });
            });
            tween(toggle, "--face-scale", 1, 0.4, 120, (t) => t, 0);
          });
        });
      });
      tween(toggle, "--scale", 0.4, 1, 400, elasticOut, 0);
    });
    tween(toggle, "--scale", 1, 0.4, 320, (t) => t, 0);
  });
  tweenU(toggle, "--rotate", 0, 360, "deg", 1400, (t) => t, 0, () => {
    toggle.style.removeProperty("--rotate");
  });
}

// The "turn a star OFF" animation: the star splits into a top half and bottom
// half that fly apart and fade, then a fresh blank star drops back into place.
// `delay` lets several stars crush out one after another.
function crushOut(li: HTMLElement, delay: number, cb?: () => void) {
  const toggle = li.querySelector<HTMLElement>(".sr-toggle");
  const ct = li.querySelector<HTMLElement>(".sr-crush-top"); // top shard
  const cb2 = li.querySelector<HTMLElement>(".sr-crush-bot"); // bottom shard
  if (!toggle || !ct || !cb2) return;

  // The actual animation body, run now or after the delay below.
  const run = () => {
    const starEl = toggle.querySelector<HTMLElement>(".sr-clip .sr-star");
    if (starEl) starEl.style.opacity = "0";
    ct.style.opacity = "1";
    cb2.style.opacity = "1";
    ct.style.transform = "translate(0,0) rotate(0deg)";
    cb2.style.transform = "translate(0,0) rotate(0deg)";

    let s2: number | null = null;
    function animTop(ts: number) {
      if (!s2) s2 = ts;
      const p = Math.min((ts - s2) / 600, 1);
      const ep = easeOutPow(p, 2);
      ct!.style.transform = `translate(${-14 * ep}px, ${-22 * ep}px) rotate(${-22 * ep}deg)`;
      ct!.style.opacity = String(1 - easeOutPow(p, 1.4));
      if (p < 1) requestAnimationFrame(animTop);
      else ct!.style.opacity = "0";
    }
    requestAnimationFrame(animTop);

    let s3: number | null = null;
    function animBot(ts: number) {
      if (!s3) s3 = ts;
      const p = Math.min((ts - s3) / 600, 1);
      const ep = easeOutPow(p, 2);
      cb2!.style.transform = `translate(${12 * ep}px, ${26 * ep}px) rotate(${22 * ep}deg)`;
      cb2!.style.opacity = String(1 - easeOutPow(p, 1.4));
      if (p < 1) requestAnimationFrame(animBot);
      else {
        cb2!.style.opacity = "0";
        li.classList.remove("active");
        if (starEl) starEl.style.opacity = "";
        toggle!.style.setProperty("--y", "-160px");

        tweenU(toggle!, "--y", -160, 0, "px", 500, easeInPow, 0, () => { 
          toggle!.classList.add("sr-bottom");
          setTimeout(() => toggle!.classList.remove("sr-bottom"), 160);
          toggle!.dataset.animating = "";
          if (cb) cb();
        });
      }
    }
    requestAnimationFrame(animBot);
  };

  // Wait for the stagger delay (if any) before running the crush.
  if (delay > 0) setTimeout(run, delay);
  else run();
}

// Instantly snaps a star to its final on/off look with NO animation. Used to
// tidy up if a click interrupts an in-progress animation, or to match an
// external value change (like a reset). `happy` = should this star be filled?
function settle(li: HTMLElement, happy: boolean) {
  const toggle = li.querySelector<HTMLElement>(".sr-toggle");
  const ct = li.querySelector<HTMLElement>(".sr-crush-top");
  const cb2 = li.querySelector<HTMLElement>(".sr-crush-bot");
  if (!toggle) return;
  toggle.dataset.animating = "";
  toggle.style.setProperty("--y", "0px");
  toggle.style.setProperty("--scale", "1");
  toggle.style.setProperty("--rotate", "0deg");
  toggle.style.removeProperty("--toggle-y");
  toggle.style.removeProperty("--face-scale");
  toggle.classList.remove("sr-round", "sr-bottom");
  const starEl = toggle.querySelector<HTMLElement>(".sr-clip .sr-star");
  if (starEl) starEl.style.opacity = "";
  if (ct) ct.style.opacity = "0";
  if (cb2) cb2.style.opacity = "0";
  if (happy) li.classList.add("active");
  else li.classList.remove("active");
}

// The star-rating component itself. `value` is the current rating (0–5) and
// `onChange` is called with the new number whenever the user picks one.
export default function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // A handle to the <ul> holding the stars.
  const listRef = useRef<HTMLUListElement>(null);
  // Remembers what the stars currently LOOK like, so we can compare against a
  // new `value` and only animate the difference.
  const visualRatingRef = useRef(0);

  // Sets up the hover highlight: hovering a star lights up it and the ones
  // before it; leaving the row clears the highlight. Runs once on mount.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));

    // We collect "remove this listener" functions here for cleanup later.
    const enterHandlers: Array<() => void> = [];
    items.forEach((li, idx) => {
      // When the mouse enters star `idx`, mark stars 0..idx as hovered.
      const onEnter = () => {
        items.forEach((e, i) => {
          if (i <= idx) e.classList.add("hover-on");
          else e.classList.remove("hover-on");
        });
      };
      const toggle = li.querySelector(".sr-toggle");
      toggle?.addEventListener("mouseenter", onEnter);
      enterHandlers.push(() => toggle?.removeEventListener("mouseenter", onEnter));
    });
    // Leaving the whole row clears every highlight.
    const onLeave = () => items.forEach((e) => e.classList.remove("hover-on"));
    list.addEventListener("mouseleave", onLeave);

    // Cleanup: remove all the hover listeners we added.
    return () => {
      enterHandlers.forEach((fn) => fn());
      list.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Sync from prop changes (e.g. external reset to 0 after submit).
  // If something outside changes `value`, snap the stars to match it.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));
    // Already matching what's on screen? Nothing to do.
    if (value === visualRatingRef.current) return;

    // For each star, decide if it should be filled and snap it if it's wrong.
    items.forEach((li, i) => {
      const shouldBeHappy = i < value;
      const isHappy = li.classList.contains("active");
      if (shouldBeHappy !== isHappy) settle(li, shouldBeHappy);
    });
    visualRatingRef.current = value;
  }, [value]);

  // Runs when the user clicks/taps star number `starIdx` (1–5).
  const handleClick = (starIdx: number) => {
    const list = listRef.current;
    if (!list) return;
    // Clicking the rating you already have does nothing.
    if (starIdx === value) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));

    const prev = visualRatingRef.current; // old rating
    const next = starIdx;                 // new rating

    // First, instantly settle any star that's still mid-animation so we start
    // from a clean state.
    items.forEach((e, i) => {
      const toggle = e.querySelector<HTMLElement>(".sr-toggle");
      if (toggle?.dataset.animating === "1") {
        settle(e, i < next);
      }
    });

    visualRatingRef.current = next;

    if (next > prev) {
      // Rating went UP: play the "dive in" animation on each newly-added star,
      // staggered so they cascade.
      items.slice(prev, next).forEach((e, si) => {
        setTimeout(() => diveIn(e), si * 120);
      });
    } else {
      // Rating went DOWN: "crush out" the stars that are no longer selected.
      items.slice(next, prev).forEach((e, si) => {
        const t = e.querySelector<HTMLElement>(".sr-toggle");
        if (!t || t.dataset.animating === "1") return;
        t.dataset.animating = "1";
        crushOut(e, si * 80);
      });
    }
    // Tell the parent component about the new rating.
    onChange(next);
  };

  return (
    <div className="sr-wrap">
      <ul className="sr-rating" ref={listRef}>
        {/* Build the 5 star items. `i` is 0-based, so star number = i + 1. */}
        {Array.from({ length: STAR_COUNT }, (_, i) => (
          // "active" means this star is filled (its index is below the value).
          <li key={i} className={`sr-li ${i < value ? "active" : ""}`}>
            {/* The little "hole" graphic used by the punch animation */}
            <div className="sr-hole"></div>
            {/* The clickable star itself. role/tabIndex/onKeyDown make it
                keyboard-usable: Enter or Space picks it, just like a click. */}
            <div
              className="sr-toggle"
              role="button"
              tabIndex={0}
              aria-label={`Rate ${i + 1} ${i === 0 ? "star" : "stars"}`}
              onClick={() => handleClick(i + 1)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(i + 1);
                }
              }}
            >
              {/* The visible star shape and its little "eye" detail */}
              <div className="sr-clip">
                <div className="sr-star">
                  <div className="sr-eye"></div>
                </div>
              </div>
            </div>
            {/* The two shard halves used by the crush-out animation */}
            <div className="sr-crush-top"></div>
            <div className="sr-crush-bot"></div>
          </li>
        ))}
      </ul>
      {/* The "X / 5" score pill shown next to the stars */}
      <div className="sr-score-pill">
        <span className={`sr-score-num ${value === 0 ? "zero" : ""}`}>
          {value}
        </span>
        <span className="sr-score-out"> / 5</span>
      </div>
    </div>
  );
}
