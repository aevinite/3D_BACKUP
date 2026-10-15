// scripts/sweep/t16s10/mutate.mjs — MUTATION TESTING of my files (sweep #10 T16 round 2).
//
//   node scripts/sweep/t16s10/mutate.mjs [--files=outbox.js,maint.js,…] [--max=60] [--workers=4] [--seed=1] [--json=out]
//
// "Every line ran" (./cov.mjs) says nothing about whether a check would NOTICE that line being wrong.
// So this makes one small deliberate break at a time in a COPY of one file — a comparison flipped, a
// "not" dropped, and/or swapped, true/false swapped, `??` turned into `||` — and runs every check that
// RUNS that file (never the ones that only read its text: a text check "kills" every mutant by noticing
// the text changed, which proves nothing). A break nobody notices SURVIVES; each survivor is either a
// missing check or a line that does nothing, and both are worth knowing.
//
// The real file is never touched: the copy lives in .t16mut/ at the repo root (deleted after; NOT
// under node_modules, where Node refuses to strip TypeScript and every copy would "fail" — the T9
// lesson) and reaches the checks through T16_MUT / T16_MUT_REL (lib.mjs src(), browser.mjs harness,
// routes.mjs + hooks.mjs). A CONTROL — an unchanged copy, same path — must pass first for each file,
// or none of that file's results are reported.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ROOT, MY_FILES, ROUTES } from "./lib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MAX = Number(arg("max", 60)), WORKERS = Number(arg("workers", 4)), SEED = Number(arg("seed", 1)), OUT = arg("json", "");
const SKIP = new Set((arg("skip", "") || "").split(",").filter(Boolean));   // "file:line:col:op" already tried (convergence)
const ALL = [...MY_FILES.map((f) => "public/panels/" + f), ROUTES.health, ROUTES.clientError, ROUTES.maintenance, "lib/maintenance.ts", ROUTES.ownerSettings];
const FILES = arg("files", "") ? arg("files", "").split(",").map((f) => ALL.find((x) => x.endsWith("/" + f) || x === f)).filter(Boolean) : ALL;
// Only suites whose checks RUN the code (no text-reading suites, and none that need a login on the
// live dev server — those run the server's own, unbroken copy and only slow this down).
const SUITES = "node,browser,browser2,new-a,new-b,new-c,new-f,new-g,new-h,new-i,new-j,new-k";
// The route files are also driven by two in-memory guards; they read the broken copy through the same
// loader (routes.mjs + hooks.mjs), so they count as checks that RUN it.
const NODE_GUARDS = ["scripts/verify-guest-menu-switch.mjs", "scripts/verify-public-endpoints.mjs"];

function codeMask(L) {
  const m = new Array(L.length).fill(false); let q = null;
  for (let i = 0; i < L.length; i++) {
    const c = L[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === "/" && L[i + 1] === "/") break;
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    m[i] = true;
  }
  return m;
}
const OPS = [
  { name: "=== → !==", re: / === /g, to: " !== " }, { name: "!== → ===", re: / !== /g, to: " === " },
  { name: "&& → ||", re: / && /g, to: " || " }, { name: "|| → &&", re: / \|\| /g, to: " && " },
  { name: ">= → >", re: / >= /g, to: " > " }, { name: "<= → <", re: / <= /g, to: " < " },
  { name: "> → >=", re: / > /g, to: " >= " }, { name: "< → <=", re: / < /g, to: " <= " },
  { name: "?? → ||", re: / \?\? /g, to: " || " },
  { name: "drop !", re: /\(!(?=[\w(.])/g, to: "(" }, { name: "drop ! after &&", re: /&& !(?=[\w(])/g, to: "&& " },
  { name: "true → false", re: /\breturn true\b/g, to: "return false" }, { name: "false → true", re: /\breturn false\b/g, to: "return true" },
  { name: "null → undefined", re: /\breturn null\b/g, to: "return undefined" },
];
// The owner settings route is measured only in its maintenance half (round 2, item 15).
function spanOf(rel, text) {
  if (rel !== ROUTES.ownerSettings) return [[0, text.length]];
  const g1 = text.indexOf("  // ── THE GUEST MENU'S MAINTENANCE SWITCH"), g2 = text.indexOf("  return NextResponse.json({ name, isAdmin", g1);
  const a = text.indexOf("async function patchMaintenance("), b = text.indexOf("export async function POST(", a);
  return [[g1, g2], [a, b]];
}
let rnd = SEED >>> 0 || 1;
const rand = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };

const base = join(ROOT, ".t16mut");
rmSync(base, { recursive: true, force: true });
const runOne = (args, rel, file) => new Promise((res) => {
  const p = spawn("node", ["--no-warnings", "--import", "./scripts/sweep/t16s10/hooks.mjs", ...args],
    { cwd: ROOT, env: { ...process.env, T16_NODE_ROUTES: "1", T16_MUT: file, T16_MUT_REL: rel }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", () => {});
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, 240000);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});
const runCopy = async (rel, file) => {
  const r = await runOne(["scripts/sweep/t16s10/run.mjs", "--suite", SUITES, "--file", rel, "--bail", "--quiet", "--browser-close"], rel, file);
  if (r.code !== 0 || rel.startsWith("public/")) return r;
  for (const g of NODE_GUARDS) { const q = await runOne([g], rel, file); if (q.code !== 0) return { code: q.code, out: r.out + "\n" + q.out.split("\n").filter((l) => /❌/.test(l)).slice(0, 1).map((l) => "❌ " + g.split("/").pop() + l).join("") }; }
  return r;
};

const results = [], controls = {};
for (const rel of FILES) {
  const text = readFileSync(join(ROOT, rel), "utf8"), lines = text.split("\n"), spans = spanOf(rel, text);
  const ext = rel.endsWith(".ts") ? ".ts" : ".js";
  const sites = []; let off = 0;
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k], t = L.trim(), at = off; off += L.length + 1;
    if (!spans.some(([a, b]) => at >= a && at < b)) continue;
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ") || L.includes("`")) continue;
    const mask = codeMask(L);
    for (const op of OPS) for (const m of L.matchAll(op.re)) if (mask[m.index] && mask[m.index + m[0].length - 1]) {
      const key = `${rel}:${k + 1}:${m.index}:${op.name}`;
      if (!SKIP.has(key)) sites.push({ rel, line: k + 1, col: m.index, len: m[0].length, to: op.to, name: op.name, key });
    }
  }
  // A seeded shuffle, then the first MAX — a fresh seed draws a different sample (convergence).
  for (let i = sites.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sites[i], sites[j]] = [sites[j], sites[i]]; }
  // The breaks most likely to be real bugs first: a dropped "not", true/false, and/or, ===/!==.
  const band = (n) => (/drop !|true|false|null/.test(n) ? 0 : /&&|\|\||===|!==|\?\?/.test(n) ? 1 : 2);
  sites.sort((a, b) => band(a.name) - band(b.name));
  const chosen = sites.slice(0, MAX);
  const dir = join(base, basename(rel).replace(/\W/g, "_")); mkdirSync(dir, { recursive: true });
  const ctl = join(dir, "control" + ext); writeFileSync(ctl, text);
  const c = await runCopy(rel, ctl);
  controls[rel] = c.code === 0;
  const rowsRan = (c.out.match(/— (\d+) rows:/) || [])[1] || "?";
  if (c.code !== 0) { console.log(`✗ ${rel}: CONTROL FAILED (an unchanged copy is not green) — skipped\n${c.out.slice(-400)}`); continue; }
  if (rowsRan === "0" && rel.startsWith("public/")) { console.log(`· ${rel}: no behavioural row is about this file — ${sites.length} sites, none can be judged`); results.push(...chosen.map((s) => ({ ...s, status: "NO-ROWS" }))); continue; }
  console.log(`${rel}: ${sites.length} sites, running ${chosen.length} against ${rowsRan} behavioural rows, ${WORKERS} at a time`);
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const file = join(dir, `w${w}${ext}`);
    while (next < chosen.length) {
      const s = chosen[next++];
      const m = [...lines]; m[s.line - 1] = lines[s.line - 1].slice(0, s.col) + s.to + lines[s.line - 1].slice(s.col + s.len);
      writeFileSync(file, m.join("\n"));
      const r = await runCopy(rel, file);
      results.push({ ...s, before: lines[s.line - 1].trim().slice(0, 140), status: r.code === 0 ? "SURVIVED" : r.code === "timeout" ? "timeout" : "killed", killedBy: (r.out.match(/^❌ (P\d+)/m) || [])[1] || null });
    }
  }));
  const mine = results.filter((r) => r.rel === rel), sv = mine.filter((r) => r.status === "SURVIVED");
  console.log(`  → ${mine.length - sv.length} killed · ${sv.length} survived`);
  for (const r of sv.sort((a, b) => a.line - b.line)) console.log(`     L${r.line} [${r.name}]  ${r.before}`);
}
rmSync(base, { recursive: true, force: true });
const sv = results.filter((r) => r.status === "SURVIVED");
console.log(`\nTOTAL ${results.length} mutants · ${results.filter((r) => r.status === "killed" || r.status === "timeout").length} killed · ${sv.length} SURVIVED · ${results.filter((r) => r.status === "NO-ROWS").length} with no behavioural row`);
if (OUT) writeFileSync(OUT, JSON.stringify({ controls, results }, null, 1));
process.stdout.write("", () => process.exit(0));
