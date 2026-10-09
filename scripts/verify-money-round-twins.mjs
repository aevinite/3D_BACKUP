// verify-money-round-twins.mjs — ONE rounding to the paisa, the same everywhere, and the same as the database.
//
// WHY (sweep #10 T30 round 4, item 10, 2026-10-10, the owner's yes). The app rounded money with
// `Math.round(x * 100) / 100`, which rounds the FLOAT: 5% of ₹0.70 is 3.5 paise exactly, but
// 0.7 × 0.05 × 100 is 3.4999999999999996, so the app said ₹0.03 where Postgres's exact numeric
// `round()` says ₹0.04 — 818 amounts in a million at 5% tax on top, 3,656 at 18%, 21,699 at 12%
// tax-inside. Now there is one exact rule, written twice because the panels take no imports:
//   · lib/tax.ts               roundPaise   — the server and React (tax.ts imports nothing)
//   · public/panels/billdoc.js moneyRound   — the panels (LFH_BILLDOC) and anything importing billdoc
// A copied helper drifts silently, so this proves, every run:
//   1. the two copies give the SAME answer on millions of inputs;
//   2. both give the DATABASE's answer (exact half-away-from-zero) for tax on top and tax inside, on
//      every amount ₹0.01–₹10,000 at every rate a restaurant here can use;
//   3. the manager and tablet panels call the shared one, and their pages load billdoc.js first;
//   4. no money × rate (or ÷ (1 + rate)) is rounded the old float way anywhere in the app again.
//
// Static, no server, no database:  node scripts/verify-money-round-twins.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let passed = 0, failed = 0;
const check = (ok, good, bad) => { if (ok) { passed++; console.log(`  ✓ ${good}`); } else { failed++; console.log(`  ✗ ${bad}`); } };
console.log("\nMONEY ROUNDING · one exact rule, the same in the app, the panels and the database\n");

const { roundPaise } = await import(pathToFileURL(join(root, "lib/tax.ts")).href);
const BILLDOC = createRequire(import.meta.url)(join(root, "public/panels/billdoc.js"));
check(typeof roundPaise === "function" && typeof BILLDOC.moneyRound === "function", "both copies exist (lib/tax.ts roundPaise, billdoc.js moneyRound)", "a copy is missing");

// 1 — the twins agree
{ let s = 7, bad = null; const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const inputs = [0, -0, 0.005, -0.005, 0.015, 1.005, 2.675, 1e-9, -1e-9, 123456.785, -123456.785, NaN, Infinity, -Infinity, 1e12, 0.145, 4.35];
  for (let i = 0; i < 2000000; i++) inputs.push((rnd() - 0.3) * (i % 3 === 0 ? 100 : i % 3 === 1 ? 1e4 : 1e7) * (i % 7 === 0 ? 1 : rnd()));
  for (const x of inputs) { const a = roundPaise(x), b = BILLDOC.moneyRound(x); if (!(Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b)))) { bad = `${x}: ${a} vs ${b}`; break; } }
  check(!bad, `the two copies give the same answer on ${inputs.length.toLocaleString("en-IN")} inputs (incl. negatives, halves, NaN, ±∞)`, `the copies differ — ${bad}`); }

// 2 — both equal the database's exact rounding, for every amount, at every rate
const exactAdd = (g, bp) => { const num = g * bp, q = Math.floor(num / 10000), r = num - q * 10000; return 2 * r >= 10000 ? q + 1 : q; };
const exactIncl = (g, bp) => { const num = g * 10000, den = 10000 + bp, q = Math.floor(num / den), r = num - q * den; return 2 * r >= den ? q + 1 : q; };
for (const bp of [500, 1200, 1800, 2800, 250, 1250, 300, 600]) {
  let add = 0, incl = 0, ex = "";
  for (let g = 1; g <= 1000000; g++) {
    const a = Math.round(roundPaise((g / 100) * (bp / 10000)) * 100), i = Math.round(roundPaise((g / 100) / (1 + bp / 10000)) * 100);
    if (a !== exactAdd(g, bp)) { add++; ex ||= `tax on ₹${g / 100}`; }
    if (i !== exactIncl(g, bp)) { incl++; ex ||= `net of ₹${g / 100}`; }
  }
  check(!add && !incl, `at ${bp / 100}%: tax on top and the net inside the price equal the database's on all 1,000,000 amounts to ₹10,000`, `at ${bp / 100}%: ${add} tax-on-top and ${incl} tax-inside amounts differ from the database (${ex})`);
}
check(roundPaise(-0.035) === -0.04 && roundPaise(0.035) === 0.04, "a negative amount rounds the way the database does (half away from zero: −0.035 → −0.04)", `negative rounding: ${roundPaise(-0.035)}`);
check(roundPaise(1.005) === 1.01 && roundPaise(0.7 * 0.05) === 0.04, "the cases that started this: ₹1.005 → ₹1.01, 5% of ₹0.70 → ₹0.04", `${roundPaise(1.005)} / ${roundPaise(0.7 * 0.05)}`);

// 3 — the panels call the shared one, and load it first
for (const [app, page] of [["public/panels/editor/app.js", "public/panels/editor/index.html"], ["public/panels/tablet/app.js", "public/panels/tablet/index.html"]]) {
  const a = read(app), h = read(page);
  check(/const moneyRound = \(n\) => \(typeof LFH_BILLDOC !== "undefined" && LFH_BILLDOC\.moneyRound \? LFH_BILLDOC\.moneyRound\(n\)/.test(a), `${app} rounds through the shared LFH_BILLDOC.moneyRound`, `${app} does not use the shared rounding`);
  const bd = h.indexOf("/panels/billdoc.js"), ap = h.search(/<script src="[^"]*app\.js/);
  check(bd > 0 && ap > bd, `${page} loads billdoc.js before app.js`, `${page} loads app.js before billdoc.js (or not at all)`);
}

// 4 — no money × rate rounded the old float way again
const walk = (d, out = []) => { for (const e of readdirSync(join(root, d))) { const p = join(d, e); if (e === "node_modules" || e.startsWith(".")) continue; if (statSync(join(root, p)).isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs)$/.test(e) && !/\.d\.ts$|\.test\.|\.min\./.test(e)) out.push(p); } return out; };
const RATE_ROUND = /Math\.round\([^;\n]*(?:\* ?\(?(?:rate|r|tm\.rate|bk\.rate|taxRate|settingsRate|gstRate)\b|\/ ?\(1 ?\+)[^;\n]*\* 100\) \/ 100/;
const hits = [];
for (const f of ["app", "lib", "components", "public/panels", "hooks"].flatMap((d) => { try { return walk(d); } catch { return []; } })) {
  read(f).split("\n").forEach((l, i) => { if (!/^\s*(\/\/|\*)/.test(l) && RATE_ROUND.test(l)) hits.push(`${f}:${i + 1}`); });
}
check(!hits.length, "no amount × a tax rate (or ÷ (1 + rate)) is rounded the old float way anywhere in the app", `rounded the float way: ${hits.join(", ")}`);
const scanned = RATE_ROUND.test("const tax = Math.round(taxable * rate * 100) / 100;") && RATE_ROUND.test("x = Math.round((amt / (1 + rate)) * 100) / 100;");
check(scanned, "…and the scan really recognises the old pattern (tested on two copies of it), so it is not passing on nothing", "the scan no longer matches the pattern it exists to find");

console.log(`\n${failed ? "✗ FAIL" : "✓ PASS"} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
