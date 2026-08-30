// lib/money.test.mjs — the DISPLAY half of the money helpers (lib/money.ts).
//
// tests/money.test.mjs already covers lib/money.mjs, the pure arithmetic shared with SQL. This
// covers the TypeScript file beside it, which is what turns a figure into the text on a chart tile —
// and the one rule that matters there is that no code word ever reaches a screen.
//
// WHY IT EXISTS (T25, sweep #7, 2026-08-28). `compactINR` guarded its input with
// `Number(value) || 0`, which catches NaN, null, "" and undefined — all falsy — and lets INFINITY
// through, because Infinity is truthy. So `compactINR(Infinity)` returned "₹InfinityCr", straight
// onto an owner or admin tile. Nothing produces an infinite total today, which is exactly why it
// would have been found by a person and not by a test: it takes one division by a count that
// happened to be zero, upstream, on a screen full of numbers.
//
// Run by `npm run test:units` (which globs lib/*.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactINR, roundTicks } from "./money.ts";

test("compactINR never puts a code word on a screen", () => {
  for (const v of [NaN, Infinity, -Infinity, undefined, null, "", "abc", {}, [], -0]) {
    const out = compactINR(v);
    assert.match(out, /^−?₹/, `compactINR(${String(v)}) = ${out}`);
    assert.doesNotMatch(out, /NaN|Infinity|undefined|null|object|\[/, `compactINR(${String(v)}) = ${out}`);
  }
});

test("compactINR buckets at the Indian thresholds", () => {
  assert.equal(compactINR(0), "₹0");
  assert.equal(compactINR(999), "₹999");
  assert.equal(compactINR(1000), "₹1k");
  assert.equal(compactINR(100000), "₹1L");
  assert.equal(compactINR(10000000), "₹1Cr");
  assert.equal(compactINR(12000000), "₹1.2Cr");
});

// The owner picked this one (item 16, 2026-08-30): the bucket is chosen on the number the label will
// SHOW, not the one we were handed. ₹99,999 read "₹100k" before — right by arithmetic, and not how
// anybody in India reads it. The same shape one bucket up made ₹99,99,999 read "₹100L".
test("compactINR promotes a figure that ROUNDS into the next bucket", () => {
  assert.equal(compactINR(99999), "₹1L");
  assert.equal(compactINR(9999999), "₹1Cr");
  assert.equal(compactINR(-99999), "−₹1L");
});

test("…and promotes nothing that rounds BELOW the boundary", () => {
  assert.equal(compactINR(99449), "₹99.4k");
  assert.equal(compactINR(99500), "₹99.5k");
  assert.equal(compactINR(9950000), "₹99.5L");
  assert.equal(compactINR(100000), "₹1L");        // already a lakh, unchanged
  assert.equal(compactINR(10000000), "₹1Cr");     // already a crore, unchanged
});

test("…and never shows a bucket figure of 100 or more", () => {
  // The fault this fixes, stated as the property rather than as three examples: a label like
  // "100k" or "100L" means the bucket below the one it should have used.
  for (let v = 1; v < 2_00_00_000; v = Math.ceil(v * 1.037)) {
    const out = compactINR(v);
    const m = out.match(/^₹([\d.]+)(k|L|Cr)$/);
    if (m && m[2] !== "Cr") assert.ok(Number(m[1]) < 100, `compactINR(${v}) = ${out}`);
  }
});

test("compactINR keeps a MINUS SIGN, not a hyphen, so a column lines up", () => {
  assert.ok(compactINR(-12000000).startsWith("−"));
  assert.ok(!compactINR(-12000000).startsWith("-"));
});

test("roundTicks refuses an empty or unusable domain, and never draws a lonely axis", () => {
  assert.deepEqual(roundTicks(5, 5), []);
  assert.deepEqual(roundTicks(10, 5), []);
  assert.deepEqual(roundTicks(NaN, 10), []);
  assert.deepEqual(roundTicks(0, Infinity), []);
  for (const max of [10, 100, 1000]) assert.notEqual(roundTicks(0, max, 1).length, 1);
});

test("roundTicks gives an ascending, unique axis inside its domain", () => {
  for (const max of [1, 7, 37, 999, 1234, 1e6, 1e9]) {
    const t = roundTicks(0, max, 6);
    assert.ok(t.length >= 2, `0..${max} gave ${t.length} ticks`);
    assert.equal(t.length, new Set(t).size, `duplicate ticks for 0..${max}`);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `not ascending for 0..${max}`);
    assert.ok(t[t.length - 1] <= max, `a tick above the max for 0..${max}`);
  }
});
