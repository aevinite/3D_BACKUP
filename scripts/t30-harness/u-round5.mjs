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
if (!process.env.T30_MUTATING) {
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
  if (!process.env.T30_MUTATING) t(`${f}: the project's lint finds nothing in it — no unused variable, import or eslint-disable that disables nothing`, (LINT[f] || []).length === 0, (LINT[f] || []).join(", "));
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
for (const f of TESTS) if (!process.env.T30_MUTATING) t(`${f}: the project's lint finds nothing in this test file`, (LINT[f] || []).length === 0, (LINT[f] || []).join(", "));
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
