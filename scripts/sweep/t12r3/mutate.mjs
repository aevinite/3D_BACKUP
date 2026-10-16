// scripts/sweep/t12r3/mutate.mjs — band M: MUTATION TESTING of the waiter tablet (sweep #10 T12 round 3).
//
//   node scripts/sweep/t12r3/mutate.mjs <per-group coverage root> [--max=120] [--workers=4] [--seed=1] [--json=out] [--keys=file]
//
// "Every line ran" (cov.mjs) says nothing about whether a check would NOTICE that line being wrong. So
// this makes ONE small deliberate break at a time in a COPY of public/panels/tablet/app.js — a comparison
// flipped, a "not" dropped, and/or swapped, true/false swapped, `??` → `||`, a number ±1 — serves that
// copy in place of the real file (lib.mjs T12_MUT: the browser is handed the copy, the service worker is
// blocked), and runs only the band-F groups whose checks EXECUTE that line (from per-group coverage),
// stopping at the first red. A break nobody notices SURVIVES — a missing check, or a line that does
// nothing; both get a row. The real file is never touched. Nothing is written anywhere: band F is the
// fixture world. Same method as T16's mutate.mjs (operators, seeded sampling, a CONTROL that must pass).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { report } from "./cov.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const REL = "public/panels/tablet/app.js";
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const COVROOT = process.argv[2];
const MAX = Number(arg("max", 120)), WORKERS = Number(arg("workers", 4)), SEED = Number(arg("seed", 1)), OUT = arg("json", "");
const ONLY = arg("keys", "") ? new Set(JSON.parse(readFileSync(arg("keys", ""), "utf8"))) : null;
const SKIP = new Set(arg("skip", "") ? JSON.parse(readFileSync(arg("skip", ""), "utf8")) : []);

// ── which groups run which line ────────────────────────────────────────────────────────────────
const groups = readdirSync(COVROOT).filter((g) => existsSync(join(COVROOT, g, "browser")));
const runBy = new Map();   // line → Set(group)
for (const g of groups) {
  const rep = report(join(COVROOT, g)).find((r) => r.file === REL);
  const src = readFileSync(join(ROOT, REL), "utf8").split("\n");
  const missed = new Set(rep.missed);
  // A line counts as "run by g" when it is a code line g did not miss. report() only lists missed lines,
  // so rebuild the run set from the code lines it counted.
  for (let k = 1; k <= src.length; k++) if (!missed.has(k)) { if (!runBy.has(k)) runBy.set(k, new Set()); runBy.get(k).add(g); }
}

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
  { name: "if (!x → if (x", re: /if \(!(?=[\w(.])/g, to: "if (" },
  { name: "true → false", re: /\breturn true\b/g, to: "return false" }, { name: "false → true", re: /\breturn false\b/g, to: "return true" },
  { name: "null → undefined", re: /\breturn null\b/g, to: "return undefined" },
  { name: "+ 1 → + 2", re: / \+ 1\b/g, to: " + 2" }, { name: "- 1 → - 2", re: / - 1\b/g, to: " - 2" },
];
let rnd = SEED >>> 0 || 1;
const rand = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };

const text = readFileSync(join(ROOT, REL), "utf8"), lines = text.split("\n");
const sites = [];
lines.forEach((L, k) => {
  const t = L.trim();
  if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || L.includes("`")) return;
  const by = runBy.get(k + 1); if (!by || !by.size) return;          // only lines band F actually executes
  const mask = codeMask(L);
  for (const op of OPS) for (const m of L.matchAll(op.re)) if (mask[m.index] && mask[m.index + m[0].length - 1]) {
    const key = `${REL}:${k + 1}:${m.index}:${op.name}`;
    if (SKIP.has(key) || (ONLY && !ONLY.has(key))) continue;
    sites.push({ line: k + 1, col: m.index, len: m[0].length, to: op.to, name: op.name, key, groups: [...by] });
  }
});
for (let i = sites.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sites[i], sites[j]] = [sites[j], sites[i]]; }
const band = (n) => (/drop !|if \(!|true|false|null/.test(n) ? 0 : /&&|\|\||===|!==|\?\?/.test(n) ? 1 : 2);
sites.sort((a, b) => band(a.name) - band(b.name));
const chosen = ONLY ? sites : sites.slice(0, MAX);

const base = join(ROOT, ".t12mut"); rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true });
const run = (file, gs) => new Promise((res) => {
  const p = spawn("node", ["scripts/sweep/t12r3/f-run.mjs", "--groups", gs.join(","), "--quiet", "--bail"], { cwd: ROOT, env: { ...process.env, T12_MUT: file, T12_COV: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, 15 * 60e3);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});

console.log(`${sites.length} sites on lines band F runs · trying ${chosen.length} · ${WORKERS} at a time`);
const ctl = join(base, "control.js"); writeFileSync(ctl, text);
const allGroups = [...new Set(chosen.flatMap((s) => s.groups))];
const c = await run(ctl, allGroups);
if (c.code !== 0) { console.log(`✗ CONTROL FAILED — an unchanged copy is not green, so no result can be trusted:\n${c.out.split("\n").filter((l) => /❌|stopped/.test(l)).slice(0, 8).join("\n")}`); process.stdout.write("", () => process.exit(2)); }
else console.log(`✓ control: an unchanged copy passes every group a mutant will be judged by (${allGroups.join(",")})`);

const results = [];
let next = 0;
await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  const file = join(base, `w${w}.js`);
  while (next < chosen.length) {
    const s = chosen[next++];
    const m = [...lines]; m[s.line - 1] = lines[s.line - 1].slice(0, s.col) + s.to + lines[s.line - 1].slice(s.col + s.len);
    writeFileSync(file, m.join("\n"));
    const r = await run(file, s.groups);
    const killedBy = (r.out.match(/^❌ (P\d+)/m) || [])[1] || null;
    results.push({ ...s, before: lines[s.line - 1].trim().slice(0, 150), status: r.code === 0 ? "SURVIVED" : r.code === "timeout" ? "timeout" : "killed", killedBy });
    console.log(`${r.code === 0 ? "· SURVIVED" : "✓ killed  "} L${s.line} [${s.name}]${killedBy ? " by " + killedBy : ""}`);
  }
}));
rmSync(base, { recursive: true, force: true });
const sv = results.filter((r) => r.status === "SURVIVED");
console.log(`\nTOTAL ${results.length} mutants · ${results.length - sv.length} killed · ${sv.length} SURVIVED`);
for (const r of sv.sort((a, b) => a.line - b.line)) console.log(`   L${r.line} [${r.name}]  ${r.before}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.stdout.write("", () => process.exit(0));
