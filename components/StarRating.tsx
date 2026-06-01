"use client";

import { useEffect, useRef } from "react";

const STAR_COUNT = 5;

const easeOutPow = (t: number, p = 2) => 1 - Math.pow(1 - t, p);
const easeInPow = (t: number, p = 2) => Math.pow(t, p);
const elasticOut = (t: number) => {
  if (t === 0 || t === 1) return t;
  return (
    Math.pow(2, -10 * t) * Math.sin(((t - 0.075) * (2 * Math.PI)) / 0.3) + 1
  );
};

type Ease = (t: number) => number;

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
  const t0 = performance.now() + delay * 1000;
  function tick(now: number) {
    const e = now - t0;
    if (e < 0) {
      requestAnimationFrame(tick);
      return;
    }
    const p = Math.min(e / dur, 1);
    el.style.setProperty(prop, from + (to - from) * ease(p) + unit);
    if (p < 1) requestAnimationFrame(tick);
    else if (cb) cb();
  }
  requestAnimationFrame(tick);
}

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

function diveIn(li: HTMLElement, cb?: () => void) {
  const toggle = li.querySelector<HTMLElement>(".sr-toggle");
  if (!toggle) return;
  if (toggle.dataset.animating === "1") return;
  toggle.dataset.animating = "1";

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

function crushOut(li: HTMLElement, delay: number, cb?: () => void) {
  const toggle = li.querySelector<HTMLElement>(".sr-toggle");
  const ct = li.querySelector<HTMLElement>(".sr-crush-top");
  const cb2 = li.querySelector<HTMLElement>(".sr-crush-bot");
  if (!toggle || !ct || !cb2) return;

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

  if (delay > 0) setTimeout(run, delay);
  else run();
}

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

export default function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const visualRatingRef = useRef(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));

    const enterHandlers: Array<() => void> = [];
    items.forEach((li, idx) => {
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
    const onLeave = () => items.forEach((e) => e.classList.remove("hover-on"));
    list.addEventListener("mouseleave", onLeave);

    return () => {
      enterHandlers.forEach((fn) => fn());
      list.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Sync from prop changes (e.g. external reset to 0 after submit).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));
    if (value === visualRatingRef.current) return;

    items.forEach((li, i) => {
      const shouldBeHappy = i < value;
      const isHappy = li.classList.contains("active");
      if (shouldBeHappy !== isHappy) settle(li, shouldBeHappy);
    });
    visualRatingRef.current = value;
  }, [value]);

  const handleClick = (starIdx: number) => {
    const list = listRef.current;
    if (!list) return;
    if (starIdx === value) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>(".sr-li"));

    const prev = visualRatingRef.current;
    const next = starIdx;

    items.forEach((e, i) => {
      const toggle = e.querySelector<HTMLElement>(".sr-toggle");
      if (toggle?.dataset.animating === "1") {
        settle(e, i < next);
      }
    });

    visualRatingRef.current = next;

    if (next > prev) {
      items.slice(prev, next).forEach((e, si) => {
        setTimeout(() => diveIn(e), si * 120);
      });
    } else {
      items.slice(next, prev).forEach((e, si) => {
        const t = e.querySelector<HTMLElement>(".sr-toggle");
        if (!t || t.dataset.animating === "1") return;
        t.dataset.animating = "1";
        crushOut(e, si * 80);
      });
    }
    onChange(next);
  };

  return (
    <div className="sr-wrap">
      <ul className="sr-rating" ref={listRef}>
        {Array.from({ length: STAR_COUNT }, (_, i) => (
          <li key={i} className={`sr-li ${i < value ? "active" : ""}`}>
            <div className="sr-hole"></div>
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
              <div className="sr-clip">
                <div className="sr-star">
                  <div className="sr-eye"></div>
                </div>
              </div>
            </div>
            <div className="sr-crush-top"></div>
            <div className="sr-crush-bot"></div>
          </li>
        ))}
      </ul>
      <div className="sr-score-pill">
        <span className={`sr-score-num ${value === 0 ? "zero" : ""}`}>
          {value}
        </span>
        <span className="sr-score-out"> / 5</span>
      </div>
    </div>
  );
}
