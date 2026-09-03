// verify-panel-names.mjs — a name a panel READS has to exist where it is read.
//
// THE BUG THIS EXISTS FOR (sweep #8, terminal 7, 2026-09-03), found twice in one file and proved
// by loading the panel:
//
//   openDishEditModal() saved a dish's allergy chips and kitchen note, closed the modal, refreshed
//   the floor — and then called `okToast(_wq, "Dish updated")`, where `_wq` was a `const` declared
//   INSIDE the `if (note !== …)` block eleven lines above. A `const` in a block is invisible outside
//   it, so that line threw "_wq is not defined" into the surrounding catch, which told the person
//   **"Couldn't save: _wq is not defined"** about an edit that had already gone through. The same
//   shape sat in restoreBill(), where the throw landed outside every try: a bill came back on the
//   floor and the confirmation sentence never appeared at all.
//
// WHY NOTHING CAUGHT IT. The panels are plain <script> files — no bundler, no import graph, no
// type-checker. `npm run typecheck` does not read them. `verify:panel-scope` (the guard written for
// the ordersInGroup bug in the T5 sweep) only asks whether a name declared inside ONE top-level
// function is read from a DIFFERENT top-level function, and it deliberately skips any name declared
// in several places — `_wq` is declared in fifty of them, so it was skipped by design.
//
// WHAT THIS CHECKS INSTEAD. Every panel script is parsed and its scopes resolved properly (acorn +
// eslint-scope, both already in this repo's tree). Every identifier that is READ and resolves to no
// declaration in any enclosing scope is reported, unless it is a browser built-in, a cross-script
// panel global (LFH_*), or a name this file explicitly allows. That is exactly the set of names
// that throw a ReferenceError the moment the line runs — block scope, a typo, a helper deleted from
// under its caller, all of them.
//
//   · `typeof x` is NOT a read that can throw, so those references are skipped (inventory.js asks
//     `typeof confirmDialog === "function"` on purpose — app.js shares the page's global scope and
//     this file must not assume load order).
//   · A WRITE to an undeclared name is a different, deliberate thing (`window.foo = …` is written
//     as a property; a bare assignment would be an implicit global). Only reads are reported.
//
// Usage: node scripts/verify-panel-names.mjs      (no server, no browser, no database)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import { analyze } from "eslint-scope";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

// Everything a browser hands a classic script. Kept as one flat list rather than pulled from a
// dependency: this guard must keep working with no network and no extra package.
const BROWSER = new Set(`
AbortController AbortSignal ArrayBuffer Array Audio Blob BroadcastChannel Boolean CSS CustomEvent
DOMParser Date Element Error Event File FileReader FormData Function Headers HTMLElement Image
Infinity Intl IntersectionObserver JSON Map Math MediaRecorder MutationObserver NaN Node Notification Number
Object PerformanceObserver Promise Proxy Reflect RegExp Request ResizeObserver Response Set String
Symbol TextDecoder TextEncoder URL URLSearchParams Uint8Array WeakMap WeakSet WebSocket Worker
alert atob btoa caches cancelAnimationFrame clearInterval clearTimeout confirm console crypto
decodeURI decodeURIComponent document encodeURI encodeURIComponent fetch getComputedStyle
getSelection globalThis history indexedDB isFinite isNaN localStorage location matchMedia
navigator open parent parseFloat parseInt performance print prompt queueMicrotask
requestAnimationFrame screen self sessionStorage setInterval setTimeout structuredClone top
undefined window
`.trim().split(/\s+/));

// Names one panel script legitimately reads from ANOTHER script on the same page. Every entry is a
// deliberate cross-file global, not an accident — add to this list only with a reason, because the
// whole point of the guard is that an unexplained name is a fault.
const CROSS_SCRIPT = new Set([
  "Chart",              // vendor/chart.umd.min.js, loaded before every panel that draws one
  "confirmDialog",      // editor/app.js's own dialog, shared with editor/inventory.js on one page
  "toast",              // ditto
  "ridQ",               // ditto — the admin's ?rid= pin
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "vendor") walk(p); continue; }
    if (name.endsWith(".js")) files.push(p);
  }
})(join(ROOT, "public/panels"));
files.sort();

console.log(`\nverify:panel-names — ${files.length} panel scripts\n`);

for (const abs of files) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, "utf8");
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2024, sourceType: "script", locations: true, ranges: true });
  } catch (e) { bad(`${rel} does not parse`, e.message); continue; }
  // acorn does not link a node to its parent, and the `typeof` skip below needs one.
  (function link(node, parent) {
    if (!node || typeof node.type !== "string") return;
    node.__parent = parent;
    for (const k of Object.keys(node)) {
      if (k === "__parent") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => link(c, node));
      else if (v && typeof v === "object" && typeof v.type === "string") link(v, node);
    }
  })(ast, null);
  const sm = analyze(ast, { ecmaVersion: 2024, sourceType: "script" });
  // A top-level `function foo(){}` / `var foo` in a classic script IS a global — eslint-scope keeps
  // those in globalScope.variables, and a reference to one is not undeclared even though it also
  // appears in `through`.
  const tops = new Set(sm.globalScope.variables.map((v) => v.name));
  // A name the file itself asks about with `typeof` is one the AUTHOR has declared may be absent —
  // the UMD tail of billdoc.js / auditsort.js (`typeof module !== "undefined" && module.exports`)
  // and inventory.js's `typeof confirmDialog === "function"` are both deliberate. `typeof` is the
  // one read that cannot throw, so a file that guards a name anywhere has said what it means.
  const guarded = new Set();
  for (const ref of sm.globalScope.through) {
    const par = ref.identifier.__parent;
    if (par && par.type === "UnaryExpression" && par.operator === "typeof") guarded.add(ref.identifier.name);
  }
  const seen = new Map();
  for (const ref of sm.globalScope.through) {
    if (ref.resolved) continue;
    if (!ref.isRead()) continue;                       // a write is a different, deliberate thing
    const n = ref.identifier.name;
    if (BROWSER.has(n) || CROSS_SCRIPT.has(n) || tops.has(n) || guarded.has(n) || /^LFH_/.test(n)) continue;
    // `typeof x` never throws, and this codebase uses it on purpose to ask whether a sibling
    // script is on the page at all.
    const p = ref.identifier.__parent;
    if (p && p.type === "UnaryExpression" && p.operator === "typeof") continue;
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n).push(ref.identifier.loc.start.line);
  }
  if (seen.size) {
    for (const [n, ls] of seen) bad(`${rel}: \`${n}\` is read where nothing declares it`, `line${ls.length > 1 ? "s" : ""} ${ls.join(", ")} — a ReferenceError the moment that line runs`);
  } else {
    ok(`${rel} — every name it reads exists where it is read`);
  }
}

console.log(`\n  ${pass} pass · ${fail} fail\n`);
process.exit(fail ? 1 : 0);
