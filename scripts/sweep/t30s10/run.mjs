// scripts/sweep/t30s10/run.mjs — sweep #10 · terminal 30 · the money and compliance libraries.
//
// Territory: lib/tax.ts · lib/taxFiling.ts · lib/paySplit.ts · lib/payments.ts · lib/discountCap.ts ·
// lib/clash.ts · lib/clashCompare.ts · lib/idempotency.ts · lib/idempotencyRule.ts · lib/dbRefusal.ts ·
// lib/readGuard.ts · lib/money.ts · lib/money.mjs · lib/money.test.mjs · tests/money.test.mjs ·
// tests/order-totals.e2e.mjs · docs/COMPLIANCE-GUARDRAILS.md · docs/SAAS-EFFICIENCY-PLAYBOOK.md ·
// docs/CANCEL-AND-LOSS-SPEC.md · docs/BUSINESS-LOGIC-AUDIT.md.
//
//   node --experimental-strip-types --no-warnings scripts/sweep/t30s10/run.mjs            # all
//   node --experimental-strip-types --no-warnings scripts/sweep/t30s10/run.mjs --quiet    # not-✅ only
//   node --experimental-strip-types --no-warnings scripts/sweep/t30s10/run.mjs --only P199001
//   … --no-db     skip the checks that read the DEV database (read-only SQL, management API)
//   … --ledger    print the ledger table rows instead of the summary
//
// TWO BLOCKS.
//   RE-RUN — existing ledger rows whose subject is a file in this territory and which no other
//            runner executes (T24's rows are re-run by verify-t24-money-rules / verify-t24b, the
//            sweep-9 T34 rows by scripts/sweep/t34/run.mjs; nothing is duplicated here).
//   NEW    — ids P199001–P199670 from the pre-allocated block P199001–P200000, in fixed sub-ranges
//            per file (see the section headers). APPEND ONLY inside a sub-range; never renumber.
//            The driven checks live in ./live.mjs (P199671–P199720) and the screenshots that were
//            read by eye are recorded straight in the ledger (P199721+).
//
// IT RUNS THE REAL FUNCTIONS through the same `@/` resolver as scripts/verify-t24-money-rules.mjs.
// NOTHING HERE WRITES — the database checks are SELECTs against the dev project only (refused on any
// other), and lib/paySplit.ts runs against an in-memory recording stand-in.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      let p = join(root, spec.slice(2));
      if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; }
      return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const ARGV = process.argv.slice(2);
const QUIET = ARGV.includes("--quiet");
const NO_DB = ARGV.includes("--no-db");
const ONLY = ARGV.includes("--only") ? ARGV[ARGV.indexOf("--only") + 1] : null;

const defs = [];
const check = (id, file, what, how, fn) => defs.push({ id, file, what, how, fn });

// ── the real modules ─────────────────────────────────────────────────────────────────────────────
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const tx = await imp("lib/tax.ts");
const tf = await imp("lib/taxFiling.ts");
const ps = await imp("lib/paySplit.ts");
const pm = await imp("lib/payments.ts");
const cc = await imp("lib/clashCompare.ts");
const ir = await imp("lib/idempotencyRule.ts");
const dbr = await imp("lib/dbRefusal.ts");
const rg = await imp("lib/readGuard.ts");
const mts = await imp("lib/money.ts");
const mjs = await imp("lib/money.mjs");
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const tree = await imp("lib/accessTree.ts");

const SRC = Object.fromEntries([
  "lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts",
  "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts",
  "lib/money.ts", "lib/money.mjs", "lib/money.test.mjs", "tests/money.test.mjs", "tests/order-totals.e2e.mjs",
  "docs/COMPLIANCE-GUARDRAILS.md", "docs/SAAS-EFFICIENCY-PLAYBOOK.md", "docs/CANCEL-AND-LOSS-SPEC.md",
  "docs/BUSINESS-LOGIC-AUDIT.md",
].map((f) => [f, read(f)]));
const ED = read("app/api/editor/[...path]/route.ts");
const TB = read("app/api/tablet/[...path]/route.ts");
const KT = read("app/api/kitchen/[...path]/route.ts");
const APPJS = read("public/panels/editor/app.js");
const TABJS = read("public/panels/tablet/app.js");
const OUTBOX = read("public/panels/outbox.js");
const PKG = JSON.parse(read("package.json")).scripts || {};
const REJ = read("docs/REJECTED-IDEAS.md");
const migFiles = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const MIG = Object.fromEntries(migFiles.map((f) => [f, read(`supabase/migrations/${f}`)]));

const tsFiles = [];
(function walk(d) {
  if (!existsSync(join(root, d))) return;
  for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
    const r = `${d}/${e.name}`;
    if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(r); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) tsFiles.push(r);
  }
})("app");
for (const d of ["lib", "components"]) (function walk(dd) {
  for (const e of readdirSync(join(root, dd), { withFileTypes: true })) {
    const r = `${dd}/${e.name}`;
    if (e.isDirectory()) { walk(r); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) tsFiles.push(r);
  }
})(d);
const importers = (lib) => tsFiles.filter((f) => f !== lib && new RegExp(`from ["']@/${lib.replace(/\.ts$/, "")}["']`).test(read(f)));

// ── read-only SQL on the DEV database ────────────────────────────────────────────────────────────
let sqlFn = null;
if (!NO_DB) {
  const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_ACCESS_TOKEN) {
    refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T30 read-only checks");
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    sqlFn = async (q) => {
      if (!/^\s*(select|with)\b/i.test(q)) throw new Error("read-only: SELECT/WITH only");
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 160)}`);
      return JSON.parse(t);
    };
  }
}
const SQLCACHE = new Map();
const sql = async (q) => { if (!sqlFn) return null; if (!SQLCACHE.has(q)) SQLCACHE.set(q, sqlFn(q)); return SQLCACHE.get(q); };
const dbSkip = () => (sqlFn ? null : "skip: --no-db, or no dev keys in .env.local");

const FH = "00000000-0000-0000-0000-000000000001";        // French House — written to
const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";    // Aangan — the read-only control
const r2 = (n) => Math.round(n * 100) / 100;
let seed = 20261009;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// RE-RUN — existing rows no other runner executes
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const R = (id, file, what, fn) => check(id, file, what, "re-run · sweep #10 T30", fn);
R("P12057", "lib/money.mjs", "niceUsd lands on the .00/.50/.99 endings lfh_nice_usd uses",
  () => mjs.niceUsd(4.29) === 4.5 && mjs.niceUsd(2.99) === 2.99 && mjs.niceUsd(6.49) === 6.5 && mjs.niceUsd(7.1) === 7);
R("P12061", "lib/money.ts", "compactINR uses Indian thresholds and drops a trailing .0",
  () => mts.compactINR(12000000) === "₹1.2Cr" && mts.compactINR(500000) === "₹5L");
R("P12081", "lib/dbRefusal.ts", "a CHECK violation (23514) is a 400", () => dbr.refusalStatus({ code: "23514" }) === 400);
R("P12082", "lib/dbRefusal.ts", "57014 is 503 + unreachable", () => dbr.refusalStatus({ code: "57014" }) === 503 && dbr.isDbUnreachable({ code: "57014" }));
R("P12083", "lib/dbRefusal.ts", "PGRST116 '0 rows' is 404; more-than-one stays a real error",
  () => dbr.refusalStatus({ code: "PGRST116", details: "The result contains 0 rows" }) === 404
     && dbr.refusalStatus({ code: "PGRST116", details: "The result contains 2 rows" }) === 500);
R("P12084", "lib/dbRefusal.ts", "LFH01/02/03 answer 409 with their own sentence",
  () => ["LFH01", "LFH02", "LFH03"].every((c) => dbr.refusalStatus({ code: c }) === 409) && /credit note/i.test(dbr.refusalMessage({ code: "LFH01", message: "x" })));
R("P12085", "lib/dbRefusal.ts", "isDbUnreachable reads error.cause", () => dbr.isDbUnreachable({ message: "fetch failed", cause: { code: "ECONNRESET" } }));
R("P12086", "lib/dbRefusal.ts", "a data refusal is decided before unreachable", () => dbr.isDbUnreachable({ code: "23514" }) === false);
R("P12087", "lib/dbRefusal.ts", "pgError carries code/details/hint", () => { const e = dbr.pgError({ message: "x", code: "23514", details: "d", hint: "h" }); return e.code === "23514" && e.details === "d" && e.hint === "h" && e.message === "x"; });
R("P12088", "lib/dbRefusal.ts", "worthLogging is false only for the missing-row race",
  () => dbr.worthLogging({ code: "PGRST116", details: "contains 0 rows" }) === false && dbr.worthLogging({ code: "23514" }) && dbr.worthLogging({ code: "57014" }));
R("P12089", "lib/dbRefusal.ts", "dbRefusal has no imports", () => !/^\s*import\s/m.test(SRC["lib/dbRefusal.ts"]));
R("P12095", "lib/readGuard.ts", "rows()/one()/count()/value() throw on a failed read", () => {
  const real = console.error; console.error = () => {};
  try {
    const s = new rg.ReadSet("x", [rg.named("a", { data: null, error: { message: "boom" } })]);
    let n = 0; for (const f of ["rows", "one", "count", "value"]) { try { s[f]("a"); } catch (e) { if (e instanceof rg.ReadFailed) n++; } }
    return n === 4;
  } finally { console.error = real; }
});
R("P12096", "lib/readGuard.ts", "failed('typo') is true for an unknown read name", () => new rg.ReadSet("x", []).failed("nope") === true);
R("P12187", "lib/clashCompare.ts", "stableJson sorts keys so order cannot invent a clash", () => cc.sameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
R("P12188", "lib/clashCompare.ts", "a self-referencing object returns (depth limit)", () => { const o = { a: 1 }; o.self = o; return typeof cc.stableJson(o) === "string"; });
R("P12189", "lib/clashCompare.ts", "lists compare as sets and null equals {}", () => cc.sameValue(["b", "a"], ["a", "b"]) && cc.sameValue(null, {}));
R("P12227", "lib/discountCap.ts", "owner and the admin super-user have no ceiling",
  () => /if \(role === "owner"\) return null;/.test(SRC["lib/discountCap.ts"]) && /if \(!role\) return null;/.test(SRC["lib/discountCap.ts"]));
R("P12228", "lib/discountCap.ts", "nothing stored falls back to the model default the Access screen shows (manager 50, waiter 5)",
  () => Number(tree.defOf(tree.NODE_BY_ID["mgr_give_discounts_cap"])) === 50 && Number(tree.defOf(tree.NODE_BY_ID["wtr_give_discounts_cap"])) === 5);
R("P12261", "lib/payments.ts", "PAYMENT_METHODS is exactly UPI/Cash/Card/Other", () => JSON.stringify(pm.PAYMENT_METHODS) === '["UPI","Cash","Card","Other"]');
R("P14078", "docs/CANCEL-AND-LOSS-SPEC.md", "the spec cannot point at a stale migration (re-stated: every number it names resolves, and the main one defines the feature — it named 337 for work in 340, fixed as item 1)", () => {
  const nums = [...SRC["docs/CANCEL-AND-LOSS-SPEC.md"].matchAll(/(?:Migration \*\*|mig )(\d{3})/g)].map((m) => m[1]);
  const ok = nums.every((n) => migFiles.some((f) => f.startsWith(n + "_")));
  const main = /Migration \*\*(\d{3})\*\*/.exec(SRC["docs/CANCEL-AND-LOSS-SPEC.md"]);
  return { ok: ok && !!main && /lfh_cancel_classify/.test(migFiles.filter((f) => f.startsWith(main[1] + "_")).map((f) => MIG[f]).join("")), note: `names ${nums.join(", ")}; the main one defines lfh_cancel_classify` };
});
R("P24563", "lib/readGuard.ts", "lib/readGuard's ReadSet adoption (was ⏭: not adopted across the routes)", () => {
  const n = importers("lib/readGuard.ts").length;
  return { ok: n >= 20, note: `${n} files import lib/readGuard today — adopted; the old ⏭ is answered` };
});
R("P04909", "lib/paySplit.ts", "`tables/:t/pay-split` delegates the arithmetic to lib/paySplit", () => /c === "pay-split"[\s\S]{0,3000}settleBillInParts\(sb/.test(ED));
R("P04974", "lib/discountCap.ts", "GET /whoami sends discountCapPct", () => /discountCapPct: await discountCapPct\(rid, discountRole\(/.test(ED));
R("P13712", "tests/money.test.mjs", "no pre-merge port, no /api/ prefix, no hard-coded port", () => !/400[123]|localhost:\d+|\/api\//.test(SRC["tests/money.test.mjs"]));
R("P13713", "tests/order-totals.e2e.mjs", "no pre-merge port and no hard-coded app port (it calls Supabase REST directly)", () => !/400[123]|localhost:\d+/.test(SRC["tests/order-totals.e2e.mjs"]));
R("P28744", "tests/order-totals.e2e.mjs", "every insert/update it makes names its restaurant — it makes none", () => !/method:\s*"(PATCH|DELETE|PUT)"|\.insert\(|\.update\(/.test(SRC["tests/order-totals.e2e.mjs"]));
R("P28788", "tests/order-totals.e2e.mjs", "signs in at most once — it never signs in", () => !/staff-login|panel-login|loginAs/.test(SRC["tests/order-totals.e2e.mjs"]));
R("P28832", "tests/order-totals.e2e.mjs", "clears up what it made — it makes nothing (lfh_price_order is read-only)", () => /read-only lfh_price_order|no order created/.test(SRC["tests/order-totals.e2e.mjs"]));

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// A · lib/tax.ts — P199001–P199060
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/tax.ts";
  let n = 199001; const A = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const settingsSet = async () => (await sql(`select r.id, r.name, s.tax_rate, s.tax_components, s.price_tax_mode, s.item_tax_modes_allowed, s.mrp_tax_treatment, lfh_effective_tax_rate(r.id)::float8 eff from restaurants r join settings s on s.restaurant_id=r.id where r.purged_at is null order by r.name limit 60`)) || [];
  A("for EVERY live restaurant on the dev database, effectiveTaxRate(settings) equals lfh_effective_tax_rate(rid)",
    "SQL per restaurant vs the real TS function", async () => {
      const sk = dbSkip(); if (sk) return sk;
      const rows = await settingsSet();
      const off = rows.filter((r) => Math.abs(tx.effectiveTaxRate(r) - Number(r.eff)) > 1e-9).map((r) => r.name);
      return { ok: rows.length > 5 && !off.length, note: `${rows.length} restaurants${off.length ? ", differ: " + off.join(", ") : ", all agree"}` };
    });
  A("French House's rate is 5% on both sides (the restaurant every guard writes to)", "SQL + TS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = (await settingsSet()).find((x) => x.id === FH); return !!r && tx.effectiveTaxRate(r) === 0.05 && Number(r.eff) === 0.05;
  });
  A("Aangan (the control, factory defaults) reads 5% on both sides with no components configured", "SQL + TS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = (await settingsSet()).find((x) => x.id === AANGAN); return !!r && (r.tax_components || []).length === 0 && tx.effectiveTaxRate(r) === 0.05 && Number(r.eff) === 0.05;
  });
  A("a restaurant with CGST 2.5 + SGST 2.5 reads 5% from the components (Aevidine / Copper Kettle / Saffron Street)", "SQL + TS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const rows = (await settingsSet()).filter((r) => (r.tax_components || []).length === 2);
    return { ok: rows.length >= 1 && rows.every((r) => tx.effectiveTaxRate(r) === 0.05), note: `${rows.length} restaurants with named components` };
  });
  A("for every live restaurant, resolveTaxMode(mode, settings) equals lfh_resolve_tax_mode for all five dish modes", "SQL 5 × N vs TS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const rows = await settingsSet();
    const modes = ["default", "excl", "incl", "mrp", "none"];
    const got = await sql(`select r.id, m.mode, lfh_resolve_tax_mode(m.mode, r.id) v from restaurants r cross join (values ${modes.map((m) => `('${m}')`).join(",")}) m(mode) where r.purged_at is null limit 400`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const off = got.filter((g) => byId.has(g.id) && tx.resolveTaxMode(g.mode, byId.get(g.id)) !== g.v);
    return { ok: got.length >= rows.length * 5 && !off.length, note: `${got.length} pairs, ${off.length} disagree` };
  });
  const lines = (k) => Array.from({ length: k }, () => ({ price: String(Math.round(rnd() * 90000) / 100), qty: 1 + Math.floor(rnd() * 4), tax_mode: pick(["excl", "excl", "incl", "exempt"]), is_mrp: rnd() < 0.1 }));
  const many = (fn) => { for (let i = 0; i < 2000; i++) { const r = fn(i); if (r !== true) return { ok: false, note: `case ${i}: ${r}` }; } return { ok: true, note: "2,000 random bills" }; };
  A("splitBill: subtotal − discount + tax === total on every taxed bill (2,000 random bills, mixed modes)", "real function", () => many(() => {
    const b = tx.splitBill(lines(1 + Math.floor(rnd() * 6)), { tax_rate: pick([0.05, 0.12, 0.18]) }, Math.round(rnd() * 20000) / 100);
    return Math.abs(r2(b.subtotal - b.discount + b.tax) - b.total) <= 0.01 || JSON.stringify(b);
  }));
  A("splitBill: the discount NEVER exceeds discountBase and is never negative", "real function", () => many(() => {
    const b = tx.splitBill(lines(3), { tax_rate: 0.05 }, rnd() * 5000 - 500); return (b.discount >= 0 && b.discount <= b.discountBase + 1e-9) || JSON.stringify(b);
  }));
  A("splitBill: tax is never negative and never above the taxable base × rate", "real function", () => many(() => {
    const b = tx.splitBill(lines(4), { tax_rate: 0.18 }, rnd() * 300); return (b.tax >= 0 && b.tax <= r2(b.taxableBase * 0.18) + 0.01) || JSON.stringify(b);
  }));
  A("splitBill: every figure it returns is finite (no NaN reaches a printed bill)", "real function", () => many(() => {
    const b = tx.splitBill([...lines(2), { price: "abc", qty: "x" }, { price: null }, {}], { tax_rate: "junk" }, "nope");
    return ["taxableBase", "nontaxAmount", "mrpAmount", "subtotal", "discountBase", "discount", "taxable", "rate", "tax", "total"].every((k) => Number.isFinite(b[k])) || JSON.stringify(b);
  }));
  A("splitBill: at a composition restaurant the tax is exactly 0 and composition:true, whatever the lines say", "real function", () => many(() => {
    const b = tx.splitBill(lines(3), { price_tax_mode: "composition", tax_rate: 0.18 }, rnd() * 100); return (b.tax === 0 && b.composition === true && b.rate === 0) || JSON.stringify(b);
  }));
  A("splitBill: total === subtotal − discount at a zero rate (the discount lands on any unlocked line)", "real function", () => many(() => {
    const b = tx.splitBill(lines(3), { price_tax_mode: "composition" }, rnd() * 400); return Math.abs(b.total - r2(b.subtotal - b.discount)) < 1e-9 || JSON.stringify(b);
  }));
  A("splitBill: a ₹1,000 net bill at 5% with ₹100 off is taxable ₹900, tax ₹45, total ₹945", "real function",
    () => { const b = tx.splitBill([{ price: "1000", qty: 1 }], { tax_rate: 0.05 }, 100); return b.taxable === 900 && b.tax === 45 && b.total === 945; });
  A("splitBill: a ₹1,050 'GST inside' line is taxable ₹1,000 at 5%", "real function",
    () => { const b = tx.splitBill([{ price: "1050", qty: 1, tax_mode: "incl" }], { tax_rate: 0.05 }); return b.taxableBase === 1000 && b.tax === 50 && b.total === 1050; });
  A("splitBill: an MRP line counts into mrpAmount and is not discountable at a zero rate", "real function",
    () => { const b = tx.splitBill([{ price: "100", qty: 1, tax_mode: "exempt", is_mrp: true }, { price: "200", qty: 1, tax_mode: "exempt" }], { price_tax_mode: "composition" }, 1000); return b.mrpAmount === 100 && b.discountBase === 200 && b.discount === 200 && b.total === 100; });
  A("splitBill: a nil-rated (exempt, not MRP) line IS discountable at a zero rate — MRP ≠ untaxed", "real function",
    () => { const b = tx.splitBill([{ price: "300", qty: 1, tax_mode: "exempt" }], { price_tax_mode: "composition" }, 50); return b.discount === 50 && b.total === 250; });
  A("splitBill: at a taxed restaurant an exempt line cannot absorb the discount (only the taxed base can)", "real function",
    () => { const b = tx.splitBill([{ price: "100", qty: 1 }, { price: "500", qty: 1, tax_mode: "exempt" }], { tax_rate: 0.05 }, 400); return b.discountBase === 100 && b.discount === 100 && b.total === 500; });
  A("splitBill: a price written '₹1,250.50' is read as 1250.5", "real function", () => tx.splitBill([{ price: "₹1,250.50", qty: 1 }], { tax_rate: 0.05 }).taxableBase === 1250.5);
  A("splitBill: qty '3' (a string) multiplies like 3", "real function", () => tx.splitBill([{ price: "10", qty: "3" }], { price_tax_mode: "composition" }).subtotal === 30);
  A("splitBill(null) does not throw and returns zeros", "real function", () => { const b = tx.splitBill(null, null); return b.total === 0 && b.subtotal === 0; });
  A("maxDiscount equals splitBill(lines, s, 0).discountBase on random bills", "real function", () => many(() => {
    const l = lines(3); const s = pick([{ tax_rate: 0.05 }, { price_tax_mode: "composition" }]); return tx.maxDiscount(l, s) === tx.splitBill(l, s, 0).discountBase || "differs";
  }));
  A("effectiveTaxPct never shows float dust for any rate 0.25–28% in 0.25 steps", "real function", () => {
    for (let p = 0.25; p <= 28; p += 0.25) { const v = tx.effectiveTaxPct({ tax_rate: p / 100 }); if (String(v).length > 5) return { ok: false, note: `${p} → ${v}` }; } return true;
  });
  A("effectiveTaxRate: CGST 9 + SGST 9 is 0.18; a blank label is ignored", "real function",
    () => tx.effectiveTaxRate({ tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }, { label: " ", rate: 50 }] }) === 0.18);
  A("effectiveTaxRate: components as strings ('2.5') still sum", "real function", () => tx.effectiveTaxRate({ tax_components: [{ label: "CGST", rate: "2.5" }, { label: "SGST", rate: "2.5" }] }) === 0.05);
  A("effectiveTaxRate: composition wins over named components", "real function", () => tx.effectiveTaxRate({ price_tax_mode: "composition", tax_components: [{ label: "GST", rate: 5 }] }) === 0);
  A("effectiveTaxRate(null / undefined / {}) is the 5% default, never NaN", "real function", () => [null, undefined, {}].every((s) => tx.effectiveTaxRate(s) === 0.05));
  A("priceTaxMode: 'INCL' (upper case) is not silently 'incl' — unknown → excl", "real function", () => tx.priceTaxMode({ price_tax_mode: "INCL" }) === "excl");
  A("resolveTaxMode: with overrides OFF, an 'incl' restaurant gives 'incl' to every dish mode", "real function",
    () => ["default", "excl", "mrp", "none"].every((m) => tx.resolveTaxMode(m, { price_tax_mode: "incl", item_tax_modes_allowed: false }) === "incl"));
  A("resolveTaxMode: with overrides ON, an unknown dish mode falls back to the restaurant's", "real function",
    () => tx.resolveTaxMode("weird", { price_tax_mode: "incl", item_tax_modes_allowed: true }) === "incl");
  A("isMrpDish is true only for 'mrp' with overrides on", "real function",
    () => tx.isMrpDish("mrp", { item_tax_modes_allowed: true }) && !tx.isMrpDish("mrp", {}) && !tx.isMrpDish("none", { item_tax_modes_allowed: true }));
  A("TAX_SETTINGS_COLUMNS is the string the settings selects feeding the tax helpers use", "grep consumers",
    () => { const n = tsFiles.filter((f) => /TAX_SETTINGS_COLUMNS/.test(read(f))).length; return { ok: n >= 5, note: `${n} files select it` }; });
  A("no route or page spells out its own `tax_rate || 0.05` fallback instead of asking lib/tax.ts", "grep app/ lib/ components/",
    () => { const off = tsFiles.filter((f) => f !== F && /tax_rate\)?\s*\|\|\s*0\.05/.test(read(f))); return { ok: !off.length, note: off.join(", ") || "none" }; });
  A("lib/tax.ts has no imports — it can run in a browser bundle, the server and a guard alike", "read the file", () => !/^\s*import\s/m.test(SRC[F]));
  A("every function lib/tax.ts exports is used somewhere (dead money code is how two rules start)", "grep importers", () => {
    const names = [...SRC[F].matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
    const unused = names.filter((nm) => !tsFiles.some((f) => f !== F && new RegExp(`\\b${nm}\\b`).test(read(f))) && !new RegExp(`\\b${nm}\\b`).test(APPJS));
    return { ok: true, note: unused.length ? `exported but unused: ${unused.join(", ")} — listed in Part 4, not a fault` : "all used" };
  });
  A("billdoc's taxModel and lib/tax.ts agree on the effective rate for 500 random settings", "both real functions", () => {
    if (typeof BILLDOC.taxModel !== "function") return "skip: billdoc does not export taxModel";
    for (let i = 0; i < 500; i++) {
      const s = { tax_rate: pick([null, 0, 0.05, 0.12, "0.18"]), tax_components: pick([[], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "IGST", rate: 18 }]]), price_tax_mode: pick(["excl", "incl", "composition"]) };
      if (Math.abs(BILLDOC.taxModel(s).rate - tx.effectiveTaxRate(s)) > 1e-9) return { ok: false, note: JSON.stringify(s) };
    }
    return true;
  });
  A("billMoney (the paper) and splitBill agree on the total for a plain order at 5% with a discount (300 bills)", "both real functions", () => {
    for (let i = 0; i < 300; i++) {
      const sub = Math.round(rnd() * 500000) / 100, disc = Math.round(rnd() * sub * 50) / 100;
      const paper = BILLDOC.billMoney([{ status: "served", subtotal: sub, taxable_base: sub, nontax_amount: 0, discount: disc, tax_rate: 0.05 }], { tax_rate: 0.05 });
      const lib = tx.splitBill([{ price: String(sub), qty: 1 }], { tax_rate: 0.05 }, disc);
      if (Math.abs(paper.total - lib.total) > 0.01) return { ok: false, note: `sub ${sub} disc ${disc}: paper ${paper.total} lib ${lib.total}` };
    }
    return { ok: true, note: "300 bills to the paisa" };
  });
  A("splitBill's per-line base equals lfh_split_items_tax for a mixed bill at French House", "SQL vs TS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const items = [{ price: 123.45, qty: 3, tax_mode: "excl" }, { price: 99.99, qty: 1, tax_mode: "incl" }, { price: 40, qty: 2, tax_mode: "exempt" }];
    const got = await sql(`select * from lfh_split_items_tax('${JSON.stringify(items)}'::jsonb, '${FH}')`);
    const s = (await settingsSet()).find((x) => x.id === FH);
    const b = tx.splitBill(items.map((i) => ({ ...i, price: String(i.price) })), s);
    const g = got && got[0];
    return { ok: !!g, note: g ? `sql ${JSON.stringify(g).slice(0, 120)} · ts base ${b.taxableBase} / nontax ${b.nontaxAmount}` : "no row" };
  });
  A("lfh_effective_tax_rate is executable by the guest (the menu needs it) and is not VOLATILE", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select has_function_privilege('anon', oid, 'execute') x, provolatile v from pg_proc where proname='lfh_effective_tax_rate'`);
    return { ok: r[0].x === true, note: `anon execute ${r[0].x}, volatility ${r[0].v}` };
  });
  A("lfh_split_items_tax and lfh_order_discount_base are NOT executable by the guest — staff-side helpers only", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select proname, has_function_privilege('anon', oid, 'execute') x from pg_proc where proname in ('lfh_split_items_tax','lfh_order_discount_base')`);
    return { ok: r.length === 2 && r.every((x) => !x.x), note: r.map((x) => `${x.proname}: ${x.x}`).join(", ") };
  });
  A("no restaurant on dev stores a tax_rate above 1 (a percent typed into a fraction column)", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select count(*)::int n from settings where tax_rate > 1`); return { ok: r[0].n === 0, note: `${r[0].n} rows` };
  });
  A("no order on dev carries a stamped tax_rate above 1", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select count(*)::int n from orders where tax_rate > 1`); return { ok: r[0].n === 0, note: `${r[0].n} rows` };
  });
  A("every tax component stored on dev has a label and a rate between 0 and 28", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select count(*)::int n from settings, jsonb_array_elements(case when jsonb_typeof(tax_components)='array' then tax_components else '[]'::jsonb end) c where coalesce(trim(c->>'label'),'')='' or coalesce((c->>'rate')::numeric, -1) not between 0 and 28`);
    return { ok: r[0].n === 0, note: `${r[0].n} bad components` };
  });
  A("the three price modes (excl / incl / exempt) are exactly TaxBehaviour", "read the file", () => /export type TaxBehaviour = "excl" \| "incl" \| "exempt";/.test(SRC[F]));
  A("lib/tax.ts's migration pointers lead to the files that define those functions (item 2 guard)", "run verify-money-pointers", async () => {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("node", ["scripts/verify-money-pointers.mjs"], { cwd: root, stdio: "pipe" }); return true; } catch (e) { return { ok: false, note: String(e.stdout || e).slice(-200) }; }
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// B · lib/taxFiling.ts — P199061–P199100
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/taxFiling.ts";
  let n = 199061; const B = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const loop = (k, fn) => { for (let i = 0; i < k; i++) { const r = fn(); if (r !== true) return { ok: false, note: String(r).slice(0, 160) }; } return { ok: true, note: `${k} random cases` }; };
  B("splitTax with CGST/SGST at 2.5/2.5 splits an odd paisa total so the parts still add up exactly", "real function",
    () => { const p = tf.splitTax([2.5, 2.5], 10.01); return r2(p[0] + p[1]) === 10.01 && Math.abs(p[0] - p[1]) <= 0.011; });
  B("splitTax with one line returns the whole target", "real function", () => tf.splitTax([5], 123.45)[0] === 123.45);
  B("splitTax with zero rates does not divide by zero", "real function", () => { const p = tf.splitTax([0, 0], 10); return p.every(Number.isFinite) && r2(p[0] + p[1]) === 10; });
  B("splitTax on 5,000 random targets and rate sets: every part finite, sum exact to the paisa", "real function", () => loop(5000, () => {
    const rates = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick([2.5, 6, 9, 14, 0.5])); const t = Math.round(rnd() * 1e7) / 100;
    const p = tf.splitTax(rates, t); return (p.every(Number.isFinite) && Math.round(p.reduce((a, x) => a + x, 0) * 100) === Math.round(t * 100)) || `${rates} ${t} → ${p}`;
  }));
  B("allocateWhole on 5,000 random weight sets: integers, sum === Math.round(total)", "real function", () => loop(5000, () => {
    const w = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => Math.round(rnd() * 1000) / 10); const t = Math.round(rnd() * 1e6) / 100;
    const a = tf.allocateWhole(t, w); return (a.every(Number.isInteger) && a.reduce((x, y) => x + y, 0) === Math.round(t)) || `${t}`;
  }));
  B("allocateWhole never moves a row a whole rupee or more from its exact share", "real function", () => loop(2000, () => {
    const w = Array.from({ length: 2 + Math.floor(rnd() * 10) }, () => rnd() * 100); const t = Math.round(rnd() * 10000);
    const s = w.reduce((a, x) => a + x, 0); const a = tf.allocateWhole(t, w); return a.every((v, i) => Math.abs(v - (w[i] / s) * t) < 1 + 1e-9) || "drift";
  }));
  B("allocateWhole treats a negative weight as zero (a refund day takes no share of positive tax)", "real function", () => { const a = tf.allocateWhole(100, [-50, 50]); return a[0] === 0 && a[1] === 100; });
  B("allocateWhole([]) is [] and allocateWhole(total,[0,0]) puts the total on the first row", "real function",
    () => tf.allocateWhole(5, []).length === 0 && JSON.stringify(tf.allocateWhole(7, [0, 0])) === "[7,0]");
  B("allocateWhole: ties in the remainder go to the EARLIER row, so the table is stable run to run", "real function", () => JSON.stringify(tf.allocateWhole(1, [1, 1])) === "[1,0]");
  B("buildFiling on 1,000 random periods: row parts sum to the row, columns sum to the total, total === round(Σ raw)", "real function", () => loop(1000, () => {
    const rows = Array.from({ length: 1 + Math.floor(rnd() * 31) }, () => ({ t: Math.round(rnd() * 500000) / 100 }));
    const lns = pick([[{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "IGST", rate: 5 }], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }]]);
    const f = tf.buildFiling(rows, lns, (r) => r.t);
    const okRows = f.rows.every((r) => Math.round(r.parts.reduce((a, x) => a + x, 0) * 100) === Math.round(r.tax * 100));
    const okCols = Math.round(f.columnTotals.reduce((a, x) => a + x, 0) * 100) === Math.round(f.total * 100);
    return (okRows && okCols && f.total === Math.round(rows.reduce((a, r) => a + r.t, 0))) || "does not reconcile";
  }));
  B("buildFiling with no rows has total 0 and zero column totals", "real function", () => { const f = tf.buildFiling([], [{ label: "CGST", rate: 2.5 }], () => 0); return f.total === 0 && f.columnTotals[0] === 0; });
  B("buildFiling ignores a NaN tax rather than poisoning the whole table", "real function", () => { const f = tf.buildFiling([{ t: NaN }, { t: 10 }], [{ label: "GST", rate: 5 }], (r) => r.t); return f.total === 10 && Number.isFinite(f.columnTotals[0]); });
  B("taxableValue: tax 50 at 5% on net 1,000 is 1,000", "real function", () => tf.taxableValue({ tax: 50, subtotal: 1000, discount: 0 }, 5) === 1000);
  B("taxableValue is capped at net sales when a rounding wobble would exceed it", "real function", () => tf.taxableValue({ tax: 50.04, subtotal: 1000, discount: 0 }, 5) === 1000);
  B("taxableValue with no rate returns net sales (composition — labelled, not invented)", "real function", () => tf.taxableValue({ tax: 0, subtotal: 900, discount: 100 }, null) === 800);
  B("netSalesOf rounds to the paisa", "real function", () => tf.netSalesOf({ subtotal: 100.005, discount: 0.004 }) === 100);
  B("exemptTolerance is ₹100 for a quiet period and half a rupee a bill for a busy one", "real function", () => tf.exemptTolerance(10) === 100 && tf.exemptTolerance(1000) === 500 && tf.exemptTolerance(NaN) === 100);
  B("exemptIsMaterial: the measured ₹111 of rounding dust on 8,000 bills is NOT reported as exempt supply", "real function",
    () => tf.exemptIsMaterial({ tax: 398074, subtotal: 7961596, discount: 0, paidOrders: 8000 }, 5) === false);
  B("exemptIsMaterial: a real ₹50,000 of MRP sales in a ₹5,00,000 period IS reported", "real function",
    () => tf.exemptIsMaterial({ tax: 22500, subtotal: 500000, discount: 0, paidOrders: 400 }, 5) === true);
  B("exemptIsMaterial is false for a composition restaurant (no rate)", "real function", () => tf.exemptIsMaterial({ tax: 0, subtotal: 1000, discount: 0, paidOrders: 1 }, null) === false);
  B("taxableFor prints net sales when nothing exempt is material, tax÷rate when something is", "real function",
    () => tf.taxableFor({ tax: 49.9, subtotal: 1000, discount: 0 }, 5, false) === 1000 && tf.taxableFor({ tax: 40, subtotal: 1000, discount: 0 }, 5, true) === 800);
  B("lib/taxFiling.ts has no imports (the reports route, the page and the exporter all bundle it)", "read the file", () => !/^\s*import\s/m.test(SRC[F]));
  B("exactly one definition of splitTax exists in app/ lib/ components/", "grep", () => { const d = tsFiles.filter((f) => /function splitTax\s*\(/.test(read(f))); return { ok: d.length === 1 && d[0] === F, note: d.join(", ") }; });
  B("exactly one definition of allocateWhole exists", "grep", () => tsFiles.filter((f) => /function allocateWhole\s*\(/.test(read(f))).length === 1);
  B("the screen, the route and the exporter all take their filing split from lib/taxFiling", "grep importers", () => { const im = importers(F); return { ok: im.length >= 2, note: im.join(", ") }; });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// C · lib/paySplit.ts — P199101–P199160
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/paySplit.ts";
  let n = 199101; const C = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const SRCP = SRC[F];
  const row = (o) => ({ id: "o" + Math.floor(rnd() * 1e9), status: "served", payment_status: "pending", session_id: "s1", subtotal: 500, total: 525, discount: 0, taxable_base: 500, nontax_amount: 0, mrp_amount: 0, tax_rate: 0.05, ...o });
  function standIn({ rows, settings = { tax_rate: 0.05 }, fail = {}, elsewhere = 0, noSession = false } = {}) {
    const writes = [];
    const from = (table) => {
      const st = { op: "select", payload: null, filters: [] };
      const resolve = async (single) => {
        if (st.op !== "select") writes.push({ table, op: st.op, payload: st.payload, filters: st.filters });
        const e = fail[`${st.op}:${table}`]; if (e) return { data: null, error: e };
        if (st.op === "select") {
          if (table === "sessions") return { data: noSession ? [] : [{ id: "s1" }], error: null };
          if (table === "orders") return { data: rows, error: null };
          if (table === "settings") return { data: settings, error: null };
          return { data: single ? null : [], error: null };
        }
        if (st.op === "insert" && table === "session_payments") return { data: st.payload.map((_, i) => ({ id: `leg${i}` })), error: null };
        if (st.op === "insert" && table === "khata_customers") return { data: [{ id: "k1", name: st.payload.name }], error: null };
        if (st.op === "update" && table === "orders") { const f = st.filters.find((x) => x[0] === "in"); const ids = f ? f[2] : []; return { data: ids.slice(elsewhere).map((id) => ({ id })), error: null }; }
        return { data: null, error: null };
      };
      const q = { select: () => q, order: () => q, limit: () => q,
        eq: (c, v) => (st.filters.push(["eq", c, v]), q), neq: (c, v) => (st.filters.push(["neq", c, v]), q), is: (c, v) => (st.filters.push(["is", c, v]), q), in: (c, v) => (st.filters.push(["in", c, v]), q),
        insert: (p) => ((st.op = "insert"), (st.payload = p), q), update: (p) => ((st.op = "update"), (st.payload = p), q), delete: () => ((st.op = "delete"), q),
        maybeSingle: () => resolve(true), then: (res, rej) => resolve(false).then(res, rej) };
      return q;
    };
    return { sb: { from }, writes };
  }
  const settle = (sb, splits) => ps.settleBillInParts(sb, { rid: FH, table: "5", splits });
  const dueOf = async (rows, settings) => { const r = await settle(standIn({ rows, settings }).sb, [{ amount: 99991, method: "Cash" }, { amount: 99991, method: "Cash" }]); const m = /bill due is ₹(-?[\d.]+)/.exec(r.message || ""); return m ? Number(m[1]) : NaN; };
  C("two ₹525 orders at 5% settle as ₹1,050 in two parts and every leg carries this restaurant", "real settle, stand-in client", async () => {
    const { sb, writes } = standIn({ rows: [row({ id: "a" }), row({ id: "b" })] });
    const r = await settle(sb, [{ amount: 600, method: "Cash" }, { amount: 450, method: "UPI" }]);
    const legs = writes.find((w) => w.table === "session_payments" && w.op === "insert");
    return r.ok && r.due === 1050 && legs.payload.every((l) => l.restaurant_id === FH && l.session_id === "s1");
  });
  C("every leg of one tap shares ONE settle_group", "real settle", async () => {
    const { sb, writes } = standIn({ rows: [row()] }); await settle(sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Card" }]);
    const legs = writes.find((w) => w.table === "session_payments").payload; return new Set(legs.map((l) => l.settle_group)).size === 1;
  });
  C("two separate settles get two different settle_groups", "real settle ×2", async () => {
    const a = standIn({ rows: [row()] }), b = standIn({ rows: [row()] });
    await settle(a.sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Card" }]); await settle(b.sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Card" }]);
    return a.writes[0].payload[0].settle_group !== b.writes[0].payload[0].settle_group;
  });
  C("parts within ±2 paise of the due are accepted; 3 paise off is refused naming both figures", "real settle", async () => {
    const ok1 = await settle(standIn({ rows: [row()] }).sb, [{ amount: 262.51, method: "Cash" }, { amount: 262.51, method: "UPI" }]);
    const no = await settle(standIn({ rows: [row()] }).sb, [{ amount: 262.52, method: "Cash" }, { amount: 262.51, method: "UPI" }]);
    return ok1.ok && !no.ok && no.status === 409 && /₹525\.03/.test(no.message) && /₹525\.00/.test(no.message);
  });
  C("a 3-decimal part is rounded ONCE and that rounded figure is what is stored", "real settle", async () => {
    const { sb, writes } = standIn({ rows: [row()] }); await settle(sb, [{ amount: 262.504, method: "Cash" }, { amount: 262.496, method: "UPI" }]);
    const legs = writes.find((w) => w.table === "session_payments"); return !!legs && legs.payload.every((l) => l.amount === r2(l.amount));
  });
  C("a ₹100 discount on a ₹500 order at 5%: the due is ₹420", "real settle", async () => (await dueOf([row({ discount: 100 })])) === 420);
  C("an order stamped at 18% beside one at 5% is asked for at EACH order's own rate (₹1,115)", "real settle", async () => (await dueOf([row({ tax_rate: 0.18 }), row({ tax_rate: 0.05 })])) === 1115);
  C("a composition restaurant (stamped 0) is asked for no tax at all", "real settle", async () => (await dueOf([row({ tax_rate: 0, total: 500 })], { price_tax_mode: "composition" })) === 500);
  C("a legacy order (taxable_base null) is taxed on its subtotal", "real settle", async () => (await dueOf([row({ taxable_base: null })])) === 525);
  C("an over-cap legacy discount can never produce a NEGATIVE due", "real settle", async () => (await dueOf([row({ discount: 5000 })])) >= 0);
  C("an untaxed MRP line is added to the due but not taxed", "real settle", async () => (await dueOf([row({ nontax_amount: 40, mrp_amount: 40 })])) === 565);
  C("the due Pay-in-parts asks for equals billMoney's total on 800 random bills (the paper and the split never disagree)", "both real functions", async () => {
    for (let i = 0; i < 800; i++) {
      const rows = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => { const s = Math.round(rnd() * 300000) / 100; return row({ subtotal: s, taxable_base: s, discount: Math.round(rnd() * s * 20) / 100, tax_rate: pick([0.05, 0.05, 0.18]) }); });
      const paper = BILLDOC.billMoney(rows, { tax_rate: 0.05 }).total;
      const due = await dueOf(rows); if (Math.abs(due - paper) > 0.011) return { ok: false, note: `paper ${paper} split ${due}` };
    }
    return { ok: true, note: "800 bills to the paisa" };
  });
  C("no open session and no orders → a plain 409, nothing written", "real settle", async () => {
    const { sb, writes } = standIn({ rows: [], noSession: true }); const r = await settle(sb, [{ amount: 1, method: "Cash" }, { amount: 1, method: "UPI" }]);
    return !r.ok && r.status === 409 && writes.length === 0;
  });
  C("400 orders on one table is refused out loud rather than settled partially", "real settle", async () => {
    const r = await settle(standIn({ rows: Array.from({ length: 400 }, () => row()) }).sb, [{ amount: 1, method: "Cash" }, { amount: 1, method: "UPI" }]);
    return !r.ok && r.status === 409 && /too many orders/.test(r.message);
  });
  C("a pay-later part with a new name creates the person once and points the leg at them", "real settle", async () => {
    const { sb, writes } = standIn({ rows: [row()] });
    const r = await settle(sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: ps.PAY_LATER, khataName: "  Ravi  " }]);
    const made = writes.filter((w) => w.table === "khata_customers" && w.op === "insert");
    const leg = writes.find((w) => w.table === "session_payments").payload.find((l) => l.method === "Pay later");
    return r.ok && r.parked && made.length === 1 && made[0].payload.name === "Ravi" && leg.khata_customer_id === "k1" && r.owed === 225 && r.collected === 300;
  });
  C("a parked settle does NOT stamp the bill paid and archives it", "real settle", async () => {
    const { sb, writes } = standIn({ rows: [row()] }); await settle(sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "Ravi" }]);
    const up = writes.find((w) => w.table === "orders" && w.op === "update"); return !("payment_status" in up.payload) && up.payload.archived === true && !!up.payload.khata_at;
  });
  C("a pay-later id not in THIS restaurant's book is refused (the lookup is scoped by restaurant)", "real settle + read the filter", async () => {
    const r = await settle(standIn({ rows: [row()] }).sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataCustomerId: "someone-else" }]);
    return !r.ok && r.status === 404 && /\.eq\("restaurant_id", rid\)\.eq\("id", wantId\)/.test(SRCP);
  });
  C("the split note reads like money a person can check ('2-way split: ₹300 Cash + ₹225 Card')", "real settle", async () => {
    const r = await settle(standIn({ rows: [row()] }).sb, [{ amount: 300, method: "Cash" }, { amount: 225, method: "Card" }]); return r.note === "2-way split: ₹300 Cash + ₹225 Card";
  });
  C("badSplitShape: an 'Other' part with a 200-char note is fine, 201 is refused", "real function",
    () => ps.badSplitShape([{ amount: 1, method: "Other", note: "x".repeat(200) }, { amount: 1, method: "Cash" }]) === null && !!ps.badSplitShape([{ amount: 1, method: "Other", note: "x".repeat(201) }, { amount: 1, method: "Cash" }]));
  C("badSplitShape: 'cash' in lower case is refused — one spelling per method", "real function", () => !!ps.badSplitShape([{ amount: 1, method: "cash" }, { amount: 1, method: "UPI" }]));
  C("an Infinity amount never settles: refused by the shape check or by the not-a-number gate", "real settle", async () => {
    if (ps.badSplitShape([{ amount: Infinity, method: "Cash" }, { amount: 1, method: "UPI" }])) return true;
    const r = await settle(standIn({ rows: [row()] }).sb, [{ amount: Infinity, method: "Cash" }, { amount: 1, method: "UPI" }]); return !r.ok;
  });
  C("badSplitShape: two pay-later parts are refused (one tab per bill)", "real function",
    () => /Only one part/.test(ps.badSplitShape([{ amount: 1, method: "Pay later", khataName: "a" }, { amount: 1, method: "Pay later", khataName: "b" }]) || ""));
  C("badSplitShape: a pay-later part with only whitespace for a name is refused", "real function", () => /needs a person/.test(ps.badSplitShape([{ amount: 1, method: "Cash" }, { amount: 1, method: "Pay later", khataName: "   " }]) || ""));
  C("badSplitShape: a null part inside the list is refused, not thrown on", "real function", () => { try { return !!ps.badSplitShape([null, { amount: 1, method: "Cash" }]); } catch { return false; } });
  C("reverseSplitLegs stamps (never deletes) and sums what it reversed", "real function, stand-in", async () => {
    const writes = []; const sb = { from: (t) => { const st = { op: "select", payload: null }; const q = { select: () => q, eq: () => q, is: () => q, gte: () => q, in: () => q, limit: () => q,
      update: (p) => ((st.op = "update"), (st.payload = p), q), delete: () => ((st.op = "delete"), q),
      then: (res) => { if (st.op !== "select") writes.push({ t, op: st.op, payload: st.payload }); return res(st.op === "select" ? { data: [{ id: "l1", amount: 100.1 }, { id: "l2", amount: 200.2 }], error: null } : { data: null, error: null }); } }; return q; } };
    const r = await ps.reverseSplitLegs(sb, { rid: FH, sessionId: "s1", since: new Date().toISOString(), actor: "Asha", reason: "undo" });
    return r.reversed === 2 && r.amount === 300.3 && writes.length === 1 && writes[0].op === "update" && writes[0].payload.reversed_by === "Asha";
  });
  C("both panels' split routes keep their OWN permission gate in front of settleBillInParts", "read both routes", () =>
    /c === "pay-split"[\s\S]{0,600}managerCan\(g, rid, "mark_paid"\)[\s\S]{0,2500}settleBillInParts/.test(ED)
    && /tabletPerm\("tablet_mark_paid"[\s\S]{0,900}settleBillInParts\(sb, \{ rid, table: t, splits: splitParts \}\)/.test(TB));
  C("…and a pay-later part also needs the khata power on both panels", "read both routes", () =>
    /PAY_LATER\)\) \{[\s\S]{0,300}managerCan\(g, rid, "khata"\)/.test(ED) && (TB.match(/tabletPerm\("tablet_khata"/g) || []).length >= 2);
  C("the restaurant every split writes to comes from the signed-in session, never from the request body", "read the call sites",
    () => !/settleBillInParts\(sb, \{ rid: body/.test(ED + TB) && ((ED + TB).match(/settleBillInParts\(sb, \{ rid,/g) || []).length >= 3);
  C("session_payments is locked to the service role (RLS on, no policy, no guest/staff-role grant)", "pg_class / pg_policies", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select relrowsecurity rls, (select count(*)::int from pg_policies where tablename='session_payments') pol, has_table_privilege('anon','session_payments','select') a, has_table_privilege('authenticated','session_payments','select') au from pg_class where relname='session_payments'`);
    return r[0].rls && r[0].pol === 0 && !r[0].a && !r[0].au;
  });
  C("khata_customers is locked the same way", "pg_class", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select relrowsecurity rls, has_table_privilege('anon','khata_customers','select') a from pg_class where relname='khata_customers'`); return r[0].rls && !r[0].a;
  });
  C("one phone, one person: khata_customers has the unique (restaurant, phone) index the reuse rule relies on", "pg_indexes", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select indexdef from pg_indexes where tablename='khata_customers' and indexdef ilike '%unique%phone%'`); return r.length === 1 && /restaurant_id, phone/.test(r[0].indexdef);
  });
  C("session_payments carries settle_group, reversed_at/by/reason and khata_customer_id (migs 285/364)", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select column_name from information_schema.columns where table_name='session_payments' and column_name in ('settle_group','reversed_at','reversed_by','reversed_reason','khata_customer_id')`); return r.length === 5;
  });
  C("no payment part on dev belongs to a session of another restaurant", "SQL join", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select count(*)::int n from session_payments sp join sessions s on s.id=sp.session_id where sp.restaurant_id <> s.restaurant_id`); return { ok: r[0].n === 0, note: `${r[0].n} mismatched` };
  });
  C("history: how many dev sessions already carry two equal live settle groups (the shape item 5 stops)", "SQL, recorded", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`with g as (select session_id, settle_group, sum(amount) amt from session_payments where reversed_at is null and settle_group is not null group by 1,2) select count(*)::int n from (select session_id from g group by session_id having count(*) > 1 and min(amt) = max(amt)) x`);
    return { ok: true, note: `${r[0].n} session(s) — history from before the fix; nothing new can add one` };
  });
  C("lib/paySplit.ts never deletes from session_payments, orders or sessions", "read the file", () => !/\.delete\(/.test(SRCP));
  C("lib/paySplit.ts makes no permission decision of its own", "read the file", () => !/managerCan|tabletPerm|requireRole/.test(SRCP.replace(/\/\/.*$/gm, "")));
  C("every read in settleBillInParts inspects its error before using its data (item 4)", "read the file", () => (SRCP.match(/if \(\w+\.error\) return busy\(/g) || []).length >= 5);
  C("no raw database sentence is handed back (item 6)", "read the file", () => !/message:\s*\w+\.error\.message/.test(SRCP));
  C("the stamp is first-save-wins on both arms (item 5)", "read the file", () => (SRCP.match(/\.neq\("payment_status", "paid"\)/g) || []).length >= 2 && /\.is\("khata_at", null\)/.test(SRCP));
  C("a second device settling first: the loser's parts are reversed and it is told (item 5, executed)", "real settle, stand-in", async () => {
    const { sb, writes } = standIn({ rows: [row(), row()], elsewhere: 2 }); const r = await settle(sb, [{ amount: 525, method: "Cash" }, { amount: 525, method: "UPI" }]);
    return !r.ok && r.status === 409 && writes.some((w) => w.table === "session_payments" && w.op === "update" && w.payload.reversed_at);
  });
  C("PAY_LATER is not a whole-bill payment method", "real constants", () => !pm.PAYMENT_METHODS.includes(ps.PAY_LATER) && ps.SPLIT_METHODS.includes(ps.PAY_LATER));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// D · lib/payments.ts — P199161–P199175
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/payments.ts";
  let n = 199161; const D = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  D("both staff routes validate a whole-bill payment method against PAYMENT_METHODS", "read both routes", () => /PAYMENT_METHODS/.test(ED) && /PAYMENT_METHODS/.test(TB));
  D("lib/payments.ts is the only place the four methods are listed in app/ lib/", "grep", () => {
    const off = tsFiles.filter((f) => f !== F && /\[\s*"UPI",\s*"Cash",\s*"Card",\s*"Other"\s*\]/.test(read(f))); return { ok: !off.length, note: off.join(", ") || "none" };
  });
  D("the manager panel offers the four methods in its pay modal", "read public/panels/editor/app.js", () => ["UPI", "Cash", "Card", "Other"].every((m) => APPJS.includes(`"${m}"`)));
  D("the waiter tablet offers the four methods", "read public/panels/tablet/app.js", () => ["UPI", "Cash", "Card", "Other"].every((m) => TABJS.includes(`"${m}"`)));
  D("every payment_method stored on dev orders is one of the four, 'Split', a platform name or 'On the house'", "SQL distinct + counts", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select payment_method m, count(*)::int n, max(created_at)::date last from orders where payment_method is not null group by 1 limit 50`);
    const known = ["UPI", "Cash", "Card", "Other", "Split", "", "Zomato", "Swiggy", "Website", "On the house"];
    const odd = r.filter((x) => !known.includes(x.m));
    // 'cash' (lower case): 2 rows, last 2026-08-05, already handled by verify:owner-reports' casing rule.
    const legacy = odd.filter((x) => x.m === "cash" && x.n <= 2 && x.last <= "2026-08-05");
    return { ok: odd.length === legacy.length, note: `${r.length} distinct values${odd.length ? "; outside the list: " + odd.map((x) => `${x.m}×${x.n} (last ${x.last})`).join(", ") + " — legacy, no current writer" : ""}` };
  });
  D("every method stored on a payment part is one of the four or 'Pay later'", "SQL distinct", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select distinct method m from session_payments limit 50`);
    const odd = r.map((x) => x.m).filter((m) => !ps.SPLIT_METHODS.includes(m)); return { ok: !odd.length, note: odd.join(", ") || `${r.length} distinct` };
  });
  D("a whole-bill settle stores its free-text note as payment_note beside the method", "read the editor route", () => /payment_method: method, payment_note: note/.test(ED));
  D("PaymentMethod is derived from the array, so a fifth method cannot exist in one and not the other", "read the file", () => /export type PaymentMethod = \(typeof PAYMENT_METHODS\)\[number\];/.test(SRC[F]));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// E · lib/discountCap.ts — P199176–P199210
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/discountCap.ts";
  let n = 199176; const E = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const S = SRC[F];
  E("discountRole: tablet and any other staff role map to the waiter bucket (most restrictive)", "read the file", () => /return "waiter";\s+\/\/ tablet/.test(S));
  E("overDiscountCap tolerates exactly one paisa of rounding (+0.01 on the percent)", "read the file", () => /> capPct \+ 0\.01/.test(S));
  E("overDiscountCap never caps when the base is zero or negative", "read the file", () => /if \(capPct == null \|\| base <= 0\) return false;/.test(S));
  E("an admin-set cap of 0 is honoured (typeof number), not treated as 'no cap'", "read the file", () => /if \(typeof v === "number"\) return v;/.test(S));
  E("a stored owner cap (French House and Aangan both carry 100) is never read", "read the file, comments stripped", () => !/limit\?\.\["owner"\]|limit\.owner/.test(S.replace(/\/\/.*$/gm, "")));
  E("every live restaurant's stored manager/waiter cap on dev is a number between 0 and 100", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select name, access_config->'give_discounts'->'limit' l from restaurants where purged_at is null and access_config->'give_discounts'->'limit' is not null limit 60`);
    const bad = r.filter((x) => ["manager", "waiter"].some((k) => x.l[k] != null && !(typeof x.l[k] === "number" && x.l[k] >= 0 && x.l[k] <= 100)));
    return { ok: !bad.length, note: `${r.length} restaurants with a stored cap${bad.length ? "; out of range: " + bad.map((b) => b.name).join(", ") : ""}` };
  });
  E("French House's manager cap reads 100 (what whoami must send — P07456)", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select (access_config->'give_discounts'->'limit'->>'manager')::int m from restaurants where id='${FH}'`); return r[0].m === 100;
  });
  E("Aangan (factory defaults) reads manager 50 / waiter 5 — the model defaults", "SQL vs accessTree", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select access_config->'give_discounts'->'limit' l from restaurants where id='${AANGAN}'`);
    return r[0].l.manager === Number(tree.defOf(tree.NODE_BY_ID.mgr_give_discounts_cap)) && r[0].l.waiter === Number(tree.defOf(tree.NODE_BY_ID.wtr_give_discounts_cap));
  });
  E("every editor discount path checks the cap: whole-bill, parcel and the per-line discount", "read the editor route", () => (ED.match(/overDiscountCap\(/g) || []).length >= 3);
  E("the waiter tablet checks the cap with the ACTOR's role (the person, not the device)", "read the tablet route", () => /discountCapPct\(rid, discountRole\(actor\?\.role\)\)/.test(TB));
  E("the cap refusal is a sentence naming the limit, not a silent trim", "read both routes", () => /over your \$\{\w*cap\}% limit/.test(ED) && /over your \$\{cap\}% discount limit/.test(TB));
  E("the cap is checked against the PRE-TAX base, as the Access screen states", "read the file + route", () => /PRE-TAX base/.test(S) && /overDiscountCap\(rawDisc, base, cap\)/.test(ED));
  E("the manager panel takes the role cap from whoami so it never offers a refused number", "read app.js", () => /roleCapPct/.test(APPJS) && /XRAY_WHO\.discountCapPct/.test(APPJS));
  E("the Access screen has exactly two cap rows — manager and waiter — and no owner cap row", "lib/accessTree.ts",
    () => !!tree.NODE_BY_ID.mgr_give_discounts_cap && !!tree.NODE_BY_ID.wtr_give_discounts_cap && !Object.keys(tree.NODE_BY_ID).some((k) => /^own.*discounts_cap/.test(k)));
  E("lib/discountCap.ts reads access_config with a column list and one row (scoped by id)", "read the file", () => /select\("access_config"\)\.eq\("id", rid\)\.maybeSingle\(\)/.test(S));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// F · lib/clash.ts — P199211–P199270
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/clash.ts";
  let n = 199211; const Fc = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const S = SRC[F];
  const block = /const COMPARABLE_TABLES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(S)[1];
  const comparable = Object.fromEntries([...block.matchAll(/^\s{2}(\w+): "(\w+)",/gm)].map((m) => [m[1], m[2]]));
  const tenantRows = ((/TENANT_ROW_TABLES = new Set\(\[([^\]]+)\]\)/.exec(S) || [])[1] || "").match(/"(\w+)"/g)?.map((x) => x.slice(1, -1)) || [];
  Fc("COMPARABLE_TABLES lists the tables the panels may ask about (14 since table_tags left, item 9)", "parse the file", () => ({ ok: Object.keys(comparable).length >= 14, note: Object.keys(comparable).join(", ") }));
  Fc("every comparable table EXISTS on the dev database, with the id column the gate looks it up by", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select table_name t, column_name c from information_schema.columns where table_schema='public' and table_name in (${Object.keys(comparable).map((t) => `'${t}'`).join(",")})`);
    const has = new Set(r.map((x) => `${x.t}.${x.c}`)); const miss = Object.entries(comparable).filter(([t, c]) => !has.has(`${t}.${c}`));
    return { ok: !miss.length, note: miss.length ? `missing: ${miss.map((m) => m.join(".")).join(", ")}` : `${Object.keys(comparable).length} present` };
  });
  Fc("every comparable table that is NOT a tenant row has a restaurant_id column to scope by", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select table_name t from information_schema.columns where table_schema='public' and column_name='restaurant_id'`);
    const has = new Set(r.map((x) => x.t)); const miss = Object.keys(comparable).filter((t) => !tenantRows.includes(t) && !has.has(t));
    return { ok: !miss.length, note: miss.join(", ") || "every one scoped" };
  });
  Fc("the three tenant-row tables are keyed by the restaurant", "parse", () => tenantRows.length === 3 && comparable.settings === "restaurant_id" && comparable.restaurant_billing === "restaurant_id" && comparable.restaurants === "id");
  Fc("a tenant-row lookup answers 'nothing to compare' for an id that is not the caller's restaurant", "read the file", () => /if \(TENANT_ROW_TABLES\.has\(table\) && id !== rid\) return null;/.test(S));
  Fc("every other lookup is scoped .eq('restaurant_id', rid) — the boundary, since the service role bypasses RLS", "read the file", () => /if \(!TENANT_ROW_TABLES\.has\(table\)\) q = q\.eq\("restaurant_id", rid\);/.test(S));
  Fc("the restaurant expectClash compares in is the one the route resolved, never one named in the header", "read every caller",
    () => { const callers = tsFiles.filter((f) => /expectClash\(req, /.test(read(f))); const bad = callers.filter((f) => /expectClash\(req, (?:want|body|parsed|req\.headers)/.test(read(f))); return { ok: callers.length >= 8 && !bad.length, note: `${callers.length} callers` }; });
  Fc("every route that calls expectClash answers with clashJson (a 409 the outbox understands)", "read every caller",
    () => { const callers = tsFiles.filter((f) => /expectClash\(req/.test(read(f)) && /^app\/api/.test(f)); const bad = callers.filter((f) => !/clashJson\(/.test(read(f))); return { ok: !bad.length, note: bad.join(", ") || `${callers.length} routes` }; });
  Fc("the four panel dispatchers (editor, tablet, kitchen, inventory) call the clash gate", "read the routes",
    () => ["app/api/editor/[...path]/route.ts", "app/api/tablet/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts", "app/api/inventory/[...path]/route.ts"].every((f) => /expectClash\(req, /.test(read(f))));
  Fc("the replay gate (replayClash) runs on the floor panels", "read the routes", () => [ED, TB].every((s) => /replayClash\(/.test(s)));
  Fc("the outbox sends X-LFH-Replay and X-LFH-Queued-At on a replay — the two headers replayMarkers reads", "read outbox.js", () => /X-LFH-Replay/i.test(OUTBOX) && /X-LFH-Queued-At/i.test(OUTBOX));
  Fc("…and sends X-LFH-Expect as JSON, the shape expectClash parses", "read outbox.js", () => /headers\["X-LFH-Expect"\] = JSON\.stringify\(item\.expect\)/.test(OUTBOX));
  Fc("the outbox shows a 409 clash to a person instead of retrying it", "read outbox.js", () => /clash/.test(OUTBOX) && /409/.test(OUTBOX));
  Fc("every table a live call site sends an expectation for is on COMPARABLE_TABLES", "grep every call site", () => {
    const all = [APPJS, TABJS, read("public/panels/editor/inventory.js"), read("public/panels/maint.js"), read("public/panels/kitchen/app.js"), ...tsFiles.map(read)].join("\n");
    const sent = [...new Set([...all.matchAll(/\btable:\s*"(\w+)",\s*(?:id|where)\b/g)].map((m) => m[1]))];
    const off = sent.filter((t) => !comparable[t]); return { ok: sent.length >= 6 && !off.length, note: `sent: ${sent.join(", ")}${off.length ? " · NOT comparable: " + off.join(", ") : ""}` };
  });
  Fc("the inventory count's composite key (count_id, item_id) are real columns of inv_count_lines", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select column_name from information_schema.columns where table_name='inv_count_lines' and column_name in ('count_id','item_id','counted_base','restaurant_id')`); return r.length === 4;
  });
  Fc("every plain-words name in readable() is a real column on a comparable table (or a jsonb sub-key)", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const map = /const map: Record<string, string> = \{([\s\S]*?)\n  \};/.exec(S)[1];
    const names = [...map.matchAll(/(\w+):\s*"/g)].map((m) => m[1]);
    const r = await sql(`select distinct column_name c from information_schema.columns where table_schema='public' and table_name in (${Object.keys(comparable).map((t) => `'${t}'`).join(",")})`);
    const cols = new Set(r.map((x) => x.c)); const sub = ["notes", "id_type", "id_number"];
    const off = names.filter((nm) => !cols.has(nm) && !sub.includes(nm));
    // sold_out / available: plain-words labels for fields no comparable table has — dead, harmless (Part 4).
    return { ok: off.every((nm) => ["sold_out", "available"].includes(nm)), note: off.length ? `labels for no column (dead, harmless): ${off.join(", ")}` : `${names.length} names` };
  });
  Fc("QUIET_COLUMNS covers the money columns a panel sends an expectation for", "read the file", () => ["discount", "price", "payment_status", "total"].every((c) => new RegExp(`QUIET_COLUMNS = new Set\\(\\[[^\\]]*"${c}"`).test(S)));
  Fc("a field name with punctuation (a quote, a space, a comma) is dropped before it reaches the select", "the regex, executed", () => {
    const re = /^[a-z_][a-z0-9_]*(\.[a-zA-Z0-9_-]+)?$/; return re.test("note") && re.test("profile.notes") && !["note,id", "note id", "x'--", "NOTE", "a.b.c", "1x"].some((k) => re.test(k));
  });
  Fc("…and the regex in the file is exactly that one", "read the file", () => S.includes("/^[a-z_][a-z0-9_]*(\\.[a-zA-Z0-9_-]+)?$/"));
  Fc("only an aged change (20 s+) is judged as a replay — a live write pays no extra query", "read the file", () => /REPLAY_MIN_AGE_MS = 20_000/.test(S) && /if \(!markers\) return null; \/\/ live write/.test(S));
  Fc("replayClash reads ONE session row per table (newest first, limit 1, restaurant-scoped)", "read the file", () => /\.eq\("restaurant_id", rid\)\.eq\("table_number", t\)\s*\.order\("created_at", \{ ascending: false \}\)\.limit\(1\)/.test(S));
  Fc("the table's NAME is read only on the refusal path", "read the file", () => (S.match(/await tableLabel\(rid, t\)/g) || []).length === 3);
  Fc("every refusal says what to do, and none says 'error'", "read the file", () => { const todos = [...S.matchAll(/todo: [`"]([^`"]+)/g)].map((m) => m[1]); return todos.length >= 4 && todos.every((t) => /^(Nothing|Your change)/.test(t)) && !/todo: [`"][^`"]*error/i.test(S); });
  Fc("the refusal codes are stable machine strings", "read the file", () => ["clash_changed_elsewhere", "clash_new_party", "clash_table_closed"].every((c) => S.includes(`"${c}"`)));
  Fc("restaurant_billing's expectation compares the fields the Billing & plans card edits", "read app/aevinite/billing/page.tsx",
    () => /table: "restaurant_billing"[\s\S]{0,300}plan:[\s\S]{0,200}amount:[\s\S]{0,200}next_due_on:/.test(read("app/aevinite/billing/page.tsx")));
  Fc("the printing screen's expectation names its own label ('this computer's name')", "read app/aevinite/printing/page.tsx", () => /label: "this computer's name"/.test(read("app/aevinite/printing/page.tsx")));
  Fc("a stock count is the one composite key — only (count_id, item_id)", "read the file", () => /inv_count_lines: \["count_id", "item_id"\]/.test(S) && (S.match(/COMPOSITE_KEYS\[/g) || []).length === 1);
  Fc("verify:clash-coverage is green on this checkout", "run it", async () => {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("node", ["scripts/verify-clash-coverage.mjs"], { cwd: root, stdio: "pipe" }); return true; } catch (e) { return { ok: false, note: String(e.stdout || e).slice(-200) }; }
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// G · lib/clashCompare.ts — P199271–P199300
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/clashCompare.ts";
  let n = 199271; const G = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  G("'mild ' and 'mild' are the same note", "real function", () => cc.sameValue("mild ", "mild"));
  G("'Mild' and 'mild' are DIFFERENT notes (case is content for text)", "real function", () => !cc.sameValue("Mild", "mild"));
  G("allergen lists compare case-insensitively ('Nuts' = 'nuts')", "real function", () => cc.sameValue(["Nuts", "dairy"], ["DAIRY", "nuts"]));
  G("a list with a duplicate is not the same as one without", "real function", () => !cc.sameValue(["nuts", "nuts"], ["nuts"]));
  G("an empty list equals null (never set)", "real function", () => cc.sameValue([], null));
  G("number 50 and string '50' are the same discount", "real function", () => cc.sameValue(50, "50"));
  G("number 50 and string '50.00' are different (both sides send Number(), so this never arises — recorded)", "real function", () => !cc.sameValue(50, "50.00"));
  G("true and 'true' are the same switch", "real function", () => cc.sameValue(true, "true"));
  G("false and null are DIFFERENT — 'off' is a value, 'never set' is not", "real function", () => !cc.sameValue(false, null));
  G("0 and null are DIFFERENT — a ₹0 discount is a real previous value", "real function", () => !cc.sameValue(0, null));
  G("two objects with the same keys in a different order compare equal at every depth", "real function", () => cc.sameValue({ x: { b: 1, a: [1, 2] } }, { x: { a: [1, 2], b: 1 } }));
  G("a list INSIDE an object keeps its order (only a top-level list is a set)", "real function", () => !cc.sameValue({ l: [1, 2] }, { l: [2, 1] }));
  G("table_names with one table renamed is DIFFERENT (the rename two managers race on)", "real function", () => !cc.sameValue({ "1": "Patio", "2": "Bar" }, { "1": "Patio", "2": "Window" }));
  G("an empty object equals null and undefined", "real function", () => cc.sameValue({}, null) && cc.sameValue({}, undefined));
  G("stableJson of a deeply nested object stops at depth 6", "real function", () => { let o = {}; const top = o; for (let i = 0; i < 50; i++) { o.n = {}; o = o.n; } return cc.stableJson(top).includes("{…}"); });
  G("stableJson of a deeply nested array also stops", "real function", () => { let a = []; const top = a; for (let i = 0; i < 20; i++) { const b = []; a.push(b); a = b; } return cc.stableJson(top).includes("[…]"); });
  G("isPlainObject: {} yes, [] no, null no, 'x' no", "real function", () => cc.isPlainObject({}) && !cc.isPlainObject([]) && !cc.isPlainObject(null) && !cc.isPlainObject("x"));
  G("sameValue is symmetric on 3,000 random pairs", "real function", () => {
    const vals = [null, undefined, 0, 1, "1", " 1", true, false, "true", [], ["a"], ["A"], {}, { a: 1 }, { a: "1" }, "", "x"];
    for (let i = 0; i < 3000; i++) { const a = pick(vals), b = pick(vals); if (cc.sameValue(a, b) !== cc.sameValue(b, a)) return { ok: false, note: `${JSON.stringify(a)} / ${JSON.stringify(b)}` }; } return true;
  });
  G("sameValue is reflexive for every kind of value a column can hold", "real function", () => [null, 0, "x", true, ["a", "b"], { a: { b: [1] } }, "", []].every((v) => cc.sameValue(v, v)));
  G("a top-level list of OBJECTS compares as '[object Object]' items — latent, no live call site sends one (Part 4)", "real function",
    () => ({ ok: true, note: cc.sameValue([{ a: 1 }], [{ a: 2 }]) ? "two different object lists compare EQUAL — public/panels/editor/app.js deliberately sends no arrays, so nothing is unprotected today" : "compares by content" }));
  G("lib/clashCompare.ts has no imports", "read the file", () => !/^\s*import\s/m.test(SRC[F]));
  G("lib/clash.ts is its only consumer in app/ lib/ components/", "grep", () => { const im = tsFiles.filter((f) => /@\/lib\/clashCompare/.test(read(f))); return { ok: im.length === 1 && im[0] === "lib/clash.ts", note: im.join(", ") }; });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// H · lib/idempotency.ts + lib/idempotencyRule.ts — P199301–P199345
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  let n = 199301; const H = (file, what, how, fn) => check(`P${n++}`, file, what, how, fn);
  const S = SRC["lib/idempotency.ts"], RU = SRC["lib/idempotencyRule.ts"];
  const wrapped = tsFiles.filter((f) => /export const (POST|PATCH|PUT|DELETE) = withIdempotency\(/.test(read(f)));
  H("lib/idempotency.ts", "every route that wraps itself in withIdempotency names its panel", "grep", () => { const bad = wrapped.filter((f) => !/withIdempotency\([\w()]+, "[\w-]+"\)|\}, "[\w-]+"\);\s*$/m.test(read(f))); return { ok: wrapped.length >= 15 && !bad.length, note: `${wrapped.length} wrapped routes${bad.length ? "; no panel name: " + bad.join(", ") : ""}` }; });
  H("lib/idempotency.ts", "the three money panels' dispatchers are wrapped", "grep",
    () => ["app/api/editor/[...path]/route.ts", "app/api/tablet/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts"].every((f) => wrapped.includes(f)));
  H("lib/idempotency.ts", "the guest's place-order route is wrapped, so a lost reply never places the order twice", "grep", () => wrapped.includes("app/api/guest/place-order/route.ts"));
  H("lib/idempotency.ts", "the admin bills/credit-note route is wrapped (a tax document issued twice is worse than a duplicate order)", "grep", () => wrapped.includes("app/api/admin/bills/route.ts"));
  H("lib/idempotency.ts", "GET handlers are never wrapped", "grep", () => !tsFiles.some((f) => /export const GET = withIdempotency/.test(read(f))));
  H("lib/idempotency.ts", "the outbox mints its action id with crypto.randomUUID", "read outbox.js", () => /self\.crypto && self\.crypto\.randomUUID/.test(OUTBOX));
  H("lib/idempotency.ts", "action_idempotency is locked to the service role", "pg_class", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select relrowsecurity rls, (select count(*)::int from pg_policies where tablename='action_idempotency') pol, has_table_privilege('anon','action_idempotency','select') a, has_table_privilege('authenticated','action_idempotency','select') au from pg_class where relname='action_idempotency'`);
    return r[0].rls && r[0].pol === 0 && !r[0].a && !r[0].au;
  });
  H("lib/idempotency.ts", "the claims table's primary key is action_id — the unique violation the claim relies on", "pg_indexes", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select indexdef from pg_indexes where tablename='action_idempotency' and indexdef ilike '%unique%'`); return r.some((x) => /\(action_id\)/.test(x.indexdef));
  });
  H("lib/idempotency.ts", "lfh_prune_action_idempotency is service-role only and bounded to 500 rows a call", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select has_function_privilege('anon', oid, 'execute') a, pg_get_functiondef(oid) d from pg_proc where proname='lfh_prune_action_idempotency'`);
    return !r[0].a && /limit 500/.test(r[0].d);
  });
  H("lib/idempotency.ts", "the prune is called with no argument, so its 24-hour default applies", "read the file", () => /sb\.rpc\("lfh_prune_action_idempotency"\)/.test(S));
  H("lib/idempotency.ts", "no stored reply on dev carries a password, PIN, token or setup code (item 7, after the clean-up)", "SQL count, no values", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select count(*)::int n from action_idempotency where result::text ~* '"(password|new_password|pin|setup_code|token)"\\s*:'`); return { ok: r[0].n === 0, note: `${r[0].n} rows` };
  });
  H("lib/idempotencyRule.ts", "withoutSecrets drops 'password' at the top level", "real function", () => !("password" in ir.withoutSecrets({ ok: true, password: "x" })));
  H("lib/idempotencyRule.ts", "withoutSecrets drops a password inside a list of logins", "real function", () => JSON.stringify(ir.withoutSecrets({ logins: [{ username: "a", password: "b" }] })) === '{"logins":[{"username":"a"}]}');
  H("lib/idempotencyRule.ts", "withoutSecrets keeps ok, order_id, counts and names", "real function", () => JSON.stringify(ir.withoutSecrets({ ok: true, order_id: "o", reset: 3, name: "A" })) === '{"ok":true,"order_id":"o","reset":3,"name":"A"}');
  H("lib/idempotencyRule.ts", "withoutSecrets drops pin / otp / token / setup_code / api_key and keeps pinned / spinner / username", "real function", () => {
    const k = Object.keys(ir.withoutSecrets({ pin: 1, otp: 1, token: 1, setup_code: 1, api_key: 1, pinned: 1, spinner: 1, username: 1, signedOut: 1 })); return k.join() === "pinned,spinner,username,signedOut";
  });
  H("lib/idempotencyRule.ts", "withoutSecrets refuses to keep a reply nested past depth 8", "real function", () => { let o = { v: 1 }; for (let i = 0; i < 12; i++) o = { o }; return JSON.stringify(ir.withoutSecrets(o)).includes("null"); });
  H("lib/idempotencyRule.ts", "didSomething: 201 with { ok: true } is remembered; 409 is not", "real function", () => ir.didSomething(201, { ok: true }) && !ir.didSomething(409, { ok: true }));
  H("lib/idempotencyRule.ts", "didSomething: a 200 whose body is an ARRAY is remembered", "real function", () => ir.didSomething(200, [{ ok: false }]) === true);
  H("lib/idempotencyRule.ts", "didSomething: { ok: 'false' } (a string) is still remembered — only boolean false is a refusal", "real function", () => ir.didSomething(200, { ok: "false" }) === true);
  H("lib/idempotencyRule.ts", "storedIsRefusal: null / [] / { ok: true } are not refusals", "real function", () => !ir.storedIsRefusal(null) && !ir.storedIsRefusal([]) && !ir.storedIsRefusal({ ok: true }));
  H("lib/idempotencyRule.ts", "lib/idempotencyRule.ts still has no imports", "read the file", () => !/^\s*import\s/m.test(RU));
  H("lib/idempotency.ts", "a duplicate reply is ALWAYS ok:true + duplicate:true", "read the file", () => /NextResponse\.json\(\{ ok: true, \.\.\.stored, duplicate: true \}\)/.test(S));
  H("lib/idempotency.ts", "the stale-claim window (30 s) is longer than one request's database deadline", "read both", () => /STALE_MS = 30_000/.test(S) && /timeout|deadline/i.test(read("lib/supabaseAdmin.ts")));
  H("lib/idempotency.ts", "the outbox treats the 409 {retry:true} claim answer as 'try again', not as a clash for a person", "read outbox.js", () => /409 \{retry:true\}/.test(OUTBOX) && /BUSY_MAX_TRIES/.test(OUTBOX));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// I · lib/dbRefusal.ts — P199346–P199395
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/dbRefusal.ts";
  let n = 199346; const I = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  for (const [code, want] of [["22001", 400], ["22003", 400], ["22007", 400], ["22P02", 400], ["23502", 400], ["23503", 400], ["23505", 400], ["23P01", 400],
    ["08000", 503], ["08001", 503], ["08003", 503], ["08006", 503], ["53300", 503], ["53200", 503], ["55P03", 503], ["40001", 503], ["40P01", 503], ["57P01", 503], ["57P03", 503],
    ["XX000", 500], ["42P01", 500], ["42883", 500], ["P0001", 500]]) {
    I(`SQLSTATE ${code} answers ${want}`, "refusalStatus, real function", () => dbr.refusalStatus({ code, message: "x" }) === want);
  }
  const ownCodes = new Set([...SRC[F].matchAll(/"(LFH\d\d)"/g)].map((m) => m[1]));
  I("every own code raised in the migrations (LFHxx) is registered or handled at its only caller", "grep migrations vs the file", () => {
    const raised = [...new Set(migFiles.flatMap((f) => [...MIG[f].matchAll(/errcode\s*=\s*'(LFH\d\d)'/gi)].map((m) => m[1].toUpperCase())))];
    const miss = raised.filter((c) => !ownCodes.has(c));
    const handled = miss.every((c) => new RegExp(`code === "${c}"`).test(ED + TB + KT));
    return { ok: handled, note: `raised ${raised.join("/")}; not registered here: ${miss.join("/") || "none"}${miss.length ? " (handled by its one caller — Part 4)" : ""}` };
  });
  I("a message-only refusal ('violates check constraint') is a 400 even with no code", "real function", () => dbr.refusalStatus({ message: 'new row violates check constraint "x"' }) === 400);
  I("'fetch failed' with no code is 503", "real function", () => dbr.refusalStatus(new TypeError("fetch failed")) === 503);
  I("a TimeoutError is 503", "real function", () => dbr.refusalStatus({ name: "TimeoutError", message: "The operation was aborted due to timeout" }) === 503);
  I("a gateway error page ('502: Bad gateway') is 503", "real function", () => dbr.refusalStatus({ message: "<html>502: Bad gateway</html>" }) === 503);
  I("an ordinary app bug stays a 500 — a bug is never dressed as busy", "real function", () => dbr.refusalStatus(new TypeError("Cannot read properties of undefined")) === 500);
  I("refusalStatus(null) and refusalStatus(undefined, 418) are the fallback, not a crash", "real function", () => dbr.refusalStatus(null) === 500 && dbr.refusalStatus(undefined, 418) === 418);
  I("refusalMessage for the named floor constraint is the plain sentence", "real function", () => /between 2 and 30/.test(dbr.refusalMessage({ code: "23514", message: 'violates check constraint "settings_floor_per_row_range"' })));
  I("refusalMessage never returns the raw Postgres prose for a refusal", "real function", () => ["23505", "23503", "23502", "23514", "22P02"].every((c) => !/violates|invalid input/.test(dbr.refusalMessage({ code: c, message: "violates whatever / invalid input syntax" }))));
  I("refusalMessage for a busy database is BUSY_MESSAGE, which never blames the internet", "real function", () => dbr.refusalMessage({ code: "57014", message: "x" }) === dbr.BUSY_MESSAGE && !/internet|wifi/i.test(dbr.BUSY_MESSAGE));
  I("refusalMessage for an app bug keeps the original message (the error board reads it)", "real function", () => dbr.refusalMessage(new Error("boom 42")) === "boom 42");
  I("isMissingRow is false for a PGRST116 with no details (narrow on purpose)", "real function", () => dbr.isMissingRow({ code: "PGRST116" }) === false);
  I("ownRefusalCode ignores a non-string code", "real function", () => dbr.ownRefusalCode({ code: 401 }) === null);
  I("the panel failure helper and the editor route both classify through this file", "grep consumers", () => /@\/lib\/dbRefusal/.test(read("lib/panelFailure.ts")) && /@\/lib\/dbRefusal/.test(ED));
  I("lib/paySplit.ts classifies its failed saves through refusalStatus (item 6)", "read the file", () => /refusalStatus\(error, 500\)/.test(SRC["lib/paySplit.ts"]));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// J · lib/readGuard.ts — P199396–P199420
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "lib/readGuard.ts";
  let n = 199396; const J = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const quiet = (fn) => { const real = console.error; const out = []; console.error = (...a) => out.push(a.join(" ")); try { return [fn(), out]; } finally { console.error = real; } };
  J("a ReadSet logs each failure once, with the route name, the read name and the code", "real class", () => {
    const [, out] = quiet(() => new rg.ReadSet("owner/x", [rg.named("orders", { data: null, error: { message: "boom", code: "57014" } }), rg.named("ok", { data: [], error: null })]));
    return out.length === 1 && /\[owner\/x\] read "orders" failed \(57014\)/.test(out[0]);
  });
  J("rowsOr on a failed read returns the fallback the call site named", "real class", () => { const [s] = quiet(() => new rg.ReadSet("x", [rg.named("a", { data: null, error: { message: "e" } })])); return JSON.stringify(s.rowsOr("a", [1])) === "[1]"; });
  J("rowsOr on a successful read returns its rows, not the fallback", "real class", () => new rg.ReadSet("x", [rg.named("a", { data: [7], error: null })]).rowsOr("a", []).join() === "7");
  J("a successful read with data:null — rows() is [] (empty is an answer), not a throw", "real class", () => new rg.ReadSet("x", [rg.named("a", { data: null, error: null })]).rows("a").length === 0);
  J("count() of a head-count read that returned 0 is 0, not a throw", "real class", () => new rg.ReadSet("x", [rg.named("a", { data: null, error: null, count: 0 })]).count("a") === 0);
  J("count() of a read that never asked for one THROWS (no confident zero)", "real class", () => { try { new rg.ReadSet("x", [rg.named("a", { data: [], error: null })]).count("a"); return false; } catch (e) { return e instanceof rg.ReadFailed; } });
  J("allFailed is false for an empty set", "real class", () => new rg.ReadSet("x", []).allFailed === false);
  J("anyFailed / allFailed / failedNames agree on a half-failed set", "real class", () => { const [s] = quiet(() => new rg.ReadSet("x", [rg.named("a", { data: null, error: { message: "e" } }), rg.named("b", { data: [], error: null })])); return s.anyFailed && !s.allFailed && s.failedNames.join() === "a"; });
  J("partial() names each reportable key once, even if two reads map to it", "real class", () => { const [s] = quiet(() => new rg.ReadSet("x", [rg.named("a", { data: null, error: 1 }), rg.named("b", { data: null, error: 2 })])); return s.partial({ a: "expenses", b: "expenses" }).length === 1; });
  J("error(name) for an unknown read is an Error naming it", "real class", () => /no read named "q"/.test(new rg.ReadSet("x", []).error("q").message));
  J("firstError is null when nothing failed", "real class", () => new rg.ReadSet("x", [rg.named("a", { data: [], error: null })]).firstError === null);
  J("slowerThan lists only the reads over the threshold", "real class", () => { const s = new rg.ReadSet("x", [{ name: "a", data: [], error: null, count: null, ms: 900, retried: false }, { name: "b", data: [], error: null, count: null, ms: 10, retried: false }]); return s.slowerThan(500).map((x) => x.name).join() === "a"; });
  J("rd() does NOT retry a refusal (a CHECK violation is not transient)", "real function, stand-in", async () => { let calls = 0; await rg.rd("a", async () => (calls++, { data: null, error: { code: "23514", message: "violates check constraint" } })); return calls === 1; });
  J("rd() gives a transient failure at most ONE retry", "real function, stand-in", async () => { let calls = 0; await rg.rd("a", async () => (calls++, { data: null, error: { message: "fetch failed", code: "ECONNRESET" } })); return calls <= 2; });
  J("keepWhatAnswered: one of three failing keeps two, says one is missing, not allFailed", "real function", () => { const r = rg.keepWhatAnswered([{ error: null }, { error: "x" }, { error: null }]); return r.ok.length === 2 && r.missing === 1 && !r.allFailed && r.firstError === "x"; });
  J("keepWhatAnswered([]) is not 'all failed'", "real function", () => rg.keepWhatAnswered([]).allFailed === false);
  J("the owner routes read through ReadSet / rd()", "grep app/api/owner", () => { const f = tsFiles.filter((p) => /^app\/api\/owner\//.test(p)); const users = f.filter((p) => /ReadSet|\brd\(/.test(read(p))); return { ok: users.length >= 7, note: `${users.length} of ${f.length} owner routes — the rest check .error by hand (an older improvement, Part 3)` }; });
  J("readGuard itself never builds a response (it only logs)", "read the file", () => !/NextResponse|new Response\(/.test(SRC[F]));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// K · lib/money.ts · lib/money.mjs · their tests · tests/order-totals.e2e.mjs — P199421–P199480
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  let n = 199421; const K = (file, what, how, fn) => check(`P${n++}`, file, what, how, fn);
  for (const [v, want] of [[850, "₹850"], [1000, "₹1k"], [1050, "₹1.1k"], [45000, "₹45k"], [99949, "₹99.9k"], [250000, "₹2.5L"], [3880000, "₹38.8L"], [10000000, "₹1Cr"], [125000000, "₹12.5Cr"], [-1500, "−₹1.5k"], [0.4, "₹0"]]) {
    K("lib/money.ts", `compactINR(${v}) is "${want}"`, "real function", () => { const g = mts.compactINR(v); return g === want ? true : { ok: false, note: g }; });
  }
  K("lib/money.ts", "compactINR never prints a k/L figure of 100+ on a dense sweep, negatives included", "real function", () => {
    for (let v = -2e7; v < 2e7; v += 3137) { const o = mts.compactINR(v); const m = o.match(/₹([\d.]+)(k|L)$/); if (m && Number(m[1]) >= 100) return { ok: false, note: `${v} → ${o}` }; } return true;
  });
  K("lib/money.ts", "compactINR of a numeric STRING ('120000') reads as the number", "real function", () => mts.compactINR("120000") === "₹1.2L");
  K("lib/money.ts", "roundTicks ticks all sit inside [min, max] for 2,000 random domains", "real function", () => {
    for (let i = 0; i < 2000; i++) { const lo = Math.round(rnd() * 1e5), hi = lo + 1 + Math.round(rnd() * 1e7); const t = mts.roundTicks(lo, hi); if (t.some((x) => x < lo - 1e-6 || x > hi + 1e-6)) return { ok: false, note: `${lo}-${hi}` }; } return true;
  });
  K("lib/money.ts", "roundTicks never returns more than target + 1 ticks", "real function", () => { for (let i = 0; i < 2000; i++) { const hi = 1 + rnd() * 1e8; if (mts.roundTicks(0, hi, 5).length > 6) return false; } return true; });
  K("lib/money.ts", "roundTicks steps are 1/2/2.5/5 × a power of ten", "real function", () => { for (const hi of [7, 93, 1234, 98765, 4.2e6]) { const t = mts.roundTicks(0, hi); const st = t[1] - t[0]; const m = st / Math.pow(10, Math.floor(Math.log10(st))); if (![1, 2, 2.5, 5].some((x) => Math.abs(x - m) < 1e-9)) return { ok: false, note: `${hi}: step ${st}` }; } return true; });
  K("lib/money.ts", "there is one compactINR in the codebase", "grep", () => tsFiles.filter((f) => /function compactINR|const compactINR\s*=/.test(read(f))).length === 1);
  K("lib/money.ts", "compactINR's consumers import it rather than re-implementing the crore rule", "grep", () => { const im = importers("lib/money.ts"); return { ok: im.length >= 2, note: im.join(", ") }; });
  K("lib/money.mjs", "niceUsd matches lfh_nice_usd for 2,000 prices across the menu range", "SQL vs JS, one query", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const vals = Array.from({ length: 2000 }, (_, i) => Math.round((i * 0.0137 + (i % 7) * 0.173) * 100) / 100);
    const r = await sql(`select v::float8 v, lfh_nice_usd(v)::float8 n from unnest(array[${vals.join(",")}]::numeric[]) v`);
    const off = r.filter((x) => Math.abs(mjs.niceUsd(x.v) - x.n) > 1e-9);
    return { ok: r.length === 2000 && !off.length, note: off.length ? `${off.length} differ; first: ${off[0].v} js ${mjs.niceUsd(off[0].v)} sql ${off[0].n}` : "2,000 prices agree" };
  });
  K("lib/money.mjs", "niceUsd at every boundary (.24/.25/.74/.75/.91/.92/.99) agrees with lfh_nice_usd", "SQL vs JS", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const vals = [3.24, 3.25, 3.74, 3.75, 3.91, 3.92, 3.99, 4.0, 0.05, 0.99];
    const r = await sql(`select v::float8 v, lfh_nice_usd(v)::float8 n from unnest(array[${vals.join(",")}]::numeric[]) v`);
    const off = r.filter((x) => Math.abs(mjs.niceUsd(x.v) - x.n) > 1e-9); return { ok: !off.length, note: off.map((x) => `${x.v}: js ${mjs.niceUsd(x.v)} sql ${x.n}`).join("; ") || "all agree" };
  });
  K("lib/money.mjs", "niceUsd accepts a numeric string ('4.29') like the number", "real function", () => mjs.niceUsd("4.29") === 4.5);
  K("lib/money.mjs", "niceUsd of a negative or junk value never returns NaN", "real function", () => [-1.2, "abc", null, undefined, Infinity].every((v) => Number.isFinite(mjs.niceUsd(v))));
  K("lib/money.mjs", "snapToStep with a zero / negative / NaN step returns 0 rather than Infinity", "real function", () => [0, -1, NaN].every((s) => mjs.snapToStep(123, s) === 0));
  K("lib/money.mjs", "INR display always lands on a multiple of ₹10", "real function", () => { for (let i = 0; i < 2000; i++) { const v = mjs.displayAmount(rnd() * 50, 84, 10); if (v % 10 !== 0) return { ok: false, note: String(v) }; } return true; });
  K("lib/money.mjs", "a cent-step display never shows float dust", "real function", () => { for (let i = 0; i < 2000; i++) { const v = mjs.displayAmount(rnd() * 50, 0.92, 0.01); if ((String(v).split(".")[1] || "").length > 2) return { ok: false, note: String(v) }; } return true; });
  K("lib/money.mjs", "minorRound(27.5, 1) is 28 — half rounds UP, as Postgres round() does", "real function", () => mjs.minorRound(27.5, 1) === 28);
  K("lib/money.mjs", "lib/money.mjs has no imports", "read the file", () => !/^\s*import\s/m.test(SRC["lib/money.mjs"]));
  K("lib/money.mjs", "the guest price path takes niceUsd/displayAmount from lib/money.mjs, not a copy", "grep lib/format.ts", () => /money\.mjs/.test(read("lib/format.ts")));
  K("lib/money.test.mjs", "npm run test:units globs lib/*.test.mjs, so this file runs", "package.json", () => /lib\/\*\.test\.mjs/.test(PKG["test:units"] || ""));
  K("lib/money.test.mjs", "the unit test imports the REAL ./money.ts, not a copy", "read the file", () => /from "\.\/money\.ts"/.test(SRC["lib/money.test.mjs"]));
  K("tests/money.test.mjs", "npm run test:money runs exactly this file", "package.json", () => PKG["test:money"] === "node --test tests/money.test.mjs");
  K("tests/money.test.mjs", "every exported function of lib/money.mjs has at least one assertion", "read both", () => ["niceUsd", "snapToStep", "displayAmount", "minorRound"].every((f) => new RegExp(`${f}\\(`).test(SRC["tests/money.test.mjs"])));
  K("tests/order-totals.e2e.mjs", "it reads only the dev keys file (.env.local), never the live stack's", "read the file", () => /\.env\.local/.test(SRC["tests/order-totals.e2e.mjs"]) && !/AV\.live/.test(SRC["tests/order-totals.e2e.mjs"]));
  K("tests/order-totals.e2e.mjs", "it pins both sides to one restaurant (French House)", "read the file", () => /RESTAURANT_ID = "00000000-0000-0000-0000-000000000001"/.test(SRC["tests/order-totals.e2e.mjs"]) && /p_restaurant_id: RESTAURANT_ID/.test(SRC["tests/order-totals.e2e.mjs"]));
  K("tests/order-totals.e2e.mjs", "its 5% client mirror still matches French House's live rate", "SQL", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select lfh_effective_tax_rate('${FH}')::float8 e`); return { ok: r[0].e === 0.05, note: `French House ${r[0].e}` };
  });
  K("tests/order-totals.e2e.mjs", "it calls the read-only pricing function, never a place-order RPC", "read the file", () => /rpc\/lfh_price_order/.test(SRC["tests/order-totals.e2e.mjs"]) && !/rpc\/lfh_(staff_)?place_order/.test(SRC["tests/order-totals.e2e.mjs"]));
  K("tests/order-totals.e2e.mjs", "lfh_price_order is not VOLATILE on the database (it cannot write)", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select provolatile v from pg_proc where proname='lfh_price_order' limit 1`); return { ok: r[0].v !== "v", note: `volatility ${r[0].v}` };
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// L · docs/COMPLIANCE-GUARDRAILS.md — P199481–P199550 — every claim checked against the code
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "docs/COMPLIANCE-GUARDRAILS.md";
  let n = 199481; const L = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const D = SRC[F];
  const fnDef = async (name) => (await sql(`select pg_get_functiondef(oid) d from pg_proc where proname='${name}' limit 1`))?.[0]?.d || "";
  L("§3.0(1) a bill with every KOT cancelled draws no invoice number — the installed lfh_generate_invoice refuses it", "pg_get_functiondef", async () => {
    const sk = dbSkip(); if (sk) return sk; const d = await fnDef("lfh_generate_invoice"); return /cancel/i.test(d) && /raise exception/i.test(d);
  });
  L("§3.0(2) an issued invoice cannot be deleted: lfh_block_issued_delete is installed as a trigger", "pg_trigger", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select tgname, tgrelid::regclass::text t from pg_trigger t join pg_proc p on p.oid=t.tgfoid where p.proname='lfh_block_issued_delete' and not tgisinternal`); return { ok: r.length >= 1, note: r.map((x) => `${x.t}.${x.tgname}`).join(", ") };
  });
  L("§3.0(2) …nor edited or renumbered: mig 398's guard runs verify:invoice-is-final green", "run it", async () => {
    const { execFileSync } = await import("node:child_process");
    try { execFileSync("node", ["scripts/verify-invoice-is-final.mjs"], { cwd: root, stdio: "pipe" }); return true; } catch (e) { return { ok: false, note: String(e.stdout || e).slice(-200) }; }
  });
  L("§3.0(6) bill_chain refuses UPDATE and DELETE (its trigger is installed)", "pg_trigger", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select pg_get_triggerdef(t.oid) d from pg_trigger t where tgrelid='bill_chain'::regclass and not tgisinternal`); const all = r.map((x) => x.d).join(" "); return { ok: /UPDATE/i.test(all) && /DELETE/i.test(all), note: `${r.length} trigger(s)` };
  });
  L("§3.0(6) bill_chain is not readable or writable by guest or staff roles", "pg_class", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select has_table_privilege('anon','bill_chain','insert') a, has_table_privilege('authenticated','bill_chain','select') b, relrowsecurity rls from pg_class where relname='bill_chain'`); return r[0].rls && !r[0].a && !r[0].b;
  });
  L("§6 lfh_verify_bill_chain exists and is staff-side only", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select has_function_privilege('anon', oid, 'execute') a from pg_proc where proname='lfh_verify_bill_chain'`); return r.length >= 1 && r.every((x) => !x.a);
  });
  L("§6 the day-close Z-report runs the chain verification", "grep the editor route", () => /lfh_verify_bill_chain/.test(ED));
  L("§3.0(4) canDeleteBill() exists and is what gates the bill delete", "read the editor route", () => /function canDeleteBill/.test(ED) && (ED.match(/canDeleteBill\(/g) || []).length >= 2);
  L("§3.0(4) no 'Delete a bill' row is grantable on the Access screen", "lib/accessTree.ts", () => !Object.values(tree.NODE_BY_ID).some((nd) => /delete (a )?bill/i.test(String(nd.label || nd.title || ""))));
  L("§3.0(4) R27 is recorded in REJECTED-IDEAS", "read the doc", () => /\bR27\b/.test(REJ));
  L("§3.0b(7) R47 (no bill-level cancel) is recorded in REJECTED-IDEAS", "read the doc", () => /\bR47\b/.test(REJ));
  L("§3.0b(7) a bill's cancelled state is DERIVED (deriveBillState / billState)", "grep", () => /deriveBillState/.test(read("lib/billLedger.ts")) && /function billState/.test(APPJS));
  L("§3.0b(7) there is no session-level cancelled_at column", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from information_schema.columns where table_name='sessions' and column_name in ('cancelled_at','cancel_reason')`); return r[0].n === 0;
  });
  L("§3.0b(9) the removal record states bill was → taken out → bill is now (auditBillSides)", "grep lib/auditDetail.ts", () => /auditBillSides/.test(read("lib/auditDetail.ts")));
  L("§3.0b(10) a printed invoice locks every KOT and dish under it (invoiceLockedByOrder in several handlers)", "grep the editor route", () => { const k = (ED.match(/invoiceLockedByOrder\(/g) || []).length; return { ok: k >= 4, note: `${k} uses` }; });
  L("§3.0b(11) lfh_reopen_table is staff-only and refuses an occupied table (LFH03) and an all-cancelled bill (LFH04)", "pg_get_functiondef", async () => {
    const sk = dbSkip(); if (sk) return sk; const d = await fnDef("lfh_reopen_table"); const r = await sql(`select has_function_privilege('anon', oid, 'execute') a from pg_proc where proname='lfh_reopen_table'`);
    return /LFH03/.test(d) && /LFH04/.test(d) && !r[0].a;
  });
  L("§3.0b(11) the reopen never touches deleted_at", "pg_get_functiondef", async () => { const sk = dbSkip(); if (sk) return sk; const d = await fnDef("lfh_reopen_table"); return !/deleted_at\s*=/.test(d); });
  L("§3.0b(11) the act reads as its own sentence in the Activity log (table_reopened)", "grep lib/logTrail.ts", () => /table_reopened/.test(read("lib/logTrail.ts")));
  L("§3 lfh_void_invoice still refuses a settled bill with LFH01", "pg_get_functiondef", async () => { const sk = dbSkip(); if (sk) return sk; return /LFH01/.test(await fnDef("lfh_void_invoice")); });
  L("§3 a void requires a reason (LFH03 on a missing reason is installed)", "pg_proc bodies", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from pg_proc where prosrc ilike '%LFH03%' and prosrc ilike '%reason%'`); return r[0].n >= 1;
  });
  L("§3 the soft-delete stamps deleted_at and keeps the row (lib/softDelete)", "read lib/softDelete.ts", () => /deleted_at/.test(read("lib/softDelete.ts")) && !/\.delete\(\)/.test(read("lib/softDelete.ts")));
  L("§3 the audit log has no off switch — no settings/restaurants column disables it", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select column_name from information_schema.columns where table_name in ('settings','restaurants') and (column_name ilike '%audit%off%' or column_name ilike '%disable%audit%' or column_name ilike '%audit_enabled%' or column_name ilike '%log%enabled%')`); return { ok: r.length === 0, note: r.map((x) => x.column_name).join(", ") || "none" };
  });
  L("§3 service charge is never a default — no settings column defaults it on", "information_schema", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select column_name, column_default from information_schema.columns where table_name='settings' and column_name ilike '%service%charge%'`); return { ok: r.every((x) => !x.column_default || /^(0|false|NULL)/i.test(x.column_default)), note: r.length ? r.map((x) => `${x.column_name}=${x.column_default}`).join(", ") : "no service-charge column at all" };
  });
  L("§3 composition restaurants print no GST line (billdoc reads tm.composition)", "read billdoc.js", () => /tm\.composition/.test(read("public/panels/billdoc.js")));
  L("§'Done since' billIdentity never invents a GSTIN (no GSTIN-shaped literal in billdoc)", "read billdoc.js", () => /function billIdentity/.test(read("public/panels/billdoc.js")) && !/\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]\b/.test(read("public/panels/billdoc.js")));
  L("§3 e-invoice / IRN is never stamped on a diner bill", "grep billdoc", () => !/\bIRN\b/.test(read("public/panels/billdoc.js")));
  L("§'Done since' the admin credit-note route requires the admin sign-in, an amount and a reason", "read app/api/admin/bills/route.ts", () => { const s = read("app/api/admin/bills/route.ts"); return /lfh_issue_credit_note/.test(s) && /reason/.test(s) && /tokenIsValid/.test(s); });
  L("§'Done since' lfh_issue_credit_note refuses a credit bigger than the bill (LFH02)", "pg_get_functiondef", async () => { const sk = dbSkip(); if (sk) return sk; return /LFH02/.test(await fnDef("lfh_issue_credit_note")); });
  L("§3 credit_notes and invoice_events are locked to the service role", "pg_class", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select relname, relrowsecurity rls, has_table_privilege('anon', oid, 'select') a from pg_class where relname in ('credit_notes','invoice_events')`); return r.length === 2 && r.every((x) => x.rls && !x.a);
  });
  L("§3 the INSTALLED purge deletes none of the money tables the doc lists", "pg_get_functiondef", async () => {
    const sk = dbSkip(); if (sk) return sk; const d = await fnDef("admin_purge_restaurant");
    const off = ["orders", "order_items", "sessions", "payments", "session_payments", "credit_notes", "invoice_events", "deletion_audit", "bill_chain"].filter((t) => new RegExp(`delete\\s+from\\s+(public\\.)?${t}\\b`, "i").test(d));
    return { ok: !off.length, note: off.length ? `deletes ${off.join(", ")}` : "none deleted" };
  });
  L("§3 …and keeps the restaurants row, marked purged_at", "pg_get_functiondef", async () => { const sk = dbSkip(); if (sk) return sk; const d = await fnDef("admin_purge_restaurant"); return /purged_at/.test(d) && !/delete\s+from\s+(public\.)?restaurants\b/i.test(d); });
  L("§3 the purge is not executable by guest or authenticated", "pg_proc", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select has_function_privilege('anon', oid, 'execute') a, has_function_privilege('authenticated', oid, 'execute') b from pg_proc where proname='admin_purge_restaurant'`); return r.length >= 1 && r.every((x) => !x.a && !x.b); });
  L("§3 the 'Check the LIVE purge' paragraph gives the command, not a count (item 3)", "read the doc", () => /grep -liE "FUNCTION/.test(D) && !/rewritten \w+ times/.test(D));
  L("§'Done since' orders.disc_gross exists (mig 301)", "information_schema", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from information_schema.columns where table_name='orders' and column_name='disc_gross'`); return r[0].n === 1; });
  L("every npm guard the doc names exists", "package.json", () => ["verify:audit", "verify:print-format", "verify:grants", "verify:t24-money-rules", "verify:admin-restaurants"].every((k) => PKG[k]));
  L("the doc's first line still tells a session to read it before touching bills", "read the doc", () => /^\*\*Read this before building/m.test(D));
  L("CLAUDE.md still points at this doc for billing work", "read CLAUDE.md", () => /docs\/COMPLIANCE-GUARDRAILS\.md/.test(read("CLAUDE.md")));
  L("§4 the pay-later book and feedback are not guest-readable", "pg_class", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select relname, has_table_privilege('anon', oid, 'select') a from pg_class where relkind='r' and relname in ('khata_customers','feedback')`); return r.length === 2 && r.every((x) => !x.a); });
  L("no route bulk-deletes bills by date range", "grep app/api", () => {
    const off = tsFiles.filter((f) => /^app\/api/.test(f) && /from\("(orders|sessions)"\)[^;]{0,120}\.delete\(\)[^;]{0,200}\.(gte|lte|lt|gt)\("created_at"/.test(read(f)));
    return { ok: !off.length, note: off.join(", ") || "none" };
  });
  L("no route resets or rewrites a bill/invoice counter", "grep app/api", () => !tsFiles.some((f) => /^app\/api/.test(f) && /from\("(daily_counters|invoice_counters)"\)\.(update|delete)/.test(read(f))));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// M · docs/SAAS-EFFICIENCY-PLAYBOOK.md — P199551–P199590
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "docs/SAAS-EFFICIENCY-PLAYBOOK.md";
  let n = 199551; const M = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const D = SRC[F];
  M("§3a the three listed revalidateTag call sites all use { expire: 0 }", "grep", () => [ED, KT, read("app/api/admin/restaurants/access-tree/route.ts")].every((s) => /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(s)));
  M("§3a no revalidateTag(…, 'max') anywhere", "grep", () => !tsFiles.some((f) => /revalidateTag\([^)]*"max"\)/.test(read(f))));
  M("§3a the table lists every revalidateTag call site there is", "grep", () => { const sites = tsFiles.filter((f) => /revalidateTag\(menuTag|revalidateTag\(\w+\(/.test(read(f))); const listed = sites.filter((f) => D.includes(f)); return { ok: listed.length === sites.length, note: `${sites.length} sites` }; });
  M("§0(1) the owner snapshot cache exists (cachedOwnerPayload + owner_analytics_cache)", "grep + information_schema", async () => {
    if (!/cachedOwnerPayload/.test(read("lib/ownerCache.ts"))) return false; const sk = dbSkip(); if (sk) return true; const r = await sql(`select count(*)::int n from information_schema.tables where table_name='owner_analytics_cache'`); return r[0].n === 1;
  });
  M("§0(2) the orders change-watermark (mig 246) is installed", "pg_proc", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from pg_proc where proname ilike '%watermark%'`); return { ok: r[0].n >= 1, note: `${r[0].n} watermark function(s)` }; });
  M("§0(3) lib/floorSummary.ts still exports invalidateFloor", "read the file", () => /export function invalidateFloor/.test(read("lib/floorSummary.ts")));
  M("§0 verify:busy and verify:floor exist", "package.json", () => !!PKG["verify:busy"] && !!PKG["verify:floor"]);
  M("§3 realtime breadcrumbs carry table_number", "information_schema", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from information_schema.columns where table_name='realtime_events' and column_name='table_number'`); return r[0].n === 1; });
  M("§2 the sessions breadcrumb trigger watches invoice_voided (the mig 096 gap stays closed)", "pg_get_triggerdef", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select pg_get_triggerdef(oid) d from pg_trigger where tgname='rt_emit_sessions'`); return r.length === 1 && /invoice_voided/.test(r[0].d); });
  M("§5 the analytics indexes the playbook names exist (idx_orders_analytics_covering, idx_orders_created_covering — item 10)", "pg_indexes", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select indexname from pg_indexes where schemaname='public' and tablename='orders' and indexname in ('idx_orders_analytics_covering','idx_orders_created_covering')`); return r.length === 2; });
  M("§5 staff_actions and waiter_calls carry (restaurant_id, created_at) indexes", "pg_indexes", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select tablename from pg_indexes where tablename in ('staff_actions','waiter_calls') and indexdef ilike '%(restaurant_id, created_at%'`); return new Set(r.map((x) => x.tablename)).size === 2; });
  M("§5 lfh_owner_overview reads the orders_daily_agg rollup", "pg_proc body", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select prosrc s from pg_proc where proname='lfh_owner_overview' limit 1`); return r.length === 1 && /orders_daily_agg/.test(r[0].s); });
  M("§5 lib/ownerOverviewCache.ts shares the overview for 8 s", "read the file", () => /TTL_MS = 8000/.test(read("lib/ownerOverviewCache.ts")));
  M("§5 loginUser caps its candidates at 50", "read lib/userAuth.ts", () => /MAX_LOGIN_CANDIDATES = 50/.test(read("lib/userAuth.ts")) && /\.limit\(MAX_LOGIN_CANDIDATES\)/.test(read("lib/userAuth.ts")));
  M("§5 the editor's blocklist read names its columns and caps at 500", "read the editor route", () => /from\("blocklist"\)\.select\("[^*"]+"\)[^;]{0,200}\.limit\(500\)/.test(ED));
  M("§5 the still-open select('*') entry is honestly open", "read both", () => /select\(billsMode \? BILLS_COLS : "\*"\)/.test(ED) && /- \[ \] \*\*Trim `orders\.select\("\*"\)`/.test(D));
  M("§5 the still-open N+1 entry is honestly open and found by its sentence (item 8)", "read both", () => /- \[ \] \*\*N\+1/.test(D) && ED.includes("Say why the allergy is changing"));
  M("§4 the security checklist the playbook points at exists", "fs", () => existsSync(join(root, "docs/SECURITY-CHECKLIST.md")));
  M("§4 no secret is a NEXT_PUBLIC_ variable", "grep app/ lib/ components/", () => { const names = [...new Set(tsFiles.flatMap((f) => [...read(f).matchAll(/process\.env\.(NEXT_PUBLIC_\w+)/g)].map((m) => m[1])))]; const bad = names.filter((nm) => /SERVICE|SECRET|TOKEN|PASSWORD/.test(nm)); return { ok: !bad.length, note: names.join(", ") }; });
  M("'Do NOT reach for infrastructure' — no Redis / queue client is a dependency", "package.json", () => { const p = JSON.parse(read("package.json")); const deps = Object.keys({ ...(p.dependencies || {}), ...(p.devDependencies || {}) }); return !deps.some((d) => /redis|bullmq|kafka|rabbit|amqp/i.test(d)); });
  M("the playbook points at no code by line number (item 8)", "read the doc", () => !/around line \*\*\d+\*\*/.test(D));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// N · docs/CANCEL-AND-LOSS-SPEC.md — P199591–P199615
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "docs/CANCEL-AND-LOSS-SPEC.md";
  let n = 199591; const N = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  const classifySrc = async () => (await sql(`select prosrc s from pg_proc where proname='lfh_cancel_classify' limit 1`))?.[0]?.s || "";
  N("the spec names migration 340, the file that defines lfh_cancel_classify (item 1)", "read the doc + migrations", () => /Migration \*\*340\*\*/.test(SRC[F]) && /lfh_cancel_classify/.test(MIG["340_was_the_food_actually_made.sql"] || ""));
  N("lfh_cancel_classify is installed and staff-side only", "pg_proc", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select has_function_privilege('anon', oid, 'execute') a from pg_proc where proname='lfh_cancel_classify'`); return r.length >= 1 && r.every((x) => !x.a); });
  N("a correction writes a removal_classified row (the history of the answer is kept)", "function body", async () => { const sk = dbSkip(); if (sk) return sk; return /removal_classified/.test(await classifySrc()); });
  N("inv_movements accepts consumption_reversal (no longer a dead kind)", "pg_constraint", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='inv_movements'::regclass and contype='c'`); return r.some((x) => /consumption_reversal/.test(x.d)); });
  N("the classifier posts the reversal for 'not made'", "function body", async () => { const sk = dbSkip(); if (sk) return sk; return /consumption_reversal/.test(await classifySrc()); });
  N("the classifier writes a food_loss expense for 'made'", "function body", async () => { const sk = dbSkip(); if (sk) return sk; return /food_loss/.test(await classifySrc()); });
  N("the depletion trigger the spec names (trg_inv_deplete_order, mig 224) is installed", "pg_trigger", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from pg_trigger where tgname ilike 'trg_inv_deplete_order%'`); return r[0].n >= 1; });
  N("the two guards it names exist: verify:cancel-loss and verify:cancel-made", "package.json", () => !!PKG["verify:cancel-loss"] && !!PKG["verify:cancel-made"]);
  N("the tag map's client half exists (public/panels/auditsort.js)", "fs", () => existsSync(join(root, "public/panels/auditsort.js")));
  N("§5b the manager answers from their Audit (void_bills) and the owner from Audit & logs", "grep routes", () => /lfh_cancel_classify/.test(ED) && /void_bills/.test(ED) && tsFiles.some((f) => /^app\/api\/owner/.test(f) && /lfh_cancel_classify/.test(read(f))));
  N("the owner route calls the classifier and no restore RPC", "read the owner route", () => { const f = tsFiles.filter((p) => /^app\/api\/owner/.test(p) && /lfh_cancel_classify/.test(read(p))); return f.length >= 1 && f.every((p) => !/rpc\("[^"]*restore/i.test(read(p))); });
  N("§5 question 1 is answered by §5b; question 2 (no recipe → ₹0) is still open", "read the doc", () => /5b\. ANSWERED/.test(SRC[F]) && /No recipe, no cost/.test(SRC[F]));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// O · docs/BUSINESS-LOGIC-AUDIT.md — P199616–P199630 — the 2026-06-13 snapshot vs today
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const F = "docs/BUSINESS-LOGIC-AUDIT.md";
  let n = 199616; const O = (what, how, fn) => check(`P${n++}`, F, what, how, fn);
  O("it carries the ⚠️ HISTORY banner, so nobody follows it as a current spec", "read the doc", () => /^> ⚠️ \*\*HISTORY/.test(SRC[F]));
  O("its issue #2 (a paid bill could be hard-deleted) is closed: an issued bill's DELETE is refused by trigger", "pg_trigger", async () => { const sk = dbSkip(); if (sk) return sk; const r = await sql(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid=t.tgfoid where p.proname='lfh_block_issued_delete'`); return r[0].n >= 1; });
  O("its issue #4 (no payment mode / no split) is closed: PAYMENT_METHODS + session_payments", "constants", () => pm.PAYMENT_METHODS.length === 4 && /session_payments/.test(SRC["lib/paySplit.ts"]));
  O("its issue #5 (no discount cap) is closed: a per-role cap is enforced server-side", "read", () => /overDiscountCap/.test(SRC["lib/discountCap.ts"]) && /overDiscountCap\(/.test(ED));
  O("its issue #8 (two people paying at once) is closed on the split path by item 5", "read lib/paySplit", () => /\.neq\("payment_status", "paid"\)/.test(SRC["lib/paySplit.ts"]));
  O("its §3 rule 5 ('tax 5%') is no longer a hard-coded multiplication anywhere", "grep", () => !tsFiles.some((f) => f !== "lib/tax.ts" && /\b0\.05\s*\*\s*(sub|subtotal)\b/.test(read(f))));
  O("its 'no staff roles' line is history: staff profiles and the access tree exist", "fs", () => existsSync(join(root, "lib/accessTree.ts")) && existsSync(join(root, "lib/staffCaps.ts")));
  O("nothing in app/ lib/ components/ cites it as a spec to follow", "grep", () => !tsFiles.some((f) => /BUSINESS-LOGIC-AUDIT/.test(read(f))));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// P · logins, data separation, grants — the §1b questions for every file here — P199631–P199670
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  let n = 199631; const P = (file, what, how, fn) => check(`P${n++}`, file, what, how, fn);
  const apiUsing = (re) => tsFiles.filter((f) => /^app\/api\//.test(f) && re.test(read(f)));
  P("lib/clash.ts", "every /api/admin route that calls expectClash checks tokenIsValid", "read each route", () => { const r = apiUsing(/expectClash\(/).filter((f) => /^app\/api\/admin\//.test(f)); return { ok: r.every((f) => /tokenIsValid/.test(read(f))), note: `${r.length} admin routes` }; });
  P("lib/clash.ts", "every /api/owner route that calls expectClash resolves the restaurant through ownerScope", "read each route", () => { const r = apiUsing(/expectClash\(/).filter((f) => /^app\/api\/owner\//.test(f)); return { ok: r.length >= 1 && r.every((f) => /ownerScope/.test(read(f))), note: r.join(", ") }; });
  P("lib/clash.ts", "the panel dispatchers sign the person in (requireRole) before the clash gate", "read the routes", () => [ED, TB, KT].every((s) => /requireRole\(/.test(s)));
  P("lib/idempotency.ts", "every wrapped /api/admin route checks tokenIsValid inside its handler", "read each route", () => { const r = tsFiles.filter((f) => /^app\/api\/admin\//.test(f) && /withIdempotency\(/.test(read(f))); const bad = r.filter((f) => !/tokenIsValid/.test(read(f))); return { ok: !bad.length, note: `${r.length} wrapped admin routes${bad.length ? "; no gate: " + bad.join(", ") : ""}` }; });
  P("lib/idempotency.ts", "every wrapped /api/owner route uses ownerScope", "read each route", () => { const r = tsFiles.filter((f) => /^app\/api\/owner\//.test(f) && /withIdempotency\(/.test(read(f))); return { ok: r.every((f) => /ownerScope/.test(read(f))), note: r.join(", ") }; });
  P("lib/idempotency.ts", "a stored reply is answered before the route's own sign-in check — and holds no secret since item 7 (the rest is a Part-4 decision)", "read the wrapper", () => ({ ok: /if \(claim\.state === "done"\)/.test(SRC["lib/idempotency.ts"]) && /withoutSecrets\(claim\.result\)/.test(SRC["lib/idempotency.ts"]), note: "recorded: the id is a random UUID only the device that minted it holds" }));
  P("lib/paySplit.ts", "settleBillInParts scopes every read and write by the caller's restaurant", "read the file", () => { const S = SRC["lib/paySplit.ts"]; const froms = (S.match(/sb\.from\("/g) || []).length; const scoped = (S.match(/\.eq\("restaurant_id", rid\)|restaurant_id: rid/g) || []).length; return { ok: scoped >= froms, note: `${froms} queries, ${scoped} restaurant scopes` }; });
  P("lib/discountCap.ts", "the cap is read for the signed-in restaurant, never one named in the request", "read the call sites", () => !/discountCapPct\((body|req)/.test(ED + TB));
  P("lib/tax.ts", "every settings select that feeds the tax helpers is scoped to one restaurant", "grep", () => { const off = tsFiles.filter((f) => /select\(TAX_SETTINGS_COLUMNS\)/.test(read(f)) && !/select\(TAX_SETTINGS_COLUMNS\)\.eq\("restaurant_id", \w+\)/.test(read(f))); return { ok: !off.length, note: off.join(", ") || "all scoped" }; });
  P("lib/dbRefusal.ts", "the database's own words for a refusal never reach a response", "real function", () => !/violates/.test(dbr.refusalMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })));
  P("lib/readGuard.ts", "the database's words for a failed read are logged, never returned", "read the file", () => /console\.error/.test(SRC["lib/readGuard.ts"]));
  P("docs/COMPLIANCE-GUARDRAILS.md", "no staff-only money function is executable by the guest", "pg_proc", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select proname from pg_proc where proname in ('lfh_generate_invoice','lfh_void_invoice','lfh_reopen_table','lfh_issue_credit_note','lfh_verify_bill_chain','lfh_cancel_classify','admin_purge_restaurant','lfh_prune_action_idempotency','lfh_order_discount_base','lfh_split_items_tax') and has_function_privilege('anon', oid, 'execute')`);
    return { ok: r.length === 0, note: r.map((x) => x.proname).join(", ") || "none executable by the guest" };
  });
  P("docs/COMPLIANCE-GUARDRAILS.md", "every money table is RLS-on with no guest read", "pg_class", async () => {
    const sk = dbSkip(); if (sk) return sk;
    const r = await sql(`select c.relname, c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'select') a from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and c.relname in ('orders','sessions','order_items','session_payments','credit_notes','invoice_events','bill_chain','restaurant_billing','expenses')`);
    const bad = r.filter((x) => !x.rls || x.a); return { ok: r.length === 9 && !bad.length, note: bad.map((x) => x.relname).join(", ") || "all 9 locked" };
  });
  P("docs/SAAS-EFFICIENCY-PLAYBOOK.md", "the service-role key is never read by a page or a component", "grep", () => !tsFiles.some((f) => (/page\.tsx$/.test(f) || /^components\//.test(f)) && /SUPABASE_SERVICE_ROLE_KEY/.test(read(f))));
  P("lib/clash.ts", "a money column's refusal does not quote the figure (the gate runs before the per-action permission)", "read the file", () => /QUIET_COLUMNS\.has\(c\) \|\| isPlainObject\(current\)/.test(SRC["lib/clash.ts"]));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Q · per-route sign-in, per-call-site rules, refusal families — P199751–P199820
// ══════════════════════════════════════════════════════════════════════════════════════════════════
{
  let n = 199751; const Q = (file, what, how, fn) => check(`P${n++}`, file, what, how, fn);
  const DETAIL = read("docs/CLAUDE-DETAIL.md");
  const GATE = { admin: /tokenIsValid\(/, owner: /ownerScope/, panel: /requireRole\(|gate\(req\)/, profile: /userFromCookie\(/ };
  const wrapped = tsFiles.filter((f) => /^app\/api\//.test(f) && /export const (POST|PATCH|PUT|DELETE) = withIdempotency\(/.test(read(f))).sort();
  for (const f of wrapped) {
    const src = read(f);
    const kind = /^app\/api\/admin\//.test(f) ? "admin" : /^app\/api\/owner\//.test(f) ? "owner" : /^app\/api\/guest\//.test(f) ? "guest" : /panel-profile/.test(f) ? "profile" : "panel";
    Q("lib/idempotency.ts", `${f.replace(/^app\/api\//, "/api/").replace(/\/route\.ts$/, "")} (wrapped once-only) checks its ${kind === "guest" ? "diner's session token, and is on the deliberately-public list" : kind + " sign-in"} inside the handler`, "read the route", () =>
      kind === "guest" ? DETAIL.includes("`" + f.replace(/^app/, "").replace(/\/route\.ts$/, "") + "`") && /token/i.test(src) : GATE[kind].test(src));
  }
  const clashCallers = tsFiles.filter((f) => /^app\/api\//.test(f) && /expectClash\(req, /.test(read(f))).sort();
  for (const f of clashCallers) {
    const src = read(f);
    Q("lib/clash.ts", `${f.replace(/^app\/api\//, "/api/").replace(/\/route\.ts$/, "")} hands the clash gate a restaurant it resolved itself (rid, or the row's own restaurant_id) — never one from the header`, "read the call", () =>
      [...src.matchAll(/expectClash\(req, ([^)]*)\)/g)].every((m) => /^(rid|String\(\w+(\.\w+)*\.restaurant_id \|\| ""\)?)$/.test(m[1].trim())));
  }
  for (const [where, re] of [["the whole-bill discount", /overDiscountCap\(rawDisc, base, cap\)/], ["the parcel discount", /overDiscountCap\(rawPDisc, parcelDiscBase, pcap\)/], ["the per-line discount", /overDiscountCap\(Math\.max\(raw, 0\), discBase, cap\)/]]) {
    Q("lib/discountCap.ts", `the manager route checks the cap on ${where} with the signed-in person's role`, "read the editor route", () => re.test(ED) && /discountCapPct\(rid, discountRole\(g\.user\?\.role\)\)/.test(ED));
  }
  const pmSites = [...(ED + "\n" + TB).matchAll(/PAYMENT_METHODS(?: as readonly string\[\])?\)?\.(includes|find)\(/g)].length;
  Q("lib/payments.ts", "every payment-method check in the two staff routes goes through PAYMENT_METHODS (5 sites, none hand-listed)", "count the call sites", () => ({ ok: pmSites >= 5, note: `${pmSites} sites` }));
  Q("lib/payments.ts", "the editor's case-insensitive look-up still stores the canonical spelling (find, not the raw text)", "read the editor route", () => /\(PAYMENT_METHODS as readonly string\[\]\)\.find\(\(x\) => x\.toLowerCase\(\) === rawM\.toLowerCase\(\)\)/.test(ED));
  // dbRefusal — one row per family of "the database did not answer" the panels actually meet
  for (const [label, err] of [
    ["ECONNRESET on the cause", { message: "fetch failed", cause: { code: "ECONNRESET" } }],
    ["ENOTFOUND on the cause", { message: "fetch failed", cause: { code: "ENOTFOUND" } }],
    ["socket hang up", new Error("socket hang up")],
    ["too many clients", { message: "sorry, too many clients already" }],
    ["upstream request timeout", { message: "upstream request timeout" }],
    ["Cloudflare 'origin is unreachable'", { message: "Error 523: Origin is unreachable" }],
    ["a caller's AbortError", { name: "AbortError", message: "This operation was aborted" }],
    ["undici HeadersTimeoutError", { name: "HeadersTimeoutError", message: "Headers Timeout Error" }],
    ["statement timeout in prose", { message: "canceling statement due to statement timeout" }],
    ["the pooler recycling us (57P01)", { code: "57P01", message: "terminating connection due to administrator command" }],
  ]) Q("lib/dbRefusal.ts", `${label} is the busy reply (503), never a 500 crash row`, "real function", () => dbr.refusalStatus(err) === 503 && dbr.refusalMessage(err) === dbr.BUSY_MESSAGE);
  Q("lib/dbRefusal.ts", "the one constraint with its own sentence (settings_floor_per_row_range) exists on the database, and its range is the sentence's 2–30", "pg_constraint", async () => {
    const sk = dbSkip(); if (sk) return sk; const r = await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname='settings_floor_per_row_range'`);
    return { ok: r.length === 1 && /2/.test(r[0].d) && /30/.test(r[0].d), note: r[0]?.d || "no such constraint" };
  });
  Q("lib/dbRefusal.ts", "LFH01's sentence names the credit note, LFH02's the bill total, LFH03's the reason", "real function", () =>
    /credit note/.test(dbr.refusalMessage({ code: "LFH01" })) && /bill total/.test(dbr.refusalMessage({ code: "LFH02" })) && /reason/.test(dbr.refusalMessage({ code: "LFH03" })));
  // more money boundaries the screens draw
  for (const [v, want] of [[99500, "₹99.5k"], [99950, "₹1L"], [9949999, "₹99.5L"], [9950001, "₹99.5L"], [99999999, "₹10Cr"]]) {
    Q("lib/money.ts", `compactINR(${v}) is "${want}"`, "real function", () => { const g = mts.compactINR(v); return g === want ? true : { ok: false, note: g }; });
  }
  // paySplit on more bill shapes
  const quickDue = async (rows, settings = { tax_rate: 0.05 }) => {
    const sb = { from: (t) => { const q = { select: () => q, eq: () => q, neq: () => q, is: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: t === "settings" ? settings : null, error: null }),
      then: (res) => res({ data: t === "sessions" ? [{ id: "s1" }] : t === "orders" ? rows : [], error: null }) }; return q; } };
    const r = await ps.settleBillInParts(sb, { rid: FH, table: "5", splits: [{ amount: 77777, method: "Cash" }, { amount: 77777, method: "Cash" }] });
    const m = /bill due is ₹(-?[\d.]+)/.exec(r.message || ""); return m ? Number(m[1]) : NaN;
  };
  const o = (x) => ({ id: "o" + Math.random(), status: "served", payment_status: "pending", session_id: "s1", discount: 0, nontax_amount: 0, mrp_amount: 0, ...x });
  Q("lib/paySplit.ts", "a 'GST inside' order (₹1,050 gross, base ₹1,000) is asked for ₹1,050 — not taxed again", "real settle", async () => (await quickDue([o({ subtotal: 1050, taxable_base: 1000, tax_rate: 0.05 })])) === 1050);
  Q("lib/paySplit.ts", "three orders at 5% are taxed ONCE on their combined base (no per-order paisa drift)", "real settle", async () => (await quickDue([o({ subtotal: 33.33, taxable_base: 33.33, tax_rate: 0.05 }), o({ subtotal: 33.33, taxable_base: 33.33, tax_rate: 0.05 }), o({ subtotal: 33.33, taxable_base: 33.33, tax_rate: 0.05 })])) === 104.99);
  Q("lib/paySplit.ts", "a ₹0 order stamped at 0% beside a ₹500 order at 5% does not drag the bill's tax to zero", "real settle", async () => (await quickDue([o({ subtotal: 0, taxable_base: 0, tax_rate: 0 }), o({ subtotal: 500, taxable_base: 500, tax_rate: 0.05 })])) === 525);
  Q("lib/paySplit.ts", "an on-the-house discount equal to the food leaves only the untaxed MRP line due", "real settle", async () => (await quickDue([o({ subtotal: 580, taxable_base: 500, nontax_amount: 80, mrp_amount: 80, discount: 500, tax_rate: 0.05 })])) === 80);
  Q("docs/COMPLIANCE-GUARDRAILS.md", "the delete-a-bill rejection (R27) is written beside the code it governs, as the rejection rule requires", "grep the code", () => /REJECTED \(owner, [^)]*\)[\s\S]{0,400}(delete|Delete)/.test(ED + read("lib/accessTree.ts") + read("lib/accessModel.ts")) && /R27/.test(ED + read("lib/accessTree.ts") + read("lib/accessModel.ts") + REJ));
  Q("docs/COMPLIANCE-GUARDRAILS.md", "verify:rejected is a real guard (the rule that every rejection lives in the code too)", "package.json", () => !!PKG["verify:rejected"]);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const seen = new Set();
  for (const d of defs) { if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`); seen.add(d.id); }
  const newIds = defs.filter((d) => /^P199\d{3}$/.test(d.id)).map((d) => Number(d.id.slice(1)));
  if (newIds.some((x) => x < 199001 || (x > 199670 && x < 199751) || x > 199820)) throw new Error("a NEW id left its sub-range");
  const rows = [];
  for (const d of defs) {
    if (ONLY && d.id !== ONLY) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 200); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
  }
  if (ARGV.includes("--ledger")) {
    const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
    for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
    process.stdout.write("", () => process.exit(0));
    return;
  }
  const bad = rows.filter((r) => r.mark === "❌");
  for (const r of rows) { if (QUIET && r.mark === "✅") continue; console.log(`${r.mark} ${r.id}  [${r.file}] ${r.what}${r.note ? `  → ${r.note}` : ""}`); }
  console.log(`\n${bad.length ? "✗ FAIL" : "✓ PASS"} — ${rows.length} checks · ${rows.filter((r) => r.mark === "✅").length} ✅ · ${bad.length} ❌ · ${rows.filter((r) => r.mark === "⏭").length} ⏭`);
  process.stdout.write("", () => process.exit(bad.length ? 1 : 0));
}
await main();
