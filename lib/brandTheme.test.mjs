import { test } from "node:test";
import assert from "node:assert/strict";
import { isHexColor, hexToRgbTriplet, sanitizeBrandTheme, buildModeBlock } from "./brandTheme.ts";

test("isHexColor accepts #rgb and #rrggbb, rejects junk", () => {
  assert.equal(isHexColor("#fff"), true);
  assert.equal(isHexColor("#1a0f09"), true);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor("#12g"), false);
  assert.equal(isHexColor(""), false);
  assert.equal(isHexColor("javascript:alert(1)"), false);
});

test("hexToRgbTriplet expands shorthand", () => {
  assert.equal(hexToRgbTriplet("#fff"), "255, 255, 255");
  assert.equal(hexToRgbTriplet("#000000"), "0, 0, 0");
  assert.equal(hexToRgbTriplet("nope"), null);
});

test("sanitizeBrandTheme keeps only valid hex, drops junk", () => {
  const out = sanitizeBrandTheme({ dark: { bg: "#111", text: "notacolor", accent: "#e3c06f" }, light: { card: "#fff" }, junk: 1 });
  assert.deepEqual(out, { dark: { bg: "#111", accent: "#e3c06f" }, light: { card: "#fff" } });
});

test("buildModeBlock emits vars + derives accent + uses fallback", () => {
  const css = buildModeBlock("dark", { bg: "#101010", text: "#eee" }, "#e3c06f");
  assert.match(css, /--bg:\s*#101010/);
  assert.match(css, /--text:\s*#eee/);
  assert.match(css, /--accent:\s*#e3c06f/);   // fell back
  assert.match(css, /--accent-grad:/);
  assert.equal(buildModeBlock("dark", {}, undefined), "");  // nothing to emit
});
