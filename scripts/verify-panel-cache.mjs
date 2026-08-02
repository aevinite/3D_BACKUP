// verify-panel-cache.mjs — every panel asset's ?v= must match the file's CONTENT.
//
//   npm run verify:panel-cache          # check (fails if any tag is stale)
//   npm run verify:panel-cache -- --fix # rewrite every ?v= to the file's current hash
//
// WHY (a real bug, 2026-08-01). Two manager devices reported
// `Uncaught ReferenceError: col is not defined @ app.js:8069` — a crash that could NOT happen in
// the deployed file, because the served app.js has no such code. They were running a STALE app.js.
//
// The panels do cache-bust, with a hand-typed string: `app.js?v=20260730billcust`. But the string
// is only as good as somebody remembering to change it, and nobody had: editor/app.js had been
// modified by at least SIX merged PRs since that `?v=` was last touched (back in #561). The URL
// never changed, so browsers kept serving what they already had — and `vercel.json` gives panel
// assets `max-age=300, stale-while-revalidate=86400`, so a stale copy can legitimately be served
// for a DAY. Staff can therefore run a manager panel that is weeks old, never receive a fix, and
// file error reports for bugs that were fixed long ago (which is exactly what happened, and what
// sent me looking for a `col` that does not exist).
//
// THE FIX IS TO REMOVE THE JUDGEMENT. The version is now the file's own content hash, so "did I
// remember to bump it?" is not a question anyone has to answer: if the file changed, the hash
// changed, and this check says so and prints the exact value. `--fix` writes them all.
//
// Vendor files are skipped — their ?v= is the library's real version (fa 6.5.1, chart 4.4.7) and
// that is more useful to a human than a hash.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --repo <path>: check ANOTHER checkout (a worktree, the AV live folder) instead of this one.
// It used to be ignored in silence, which is worse than not existing: on 2026-08-02 a release was
// checked with --repo, the flag was dropped, THIS repo was checked instead, it passed, and the
// other checkout still had a panel pointing at a stale version. A guard that reports on a tree
// you did not ask about is a guard that lies, so an unknown flag now stops the run.
const argv = process.argv.slice(2);
const KNOWN = new Set(["--fix", "--repo"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--repo") { i++; continue; }          // its value
  if (a.startsWith("-") && !KNOWN.has(a)) {
    console.error(`verify-panel-cache: I don't know the flag "${a}" — refusing to run and report on the wrong thing.`);
    process.exit(2);
  }
}
const repoArg = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : null;
if (argv.includes("--repo") && !repoArg) { console.error("verify-panel-cache: --repo needs a path."); process.exit(2); }
const ROOT = repoArg ? resolve(repoArg) : join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(ROOT, "public", "panels"))) {
  console.error(`verify-panel-cache: no public/panels under ${ROOT}`);
  process.exit(2);
}
const FIX = argv.includes("--fix");
const PANELS = join(ROOT, "public", "panels");

const hashOf = (file) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);

// every panel's index.html
const pages = readdirSync(PANELS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PANELS, d.name, "index.html")))
  .map((d) => ({ panel: d.name, file: join(PANELS, d.name, "index.html") }));

let stale = 0, checked = 0, fixed = 0;
const problems = [];

for (const page of pages) {
  let html = readFileSync(page.file, "utf8");
  const before = html;

  // src="…" / href="…" pointing at a local .js or .css, with or without an existing ?v=
  html = html.replace(/((?:src|href)=")([^"]+?\.(?:js|css))(\?v=[^"]*)?(")/g, (m, pre, path, ver, post) => {
    if (/^https?:/i.test(path) || path.includes("/vendor/")) return m;      // third-party: leave alone
    // resolve the URL to a file on disk: "/panels/x/y.js" is absolute, "app.js" is relative
    const onDisk = path.startsWith("/")
      ? join(ROOT, "public", path.replace(/^\//, ""))
      : resolve(dirname(page.file), path);
    if (!existsSync(onDisk)) return m;                                       // not ours to version
    checked++;
    const want = `?v=${hashOf(onDisk)}`;
    if (ver === want) return m;
    stale++;
    problems.push(`${page.panel}/index.html → ${path}  has ${ver || "(no version)"}, content says ${want}`);
    return pre + path + want + post;
  });

  if (FIX && html !== before) { writeFileSync(page.file, html); fixed++; }
}

if (!stale) {
  console.log(`✓ all ${checked} panel assets carry their own content hash — no browser can be left on a stale file`);
  process.exit(0);
}
if (FIX) {
  console.log(`updated ${stale} version string(s) across ${fixed} page(s):`);
  for (const p of problems) console.log(`  ${p}`);
  console.log("\nRe-run without --fix to confirm.");
  process.exit(0);
}
console.error(`${stale} panel asset(s) are cached under a version that no longer matches the file:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(`
A browser that already has one of these will keep serving the OLD file — vercel.json allows a stale
panel asset for up to 24h (stale-while-revalidate=86400). That is how two devices ran a manager panel
whose bug had already been fixed, and reported a crash in code that no longer exists.

Fix it with:  npm run verify:panel-cache -- --fix`);
process.exit(1);
