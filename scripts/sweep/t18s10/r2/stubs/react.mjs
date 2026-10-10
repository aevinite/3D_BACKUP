// A stand-in React for lib/features.ts only (no DOM is installed): useState returns a box a check can
// read; useEffect records its callback so a check runs it — and its cleanup — by hand.
export function useState(init) {
  const box = { v: typeof init === "function" ? init() : init, sets: 0 };
  const set = (x) => { box.v = typeof x === "function" ? x(box.v) : x; box.sets++; };
  globalThis.__t18.hook = { box, set };
  return [box.v, set];
}
export function useEffect(fn, deps) { globalThis.__t18.effect = { fn, deps }; }
const React = { useState, useEffect };
export default React;
