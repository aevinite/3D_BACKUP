// scripts/verify-every-script.mjs — EVERY file under scripts/, tests/ and .github/ is checked, one
// row each (sweep #10 T39 round 3, item 85; the owner, 2026-10-10: "covering all the area within your
// boundaries like every single bit of area"). Reads only — it sends nothing and writes no data.
//
//   npm run verify:every-script                 # exits 1 if any file fails, naming it and why
//   node scripts/verify-every-script.mjs --out <rows.json> [--hands-off <list.txt>]   # the sweep's rows
//
// Per file, by kind:
//   code (.mjs/.js/.cjs/.ts) — it loads (node --check, or TypeScript's own parse for .ts); every
//     relative / "@/" import names a file that exists; every repo path it names in a plain string
//     exists (skipping templated paths); no name it uses is undefined (node + browser globals);
//     zero lint warnings; it never READS the client stack's keys file (naming the client project
//     only to refuse it is allowed and noted); a script that writes data names a way it cleans up.
//   .json — parses.   .yml/.yaml — parses.   .sh — `bash -n` parses.   anything else — readable text.
// A file another live session is editing (--hands-off) is still checked, and its result says so.
//
// WHAT "NAMES A WAY IT CLEANS UP" CAN AND CANNOT SEE. It is a word test: a file that writes and
// contains none of restoreOnExit / cleanup / teardown / DELETE / cancelled / finally … is a ❌. A file
// that contains one of those words for another reason (a Z-report check that talks about cancelled
// bills) passes it without proving its clean-up runs. The rules in verify:test-safety are the ones
// that prove specific put-backs; this one only stops a writer that has no clean-up AT ALL.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const ts = require("typescript");
const yaml = require("js-yaml");
const { Linter, ESLint } = require("eslint");
const globals = require("globals");
const espree = require("espree");
const PAGE_WRAPPERS = new Set(["inPanel", "inPanelAsync", "inFrame", "runInPanel", "panelEval"]);
const PAGE_CALLS = new Set(["evaluate", "evaluateHandle", "evaluateAll", "waitForFunction", "addInitScript", "$eval", "$$eval", "exposeBinding"]);
const argv = process.argv.slice(2);
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const HANDS = argv.includes("--hands-off") ? new Set(readFileSync(argv[argv.indexOf("--hands-off") + 1], "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) : new Set();
const files = execFileSync("git", ["ls-files", "scripts", "tests", ".github"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

const linter = new Linter();
const undefCfg = [{ languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser, ...globals.es2021, ...globals.serviceworker } }, rules: { "no-undef": "error" } }];
const eslint = new ESLint({ cwd: ROOT });
const codeFiles = files.filter((f) => /\.(mjs|js|cjs|ts)$/.test(f));
const lintRes = await eslint.lintFiles(codeFiles);
const warn = Object.fromEntries(lintRes.map((r) => [r.filePath.slice(ROOT.length + 1), r.messages.map((m) => `${m.line}:${m.ruleId || "directive"}`)]));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const exists = (p) => { try { return existsSync(p); } catch { return false; } };
const resolveImport = (from, spec) => {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(join(ROOT, from)), spec);
  for (const c of [base, base + ".ts", base + ".tsx", base + ".mjs", base + ".js", base + ".json", join(base, "index.ts"), join(base, "index.js")]) if (exists(c) && statSync(c).isFile()) return true;
  return false;
};
const REPO_PATH = /["'`]((?:app|lib|components|scripts|public|supabase|docs|tests|\.github|\.claude\/sweep\/LEDGER)\/[\w./@[\]-]+\.(?:ts|tsx|mjs|js|cjs|json|sql|md|css|html|yml|png|webp|glb))["'`]/g;
const WRITES = /method:\s*["'](POST|PATCH|DELETE|PUT)["']|\.from\(\s*["'`]\w+["'`]\s*\)\s*\.(insert|update|upsert|delete)\(|\bdb\(\s*["'`]\w+["'`]\s*,\s*\{\s*method/;
const CLEANS = /restoreOnExit|retire\w*\(|cleanup|clean[A-Z_]|\.delete\(|method:\s*["']DELETE["']|deleted_at|cancelled|finally\s*\{|restore\w*\(|putBack|teardown|undo/i;
// Files that name a path ON PURPOSE that does not exist — each one read, with the reason. A NEW
// missing path in any file (these included) is still a ❌.
const EXPLAINED_MISSING = {
  ".github/scripts/verify-doc-counts.mjs": { paths: ["lib/printPair.ts", "components/AdminSwitcher.tsx", "app/api/print-station/[file]/route.ts", "lib/printStation.ts", "docs/FLOOR-TIMEOUT-WATCH.md"], why: "its list of RETIRED files, kept so no rulebook points at them again" },
  "scripts/sweep/t2/s9r2-checks.mjs": { paths: ["app/view/[folder]/not-found.tsx"], why: "asserts that file deliberately does NOT exist" },
  "scripts/sweep/t5/round2-sabotage.mjs": { paths: ["@/components/MiniCartTypo"], why: "a sabotage tool — the broken name is the planted break" },
  "scripts/verify-access-model.mjs": { paths: ["../node_modules/.cache/accessTree.mjs", "../node_modules/.cache/staffCaps.mjs"], why: "imports files its own npm entry bundles into node_modules/.cache just before it runs" },
  "scripts/verify-kitchen-screen.mjs": { paths: ["./sweep/t9/"], why: "a folder prefix — the file name is built at run time (./sweep/t9/<module>.mjs)" },
  "scripts/verify-print-helper.mjs": { paths: ["app/pair/page.tsx", "app/api/pair/route.ts"], why: "asserts the retired pairing route is GONE" },
};
// …and this file, whose list above names every one of those paths.
EXPLAINED_MISSING["scripts/verify-every-script.mjs"] = { paths: Object.values(EXPLAINED_MISSING).flatMap((e) => e.paths), why: "its own list of paths that are meant not to exist" };
// Files that WRITE and name no clean-up — each one read on 2026-10-10, with why that is right. A
// file NOT listed here that writes and names no clean-up is still a ❌. Two kinds:
//   · a TOOL whose whole job is to change data, run by hand on purpose (a seed, a migration, a
//     password reset) — undoing its own write would defeat it;
//   · a CHECK whose "write" changes nothing: the server refuses it, it goes to an in-memory stub or a
//     local fake server, or it is a POST that only ASKS the database a question.
const TOOL = "a tool whose job IS to change data, run by hand on purpose — undoing its write would defeat it";
const ASKS = "its POSTs go to the database's query endpoint and only read (no INSERT/UPDATE/DELETE in its SQL)";
const EXPLAINED_WRITES = {
  "scripts/agent-run-record.mjs": TOOL,
  "scripts/apply-migration-avlive.mjs": TOOL,
  "scripts/apply-migration-prod.mjs": TOOL,
  "scripts/compare-schemas.mjs": ASKS,
  "scripts/copy-demo-to-prod.mjs": TOOL,
  "scripts/db-maintain.mjs": TOOL,
  "scripts/fetch-fix-requests.mjs": TOOL,
  "scripts/live-fix-watcher/watch.mjs": TOOL,
  "scripts/reseal-handover-passwords.mjs": TOOL,
  "scripts/reset-diag-password.mjs": TOOL,
  "scripts/reset-prod-owner-pw.mjs": TOOL,
  "scripts/resolve-fix-request.mjs": TOOL,
  "scripts/run-migration.mjs": TOOL,
  "scripts/seed-aangan.mjs": TOOL,
  "scripts/seed-owner-dev.mjs": TOOL,
  "scripts/set-access-defaults.mjs": TOOL,
  "scripts/set-glb-cache.mjs": TOOL,
  "scripts/stress-max.mjs": TOOL,
  "scripts/stress.mjs": TOOL,
  "scripts/verify-db-parity.mjs": ASKS,
  "scripts/verify-guest-pass-private.mjs": ASKS,
  "scripts/verify-heatmap-live.mjs": ASKS,
  "scripts/verify-order-line-keys.mjs": ASKS,
  "scripts/verify-rid-required.mjs": ASKS,
  "scripts/verify-settings-columns.mjs": ASKS,
  "scripts/sweep/t29r2/lib.mjs": ASKS,
  "scripts/sweep/t32/db.mjs": ASKS,
  "scripts/verify-outbound-honesty.mjs": "its one POST names a random restaurant id that can never exist, so the update matches nothing (asserted 409)",
  "scripts/verify-outbox-drain.mjs": "every POST goes to its own local http server or is aborted by page.route — nothing reaches the app",
  "scripts/verify-t24b-live.mjs": "every write is one the server refuses (400/409) — read-only by construction, as its header says",
  "scripts/sweep/t3/s9-checks.mjs": "each POST is shaped to be refused (bad table, 201 lines, no token, junk body) and asserts the refusal",
  "scripts/sweep/t27r2/d-settings.mjs": "its settings saves are undone by the harness's whole-row snapshot; table 1's QR code is put back by itself (item 80)",
  "scripts/t17-harness/u-close-last.mjs": "hermetic — the route runs in-process against the in-memory stub (./sb.mjs), wiped before each check",
  "scripts/t17-harness/u-close-profile.mjs": "hermetic — the route runs in-process against the in-memory stub (./sb.mjs), wiped before each check",
  "scripts/t17-harness/u-profile.mjs": "hermetic — the route runs in-process against the in-memory stub (./sb.mjs), wiped before each check",
  "tests/net-retry.test.mjs": "drives the panel file with a stubbed fetch — nothing is sent anywhere",
  "tests/order-totals.e2e.mjs": "its one POST calls lfh_price_order, a read-only pricing function that creates no order",
};
const rows = [];
for (const f of files) {
  const abs = join(ROOT, f), ext = extname(f), issues = [], notes = [];
  let src = "";
  try { src = readFileSync(abs, "utf8"); } catch { issues.push("unreadable"); }
  if (/\.(mjs|js|cjs)$/.test(f)) {
    if (spawnSync(process.execPath, ["--check", f], { cwd: ROOT }).status !== 0) issues.push("does not parse");
  } else if (ext === ".ts") {
    const out = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    if ((out.diagnostics || []).length) issues.push("TypeScript cannot parse it: " + ts.flattenDiagnosticMessageText(out.diagnostics[0].messageText, " "));
  } else if (ext === ".json") { try { JSON.parse(src); } catch { issues.push("not valid JSON"); } }
  else if (ext === ".yml" || ext === ".yaml") { try { yaml.load(src, { schema: yaml.JSON_SCHEMA }); } catch { issues.push("not valid YAML"); } }
  else if (ext === ".sh") { if (spawnSync("bash", ["-n", f], { cwd: ROOT }).status !== 0) issues.push("bash cannot parse it"); }
  if (/\.(mjs|js|cjs|ts)$/.test(f) && !issues.length) {
    const code = stripComments(src);
    const imps = [...code.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'`]((?:\.\.?\/|@\/)[^"'`$]+)["'`]/g)].map((m) => m[1]);
    const badImp = [...new Set(imps.filter((s) => !resolveImport(f, s)))];
    const meantImp = EXPLAINED_MISSING[f];
    const badImpLeft = badImp.filter((p) => !(meantImp && meantImp.paths.includes(p)));
    if (badImpLeft.length) issues.push("imports a file that does not exist: " + badImpLeft.join(", "));
    if (meantImp && badImp.length) notes.push(meantImp.why);
    const paths = [...new Set([...code.matchAll(REPO_PATH)].map((m) => m[1]).filter((p) => !/\*|\$\{/.test(p)))];
    const missing = paths.filter((p) => !exists(join(ROOT, p)) && !/zz|planted|fixture|example|does-not-exist|nope|missing/i.test(p));
    // A name that is MEANT not to exist — each read in its file on 2026-10-10 and recorded with why.
    const meant = EXPLAINED_MISSING[f];
    const unexplained = missing.filter((p) => !(meant && meant.paths.includes(p)));
    if (unexplained.length) issues.push("names a repo file that does not exist: " + unexplained.slice(0, 4).join(", "));
    if (meant && missing.length) notes.push(meant.why);
    if (ext !== ".ts") {
      // A name used INSIDE a function handed to the browser (page.evaluate, waitForFunction,
      // addInitScript …) belongs to the page — a staff panel's `state`, `render`, `okToast` — not to
      // this script. Only an undefined name OUTSIDE such a function is this file's own mistake.
      const msgs = linter.verify(src, undefCfg, { filename: f }).filter((m) => m.ruleId === "no-undef");
      let pageRanges = [];
      const STRINGIFIES = /\.toString\(\)|String\(\w+\)/.test(src) && /new\s+(?:\w+\.)?Function\(/.test(src);
      try {
        const ast = espree.parse(src, { ecmaVersion: "latest", sourceType: "module", range: true, loc: true });
        const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(walk); return; } if (typeof n.type !== "string") return;
          if (n.type === "CallExpression") {
            const c = n.callee, name = c.type === "MemberExpression" && !c.computed ? c.property.name : c.type === "Identifier" ? c.name : "";
            if (PAGE_CALLS.has(name) || PAGE_WRAPPERS.has(name)) for (const a of n.arguments) if (/Function/.test(a.type)) pageRanges.push([a.loc.start.line, a.loc.end.line]);
          }
          // A file that turns functions into TEXT and runs them in the page (fn.toString() → new
          // Function in the panel's window) keeps them in tables: those literals are page code too.
          if (STRINGIFIES && n.type === "ArrayExpression") for (const e of n.elements) if (e && /Function/.test(e.type)) pageRanges.push([e.loc.start.line, e.loc.end.line]);
          for (const k of Object.keys(n)) if (k !== "range" && k !== "loc") walk(n[k]); };
        walk(ast);
      } catch { pageRanges = []; }
      const inPage = (m) => pageRanges.some(([a, b]) => m.line >= a && m.line <= b);
      const own = msgs.filter((m) => !inPage(m)).map((m) => (m.message.match(/'([^']+)'/) || [])[1]);
      const pageNames = [...new Set(msgs.filter(inPage).map((m) => (m.message.match(/'([^']+)'/) || [])[1]))];
      if (own.length) issues.push("uses names it never defines: " + [...new Set(own)].slice(0, 6).join(", "));
      if (pageNames.length) notes.push(`uses ${pageNames.length} name(s) of the page it drives, inside browser-side code — e.g. ${pageNames.slice(0, 3).join(", ")}`);
    }
    // A sweep worktree is TEMPORARY — removed when its sweep ends. A tool that names one by its
    // absolute path works for a week and then throws ENOENT before its first check: six did
    // (wt-s7-t3, wt-s8-t13, wt-s9-t29 — sweep #10 T39 item 87). Read the checkout the file lives in.
    const worktrees = [...new Set([...code.matchAll(/["'`]\/Users\/[^"'`]*\/Projects\/(wt-[\w-]+)/g)].map((m) => m[1]))];
    if (worktrees.length) issues.push("names a temporary worktree folder by its full path: " + worktrees.join(", "));
    if ((warn[f] || []).length) issues.push(`${warn[f].length} lint warning(s): ${warn[f].slice(0, 3).join(", ")}`);
    // A release, parity or schema-compare tool reads the client stack's keys ON PURPOSE — it is run by
    // hand, asked-first, never by a sweep. Anything else that reads them is a ❌.
    const CLIENT_TOOL = /release|avlive|parity|db-grants|compare-schemas/i.test(f);
    const readsKeys = /readFileSync\([^)]*\.env\.AV\.live|["'`][^"'`]*\.env\.AV\.live["'`]\s*\)/.test(code);
    if (readsKeys && !CLIENT_TOOL) issues.push("reads the client stack's keys file");
    if (/\.env\.AV\.live|kclqkmdxnwlhtyrducku/.test(code)) notes.push(CLIENT_TOOL ? "reads the client stack — a release/parity/compare tool, run by hand, never by a sweep" : "names the client project only to refuse it");
    if (WRITES.test(code)) {
      if (CLEANS.test(code)) notes.push("writes data and names its clean-up");
      else if (EXPLAINED_WRITES[f] === ASKS && /\b(insert\s+into|delete\s+from|update\s+\w+\s+set|truncate|drop\s+table)\b/i.test(code)) issues.push("listed as only asking the database, but its SQL now changes data");
      else if (EXPLAINED_WRITES[f]) notes.push(EXPLAINED_WRITES[f]);
      else issues.push("writes data but names no clean-up");
    }
  }
  const hands = HANDS.has(f) || [...HANDS].some((h) => h.endsWith("/") && f.startsWith(h));
  rows.push({ band: "K", file: f,
    check: `\`${f}\` — ${/\.(mjs|js|cjs|ts)$/.test(f) ? "loads, its imports and named files exist, no undefined name, 0 lint warnings, never reads the client keys, cleans up what it writes" : ext === ".json" ? "is valid JSON" : /\.ya?ml$/.test(f) ? "is valid YAML" : ext === ".sh" ? "bash can parse it" : "is readable"}`,
    how: "node --check / TypeScript parse · import + path resolution · eslint no-undef + lint · source scan",
    result: issues.length ? "❌" : "✅",
    note: (issues.length ? issues.join(" · ") : "all clear") + (notes.length ? ` (${notes.join("; ")})` : "") + (hands ? " — being edited by another live session right now" : "") });
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.result === "❌");
for (const r of bad) console.log("❌", r.file, "—", r.note.slice(0, 300));
console.log(bad.length
  ? `\n${bad.length} of ${rows.length} files in scripts/, tests/ and .github/ have a problem (listed above).`
  : `✅ verify-every-script — all ${rows.length} files in scripts/, tests/ and .github/ load, name only real files, define every name they use, carry no lint warning, and clean up what they write.`);
process.exitCode = bad.length ? 1 : 0;
