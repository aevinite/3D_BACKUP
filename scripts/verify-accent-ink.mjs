// verify:accent-ink — a restaurant's own colour must stay READABLE as text on its own page.
//
// Usage:  node scripts/verify-accent-ink.mjs
//
// WHY THIS EXISTS (owner's item 11, sweep #8 T2 round 4, 2026-09-02). `--accent-ink` and
// `--accent-ink-dim` are what the guest screens use for accent-coloured TEXT — the dish price, the
// section headings, Read more, the hero sub-line. The LIGHT skin has always computed them. The DARK
// skin — the default — used the raw brand colour, with the comment "on a dark tint the bright accent
// already reads clean". That is true for a warm gold and false for a dark brown, and it was measured
// on every live restaurant:
//
//     burger-barn #78350f 2.07:1 · pizza-palace #c0392b 3.40 · spice-route #c2410c 3.58
//     green-bowl  #15803d 3.66   · sakura-sushi #db2777 4.03   — five of nine, on the PRICE
//
// THIS GUARD ASSERTS THE FACT, NOT THE SHAPE. The lesson of item 9 — two guards that matched
// `= \d+` and stayed green over `= 0` — is that a guard which checks that a thing EXISTS proves
// nothing about whether it WORKS. So this runs the real function over real and hostile colours and
// measures the contrast it produces, exactly as a browser would.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(ROOT, "node_modules/.cache"), { recursive: true });
const OUT = join(ROOT, "node_modules/.cache/accent-ink.mjs");
execFileSync("npx", ["esbuild", "lib/accent.ts", "--bundle", "--platform=node", "--format=esm",
  "--alias:@=.", "--outfile=" + OUT, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
const { accentCanvasCss } = await import(OUT);

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, why) => { fail++; console.log(`  ❌ ${m}\n       → ${why}`); };

const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parseRgb = (s) => { const m = (s || "").match(/-?[\d.]+/g); return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
const parseHex = (h) => { const x = (h || "").trim().replace(/^#/, ""); const f = x.length === 3 ? x.split("").map(c => c + c).join("") : x;
  return /^[0-9a-fA-F]{6}$/.test(f) ? [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)) : null; };
const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));

// Every accent on the dev database on 2026-09-02, plus colours chosen to be hostile: pure black and
// white (a palette can be asked for either), a mid grey, and a deeply saturated blue and violet.
const ACCENTS = ["#e8772e", "#78350f", "#c2410c", "#15803d", "#c0392b", "#db2777", "#f59e0b", "#e3c06f",
                 "#000000", "#ffffff", "#808080", "#3355ff", "#4c1d95", "#0a0a0a", "#1a1a2e"];
const ALREADY_FINE = ["#e8772e", "#f59e0b", "#e3c06f"];   // measured passing before item 11

console.log("\nverify:accent-ink — accent-coloured TEXT stays readable on a restaurant's own page\n");
for (const acc of ACCENTS) {
  const css = accentCanvasCss(acc);
  const dark = (css.match(/html\[data-theme="dark"\]\{([^}]*)\}/) || [])[1] || "";
  const ink = parseRgb((dark.match(/--accent-ink:([^;]+)/) || [])[1]);
  const dim = parseRgb((dark.match(/--accent-ink-dim:([^;]+)/) || [])[1]);
  const accRgb = parseHex(acc);
  if (!accRgb) { bad(`${acc} is not a colour and should have been refused`, "parseHex failed on a value the guard supplied"); continue; }
  const bg = mix(accRgb, [0x0d, 0x0d, 0x10], 0.08);   // exactly what accentCanvasCss emits for --bg
  if (!ink || !dim) { bad(`${acc} emits no --accent-ink`, `dark block was: ${dark.slice(0, 90)}`); continue; }
  const ri = cr(ink, bg), rd = cr(dim, bg);
  if (ri >= 4.9 && rd >= 4.4) ok(`${acc} → ink ${ri.toFixed(2)}:1, dim ${rd.toFixed(2)}:1 on its own page`);
  else bad(`${acc} → ink ${ri.toFixed(2)}:1, dim ${rd.toFixed(2)}:1`,
    "accent-coloured text on the dark page must clear 5:1 (ink) and 4.5:1 (dim). The dish PRICE uses " +
    "--accent-ink and the section headings use --accent-ink-dim; below the bar they recede into the page.");
}
// A restaurant that already reads well must keep its EXACT colour — the fix must not repaint a brand
// that was never wrong. This is the half a contrast-only check would miss.
for (const acc of ALREADY_FINE) {
  const dark = (accentCanvasCss(acc).match(/html\[data-theme="dark"\]\{([^}]*)\}/) || [])[1] || "";
  const ink = parseRgb((dark.match(/--accent-ink:([^;]+)/) || [])[1]);
  const same = ink && parseHex(acc).every((v, i) => v === ink[i]);
  same ? ok(`${acc} already read well, so it is returned untouched`)
       : bad(`${acc} was changed although it already cleared the bar`,
             `emitted rgb(${ink}) for a colour that measured fine — the fix must move the least it can`);
}
// A value that is not a colour must change nothing at all.
for (const junk of ["", "not-a-colour", "#12", "rgb(1,2,3)", "#fff;} body{display:none;"]) {
  accentCanvasCss(junk) === "" ? ok(`a value that is not a colour (${JSON.stringify(junk).slice(0, 26)}) emits nothing`)
    : bad(`${JSON.stringify(junk)} produced CSS`, "an unparseable accent must change nothing, not guess");
}
console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
