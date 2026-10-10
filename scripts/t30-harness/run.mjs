// scripts/t30-harness/run.mjs — sweep #10 · T30 round 2 — every branch of the money libraries.
//   node --experimental-strip-types --no-warnings --import ./scripts/t30-harness/hooks.mjs scripts/t30-harness/run.mjs [--quiet] [--ledger] [--only <suite>]
// HERMETIC: the database is the in-memory stand-in (./sb.mjs) and every fetch is refused (./hooks.mjs).
import { ROWS } from "./lib.mjs";
import { NET } from "./hooks.mjs";
const ARGV = process.argv.slice(2);
const ONLY = ARGV.includes("--only") ? ARGV[ARGV.indexOf("--only") + 1] : null;
const SUITES = ["u-tax", "u-taxFiling", "u-paySplit", "u-payments", "u-discountCap", "u-clash", "u-clashCompare", "u-idempotency", "u-idempotencyRule", "u-dbRefusal", "u-readGuard", "u-money", "u-proofs", "u-equivalence", "u-round3", "u-props", "u-orderAllergies", "u-exports", "u-round4", "u-round5", "u-round5b"];
for (const s of SUITES) { if (ONLY && ONLY !== s) continue; try { await import(`./${s}.mjs`); } catch (e) { if (/Cannot find module/.test(String(e)) && !ONLY) continue; ROWS.push({ id: "P—", file: s, what: "suite crashed", ok: false, note: String(e && e.stack || e).slice(0, 300) }); } }
ROWS.push({ id: "P168999", file: "scripts/t30-harness", what: "no suite reached the network (every fetch refused, none attempted)", ok: NET.length === 0, note: NET.slice(0, 3).join(" ") });
const seen = new Set(); for (const r of ROWS) { if (r.id !== "P—" && seen.has(r.id)) throw new Error("duplicate id " + r.id); seen.add(r.id); }
if (ARGV.includes("--ledger")) {
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of ROWS) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | the real file, in-memory database · \`scripts/t30-harness\` | ${r.ok ? "✅" : "❌"} | ${esc(r.note)} |`);
} else {
  for (const r of ROWS) if (!ARGV.includes("--quiet") || !r.ok) console.log(`${r.ok ? "✅" : "❌"} ${r.id}  [${r.file}] ${r.what}${r.note && !r.ok ? "  → " + r.note : ""}`);
  const bad = ROWS.filter((r) => !r.ok).length;
  console.log(`\n${bad ? "✗ FAIL" : "✓ PASS"} — ${ROWS.length} checks · ${bad} ❌`);
}
if (!process.env.T30_NOEXIT) process.stdout.write("", () => process.exit(ROWS.some((r) => !r.ok) ? 1 : 0));
else if (ROWS.some((r) => !r.ok)) throw new Error(`${ROWS.filter((r) => !r.ok).length} check(s) failed`);
