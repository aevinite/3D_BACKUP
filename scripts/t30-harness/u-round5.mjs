// Round 5 (owner, 2026-10-10: "check every single bit … any dead code or any kind of unoptimized thing …
// test till there is no error left") — HYGIENE and SPEED, rule by rule, file by file, for the 14 money files.
// One row per (file, rule), so a regression in one file names that file. APPEND ONLY; ids are permanent.
import { suite } from "./lib.mjs";
import { W, world } from "./sb.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./hooks.mjs";
const t = suite("round 5 (hygiene and speed)", 210001, 300);
const src = (p) => readFileSync(join(root, p), "utf8");
const FILES = ["lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts", "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts", "lib/money.ts", "lib/money.mjs", "lib/orderAllergies.ts"];
const TESTS = ["lib/money.test.mjs", "tests/money.test.mjs", "tests/order-totals.e2e.mjs"];

// Strip comments (line comments first — a "/*" inside one must not hide what follows) and string bodies,
// so a rule about CODE is never satisfied, or tripped, by prose.
const codeOf = (s) => s.replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p).replace(/\/\*[\s\S]*?\*\//g, "");

// lint, once for every file (the project's own ESLint config), read as JSON
let LINT = {};
// (skipped while mutating or measuring coverage: lint is not the code under test there, and it is slow)
const LINT_ON = !process.env.T30_MUTATING && !process.env.T30_COVERAGE;
if (LINT_ON) {
  try { const out = execFileSync(join(root, "node_modules/.bin/eslint"), ["-f", "json", ...FILES, ...TESTS], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
    for (const f of JSON.parse(out)) LINT[f.filePath.replace(root + "/", "")] = f.messages.map((m) => `${m.line}:${m.ruleId || m.message}`);
  } catch (e) { const out = e.stdout || "[]"; for (const f of JSON.parse(out)) LINT[f.filePath.replace(root + "/", "")] = f.messages.map((m) => `${m.line}:${m.ruleId || m.message}`); }
}

// the loops that may talk to the database, each with its reason (anything else is an N+1)
const DB_LOOPS = {
  "lib/orderAllergies.ts": [/for \(let from = 0; ; from \+= PAGE\)/, /for \(const g of groups\)/],   // pages of 500; one write per DISTINCT result (normally 1–2)
  "lib/clash.ts": [/for \(const t of tables\)/],                                                   // at most two tables (a move's from and to), only for replayed offline writes, stops at the first clash
};
const loopsWithDb = (code) => {
  const out = []; const re = /\bfor \([^)]*\)\s*\{/g; let m;
  while ((m = re.exec(code))) { let depth = 1, k = m.index + m[0].length; while (k < code.length && depth) { if (code[k] === "{") depth++; else if (code[k] === "}") depth--; k++; }
    const body = code.slice(m.index, k); if (/await\s+sb\b|await\s+supabase\b|\bsb\.(from|rpc)\(/.test(body)) out.push(body.split("\n")[0].trim()); }
  return out;
};
// every read the file makes is bounded
const unboundedReads = (code) => {
  const out = [];
  for (const m of code.matchAll(/(?:(?:let|const)\s+([A-Za-z_]\w*)\s*=\s*)?\w+\.from\((["'`][a-z_]+["'`]|[a-zA-Z_]+)\)([\s\S]*?)(;|\n\s*\n)/g)) {
    const [, v, tbl, chain] = m; if (!/\.select\(/.test(chain) || /\.(insert|update|upsert|delete)\(/.test(chain)) continue;
    const bounded = /\.(limit|maybeSingle|single|range)\(|head:\s*true/.test(chain) || (v && new RegExp(`\\b${v}\\.(limit|maybeSingle|single|range)\\(`).test(code));
    if (!bounded) out.push(`${tbl}: ${chain.trim().split("\n")[0].slice(0, 70)}`);
  }
  return out;
};
const dupBodies = (code) => {
  const bodies = new Map(); const dups = [];
  for (const m of code.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g)) { const b = m[3].replace(/\s+/g, " ").trim(); if (b.length < 60) continue; if (bodies.has(b)) dups.push(`${bodies.get(b)} = ${m[1]}`); else bodies.set(b, m[1]); }
  return dups;
};

for (const f of FILES) {
  const s = src(f), code = codeOf(s);
  if (LINT_ON) t(`${f}: the project's lint finds nothing in it — no unused variable, import or eslint-disable that disables nothing`, (LINT[f] || []).length === 0, (LINT[f] || []).join(", "));
  t(`${f}: no TODO / FIXME / XXX / HACK left in it`, !/\b(TODO|FIXME|XXX|HACK)\b/.test(s));
  // CODE, not prose: a commented assignment, a statement that ends like one, or a call on sb / await. (A
  // usage example in a header, indented as one, is documentation; "// function could ever produce" is a sentence.)
  const COMMENTED_CODE = /^\s*\/\/ (?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|return\b[^\n]*;\s*$|if \([^\n]*\)\s*\{?\s*$|await\s+[\w.]+\(|for \([^\n]*\)\s*\{?\s*$|sb\.(from|rpc)\(|(?:export\s+)?function\s+\w+\s*\()/m;
  t(`${f}: no commented-out code (a usage example in the header, indented as one, is documentation)`, !COMMENTED_CODE.test(s), (s.match(COMMENTED_CODE) || [""])[0].slice(0, 80));
  const decl = [...code.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)|^const ([A-Za-z0-9_]+) =|^let ([A-Za-z0-9_]+) =/gm)].map((m) => m[1] || m[2] || m[3]);
  const dead = decl.filter((n) => (code.match(new RegExp(`\\b${n}\\b`, "g")) || []).length < 2 && !new RegExp(`^export[^\\n]*\\b${n}\\b`, "m").test(s));
  t(`${f}: every helper it declares is used (no dead function or constant)`, !dead.length, dead.join(", "));
  t(`${f}: no function body is written twice`, !dupBodies(code).length, dupBodies(code).join(", "));
  t(`${f}: no console.log left in it (errors go to console.error, on purpose)`, !/console\.log\(/.test(code));
  t(`${f}: no read asks for every column (select("*"))`, !/\.select\(\s*["'`]\*["'`]/.test(code));
  t(`${f}: every read it makes is bounded (a limit, a single row, or a page)`, !unboundedReads(code).length, unboundedReads(code).join(" · "));
  const loops = loopsWithDb(code).filter((l) => !(DB_LOOPS[f] || []).some((re) => re.test(l)));
  t(`${f}: no database call inside a loop, except the named bounded ones`, !loops.length, loops.join(" · "));
}
for (const f of TESTS) if (LINT_ON) t(`${f}: the project's lint finds nothing in this test file`, (LINT[f] || []).length === 0, (LINT[f] || []).join(", "));
t("every allowed database loop still exists where it is named (an allowance for a loop that has gone is dead weight)", Object.entries(DB_LOOPS).every(([f, res]) => res.every((re) => re.test(src(f)))));

// ── item 30: Pay in parts sends its two independent reads together, and still checks each ──
const PS = await import("@/lib/paySplit.ts");
const sb = (await import("./sb.mjs")).supabaseAdmin;
const fix = () => ({ sessions: [{ id: "s1", restaurant_id: "R", table_number: "5", status: "open", last_activity_at: "2026-10-10T10:00:00Z" }],
  orders: [{ id: "o1", restaurant_id: "R", table_number: "5", session_id: "s1", status: "served", payment_status: "pending", deleted_at: null, archived: false, subtotal: 500, total: 525, discount: 0, taxable_base: 500, nontax_amount: 0, mrp_amount: 0, tax_rate: 0.05 }],
  settings: [{ restaurant_id: "R", tax_rate: 0.05 }], session_payments: [], khata_customers: [] });
const two = [{ amount: 262.5, method: "Cash" }, { amount: 262.5, method: "UPI" }];
world(fix()); { const r = await PS.settleBillInParts(sb, { rid: "R", table: "5", splits: two }); const order = W.READS.map((x) => x.table);
  t("item 30: Pay in parts sends the session and settings reads TOGETHER, before the orders read (one round trip fewer)", r.ok && [order[0], order[1]].sort().join() === "sessions,settings" && order[2] === "orders", order.join(" → ")); }
world(fix()); W.FAIL["settings:select"] = { code: "57014", message: "timeout" };
{ const e = console.error; console.error = () => {}; const r = await PS.settleBillInParts(sb, { rid: "R", table: "5", splits: two }); console.error = e;
  t("item 30: …a failed settings read is still refused as busy (503) and nothing is written", !r.ok && r.status === 503 && W.WRITES.length === 0, JSON.stringify(r).slice(0, 80)); }
world(fix()); W.FAIL["sessions:select"] = { code: "57014", message: "timeout" };
{ const e = console.error; console.error = () => {}; const r = await PS.settleBillInParts(sb, { rid: "R", table: "5", splits: two }); console.error = e;
  t("item 30: …a failed session read is still refused as busy before anything else is read or written", !r.ok && r.status === 503 && W.WRITES.length === 0 && !W.READS.some((x) => x.table === "orders"), JSON.stringify(r).slice(0, 80)); }
t("item 30: lib/paySplit.ts no longer carries the two eslint-disable lines that disabled nothing", !/eslint-disable-next-line @typescript-eslint\/no-explicit-any\n {2}sb: any,/.test(src("lib/paySplit.ts")));

// ── item 31: the compliance doc says how money is rounded, and names the guard ──
{ const D = src("docs/COMPLIANCE-GUARDRAILS.md");
  t("item 31: docs/COMPLIANCE-GUARDRAILS.md §3 states the one exact rounding rule and names its three copies", /\*\*Round money ONCE, exactly, the same everywhere\*\*/.test(D) && /`roundPaise`/.test(D) && /`moneyRound`/.test(D) && /lib\/taxFiling\.ts`'s own/.test(D));
  t("item 31: …and the guard that keeps the copies equal, which exists and is in verify:static", /node scripts\/verify-money-round-twins\.mjs/.test(D) && /\["verify-money-round-twins\.mjs",/.test(src("scripts/verify-static.mjs"))); }

// ── item 32: the guest's other-currency display rounds by the same exact rule ──
{ const MJ = await import("@/lib/money.mjs"); const TX = await import("@/lib/tax.ts");
  let s = 31, bad = null; const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 200000 && !bad; i++) { const x = (rnd() - 0.2) * (i % 2 ? 1e3 : 1e5) * rnd(); if (MJ.snapToStep(x, 0.01) !== TX.roundPaise(x)) bad = `${x}`; }
  t("item 32: snapToStep to the cent IS the bill's exact rule (lib/tax.ts roundPaise) — 200,000 amounts", !bad, bad || "");
  t("item 32: the cases it used to get a cent wrong — 5% of 0.70 is 0.04, 18% of 1.25 is 0.23, 1.005 is 1.01", MJ.minorRound(0.7 * 0.05, 0.01) === 0.04 && MJ.minorRound(1.25 * 0.18, 0.01) === 0.23 && MJ.snapToStep(1.005, 0.01) === 1.01);
  let rupee = null; const oldRupee = (v) => Math.round(Math.round(v) * 1e6) / 1e6;
  for (let p = 1; p <= 300000 && !rupee; p++) for (const r of [0.05, 0.12, 0.18, 0.28]) { const v = (p / 100) * r; if (MJ.minorRound(v, 1) !== oldRupee(v)) { rupee = `₹${p / 100} at ${r}`; break; } }
  t("item 32: a rupee guest sees EXACTLY what they saw before — whole-rupee tax unchanged on every base to ₹3,000 at 5/12/18/28%", !rupee, rupee || "");
  t("item 32: snapToStep keeps its contract — no usable step → 0, a negative rounds half away from zero, and nothing is −0", MJ.snapToStep(5, 0) === 0 && MJ.snapToStep(5, NaN) === 0 && MJ.snapToStep(-0.035, 0.01) === -0.04 && Object.is(MJ.snapToStep(-0.001, 0.01), 0) && MJ.snapToStep(545.0001, 10) === 550);
  t("item 32: verify-money-round-twins checks snapToStep as the fourth copy", /lib\/money\.mjs snapToStep \(the guest's other-currency display\)/.test(src("scripts/verify-money-round-twins.mjs"))); }

// ── item 33: the order-totals test compares against the database with the app's rule and the real rate ──
{ const OT = src("tests/order-totals.e2e.mjs"), OTC = codeOf(OT);   // OTC: code only — the file's own comment quotes the old line
  t("item 33: tests/order-totals.e2e.mjs rounds its expectation by the app's one rule (roundPaise), not the float way", /import \{ roundPaise \} from "\.\.\/lib\/tax\.ts";/.test(OT) && /const tax = roundPaise\(sub \* rate\);/.test(OT) && !/Math\.round\(sub \* 0\.05 \* 100\) \/ 100/.test(OTC));
  t("item 33: …takes the restaurant's rate from the database (lfh_effective_tax_rate), never a typed 5%", /rpc\/lfh_effective_tax_rate/.test(OT) && !/\* 0\.05\b/.test(OTC));
  t("item 33: …and prices eight carts, not one, with an option group on half of them", /for \(let c = 0; c < 8; c\+\+\)/.test(OT) && /withOpts\.length && c % 2 === 0/.test(OT)); }

// ── item 34: the coverage run works on a fresh install (it needed a folder that `npm ci` does not make) ──
t("item 34: coverage.mjs creates node_modules/.cache before its reporter writes there (a fresh install has no such folder)", /mkdirSync\(dirname\(out\), \{ recursive: true \}\);/.test(src("scripts/t30-harness/coverage.mjs")) && src("scripts/t30-harness/coverage.mjs").indexOf("mkdirSync(dirname(out)") < src("scripts/t30-harness/coverage.mjs").indexOf("execFileSync(process.execPath"));

// ── item 35: claiming a tap asks for nothing back ──
{ const I = await import("@/lib/idempotency.ts"); const { req } = await import("./lib.mjs");
  world({ action_idempotency: [] }); W.UNIQUE = { action_idempotency: ["action_id"] };
  const run = I.withIdempotency(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }), "editor");
  const before = W.READS.length; await run(req({ "x-lfh-action-id": "r5-A" }, { lfh_user: "u" }), {});
  const claims = W.WRITES.filter((w) => w.table === "action_idempotency");
  t("item 35: a fresh tap's claim is one insert and one 'done' update — and it reads nothing back (no .select after the insert)", W.READS.length === before && claims.map((w) => w.op).join() === "insert,update" && !/\.insert\(\{ action_id: actionId, panel \}\)\.select\(/.test(src("lib/idempotency.ts")), claims.map((w) => w.op).join()); }

// ── item 36: a hole in the report's data reads as ₹0, never as a crash ──
{ const TF = await import("@/lib/taxFiling.ts");
  t("item 36: netSalesOf / taxableValue / taxableFor of a missing row are 0, and exemptIsMaterial of missing totals is false", TF.netSalesOf(null) === 0 && TF.taxableValue(null, 5) === 0 && TF.taxableFor(null, 5, true) === 0 && TF.exemptIsMaterial(null, 5) === false);
  const f = TF.buildFiling([{ t: 105 }, null, { t: 52.5 }], [{ label: "CGST", rate: 2.5 }, null, { label: "SGST", rate: 2.5 }], (r) => r.t);
  t("item 36: buildFiling with a missing row and a missing tax line keeps every row in place (the hole is ₹0) and still adds up", f.rows.length === 3 && f.rows[1].tax === 0 && f.total === 158 && f.rows.reduce((a, r) => a + r.tax, 0) === 158 && f.rows.every((r) => Math.round(r.parts.reduce((a, x) => a + x, 0) * 100) === r.tax * 100), JSON.stringify(f.rows.map((r) => r.parts))); }
