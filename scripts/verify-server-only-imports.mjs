#!/usr/bin/env node
// verify:server-only — no "use client" file may reach a SERVER-ONLY module through its imports.
//
// WHY THIS EXISTS (2026-08-06). The owner's Pay Later page went down in production because a
// "use client" component imported one plain-words helper from lib/ownerScope — and lib/ownerScope
// imports lib/supabaseAdmin, which builds a Supabase client with the SERVICE-ROLE key at module
// scope. In a browser that variable does not exist, so the page threw "supabaseKey is required."
// before it rendered a single pixel. The fix was to move the helper to lib/partialRead.ts (no
// imports at all); this guard is what stops the next person re-learning it from a broken page.
//
// Nothing leaked that time — Next.js only inlines NEXT_PUBLIC_* variables, so the key was `undefined`
// (which is precisely why it threw). But "it failed loudly instead of leaking" is luck about which
// variable happened to be involved, not a property of the mistake. A client file that pulls in
// server-only code is a build-shape error and should fail here, not on someone's screen.
//
// HOW: walk the import graph of every "use client" file under app/ and components/, following only
// local `@/...` and relative imports, and fail if any path reaches one of SERVER_ONLY.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
// Modules that must NEVER end up in a browser bundle.
const SERVER_ONLY = [
  "lib/supabaseAdmin",   // the service-role client
  "lib/staffAuth",       // reads ADMIN_PASSWORD
  "lib/userAuth",        // cookie signing secrets
  "lib/alerts",          // ntfy/telegram tokens
];

const SRC_DIRS = ["app", "components"];
const EXTS = [".ts", ".tsx", ".js", ".jsx"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/** Resolve an `@/x` or relative import to a real file path, or null for a package. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;                              // a node package — not ours
  for (const cand of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, "index" + e))]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const importsOf = (file) => {
  const src = readFileSync(file, "utf8");
  const out = [];
  // static imports + `export … from` + dynamic import()
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    let m; while ((m = re.exec(src))) out.push(m[1]);
  }
  return out;
};

const rel = (p) => p.replace(ROOT + "/", "");
const isServerOnly = (p) => SERVER_ONLY.some((s) => rel(p).startsWith(s));

const clientFiles = SRC_DIRS.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : []))
  .filter((f) => {
    const head = readFileSync(f, "utf8").slice(0, 400);
    return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head) || head.includes('"use client"') || head.includes("'use client'");
  });

const bad = [];
for (const entry of clientFiles) {
  // BFS the local import graph, remembering how we got there so the report names the chain.
  const seen = new Set([entry]);
  const queue = [[entry, [rel(entry)]]];
  while (queue.length) {
    const [file, path] = queue.shift();
    for (const spec of importsOf(file)) {
      const target = resolveImport(spec, file);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      const chain = [...path, rel(target)];
      if (isServerOnly(target)) { bad.push(chain); break; }
      queue.push([target, chain]);
    }
  }
}

if (bad.length) {
  console.log(`\n✗ ${bad.length} client file(s) reach a SERVER-ONLY module:\n`);
  for (const chain of bad) console.log("  " + chain.join("\n    → "));
  console.log(`\nA "use client" file's import graph ends up in the browser bundle. Move the shared bit into
its own dependency-free module (lib/partialRead.ts is the worked example) and import THAT from the
client, or mark the consumer as a server component.\n`);
  process.exit(1);
}
// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). This guard finds its own
// subjects by walking a folder. Rename the folder, change the naming convention, or run it from the
// wrong place and the walk returns an EMPTY list — every check then passes because none of them ran,
// and the line above says OK. That is the exact shape verify:cache died in for a month. The floor is
// deliberately well below today's real count, so it never has to be edited when the app grows.
if (clientFiles.length < 40) {
  console.log(`\n✗ verify:server-only found only ${clientFiles.length} client file(s) — this app has over a hundred. Nothing was checked.`);
  process.exit(1);
}
console.log(`✓ ${clientFiles.length} client file(s) checked — none reaches ${SERVER_ONLY.join(", ")}`);
