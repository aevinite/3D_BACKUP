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
import { Linter } from "eslint";

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

// ── THE SAME BUG, THE TWO SHAPES THE SCAN ABOVE CANNOT SEE (sweep #8 T6, 2026-09-03) ─────────
//
// The hand-written scan above answers ONE question — "is a helper declared inside function A being
// called from function B?" — which is exactly the `ordersInGroup` fault it was built for. It is a
// good check and it stays. But "a name that isn't there" has other shapes, and this file's own
// opening paragraph promises to catch them. Two live ones were sitting in the panels on 2026-09-03,
// and this guard was green over both:
//
//   · SAME function, INNER BLOCK. restoreBill() in editor/app.js declared `const _wq` inside a try
//     block and read it after the loop, in the same function. The scan above never looks below the
//     function level, so it saw nothing. Driven on the real panel with the network stubbed: the
//     PATCH goes out, the bill IS restored, and then it throws "_wq is not defined" — on the ONE
//     path where every write had worked. The FAILURE branch toasted correctly, so it spoke up when
//     it went wrong and went silent when it went right. openDishEditModal() had the identical fault.
//
//   · A DIFFERENT TOP-LEVEL IIFE. maint.js — the settings drawer EVERY staff panel loads — calls
//     `deadline()` from two helpers that sit outside the IIFE where `deadline` is declared. Live
//     since 2026-08-30. Symptom, proved on the running panel: the server answered with a real
//     profile and profileModule:true, LFH_ME.available() still returned false (so "My profile & pay"
//     hides itself), and opening it anyway told a signed-in manager "You are not signed in as a
//     staff member, so there is no profile to show."
//
// So: run ESLint's `no-undef` — the rule that answers this question completely — over every panel
// script. The panels are plain browser <script> files and have never been inside this repo's
// TypeScript or ESLint fences, which is why nothing had ever looked. Still no server, no browser,
// no database. `eslint` is already a devDependency of this repo.
console.log("\nEVERY NAME A PANEL READS IS ACTUALLY THERE\n");
{
  const DIR = join(ROOT, "public/panels");
  // Top level AND one folder down. verify:panel-dialogs read only the top level for a year and
  // walked straight past editor/app.js, the 18,600-line manager panel — the same miss twice.
  // `vendor/` is third-party and minified; Chart.js is a UMD bundle that legitimately reads
  // `module`/`define`, and holding it to this rule would fail forever for no gain.
  const files = [];
  if (existsSync(DIR)) {
    for (const e of readdirSync(DIR, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".js")) files.push(e.name);
      else if (e.isDirectory() && e.name !== "vendor") {
        for (const f of readdirSync(join(DIR, e.name))) if (f.endsWith(".js")) files.push(`${e.name}/${f}`);
      }
    }
  }
  files.sort();
  // The browser's own names, plus what these files genuinely share. Every LFH_*/XRAY_* below is
  // published by a real file in this folder (grep `window.LFH_` there) and read behind a
  // `window.LFH_x &&` guard at its call sites, which is the panels' convention for "may be absent".
  const BROWSER = ["window","document","navigator","location","history","screen","localStorage","sessionStorage","console",
    "fetch","Headers","Request","Response","FormData","File","FileReader","Blob","URL","URLSearchParams","AbortController",
    "AbortSignal","setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame",
    "queueMicrotask","alert","confirm","prompt","print","open","close","focus","blur","postMessage","addEventListener",
    "removeEventListener","getComputedStyle","matchMedia","structuredClone","performance","crypto","CSS","Intl",
    "Notification","Audio","Image","Event","CustomEvent","MessageEvent","MutationObserver","PerformanceObserver",
    "IntersectionObserver","ResizeObserver","ResizeObserverEntry","Element","HTMLElement","Node","NodeList","DOMParser",
    "XMLHttpRequest","WebSocket","EventSource","Worker","Range","TextEncoder","TextDecoder","btoa","atob","scrollTo",
    "scrollBy","getSelection","top","parent","self","frames","name","innerWidth","innerHeight","devicePixelRatio",
    "visualViewport","caches","indexedDB","BroadcastChannel","MediaRecorder","MediaStream","OffscreenCanvas","Path2D",
    "ClipboardItem"];
  const VENDOR = ["Chart", "QRCode", "html2canvas"];
  const LFH = ["LFH_ASK","LFH_AUDITSORT","LFH_BACK","LFH_BELL","LFH_BILLCUST","LFH_BILLDOC","LFH_INV","LFH_ISSUE",
    "LFH_OFF","LFH_OUTBOX","LFH_RT","LFH_UNDO","LFH_WARM","LFH_TAPS","LFH_PRINT","LFH_KOT","LFH_SW","LFH_DEV",
    "XRAY_WHO","XRAY_CONTROLS"];
  // Names that are DELIBERATELY feature-detected, so a bare mention is not a fault:
  // `module`/`exports` — billdoc.js and auditsort.js each end with
  //   `if (typeof module !== "undefined" && module.exports) module.exports = API;`
  //   so a Node guard can import the SAME money and sort rules the browser runs.
  // `confirmDialog`/`promptDialog` — declared by editor/app.js and reached from editor/inventory.js
  //   (which loads first) behind `typeof confirmDialog === "function"`, with a fallback either way.
  const FEATURE_DETECTED = ["module","exports","require","confirmDialog","promptDialog"];
  const globals = Object.fromEntries([...BROWSER, ...VENDOR, ...LFH, ...FEATURE_DETECTED].map((g) => [g, "readonly"]));
  const linter = new Linter();
  let clean = 0;
  for (const f of files) {
    let msgs;
    try {
      msgs = linter.verify(readFileSync(join(DIR, f), "utf8"), {
        languageOptions: { ecmaVersion: 2023, sourceType: "script", globals },
        rules: { "no-undef": "error" },
      });
    } catch (e) {
      // A parse error is a different fault (verify:ui and node --check own it). Say so rather than
      // counting the file as clean — a guard that skips a file it named is the fault this repo has
      // already recorded twice.
      bad(`${f} could not be parsed, so nothing in it was checked`, String(e.message).slice(0, 140));
      continue;
    }
    const undef = msgs.filter((m) => m.ruleId === "no-undef");
    if (!undef.length) { clean++; continue; }
    bad(`${f} reads ${undef.length} name(s) that are not in scope`,
      undef.map((m) => `line ${m.line}: ${m.message}`).join(" · ")
      + "  |  a `const` inside a block is invisible outside it, and reading it throws at RUN time, which no parse check sees");
  }
  if (files.length) ok(`all ${clean} of ${files.length} panel script(s) read only names that are really there`);
  else bad("no panel scripts found at all", DIR);
}

// ── A FIELD READ OFF AN OBJECT NOTHING EVER WRITES TO IT ──────────────────────────────────────
// The narrower half of the same moral, and the second fault found on 2026-09-03. `billsCapped()`
// asked `state.billsRec.today` and `.previous`; loadBillsRecord stores `{ rows, parcels, reach, at }`
// (the route answers `{ rows, parcels, reach }`). Both were undefined every time, so the function
// always answered "no" — and it is the ONE thing that decides whether the Previous-bills search asks
// the server for help. The whole `type=any` branch written for exactly that case in
// app/api/editor/[...path]/route.ts was therefore unreachable: on a day past the route's 500-row
// cap a manager searching for an older bill was told "Nothing matches" and the server was never
// asked. No name is undefined here and nothing throws — which is why it needs its own check.
console.log("\nA PANEL DOES NOT READ A FIELD NOTHING PUTS THERE\n");
{
  const appPath = join(ROOT, "public/panels/editor/app.js");
  if (!existsSync(appPath)) ok("editor/app.js is not in this checkout — nothing to check");
  else {
    const rawApp = readFileSync(appPath, "utf8");
    // The one-pass stripper above blanks comments AND strings, which is right for "who reads this
    // field" (a name in a sentence is not a reference) and wrong for "is this exact line still
    // here" — a string literal is the whole point of that one. So both are kept, and each check
    // reads the one it actually needs.
    const app = strip(rawApp);
    const assign = app.match(/state\.billsRec\s*=\s*\{([^}]*)\}/);
    if (!assign) bad("nothing assigns state.billsRec any more", "the shape check has nothing to compare against");
    else {
      const written = new Set([...assign[1].matchAll(/(^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[2]));
      const read = new Set([...app.matchAll(/\bstate\.billsRec\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
      const bc = (app.match(/function billsCapped\(\)[\s\S]*?\n\}/) || [""])[0];
      for (const m of bc.matchAll(/\br\.([A-Za-z_$][\w$]*)/g)) read.add(m[1]);   // read through its local alias
      const ghosts = [...read].filter((k) => !written.has(k));
      if (ghosts.length) {
        bad(`the panel reads ${ghosts.length} field(s) off state.billsRec that nothing puts there: ${ghosts.join(", ")}`,
          `the one assignment carries { ${[...written].join(", ")} } — anything outside that list is undefined every time, silently`);
      } else {
        ok(`every field read off state.billsRec is one the read really returns (${[...written].join(", ")})`);
      }
    }
    // …and the answer it exists to give must stay reachable.
    if (/BILLS_WINDOW_CAP\s*=\s*500/.test(app)) ok("the bills window's row cap is named once, at the route's own 500");
    else bad("the bills window cap is not declared as 500 any more", "the route limits the bills read to 500 rows");
    if (/ordersViewKey\(\) === "previous" && billsCapped\(\)/.test(rawApp)) ok("the Previous-bills search still asks it before falling back to the server");
    else bad("the Previous-bills search no longer consults billsCapped()", "the route's type=any branch would be unreachable again");
  }
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
