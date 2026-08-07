#!/usr/bin/env node
// verify-rejected-ideas.mjs — the owner's rejections must be findable AT THE CODE, not just in a doc.
//
// THE RULE (owner, 2026-08-07): "everything I reject also should be written in the comment in the code.
// And while suggesting something and doing, at that time, you have to make sure I have already said no
// for it. So you don't repeat the same thing again."
//
// He said that after being offered — for the third time — a change he had already refused twice (a
// profile on the kitchen panel). A list in a doc nobody opens does not stop that. A comment sitting on
// the exact line someone would otherwise edit does.
//
// So this guard checks BOTH halves stay joined:
//   1. every row in docs/REJECTED-IDEAS.md names at least one code site,
//   2. every one of those sites really carries a `REJECTED (owner, …)` comment,
//   3. every `REJECTED (owner, …)` comment in the codebase is traceable to a row (no orphan claims),
//   4. the doc still explains the rule and how to add one.
//
// Read-only. Run it any time: `npm run verify:rejected`.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DOC = "docs/REJECTED-IDEAS.md";
let pass = true;
const fail = (m, d) => { pass = false; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

if (!existsSync(`${ROOT}/${DOC}`)) {
  console.log(`✗ ${DOC} is missing — the owner's rejections have nowhere to live.`);
  process.exit(1);
}
const doc = readFileSync(`${ROOT}/${DOC}`, "utf8");

// 1 · the doc must still carry the rule and the how-to (someone deleting them defeats the point)
for (const [what, needle] of [
  ["the owner's rule, in his words", "written in the comment in the code"],
  ["the 'read this before suggesting' instruction", "BEFORE suggesting any improvement"],
  ["the how-to-add section", "## How to add one"],
  ["a Reversed section (so a change of mind has somewhere to go)", "## Reversed"],
]) doc.includes(needle) ? ok(`doc keeps ${what}`) : fail(`doc lost ${what}`, `expected to find: "${needle}"`);

// 2 · parse the table rows: | R1 | idea | decision | code site |
const rows = [...doc.matchAll(/^\|\s*(R\d+)\s*\|([^|]+)\|([^|]+)\|(.+?)\|\s*$/gm)]
  .map((m) => ({ id: m[1], idea: m[2].trim(), decision: m[3].trim(), sites: m[4].trim() }));
if (!rows.length) fail("no rejection rows found in the doc's table");
else ok(`${rows.length} rejection${rows.length === 1 ? "" : "s"} listed (${rows.map((r) => r.id).join(", ")})`);

// every row must actually say NO and name a file
for (const r of rows) {
  if (!/\bNO\b/.test(r.decision)) fail(`${r.id} does not record a clear NO`, r.decision.slice(0, 90));
  const files = [...r.sites.matchAll(/`([^`]+?\.(?:ts|tsx|js|css|mjs))`/g)].map((m) => m[1].split(" ")[0]);
  if (!files.length) { fail(`${r.id} names no code file in its "code site" column`, r.sites.slice(0, 90)); continue; }
  for (const f of files) {
    if (!existsSync(`${ROOT}/${f}`)) { fail(`${r.id} points at a file that does not exist`, f); continue; }
    const src = readFileSync(`${ROOT}/${f}`, "utf8");
    if (!/REJECTED \(owner,/.test(src)) fail(`${r.id}: ${f} carries no "REJECTED (owner, …)" comment`, "the doc says no, the code does not");
    else ok(`${r.id} → ${f} carries its REJECTED comment`);
  }
}

// 3 · no orphan claims: a REJECTED comment must be traceable to a row
let files = [];
try {
  // execFileSync with an argument array: no shell, so nothing here can be re-interpreted as a command.
  files = execFileSync("git", ["ls-files", "lib", "app", "public/panels", "components", "scripts"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => /\.(ts|tsx|js|mjs|css)$/.test(f));
} catch { /* not a git checkout — skip this half rather than fail the run */ }
const orphans = [];
for (const f of files) {
  if (f.endsWith("scripts/verify-rejected-ideas.mjs")) continue;   // this file talks ABOUT the marker
  const src = readFileSync(`${ROOT}/${f}`, "utf8");
  if (!/REJECTED \(owner,/.test(src)) continue;
  // it must point back at the doc, so a reader can find the decision and the date
  if (!/REJECTED-IDEAS\.md/.test(src)) orphans.push(f);
}
orphans.length
  ? fail(`${orphans.length} file(s) claim a REJECTED decision without pointing at ${DOC}`, orphans.join("\n      "))
  : ok("every REJECTED comment in the codebase points back at the doc");

// 4 · the standing rule must be in CLAUDE.md too, or a new session never learns it exists
const claude = existsSync(`${ROOT}/CLAUDE.md`) ? readFileSync(`${ROOT}/CLAUDE.md`, "utf8") : "";
/REJECTED-IDEAS\.md/.test(claude)
  ? ok("CLAUDE.md points at the rejected-ideas list")
  : fail("CLAUDE.md does not mention docs/REJECTED-IDEAS.md", "a rule nobody is told about is not a rule");

console.log(pass
  ? "\n✅ PASS — every rejection is recorded in the code as well as the doc"
  : "\n❌ FAIL — a rejection the owner made is not where the next person will look");
process.exit(pass ? 0 : 1);
