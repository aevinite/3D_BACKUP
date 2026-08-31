#!/usr/bin/env node
// Guard: `:global(...)` inside a PLAIN <style href=… precedence=…> block is silently dead CSS.
//
// `:global()` is a styled-jsx compile-time construct. Several admin surfaces were deliberately moved
// off styled-jsx to a plain <style href> tag so their CSS ships in the server HTML instead of being
// injected after hydration (AccessTree.tsx, the Access page). In a plain <style> the browser sees
// `:global(...)` as an unknown pseudo-class, treats the selector as invalid, and DROPS THE WHOLE
// RULE — no console warning, no build error, and the file still reads as if the rule were live.
//
// Cost so far (2026-08-06): two separate attempts to darken the Access "All" counter chip on the
// light console both landed in this shape, so the chip stayed at 2.89:1 and the rule never appeared
// in the cascade at all. Found only by reading matched rules with CDP.
//
//   node scripts/verify-dead-css.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Walk the tree directly rather than shelling out to grep — no shell, nothing to quote.
let seen = 0;   // every .tsx the walk reached, not just the ones with a <style href> block
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) { seen++; if (readFileSync(p, "utf8").includes("<style href=")) out.push(p); }
  }
  return out;
}
const files = [...walk("app"), ...walk("components")];

const bad = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // Walk each plain-<style> template literal and look inside only that span, so a legitimate
  // :global() in a *different* <style jsx> block in the same file is not flagged.
  const re = /<style\s+href=[^>]*>\{`/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf("`}", start);
    if (end < 0) continue;
    const block = src.slice(start, end);
    let i = -1;
    while ((i = block.indexOf(":global(", i + 1)) !== -1) {
      // a mention inside a CSS comment is a note about this very trap, not a live selector
      const before = block.lastIndexOf("/*", i);
      if (before !== -1 && block.indexOf("*/", before) > i) continue;
      bad.push({ file: f, line: src.slice(0, start + i).split("\n").length });
    }
    re.lastIndex = end;
  }
}

if (bad.length) {
  console.error(`✗ ${bad.length} :global() inside a plain <style href> block — the browser drops these rules entirely:\n`);
  for (const b of bad) console.error(`  ${b.file}:${b.line}`);
  console.error("\nA plain <style> needs no scoping escape — write the bare selector instead.");
  process.exit(1);
}
// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). This guard finds its own
// subjects by walking a folder. Rename the folder, change the naming convention, or run it from the
// wrong place and the walk returns an EMPTY list — every check then passes because none of them ran,
// and the line above says OK. That is the exact shape verify:cache died in for a month. The floor is
// deliberately well below today's real count, so it never has to be edited when the app grows.
if (seen < 100) {
  console.error(`✗ verify:dead-css reached only ${seen} .tsx file(s) under app/ and components/ — this app has hundreds. Its walk found nothing, so nothing was checked.`);
  process.exit(1);
}
console.log(`OK — no dead :global() rules (${files.length} file(s) with a plain <style href> block).`);
