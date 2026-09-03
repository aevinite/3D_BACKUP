// Shared harness for sweep #8 terminal 8 — the manager panel's HOST page and shell.
// Territory: app/manager/**, app/editor/**, public/panels/editor/index.html,
// components/PanelFrame.tsx, lib/safeAreaBridge.ts.
//
// Every row in .claude/sweep/LEDGER/T8.md's sweep-#8 section is executed from here, one
// assertion per id, so "re-run P61xxx" is a command anybody can run:
//     node scripts/sweep/t8/static.mjs
//     node scripts/sweep/t8/rerun-old.mjs
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

/** Async twin of check(): awaits the body, so a live/browser assertion is really executed. */
export async function checkA(id, what, fn) {
  let ok = false, note = "";
  try { const r = await fn(); ok = r === true || r === undefined; if (typeof r === "string") { ok = false; note = r; } }
  catch (e) { ok = false; note = String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 200); }
  results.push({ id, what, ok, note });
  return ok;
}
export function skip(id, what, why) { results.push({ id, what, ok: null, note: why }); }
export function note(id, what, text) { results.push({ id, what, ok: true, note: text }); }
export function report(label) {
  const bad = results.filter((r) => r.ok === false);
  const sk = results.filter((r) => r.ok === null);
  for (const r of bad) console.log(`❌ ${r.id}  ${r.what}${r.note ? "  — " + r.note : ""}`);
  for (const r of sk) console.log(`⏭ ${r.id}  ${r.what}  — ${r.note}`);
  console.log(`${label}: ${results.filter((r) => r.ok === true).length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭  (${results.length} rows)`);
  // Written OUTSIDE the repo: a run artefact, not a deliverable, and .claude/sweep is shared
  // ground other terminals write to.
  const out = process.env.T8_RESULTS || path.join(process.env.TMPDIR || "/tmp", `t8-${label.replace(/\W+/g, "-")}.json`);
  try { fs.writeFileSync(out, JSON.stringify(results, null, 1)); } catch { /* the run still stands */ }
  return bad.length;
}
export const results_ = results;

// Assertion helpers that read like the ledger's own wording.
export const has = (body, re) => re.test(body) || `no match for ${re}`;
export const hasNot = (body, re) => !re.test(body) || `unexpected match for ${re}`;
export const countOf = (body, re) =>
  (body.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
export const eq = (a, b) => a === b || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;
export const before = (body, a, b) => {
  const ia = body.indexOf(a), ib = body.indexOf(b);
  if (ia < 0) return `"${a}" is not in the file at all`;
  if (ib < 0) return `"${b}" is not in the file at all`;
  return ia < ib || `"${a}" (${ia}) is NOT before "${b}" (${ib})`;
};

// Strip comments before asserting that something is ABSENT — half of a sweep's first-pass reds
// are the file's own note quoting the very string the check was proving gone.
// LINE comments first, then block comments: a `/*` that only ever appears inside a `//` line
// otherwise swallows everything to the next `*/` (the repo's own scar, ledger 2026-09-02).
export const codeOf = (body) => body
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");
// HTML comments — the same trap, for index.html.
export const htmlCodeOf = (body) => body.replace(/<!--[\s\S]*?-->/g, " ");
