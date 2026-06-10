// tests/money.test.mjs — unit tests for the pure money helpers.
// Run with: npm run test:money  (plain `node --test`, no extra dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { niceUsd, snapToStep, displayAmount, minorRound } from "../lib/money.mjs";

test("niceUsd lands on confident menu endings (.00/.50/.99)", () => {
  assert.equal(niceUsd(4.29), 4.5);
  assert.equal(niceUsd(2.99), 2.99);
  assert.equal(niceUsd(6.49), 6.5);
  assert.equal(niceUsd(0), 0);
  assert.equal(niceUsd(NaN), 0);
});

test("INR display snaps to nearest 10", () => {
  // 6.50 USD * 84 = 546 -> 550 ; 4.99 * 84 = 419.16 -> 420 ; 2.99 * 84 = 251.16 -> 250
  assert.equal(displayAmount(6.5, 84, 10), 550);
  assert.equal(displayAmount(4.99, 84, 10), 420);
  assert.equal(displayAmount(2.99, 84, 10), 250);
});

test("2-decimal currencies snap to cents (no behavior change)", () => {
  assert.equal(displayAmount(6.5, 1, 0.01), 6.5);
  assert.equal(displayAmount(6.5, 0.92, 0.01), 5.98);
});

test("snapToStep is exact for fractional steps (no float dust)", () => {
  assert.equal(snapToStep(5.979999, 0.01), 5.98);
  // 545.0001 / 10 = 54.50001 -> rounds to 55 -> 550 (midpoint-and-above goes up)
  assert.equal(snapToStep(545.0001, 10), 550);
});

test("minorRound rounds tax to the currency's minor unit", () => {
  assert.equal(minorRound(27.5, 1), 28);       // INR tax: whole rupees
  assert.equal(minorRound(0.275, 0.01), 0.28); // USD tax: cents
});
