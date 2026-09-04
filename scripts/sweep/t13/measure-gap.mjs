// What in this territory do the EXISTING ledger rows never mention? That list, not a fresh idea,
// is what a new block of checks should be aimed at.
import { readFileSync, readdirSync } from "node:fs";
const L = "/Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/LEDGER/";
const rows = readdirSync(L).filter((f) => /^T.*\.md$/.test(f))
  .flatMap((f) => readFileSync(L + f, "utf8").split("\n").filter((l) => /^\|\s*P\d{5,6}\s*\|/.test(l)));
const haystack = rows.join("\n").toLowerCase();

const files = {
  page: "app/owner/page.tsx",
  layout: "app/owner/layout.tsx",
  marketing: "app/owner/marketing/page.tsx",
  online: "app/owner/online/page.tsx",
  analytics: "app/api/owner/analytics/route.ts",
  overview: "app/api/owner/overview/route.ts",
};
const named = new Map();   // name -> where
const add = (n, where) => { if (n && n.length > 2 && !named.has(n)) named.set(n, where); };

for (const [key, f] of Object.entries(files)) {
  const t = readFileSync(f, "utf8");
  // identifiers this territory DEFINES
  for (const m of t.matchAll(/\b(?:const|let|function|type)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], key);
  // CSS class selectors it styles
  for (const m of t.matchAll(/\.((?:ow2|owr|owd|own|hq|rv|adm|owx)[\w-]*)/g)) add(m[1], key + ":css");
  // the literal strings it puts on screen (a sentence a person reads)
  for (const m of t.matchAll(/"([A-Z][^"\\]{12,80})"/g)) add(m[1], key + ":copy");
  // the query parameters and payload fields the routes read
  for (const m of t.matchAll(/sp\.get\("([\w]+)"\)/g)) add("?" + m[1], key + ":param");
  for (const m of t.matchAll(/sb\.rpc\("([\w]+)"/g)) add(m[1], key + ":rpc");
}

const covered = [], uncovered = [];
for (const [n, where] of named) {
  const needle = n.toLowerCase();
  (haystack.includes(needle) ? covered : uncovered).push({ n, where });
}
console.log(`named things in this territory: ${named.size}`);
console.log(`  already mentioned by SOME existing ledger row: ${covered.length}`);
console.log(`  mentioned by NO row at all:                   ${uncovered.length}`);
const byWhere = {};
for (const u of uncovered) (byWhere[u.where] ??= []).push(u.n);
for (const [w, ns] of Object.entries(byWhere).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n── ${w} (${ns.length}) ──`);
  console.log("   " + ns.join(" · ").slice(0, 2400));
}
