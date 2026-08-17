// verify-panel-scope.mjs — a panel helper must exist where the code that calls it can see it.
//
// THE BUG THIS EXISTS FOR (T5 sweep, 2026-08-17), found on the manager panel and proved live:
//
//   renderEditor() declared `const ordersInGroup = …` INSIDE its Bills branch. printIssuingInvoice(),
//   11,000 lines below and at the top level, called it. So pressing 🖨 Print bill on a live bill
//   card issued a real tax-invoice number and then threw "ordersInGroup is not defined" — inside a
//   click handler nobody awaits, so NOTHING printed and NOTHING was said. The manager pressed it
//   again and was asked "This invoice was voided. Re-issuing assigns a NEW number — why?", which
//   burned a second number off the restaurant's series for a bill that had never printed once.
//
// A `const` in a block is invisible outside it, and nothing in this repo would have said so: the
// panels are plain <script> files, so there is no bundler, no import graph and no type-checker to
// notice. The only symptom is a throw at the moment a person taps something.
//
// WHAT IT CHECKS. For each panel app.js: every name declared ONCE, inside a top-level function,
// and never declared at the top level, must not be referenced from a DIFFERENT top-level function.
// Names declared in several functions are ordinary locals (close, render, wrap…) and are skipped —
// each of those functions has its own.
//
// It also guards the OTHER thing that class of bug hides behind: a browser-driving guard in
// scripts/ that clicks a bare `[data-tab="…"]`. Since the T12 phone sweep the panel writes
// `document.body.dataset.tab`, so `<body>` matches that selector FIRST — the click lands in the
// middle of the floor, opens the take-order builder over everything, and every check after it
// fails for a reason that has nothing to do with the product. It had silently killed
// verify:merged-floor (26 checks) and verify:void-party (13) for weeks.
//
// Usage: node scripts/verify-panel-scope.mjs      (no server, no browser, no database)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

// Comments and strings are stripped before anything is counted: a name inside a comment (this file
// is full of them) or inside a template literal is not a reference, and counting one would make the
// guard cry wolf — which is how a guard stops being read.
// A one-pass scanner, not a pile of regexes. The first cut of this was five .replace() calls and
// it was WRONG in a way that would have made the guard useless: the line-comment rule ate from the
// `//` of a "https://…" string to the end of the line, which left an unterminated quote, which let
// the string rule swallow whole blocks of real code — `function renderList()` among them. So the
// source is walked once, in the states a JS file actually has (code · line comment · block comment
// · '…' · "…" · `…` with its ${…} holes · /regex/), and everything that is not code is replaced by
// spaces. Newlines are always kept, so a line number here is the line number in the file.
function strip(src) {
  let out = "", i = 0;
  const n = src.length;
  const keep = (c) => (out += c);
  const hide = (c) => (out += c === "\n" ? "\n" : " ");
  // What may sit before a `/` that starts a REGEX (rather than a division). Without this,
  // /[&<>"']/ opens a string and the file falls apart again.
  const beforeRegex = /[([{=,:;!&|?+\-*%~^]$|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
  const tmpl = [];               // template-literal depth stack for ${ … } holes
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") hide(src[i++]); continue; }
    if (c === "/" && c2 === "*") { hide(src[i++]); hide(src[i++]); while (i < n && !(src[i] === "*" && src[i + 1] === "/")) hide(src[i++]); hide(src[i++] || ""); hide(src[i++] || ""); continue; }
    if (c === '"' || c === "'") { const q = c; hide(src[i++]); while (i < n && src[i] !== q) { if (src[i] === "\\") hide(src[i++]); hide(src[i++]); } hide(src[i++] || ""); continue; }
    if (c === "`") {
      hide(src[i++]);
      while (i < n) {
        if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; }
        if (src[i] === "`") { hide(src[i++]); break; }
        if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; } // the hole IS code
        hide(src[i++]);
      }
      continue;
    }
    if (c === "}" && tmpl.length) {                       // leaving a ${ … } hole → back into the literal
      tmpl.pop(); keep(src[i++]);
      while (i < n) {
        if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; }
        if (src[i] === "`") { hide(src[i++]); break; }
        if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; }
        hide(src[i++]);
      }
      continue;
    }
    if (c === "/") {
      const before = out.replace(/\s+$/, "");
      if (beforeRegex.test(before)) {                     // a regex literal
        hide(src[i++]);
        let cls = false;
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; }
          if (src[i] === "[") cls = true;
          else if (src[i] === "]") cls = false;
          else if (src[i] === "/" && !cls) { hide(src[i++]); break; }
          hide(src[i++]);
        }
        continue;
      }
    }
    keep(src[i++]);
  }
  if (out.split("\n").length !== src.split("\n").length) {
    throw new Error("verify-panel-scope: stripping lost a line — the line numbers below would be wrong");
  }
  return out;
}

// The top-level functions, by line range. The panels are written with every top-level function
// starting at column 0 and closing with a `}` at column 0, which is what makes this exact.
function topFunctions(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}/.test(lines[j])) { end = j; break; }
      if (/^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(lines[j])) break; // unbalanced — give up on this one
    }
    // Its PARAMETERS are declarations too: openDishEditModal(itemId, rerender) calls rerender(),
    // which is its own argument and not the `const rerender` some other function happens to hold.
    const params = new Set(((/\(([^)]*)\)/.exec(lines[i]) || [, ""])[1])
      .split(",").map((s) => (/([A-Za-z_$][\w$]*)/.exec(s) || [, ""])[1]).filter(Boolean));
    if (end > 0) { out.push({ name: m[1], from: i, to: end, params }); i = end; }
  }
  return out;
}

const PANELS = ["editor", "tablet", "kitchen"].map((p) => join(ROOT, "public/panels", p, "app.js")).filter(existsSync);
console.log("PANEL SCOPE — can every caller SEE the helper it calls?\n");

for (const file of PANELS) {
  const short = file.slice(ROOT.length + 1);
  const src = strip(readFileSync(file, "utf8"));
  const lines = src.split("\n");
  const fns = topFunctions(lines);
  // Declarations at the top level (column 0) — these are visible everywhere and are never a problem.
  const topNames = new Set();
  lines.forEach((l) => {
    let m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) topNames.add(m[1]);
    m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) topNames.add(m[1]);
  });
  // Declarations INSIDE something (any indentation), with where they were declared.
  //
  // Only HELPERS are considered — a name bound to a function (`const f = (…) =>`, `const f =
  // async (…) =>`, `function f(…)`), because those are the ones another function calls by name.
  // A local VALUE (`const rows = …`) shares a name with half the file and is never the bug; a
  // reference is likewise only counted when it is a CALL and is not a property (`x.slice(`),
  // which is what made the first cut of this guard shout about `name`, `save` and `split`.
  const inner = new Map(); // name -> [line numbers]
  lines.forEach((l, i) => {
    const m = /^\s+(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\()/.exec(l);
    if (!m) return;
    const n = m[1] || m[2];
    if (topNames.has(n)) return;             // also declared at the top level → visible anyway
    if (n.length < 4) return;                // el, ov, fn… — noise, and never a shared helper
    if (!inner.has(n)) inner.set(n, []);
    inner.get(n).push(i);
  });
  const fnAt = (line) => fns.find((f) => line > f.from && line <= f.to);
  let bugs = 0, checked = 0;
  for (const [name, decls] of inner) {
    if (decls.length !== 1) continue;        // an ordinary local, declared afresh in each user
    const owner = fnAt(decls[0]);
    if (!owner) continue;                    // declared in a top-level block, not inside a function
    checked++;
    const re = new RegExp("(?<![.\\w$])" + name.replace(/\$/g, "\\$") + "\\s*\\(");
    for (let i = 0; i < lines.length; i++) {
      if (i === decls[0] || !re.test(lines[i])) continue;
      const here = fnAt(i);
      if (!here || here === owner) continue;
      if (here.params && here.params.has(name)) continue;   // it is that function's own argument
      bugs++;
      bad(`${short}: ${here.name}() calls ${name}(), which only exists inside ${owner.name}()`,
        `line ${i + 1} — it will throw "${name} is not defined" the moment someone taps it`);
      break;
    }
  }
  if (!bugs) ok(`${short}: ${checked} inner helper${checked === 1 ? "" : "s"} checked, none reached from another function`);
}

// ── the guards' own trap: a bare [data-tab=…] now matches <body> ──────────────────────────────
console.log("\nGUARD SELECTORS — a bare [data-tab=…] clicks <body>, not the tab\n");
const badSel = [];
for (const f of readdirSync(join(ROOT, "scripts")).filter((n) => n.endsWith(".mjs"))) {
  const s = readFileSync(join(ROOT, "scripts", f), "utf8");
  const re = /locator\(\s*(['"])\[data-tab=[^)]*?\1\s*\)/g;
  let m;
  while ((m = re.exec(s))) badSel.push(`${f}: ${m[0]}`);
}
if (badSel.length) badSel.forEach((b) => bad("a guard clicks <body> instead of the tab", b));
else ok("every guard that clicks a panel tab scopes the selector (.tab[data-tab=…])");

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
