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
// --hook: Claude Code PostToolUse mode (owner, 2026-08-17: *"you will run that automatically set
// it like that"*). It reads the tool-call JSON on stdin, does nothing at all unless a file under
// public/panels/ was just edited, and then RE-STAMPS the versions itself instead of printing a
// command for somebody to remember. Re-stamping is the whole of the fix and it cannot be wrong —
// the version IS the file's content hash, so writing it is copying a number, not a judgement.
// It derives the checkout root from the edited file's path, so it is correct inside a worktree.
const argv = process.argv.slice(2);
const HOOK = argv.includes("--hook");
const KNOWN = new Set(["--fix", "--repo", "--hook"]);
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
let ROOT = repoArg ? resolve(repoArg) : join(dirname(fileURLToPath(import.meta.url)), "..");
if (HOOK) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const file = String(payload?.tool_input?.file_path || payload?.tool_response?.filePath || "").replace(/\\/g, "/");
  if (!/\/public\/panels\//.test(file)) process.exit(0);          // not our business
  const cut = file.indexOf("/public/panels/");
  if (cut > 0) ROOT = file.slice(0, cut);
}
if (!existsSync(join(ROOT, "public", "panels"))) {
  console.error(`verify-panel-cache: no public/panels under ${ROOT}`);
  process.exit(2);
}
const FIX = argv.includes("--fix") || HOOK;   // --hook always fixes; see the note above
const PANELS = join(ROOT, "public", "panels");

const hashOf = (file) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);

// every panel's index.html
const pages = readdirSync(PANELS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PANELS, d.name, "index.html")))
  .map((d) => ({ panel: d.name, file: join(PANELS, d.name, "index.html") }));

// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). This guard finds its own
// subjects by walking a folder. Rename the folder, change the naming convention, or run it from the
// wrong place and the walk returns an EMPTY list — every check then passes because none of them ran,
// and the line above says OK. That is the exact shape verify:cache died in for a month. The floor is
// deliberately well below today's real count, so it never has to be edited when the app grows.
// Three panels have an index.html today — editor, kitchen, tablet (public/panels/vendor is a shared
// library folder, not a panel). Two would mean the walk lost one.
if (pages.length < 3) {
  console.error(`✗ verify:panel-cache found only ${pages.length} panel(s) with an index.html under public/panels — there are three. Nothing was checked.`);
  process.exit(1);
}
let stale = 0, checked = 0, fixed = 0;
const problems = [];

for (const page of pages) {
  let html = readFileSync(page.file, "utf8");
  const before = html;

  // src="…" / href="…" pointing at a local .js or .css, with or without an existing ?v=
  html = html.replace(/((?:src|href)=")([^"]+?\.(?:js|css))(\?v=[^"]*)?(")/g, (m, pre, path, ver, post) => {
    // OUR OWN VENDORED FILES ARE VERSIONED LIKE EVERYTHING ELSE (owner, 2026-08-18). This used to
    // skip anything under /vendor/, so the charts library's `?v=4.4.7` was a label somebody TYPED and
    // nothing could tell you whether it still matched the file. A remote URL is genuinely not ours to
    // stamp; a file we generate and commit is, and its content hash is the only version that cannot
    // quietly become a lie. The semantic version now lives in package.json + the generated banner.
    if (/^https?:/i.test(path)) return m;                                    // remote: not ours to stamp
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
  if (HOOK) process.exit(0);                       // nothing to say when nothing moved
  if (checked < 20) {
    console.error(`✗ verify:panel-cache read only ${checked} versioned asset(s) out of three panels — there are dozens. The index.html files parsed to nothing, so nothing was checked.`);
    process.exit(1);
  }
  console.log(`✓ all ${checked} panel assets carry their own content hash — no browser can be left on a stale file`);
  process.exit(0);
}
if (HOOK) {
  // Say what was re-stamped so the editing session sees it, and exit 0 — this is a repair, not a
  // complaint, and it must never interrupt the edit that triggered it.
  console.log(`panel cache: re-stamped ${stale} version string(s) so no staff device serves a stale file:`);
  for (const p of problems) console.log(`  ${p}`);
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
