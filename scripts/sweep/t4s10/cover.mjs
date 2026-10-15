// scripts/sweep/t4s10/cover.mjs — WHICH LINES AND BRANCHES OF MY 24 FILES DID NO CHECK EVER RUN?
//
//   node scripts/sweep/t4s10/cover.mjs                 — the in-memory blocks (a–g + round 2's i/k), mapped back
//   node scripts/sweep/t4s10/cover.mjs --lab           — …plus the screen lab (block j), in Chromium
//   node scripts/sweep/t4s10/cover.mjs --json=<file>   — also write the report as JSON
//
// Sweep #10 T4 round 2 (2026-10-15), owner: "make sure every single thing within the boundaries … should be
// covered". This is what makes that measurable instead of claimed. Nothing here talks to a database: block h
// (the built app) is left out on purpose — it proves the real screens, the lab measures them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, FILES } from "./lib.mjs";
import { addNodeDir, addScript, report, print } from "./covmap.mjs";

const LAB = process.argv.includes("--lab");
const jsonArg = (process.argv.find((a) => a.startsWith("--json=")) || "").split("=")[1];
const dir = mkdtempSync(join(tmpdir(), "t4cov-"));
const CACHE = join(ROOT, "node_modules/.cache");
for (const f of readdirSync(CACHE)) if (/^t4s10-.*\.cjs$/.test(f)) rmSync(join(CACHE, f));
const blocks = process.env.T4S10_BLOCKS || "a,b,c,d,e,f,g,i,k";
try {
  try {
    execFileSync("node", ["scripts/sweep/t4s10/run.mjs"], { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir, T4_COVER: "1", T4S10_BLOCKS: blocks }, stdio: "pipe", timeout: 1800000 });
  } catch (e) { console.log("(a check was red — coverage is still read; the run's own report says which)\n" + String(e.stdout || "").slice(-600)); }
  const n = addNodeDir(dir, readdirSync);
  console.log(`in-memory: ${n} bundle instance(s) mapped`);
  if (LAB) {
    const labOut = join(dir, "lab.json");
    try {
      execFileSync("node", ["scripts/sweep/t4s10/run.mjs"], { cwd: ROOT, env: { ...process.env, T4_COVER: "1", T4_LAB_COVER: labOut, T4S10_BLOCKS: "j" }, stdio: "pipe", timeout: 3600000 });
    } catch (e) { console.log("(a lab check was red)\n" + String(e.stdout || "").slice(-600)); }
    let m = 0;
    const texts = new Map();
    for (const line of readFileSync(labOut, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line); if (!texts.has(r.bundle)) texts.set(r.bundle, readFileSync(r.bundle, "utf8"));
      if (addScript(texts.get(r.bundle), r.functions, join(ROOT, "node_modules/.cache/t4lab"), r.bundle)) m++;
    }
    console.log(`screen lab: ${m} page script instance(s) mapped`);
  }
  const rep = report(Object.values(FILES));
  print(rep);
  if (jsonArg) writeFileSync(jsonArg, JSON.stringify(rep, null, 1));
} finally { rmSync(dir, { recursive: true, force: true }); }
