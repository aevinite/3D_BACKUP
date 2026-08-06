#!/usr/bin/env node
// Guard: a console theme token (--adm-* / --ow-*) that is READ but never DECLARED.
//
// `var(--adm-accent, #e8a13c)` looks completely correct in review. If nothing ever declares
// `--adm-accent`, though, the fallback wins EVERY time — so the value is frozen at whichever skin
// the author happened to be looking at, and the other skin gets an unreadable colour. There is no
// build error, no console warning, and no test that can see it.
//
// Found three times now (2026-08-06):
//   · --ink          (PR #632) SVG fill → invalid at computed-value time → pure BLACK on a black card
//   · --adm-accent   10 call sites, LIVE/AUDIT badges at 1.91:1 on the light console
//   · --adm-muted-fg 12 call sites, "window closed" at 2.42:1 on the light console
//
// KNOWN_UNDECLARED below is a deliberate, temporary list: these are backgrounds/borders rather than
// text, so the runtime contrast scan does not flag them, and declaring eight of them unmeasured
// risks regressing the dark console. They should be declared (or their call sites switched to a
// real token) as a measured follow-up — remove each from this list as it is done. Adding a NEW
// undeclared token is what this guard exists to stop.
//
//   node scripts/verify-css-tokens.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KNOWN_UNDECLARED = new Set([
  "--adm-line", "--adm-bad", "--adm-surface", "--adm-muted",
  "--adm-field", "--adm-pop", "--adm-card", "--ow-accent",
]);

const ROOTS = ["app", "components", "public/panels"];
const EXT = /\.(tsx|ts|css|js|html)$/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
const used = new Map();   // token -> Set(file)
const declared = new Set();

for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  for (const m of src.matchAll(/var\(\s*(--(?:adm|ow)-[A-Za-z0-9_-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(f);
  }
  // a declaration in CSS (`--x: v`) or set inline from JS/TSX (`"--x": v` / setProperty("--x", v))
  for (const m of src.matchAll(/(--(?:adm|ow)-[A-Za-z0-9_-]+)\s*(?::|"\s*\]?\s*(?:as string\s*\])?\s*:)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/setProperty\(\s*["'](--(?:adm|ow)-[A-Za-z0-9_-]+)["']/g)) declared.add(m[1]);
}

const missing = [...used.keys()].filter((t) => !declared.has(t) && !KNOWN_UNDECLARED.has(t)).sort();
const fixed = [...KNOWN_UNDECLARED].filter((t) => declared.has(t)).sort();

if (missing.length) {
  console.error(`✗ ${missing.length} console theme token(s) read but never declared — the fallback wins in BOTH skins:\n`);
  for (const t of missing) {
    console.error(`  ${t}`);
    for (const f of [...used.get(t)].slice(0, 4)) console.error(`      ${f}`);
  }
  console.error("\nDeclare it in every skin block in app/globals.css (search for --adm-ok:), or use a token that exists.");
  process.exit(1);
}
if (fixed.length) {
  console.log(`Note: now declared, remove from KNOWN_UNDECLARED in this script: ${fixed.join(", ")}`);
}
console.log(`OK — every --adm-*/--ow-* token that is read is declared (${used.size} read, ${KNOWN_UNDECLARED.size} known-undeclared background tokens still to do).`);
