// Shared harness for sweep #8 terminal 5's own checks (ids P58701–P59700).
// Every row in .claude/sweep/LEDGER/T5.md's sweep-#8 section is executed from here, one
// assertion per id, so "re-run P58xxx" is a command anybody can run:
//     node scripts/sweep/t5/static.mjs
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
export const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
export const exists = (f) => fs.existsSync(path.join(ROOT, f));

const results = [];
export function check(id, what, fn) {
  let ok = false, note = "";
  try { const r = fn(); ok = r === true || r === undefined; if (typeof r === "string") { ok = false; note = r; } }
  catch (e) { ok = false; note = String(e && e.message || e).slice(0, 160); }
  results.push({ id, what, ok, note });
  return ok;
}
export function skip(id, what, why) { results.push({ id, what, ok: null, note: why }); }
export function report(label) {
  const bad = results.filter(r => r.ok === false);
  const sk = results.filter(r => r.ok === null);
  for (const r of bad) console.log(`❌ ${r.id}  ${r.what}${r.note ? "  — " + r.note : ""}`);
  for (const r of sk) console.log(`⏭ ${r.id}  ${r.what}  — ${r.note}`);
  console.log(`${label}: ${results.filter(r => r.ok === true).length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭  (${results.length} rows)`);
  // Written OUTSIDE the repo: it is a run artefact, not a deliverable, and .claude/sweep is
  // shared ground other terminals are writing to.
  const out = process.env.T5_RESULTS || path.join(process.env.TMPDIR || "/tmp", "t5-results.json");
  try { fs.writeFileSync(out, JSON.stringify(results, null, 1)); } catch { /* the run still stands */ }
  return bad.length;
}
// Assertion helpers that read like the ledger's own wording.
export const has = (body, re) => re.test(body) || `no match for ${re}`;
export const hasNot = (body, re) => !re.test(body) || `unexpected match for ${re}`;
export const countOf = (body, re) => (body.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
export const eq = (a, b) => a === b || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;

// Strip comments before asserting that something is ABSENT. Half of this sweep's first-pass reds
// were the file's own note quoting the very string the check was proving gone — the repo's own
// "a guard can pass against its own comment" trap, inverted.
export const codeOf = (body) => body
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map(l => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
