// Round 2's extra harness: it RUNS the territory's own functions instead of reading them.
//
// Round 1 was mostly "does the code say X". That found real faults, but it cannot tell you what a
// function DOES with a hostile input — and 623 of the 967 named things in these 40 files were
// never mentioned by a round-1 row at all. So round 2 lifts each pure function out of its file by
// name and calls it, which is the only way a check can be wrong about the code rather than about
// its own regex.
import { read } from "./lib.mjs";
import ts from "typescript";

// The file is stripped of its TYPES by the real TypeScript compiler, which this repo already
// depends on. A hand-rolled stripper was tried first and mangled `let v: number, suf: string;` on
// its second function — a check that has to out-parse tsc is a check about its own parser.
const jsCache = new Map();
function asJs(file) {
  if (!jsCache.has(file)) {
    jsCache.set(file, ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      fileName: file,
    }).outputText);
  }
  return jsCache.get(file);
}

/**
 * Lift a named function (or arrow const) out of a source file and make it callable.
 *
 * `deps` is an object of anything the function closes over — imported helpers, constants — so the
 * lifted copy behaves exactly like the real one instead of throwing on a missing name. Anything
 * NOT passed is deliberately left undefined: a check that has to stub half a file is testing its
 * own stubs, and is better written as a live check.
 */
export function lift(file, name, deps = {}) {
  const src = /\.tsx?$/.test(file) ? asJs(file) : read(file);
  const starts = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`),
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?[(<]`),
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?function`),
  ];
  let i = -1;
  for (const re of starts) { const m = src.match(re); if (m && m.index !== undefined) { i = m.index; break; } }
  if (i < 0) throw new Error(`no function named ${name} in ${file}`);
  // Walk to the end of the DECLARATION, which comes in two shapes and both have to be handled.
  // A brace-bodied function ends at its matching `}`. An expression-bodied arrow
  // (`const isPanelHost = (p) => /re/.test(p) || …;`) has no brace of its own, and looking for one
  // walks straight into the NEXT declaration — which is how the first version of this lifted
  // `isPanelHost` together with the whole component below it. It ends at the first `;` outside
  // any bracket instead.
  let end = -1, depth = 0, inStr = null, esc = false, arrow = -1, sawBody = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && src[k + 1] === "/") { k = src.indexOf("\n", k); if (k < 0) break; continue; }
    if (c === "/" && src[k + 1] === "*") { k = src.indexOf("*/", k) + 1; continue; }
    if (c === "(" || c === "[") { depth++; continue; }
    if (c === ")" || c === "]") { depth--; continue; }
    if (c === "{") {
      if (depth === 0 && (arrow < 0 || !sawBody)) {
        // the function's own body — balance it and stop at its close
        let d2 = 0, s2 = null, e2 = false;
        for (let j = k; j < src.length; j++) {
          const d = src[j];
          if (s2) { if (e2) e2 = false; else if (d === "\\") e2 = true; else if (d === s2) s2 = null; continue; }
          if (d === '"' || d === "'" || d === "`") { s2 = d; continue; }
          if (d === "/" && src[j + 1] === "/") { j = src.indexOf("\n", j); if (j < 0) break; continue; }
          if (d === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j) + 1; continue; }
          if (d === "{") d2++; else if (d === "}") { d2--; if (d2 === 0) { end = j + 1; break; } }
        }
        break;
      }
      depth++; continue;
    }
    if (c === "}") { depth--; continue; }
    if (c === "=" && src[k + 1] === ">" && depth === 0) { arrow = k; sawBody = /^\s*\{/.test(src.slice(k + 2)); continue; }
    if (c === ";" && depth === 0 && arrow > -1) { end = k + 1; break; }
  }
  if (end < 0) throw new Error(`${name}'s body does not close`);
  const body = src.slice(i, end).replace(/^export\s+/, "");
  const keys = Object.keys(deps);
  const fn = new Function(...keys, `${body}\nreturn ${name};`);
  return fn(...keys.map((k) => deps[k]));
}

/** Every CSS class name a component actually renders, so a dead one can be asked about. */
export function renderedClasses(body) {
  const out = new Set();
  for (const m of body.matchAll(/className=\{?["'`]([^"'`{}]+)["'`]/g))
    for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]{2,}$/.test(c)) out.add(c);
  for (const m of body.matchAll(/className=\{`([^`]*)`\}/g))
    for (const c of m[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^[a-z][\w-]{2,}$/.test(c)) out.add(c);
  for (const m of body.matchAll(/\.className\s*=\s*["'`]([^"'`]+)["'`]/g))
    for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]{2,}$/.test(c)) out.add(c);
  return [...out];
}
