// Shared harness for sweep #8 terminal 7 (ids P60701–P61700).
// Territory: public/panels/editor/app.js from line ~9,300 to the end, public/panels/editor/
// inventory.js, and public/panels/floor-layouts.js.
//
//     node scripts/sweep/t7/static.mjs      · the code-reading half
//     node scripts/sweep/t7/live.mjs        · the watched half (a real browser)
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
export const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
export const exists = (f) => fs.existsSync(path.join(ROOT, f));

const results = [];
export function check(id, what, fn) {
  let ok = false, note = "";
  try { const r = fn(); ok = r === true || r === undefined; if (typeof r === "string") { ok = false; note = r; } }
  catch (e) { ok = false; note = String((e && e.message) || e).slice(0, 200); }
  results.push({ id, what, ok, note });
  return ok;
}
export function skip(id, what, why) { results.push({ id, what, ok: null, note: why }); }
export function report(label) {
  const bad = results.filter((r) => r.ok === false);
  const sk = results.filter((r) => r.ok === null);
  for (const r of bad) console.log(`❌ ${r.id}  ${r.what}${r.note ? "  — " + r.note : ""}`);
  for (const r of sk) console.log(`⏭ ${r.id}  ${r.what}  — ${r.note}`);
  console.log(`\n${label}: ${results.filter((r) => r.ok === true).length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭   (${results.length} rows)\n`);
  const out = process.env.T7_RESULTS || path.join(process.env.TMPDIR || "/tmp", "t7-results.json");
  try { fs.writeFileSync(out, JSON.stringify(results, null, 1)); } catch { /* the run still stands */ }
  return bad.length;
}

export const has = (body, re) => re.test(body) || `no match for ${re}`;
export const hasNot = (body, re) => !re.test(body) || `unexpected match for ${re}`;
export const countOf = (body, re) => (body.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
export const eq = (a, b) => a === b || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;
export const atLeast = (n, k, what) => n >= k || `only ${n} ${what}, wanted ${k}`;

// ── STRIPPING COMMENTS, THE ONLY WAY THAT IS ACTUALLY RIGHT ──────────────────────────────────
// Not two .replace() calls. A `/*` inside a `//` line, or a `//` inside a string, makes a
// naive stripper eat real code — that trap once hid 190 lines from two shipped guards in this
// repo, and the "block comments first" ordering is the half that gets it wrong. One pass, in
// the states a JS file actually has, with every newline kept so line numbers still mean
// something. Same design as scripts/verify-panel-scope.mjs, which was written for it.
export function codeOf(src) {
  let out = "", i = 0;
  const n = src.length;
  const keep = (c) => (out += c);
  const hide = (c) => (out += c === "\n" ? "\n" : " ");
  const beforeRegex = /[([{=,:;!&|?+\-*%~^]$|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
  const tmpl = [];
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") hide(src[i++]); continue; }
    if (c === "/" && c2 === "*") { hide(src[i++]); hide(src[i++]); while (i < n && !(src[i] === "*" && src[i + 1] === "/")) hide(src[i++]); hide(src[i++] || ""); hide(src[i++] || ""); continue; }
    if (c === '"' || c === "'") { const q = c; keep(src[i++]); while (i < n && src[i] !== q) { if (src[i] === "\\") keep(src[i++]); if (i < n) keep(src[i++]); } keep(src[i++] || ""); continue; }
    if (c === "`") { keep(src[i++]); tmpl.push(true); while (i < n && tmpl.length) { if (src[i] === "\\") { keep(src[i++]); keep(src[i++]); continue; } if (src[i] === "`") { keep(src[i++]); tmpl.pop(); break; } if (src[i] === "$" && src[i + 1] === "{") { keep(src[i++]); keep(src[i++]); let d = 1; while (i < n && d) { if (src[i] === "{") d++; else if (src[i] === "}") d--; if (!d) break; keep(src[i++]); } keep(src[i++] || ""); continue; } keep(src[i++]); } continue; }
    if (c === "/") { const before = out.replace(/\s+$/, ""); if (beforeRegex.test(before)) { keep(src[i++]); while (i < n && src[i] !== "/") { if (src[i] === "\\") keep(src[i++]); if (src[i] === "[") { while (i < n && src[i] !== "]") keep(src[i++]); } keep(src[i++]); } keep(src[i++] || ""); continue; } }
    keep(src[i++]);
  }
  if (out.split("\n").length !== src.split("\n").length) throw new Error("codeOf: stripping lost a line");
  return out;
}

// The half of editor/app.js this terminal owns: line 9,300 to the end. A check that means
// "somewhere in MY half" asserts against this, not against the whole file — otherwise a match in
// terminal 6's half would make a row about my half pass for the wrong reason.
export function tail(src, from = 9300) { return src.split("\n").slice(from - 1).join("\n"); }
