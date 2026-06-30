import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBrandSegments, stripBrandMarkers, hasBrandMarkers } from "./brandText.ts";

test("splits into plain/highlight alternating segments", () => {
  assert.deepEqual(splitBrandSegments("Demo *Bistro*"), [
    { text: "Demo ", hi: false }, { text: "Bistro", hi: true },
  ]);
  assert.deepEqual(splitBrandSegments("little *French* house"), [
    { text: "little ", hi: false }, { text: "French", hi: true }, { text: " house", hi: false },
  ]);
});

test("no markers => one plain segment", () => {
  assert.deepEqual(splitBrandSegments("Demo Bistro"), [{ text: "Demo Bistro", hi: false }]);
});

test("drops empty segments + tolerates odd markers", () => {
  assert.deepEqual(splitBrandSegments("*Solo*"), [{ text: "Solo", hi: true }]);
  // odd trailing marker: 'a','b' -> a(plain), b(hi)
  assert.deepEqual(splitBrandSegments("a*b"), [{ text: "a", hi: false }, { text: "b", hi: true }]);
  assert.deepEqual(splitBrandSegments(""), []);
});

test("stripBrandMarkers + hasBrandMarkers", () => {
  assert.equal(stripBrandMarkers("Bon *Appetit*"), "Bon Appetit");
  assert.equal(hasBrandMarkers("a*b*c"), true);
  assert.equal(hasBrandMarkers("plain"), false);
});
