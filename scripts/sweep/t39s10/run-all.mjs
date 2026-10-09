// scripts/sweep/t39s10/run-all.mjs — run EVERY verify:* / test:* entry in package.json, one at a time,
// against one app, and record the real exit code of each (sweep #10 T39, round 2 — Band F).
//
//   node scripts/sweep/t39s10/run-all.mjs --base http://localhost:4439 --out <dir> [--only a,b] [--timeout-min 40]
//
// One at a time on purpose: the guards share one dev database and one sign-in cache, and two at once
// is how fixtures collide and rate limits get tripped. RESUMABLE: an entry already in <out>/results.tsv
// is not run again, so an interrupted run picks up where it stopped.
//
// NOT RUN, BY THE HOUSE RULES (each is recorded as ⏭ with this reason, never silently dropped):
const NEVER = {
  "verify:everything": "the 40-minute everything-run refuses to share the database with other live sessions (pid lock); its phases are the other entries, run here one by one",
  "verify:db-parity": "reads the client stack's database — off-limits to this sweep (its folder half runs as verify:migration-numbers)",
  "verify:avlive-release": "reads the client stack's folder — off-limits to this sweep",
  "verify:t25-doors-live": "its live block sends signed-out requests to watch them be refused; the house rule checks a gate by reading it (its code half runs as verify:t25-doors), and it is sweep #10 T17's",
};
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4439");
const OUT = arg("--out");
if (!OUT) { console.error("--out <dir> is required"); process.exit(2); }
if (/aevinite\.shop/.test(BASE)) { console.error("refusing: never against the client site"); process.exit(2); }
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean);
const TIMEOUT = Number(arg("--timeout-min", "40")) * 60_000;
mkdirSync(OUT, { recursive: true });
const TSV = join(OUT, "results.tsv");
if (!existsSync(TSV)) writeFileSync(TSV, "entry\texit\tsecs\tlast line\n");
const done = new Set(readFileSync(TSV, "utf8").split("\n").slice(1).map((l) => l.split("\t")[0]).filter(Boolean));

const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
const entries = Object.keys(scripts).filter((k) => /^(verify|test)(:|$)/.test(k) && (!ONLY.length || ONLY.includes(k)));
const wantsBase = (k) => {
  const files = [...scripts[k].matchAll(/(?:scripts|tests|\.github\/scripts)\/[\w./-]+\.(?:mjs|ts|js)/g)].map((m) => m[0]);
  return files.some((f) => { try { return /--base/.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; } });
};
const clean = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "").replace(/[\t\r]/g, " ");

for (const k of entries) {
  if (done.has(k)) continue;
  if (NEVER[k]) { appendFileSync(TSV, `${k}\tSKIP\t0\t${NEVER[k]}\n`); console.log(`⏭  ${k} — ${NEVER[k]}`); continue; }
  const t0 = Date.now();
  const extra = wantsBase(k) ? ["--", "--base", BASE] : [];
  const log = join(OUT, k.replace(/[:/]/g, "_") + ".log");
  const code = await new Promise((res) => {
    const child = spawn("npm", ["run", "-s", k, ...extra], {
      cwd: ROOT, env: { ...process.env, LFH_BASE: BASE, VERIFY_BASE: BASE, BASE, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    let buf = "";
    const take = (d) => { buf += d; if (buf.length > 4_000_000) buf = buf.slice(-2_000_000); };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => { buf += `\n[run-all] TIMEOUT after ${TIMEOUT / 60000} min\n`; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, TIMEOUT);
    child.on("close", (c, sig) => { clearTimeout(timer); writeFileSync(log, buf); res(sig ? `SIG${sig}` : String(c)); });
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  const lines = clean(readFileSync(log, "utf8")).split("\n").map((l) => l.trim()).filter(Boolean);
  const last = (lines.reverse().find((l) => /pass|fail|✅|❌|✓|✗|ok|green|red|could not/i.test(l)) || lines[0] || "").slice(0, 220);
  appendFileSync(TSV, `${k}\t${code}\t${secs}\t${last}\n`);
  console.log(`${code === "0" ? "✅" : code === "2" ? "⏭ " : "❌"} ${k}  exit ${code}  ${secs}s  ${last.slice(0, 120)}`);
}
appendFileSync(TSV, "#DONE\n");
console.log("all entries run");
