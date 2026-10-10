// scripts/t30-harness/mutate.mjs — "is every line actually CHECKED, not just run?"
//   node scripts/t30-harness/mutate.mjs [--max 320] [--file lib/tax.ts] [--list]
// Makes one small break at a time in the 14 code files (=== ↔ !==, && ↔ ||, >= ↔ >, <= ↔ <, true ↔
// false, + 1 ↔ - 1, a dropped `!`, ?? 0 → ?? 1), runs the whole round-2 harness, and puts the file back
// BYTE FOR BYTE (also on Ctrl-C). A break the harness does not notice is a SURVIVOR: either a missing
// check (add one) or a change that cannot alter behaviour (an equivalent mutant — named in the report).
// Refuses to start on a dirty tree for these files, so a mutation can never mix with real work.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const FILES = ["lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts", "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts", "lib/money.ts", "lib/money.mjs", "lib/orderAllergies.ts"];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MAX = Number(arg("--max", 320)); const ONLY = arg("--file", null);
const dirty = execFileSync("git", ["status", "--porcelain", "--", ...FILES], { cwd: root, encoding: "utf8" }).trim();
if (dirty) { console.error("refusing: these files have uncommitted changes:\n" + dirty); process.exit(2); }
const OPS = [
  [/===/g, "!==", "=== → !=="], [/!==/g, "===", "!== → ==="],
  [/ && /g, " || ", "&& → ||"], [/ \|\| /g, " && ", "|| → &&"],
  [/ >= /g, " > ", ">= → >"], [/ <= /g, " < ", "<= → <"], [/ > (?!=)/g, " >= ", "> → >="], [/ < (?!=)/g, " <= ", "< → <="],
  [/\btrue\b/g, "false", "true → false"], [/\bfalse\b/g, "true", "false → true"],
  [/ \+ 1\b/g, " - 1", "+ 1 → - 1"], [/ - 1\b/g, " + 1", "- 1 → + 1"],
  [/(?<![!=])!(?=[A-Za-z_(])/g, "", "drop !"], [/\?\? 0\b/g, "?? 1", "?? 0 → ?? 1"],
];
const isCode = (line) => { const s = line.trim(); return s && !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*") && !/^import\b/.test(s) && !/^export type\b/.test(s); };
const mutants = [];
for (const f of FILES) {
  if (ONLY && ONLY !== f) continue;
  const lines = readFileSync(join(root, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!isCode(line)) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const [re, rep, name] of OPS) for (const m of code.matchAll(re)) mutants.push({ f, line: i + 1, col: m.index, len: m[0].length, rep, name });
  });
}
// Spread the budget evenly over every candidate, so each file and each kind of break is represented.
const step = Math.max(1, mutants.length / MAX); const picked = [];
for (let k = 0; k < mutants.length && picked.length < MAX; k += step) picked.push(mutants[Math.floor(k)]);
if (process.argv.includes("--list")) { console.log(`${mutants.length} candidate breaks, ${picked.length} picked`); process.exit(0); }
// Survivors already PROVEN to change nothing — each by a check in u-equivalence.mjs (the broken copy run
// side by side with the real one) or u-proofs.mjs (the code can never reach that branch). Matched by the
// line's text and the kind of break, so a NEW survivor anywhere else still fails this script.
const EQUIVALENT = [
  ["lib/taxFiling.ts", /left > 0 && k < order\.length/, /&& → \|\||< → <=/], ["lib/taxFiling.ts", /left < 0 && k >= 0/, /./], ["lib/taxFiling.ts", /r\.parts\[j\] \?\? 0/, /./],
  ["lib/paySplit.ts", /if \(!name\) return \{ ok: false, status: 400/, /./],
  ["lib/discountCap.ts", /return Number\.isFinite\(d\) && d > 0/, /./], ["lib/discountCap.ts", /\* 100 > capPct \+ 0\.01/, /./],
  ["lib/clash.ts", /if \(!parsed \|\| typeof parsed/, /\|\| → &&/], ["lib/clash.ts", /if \(!w \|\| typeof w !== "object" \|\| Array\.isArray\(w\)\)/, /\|\| → &&/],
  ["lib/clash.ts", /if \(res\.error \|\| !res\.data\) return null;/, /./], ["lib/clash.ts", /const name = names && typeof names/, /./],
  ["lib/money.ts", /a >= (CRORE|LAKH|THOUSAND) \?/, />= → >/], ["lib/money.ts", /if \(!Number\.isFinite\(min\)/, /./], ["lib/money.ts", /t <= max \+ step \* 1e-9/, /./],
  ["lib/money.mjs", /Math\.abs\(frac - 0\.99\) < 0\.07/, /./],
  ["lib/orderAllergies.ts", /\.order\("id", \{ ascending: true \}\)\.range/, /true → false/],
  ["lib/tax.ts", /return r === 0 \? 0 : \(x < 0 \? -r : r\) \/ 100;/, /< → <=/], ["lib/taxFiling.ts", /return r === 0 \? 0 : \(x < 0 \? -r : r\) \/ 100;/, /< → <=/],
];
const isEquivalent = (r) => EQUIVALENT.some(([f, line, op]) => f === r.f && line.test(r.text) && op.test(r.name));
const originals = new Map(FILES.map((f) => [f, readFileSync(join(root, f), "utf8")]));
const restoreAll = () => { for (const [f, s] of originals) writeFileSync(join(root, f), s); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restoreAll(); process.exit(130); });
const results = [];
try {
  for (const m of picked) {
    const src = originals.get(m.f); const lines = src.split("\n"); const L = lines[m.line - 1];
    lines[m.line - 1] = L.slice(0, m.col) + m.rep + L.slice(m.col + m.len);
    writeFileSync(join(root, m.f), lines.join("\n"));
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/t30-harness/hooks.mjs", "scripts/t30-harness/run.mjs", "--quiet"], { cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, T30_MUTATING: "1" } });
    writeFileSync(join(root, m.f), src);
    const out = (r.stdout || "") + (r.stderr || "");
    const invalid = /SyntaxError|ReferenceError: .* is not defined|suite crashed[\s\S]{0,200}(SyntaxError|Unexpected token)/.test(out) && !/❌ P\d/.test(out.replace(/❌ P—[^\n]*/g, ""));
    const status = r.status === 0 ? "SURVIVED" : invalid ? "invalid" : "killed";
    const first = (out.match(/❌ (P\d+)[^\n]*/) || [""])[0].slice(0, 110);
    results.push({ ...m, status, first, text: L.trim().slice(0, 120) });
    process.stdout.write(status === "SURVIVED" ? "S" : status === "killed" ? "." : "x");
  }
} finally { restoreAll(); }
for (const r of results) if (r.status === "SURVIVED" && isEquivalent(r)) r.status = "equivalent";
const k = results.filter((r) => r.status === "killed").length, s = results.filter((r) => r.status === "SURVIVED"), inv = results.filter((r) => r.status === "invalid").length, eq = results.filter((r) => r.status === "equivalent");
console.log(`\n\n${results.length} breaks · ${k} caught · ${eq.length} proven equivalent · ${s.length} UNEXPLAINED survivors · ${inv} did not compile (not counted)`);
for (const r of eq) console.log(`  equivalent ${r.f}:${r.line}  ${r.name}   ${r.text.slice(0, 90)}`);
for (const r of s) console.log(`  SURVIVED ${r.f}:${r.line}  ${r.name}   ${r.text}`);
const per = {}; for (const r of results) { per[r.f] ||= {}; per[r.f][r.status === "SURVIVED" ? "survived" : r.status === "equivalent" ? "equivalent" : r.status] = (per[r.f][r.status === "SURVIVED" ? "survived" : r.status === "equivalent" ? "equivalent" : r.status] || 0) + 1; }
console.log("\nper file:"); for (const [f, v] of Object.entries(per)) console.log(`  ${f}: ${v.killed || 0} caught, ${v.equivalent || 0} proven equivalent, ${v.survived || 0} unexplained`);
const after = execFileSync("git", ["status", "--porcelain", "--", ...FILES], { cwd: root, encoding: "utf8" }).trim();
console.log(after ? "✗ a file was NOT restored:\n" + after : "✓ every file restored byte for byte");
process.exit(after ? 2 : s.length ? 1 : 0);
