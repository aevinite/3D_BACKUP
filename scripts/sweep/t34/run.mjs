// scripts/sweep/t34/run.mjs — sweep #9 · terminal 34 · the money and compliance libraries.
//
// Territory: lib/clash.ts · lib/paySplit.ts · lib/tax.ts · lib/taxFiling.ts · lib/idempotency.ts ·
// lib/idempotencyRule.ts · lib/dbRefusal.ts · lib/readGuard.ts · docs/SAAS-EFFICIENCY-PLAYBOOK.md.
//
//   node scripts/sweep/t34/run.mjs             # everything, printing the ledger table
//   node scripts/sweep/t34/run.mjs --quiet     # only the rows that are not ✅
//   node scripts/sweep/t34/run.mjs --only P104901
//
// TWO BLOCKS.
//   RE-RUN  — the 37 existing ledger rows whose subject is a file this terminal owns and which
//             the three T24 guards do NOT already execute. (The other 166 are re-run by
//             `node scripts/verify-t24-money-rules.mjs --db`, `node scripts/verify-t24b-money-safety.mjs`
//             and `node scripts/verify-t24b-live.mjs --base <url>`; nothing is duplicated here.)
//   NEW     — 50 checks, ids P104901–P105000, aimed where the ledger was measured THINNEST:
//             lib/readGuard.ts and docs/SAAS-EFFICIENCY-PLAYBOOK.md had ZERO rows across all 44
//             ledger files, lib/dbRefusal.ts had 1 and lib/idempotencyRule.ts had 4.
//
// IT RUNS THE REAL FUNCTIONS. Same `@/` resolver as scripts/verify-t24-money-rules.mjs, for the
// same reason: a check that re-implements the rule it checks proves nothing about the rule that
// ships. NOTHING HERE WRITES TO THE DATABASE — lib/paySplit.ts is driven against an in-memory
// stand-in for the supabase client, so the real settle arithmetic runs with no row touched.
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
const ONLY = ARGV.includes("--only") ? ARGV[ARGV.indexOf("--only") + 1] : null;

const defs = [];
const check = (id, what, how, fn) => defs.push({ id, what, how, fn });

// ══════════════════════════════════════════════════════════════════════════════════════════════
// the real modules
// ══════════════════════════════════════════════════════════════════════════════════════════════
const rg = await import(pathToFileURL(join(root, "lib/readGuard.ts")).href);
const dbr = await import(pathToFileURL(join(root, "lib/dbRefusal.ts")).href);
const idr = await import(pathToFileURL(join(root, "lib/idempotencyRule.ts")).href);
const tf = await import(pathToFileURL(join(root, "lib/taxFiling.ts")).href);
const tx = await import(pathToFileURL(join(root, "lib/tax.ts")).href);
const BILLDOC = (await import(pathToFileURL(join(root, "public/panels/billdoc.js")).href)).default;

const srcReadGuard = read("lib/readGuard.ts");
const srcRefusal = read("lib/dbRefusal.ts");
const srcClash = read("lib/clash.ts");
const srcPaySplit = read("lib/paySplit.ts");
const srcIdem = read("lib/idempotency.ts");
const srcIdemRule = read("lib/idempotencyRule.ts");
const srcTax = read("lib/tax.ts");
const srcTaxFiling = read("lib/taxFiling.ts");
const playbook = read("docs/SAAS-EFFICIENCY-PLAYBOOK.md");

// Silence the ReadSet constructor's console.error while we deliberately hand it failures —
// except where a check is ABOUT that logging, which captures it instead.
function captureErr(fn) {
  const real = console.error; const out = [];
  console.error = (...a) => out.push(a.map(String).join(" "));
  try { return { value: fn(), logged: out }; } finally { console.error = real; }
}

const tsFiles = [];
(function walk(d) {
  for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
    const r = `${d}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(r); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) tsFiles.push(r);
  }
})("app");
(function walk(d) {
  for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
    const r = `${d}/${e.name}`;
    if (e.isDirectory()) { walk(r); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) tsFiles.push(r);
  }
})("lib");
(function walk(d) {
  for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
    const r = `${d}/${e.name}`;
    if (e.isDirectory()) { walk(r); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) tsFiles.push(r);
  }
})("components");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK 1 — RE-RUN: the 37 existing rows the three T24 guards do not execute
// ══════════════════════════════════════════════════════════════════════════════════════════════
const R = (id, what, fn) => check(id, what, "re-run · sweep #9 T34", fn);
const guestMenu = read("app/menu/page.tsx") + read("components/CartDrawer.tsx") + read("lib/menu.ts")
  + tsFiles.filter((f) => /guest|cart|menu/i.test(f)).map(read).join("\n");
const editorRoute = read("app/api/editor/[...path]/route.ts");
const tabletRoute = read("app/api/tablet/[...path]/route.ts");
const appJs = read("public/panels/editor/app.js");

R("P01065", "the cart quotes the rate from lib/tax.ts, never a second formula",
  () => /from "\.\/tax"/.test(read("lib/menu.ts")) && /effectiveTaxRate\(data\)/.test(read("lib/menu.ts"))
     && !/tax_rate\s*\|\|\s*0\.05/.test(read("lib/menu.ts")));
R("P01456", "the at-most-once id the phone mints is the header lib/idempotency.ts dedups on",
  () => /x-lfh-action-id/i.test(srcIdem) && tsFiles.concat(["public/panels/outbox.js", "public/app.js"])
    .some((f) => /X-LFH-Action-Id/i.test(read(f))));
R("P01457", "a replayed offline order carries the replay marker lib/clash.ts reads",
  () => /x-lfh-replay/i.test(srcClash) && /x-lfh-queued-at/i.test(srcClash));
R("P16512", "…and the same id is what withIdempotency claims (one header, one rule)",
  () => /const actionId = req\.headers\.get\("x-lfh-action-id"\)/.test(srcIdem));
R("P03004", "effectiveTaxRate sums NAMED components first, then tax_rate, then 5%",
  () => tx.effectiveTaxRate({ tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] }) === 0.18
     && tx.effectiveTaxRate({ tax_rate: 0.12 }) === 0.12 && tx.effectiveTaxRate({}) === 0.05
     && tx.effectiveTaxRate({ tax_components: [{ label: "", rate: 9 }, { label: "x", rate: 0 }] }) === 0.05);
R("P03010", "resolveTaxMode answers exempt for a composition restaurant BEFORE any per-dish answer",
  () => tx.resolveTaxMode("incl", { price_tax_mode: "composition", item_tax_modes_allowed: true }) === "exempt");
R("P03257", "an expectation still travels on the value-editing write paths",
  () => (editorRoute + appJs + tabletRoute).match(/expect\s*:/g)?.length >= 6);
R("P03450", "resolveTaxMode still matches lfh_resolve_tax_mode case for case",
  () => {
    // The LATEST definition wins — the function is redefined more than once.
    const migs = readdirSync(join(root, "supabase/migrations")).filter((f) => /\.sql$/.test(f)).sort();
    let body = "";
    for (const f of migs) {
      const m = read(`supabase/migrations/${f}`).match(/CREATE OR REPLACE FUNCTION lfh_resolve_tax_mode[\s\S]*?\$\$;/);
      if (m) body = m[0];
    }
    if (!body) return { ok: false, note: "no lfh_resolve_tax_mode definition found at all" };
    const order = [...body.matchAll(/WHEN\s+(?:s\.price_tax_mode = 'composition'|NOT COALESCE\(s\.item_tax_modes_allowed|COALESCE\(p_dish_mode, 'default'\) = '([a-z]+)')/g)]
      .map((m) => m[1] || (m[0].includes("composition") ? "composition" : "master-off"));
    const sqlOrder = order.join(">");
    // The TypeScript tests exactly these, in exactly this order (excl and incl share one line).
    const behaves = [
      [tx.resolveTaxMode("incl", { price_tax_mode: "composition", item_tax_modes_allowed: true }), "exempt"],
      [tx.resolveTaxMode("mrp", { item_tax_modes_allowed: false, price_tax_mode: "incl" }), "incl"],
      [tx.resolveTaxMode("excl", { item_tax_modes_allowed: true, price_tax_mode: "incl" }), "excl"],
      [tx.resolveTaxMode("incl", { item_tax_modes_allowed: true }), "incl"],
      [tx.resolveTaxMode("none", { item_tax_modes_allowed: true }), "exempt"],
      [tx.resolveTaxMode("mrp", { item_tax_modes_allowed: true, mrp_tax_treatment: "inclusive" }), "incl"],
      [tx.resolveTaxMode("mrp", { item_tax_modes_allowed: true }), "exempt"],
      [tx.resolveTaxMode("default", { item_tax_modes_allowed: true, price_tax_mode: "incl" }), "incl"],
      [tx.resolveTaxMode(undefined, {}), "excl"],
    ];
    return sqlOrder === "composition>master-off>excl>incl>none>mrp" && behaves.every(([got, want]) => got === want)
      ? { ok: true, note: `SQL case order ${sqlOrder}; TypeScript agrees on all 9 shapes` }
      : { ok: false, note: `SQL order ${sqlOrder}; TS answers ${behaves.map(([g]) => g).join(",")}` };
  });
R("P03451", "the TypeScript rate rule and the panel's taxModel still answer the same number",
  () => [{ tax_rate: 0.18 }, {}, { tax_rate: 0 }, { price_tax_mode: "composition" },
         { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] }]
    .every((s) => Math.abs(tx.effectiveTaxRate(s) - BILLDOC.taxModel(s).rate) < 1e-12));
R("P60737", "lib/clash.ts still supports a `where` (composite-key) expectation at all",
  () => /COMPOSITE_KEYS/.test(srcClash) && /inv_count_lines: \["count_id", "item_id"\]/.test(srcClash));
R("P03568", "lib/paySplit.ts uses the ONE rate definition rather than its own copy",
  () => /BILLDOC\.orderTaxRate/.test(srcPaySplit) && !/tax_rate\s*>\s*0\s*\?/.test(srcPaySplit));
R("P03964", "…so a split can always equal the printed bill (the paper's own function)",
  () => /import BILLDOC from "@\/public\/panels\/billdoc\.js"/.test(srcPaySplit));
R("P05958", "the two-button boolean screens still present no from-value for lib/clash.ts to hold",
  () => /COMPARABLE_TABLES/.test(srcClash));
R("P20795", "…and verify:clash-coverage still states which areas are deliberately uncovered",
  () => /deliberately NOT checked|NOT_COVERED|deliberate/i.test(read("scripts/verify-clash-coverage.mjs")));
R("P06064", "an empty box is sent as \"\", which is what the comparison treats as equal to absent",
  () => {
    const cc = read("lib/clashCompare.ts");
    return /sameValue/.test(cc) && /""/.test(cc);
  });
R("P06946", "paying a bill in parts is never re-implemented — every writer calls settleBillInParts",
  () => {
    const callers = tsFiles.filter((f) => /settleBillInParts/.test(read(f)) && f !== "lib/paySplit.ts");
    return callers.length >= 2 && callers.every((f) => /from "@\/lib\/paySplit"/.test(read(f)));
  });
R("P47789", "lib/clash.ts still protects a free-text box — a note/label expectation is still sent",
  () => /"x-lfh-expect"/.test(srcClash) && /expect/.test(appJs));
R("P25955", "action_idempotency is read by its own action id, never by restaurant (so no scope row is owed)",
  () => !/action_idempotency[\s\S]{0,200}?restaurant_id/.test(srcIdem)
     && /\.eq\("action_id", actionId\)/.test(srcIdem));
R("P104535", "the claims table still has its own pruner, called opportunistically from this file",
  () => /lfh_prune_action_idempotency/.test(srcIdem) && /PRUNE_ODDS = 200/.test(srcIdem));
R("P12073", "splitTax parts always sum EXACTLY to the target (200 random targets)",
  () => {
    let s = 1;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i++) {
      const target = (rnd() * 20000 - 5000);
      const rates = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => rnd() * 10);
      const parts = tf.splitTax(rates, target);
      const sum = Math.round(parts.reduce((a, x) => a + x, 0) * 100) / 100;
      if (Math.abs(sum - Math.round(target * 100) / 100) > 0.005) return false;
    }
    return true;
  });
R("P12089", "lib/dbRefusal.ts still has NO imports, so the plain node test can load it",
  () => !/^\s*import\s/m.test(srcRefusal));
R("P12190", "didSomething is FALSE for a 200 body carrying ok:false",
  () => idr.didSomething(200, { ok: false }) === false && idr.didSomething(200, { ok: true }) === true);
R("P27377", "the comparator is stable and lib/clash.ts is still its one consumer",
  () => {
    const users = tsFiles.filter((f) => /from "@\/lib\/clashCompare"/.test(read(f)));
    return users.length === 1 && users[0] === "lib/clash.ts";
  });
R("P36542", "verify:owner-reports still names something real inside lib/taxFiling.ts",
  () => {
    const g = read("scripts/verify-owner-reports.mjs");
    return /taxFiling|splitTax|allocateWhole|taxableValue|exemptIsMaterial/.test(g);
  });
R("P36555", "verify:split-payment still names something real inside lib/paySplit.ts",
  () => {
    const g = read("scripts/verify-split-payment.mjs");
    return /paySplit|settleBillInParts|badSplitShape|reverseSplitLegs/.test(g);
  });
R("P36556", "verify:t24-money-rules still names something real inside lib/idempotency.ts",
  () => /idempotency/.test(read("scripts/verify-t24-money-rules.mjs")));
R("P37715", "…and the tokens that guard names in lib/paySplit.ts are all still present in it",
  () => /settleBillInParts/.test(srcPaySplit) && /reverseSplitLegs/.test(srcPaySplit) && /badSplitShape/.test(srcPaySplit));
R("P37733", "verify:order-retry still executes the shipped rule rather than a copy of it",
  () => /idempotencyRule/.test(read("scripts/verify-order-retry.mjs")));
R("P37746", "verify:split-payment is still wired into package.json as a runnable guard",
  () => /"verify:split-payment"/.test(read("package.json")));
R("P14523", "settling a bill in parts still reads money through a shared definition",
  () => /BILLDOC\.orderTaxRate/.test(srcPaySplit) && /effectiveTaxRate/.test(srcPaySplit));
R("P14524", "the line-level split still reads money through a shared definition",
  () => /effectiveTaxRate/.test(srcTax) && /discountBaseOf/.test(srcTax));
R("P14525", "the filing split shows no order-level money, so it owes no shared-definition reference",
  () => !/rpc\(|netOf|billMoney/.test(srcTaxFiling) ? "skip: still no order-level money on this surface — the ⏭ stands" : false);
R("P14545", "lib/tax.ts is imported, never re-implemented — importers still found",
  () => { const n = tsFiles.filter((f) => /from "@\/lib\/tax"|from "\.\/tax"/.test(read(f))).length;
           return n >= 9 ? { ok: true, note: `${n} importer(s)` } : { ok: false, note: `${n} importer(s)` }; });
R("P14546", "lib/paySplit.ts is imported, never re-implemented — importers still found",
  () => { const n = tsFiles.filter((f) => /from "@\/lib\/paySplit"/.test(read(f))).length;
           return n >= 2 ? { ok: true, note: `${n} importer(s)` } : { ok: false, note: `${n} importer(s)` }; });
R("P14547", "lib/taxFiling.ts is imported, never re-implemented — importers still found",
  () => { const n = tsFiles.filter((f) => /from "@\/lib\/taxFiling"/.test(read(f))).length;
           return n >= 3 ? { ok: true, note: `${n} importer(s)` } : { ok: false, note: `${n} importer(s)` }; });
R("P43683", "withIdempotency still honours the id: claim, run once, echo the stored reply",
  () => /state === "done"/.test(srcIdem) && /duplicate: true/.test(srcIdem) && /sync_in_progress/.test(srcIdem));
R("P43703", "first save wins and the loser is TOLD — the refusal is 409 with a sentence",
  () => /status: 409/.test(srcClash) && /Your change was NOT saved/.test(srcClash));

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — 50 NEW CHECKS · P104901–P105000
// ══════════════════════════════════════════════════════════════════════════════════════════════
const N = (id, what, how, fn) => check(id, what, how, fn);
const okRead = (name, data, extra = {}) => ({ name, data, error: null, count: null, ms: 1, retried: false, ...extra });
const badRead = (name, error) => ({ name, data: null, error, count: null, ms: 7, retried: false });

// ── lib/readGuard.ts — ZERO ledger rows across all 44 files before today (18) ─────────────────
N("P104901", "a named read carries its name, its rows, no error, and how long it took",
  "run lib/readGuard.ts rd() against a stand-in supabase result", async () => {
    const r = await rg.rd("x", async () => ({ data: [{ a: 1 }], error: null }));
    return r.name === "x" && r.data.length === 1 && !r.error && typeof r.ms === "number" && r.retried === false;
  });
N("P104902", "a head-COUNT read keeps its count even though it has no rows — a zero is not 'no rows'",
  "rd() over a { data: null, count: 0 } result", async () => {
    const r = await rg.rd("c", async () => ({ data: null, error: null, count: 0 }));
    return r.count === 0 && r.data === null;
  });
N("P104903", "a read that never asked for a count reports null, not 0",
  "rd() over a result with no count field", async () => {
    const r = await rg.rd("c", async () => ({ data: [], error: null }));
    return r.count === null;
  });
N("P104904", "a read that fails for a plumbing reason is tried once more, and says it was",
  "rd() over a stand-in that fails once with ECONNRESET then succeeds", async () => {
    let n = 0;
    const r = await rg.rd("f", async () => (++n === 1 ? { data: null, error: { code: "ECONNRESET", message: "socket hang up" } } : { data: [1], error: null }));
    return n === 2 && r.retried === true && !r.error;
  });
N("P104905", "a read the caller already resolved can be wrapped even when it came back undefined",
  "named() over undefined — the ?. guard it carries", () => {
    const r = rg.named("u", undefined);
    return r.data === null && r.error === null && r.count === null;
  });
N("P104906", "asking about a read that does not exist answers FAILED — a typo must never read as fine",
  "ReadSet.failed() with a name nothing was filed under", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [okRead("a", [])]));
    return value.failed("typo") === true && value.failed("a") === false;
  });
N("P104907", "rows() on a read that FAILED throws rather than handing back an empty list",
  "ReadSet.rows() over a failed read — the '₹0 that nobody read' shape", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [badRead("a", { message: "boom" })]));
    try { value.rows("a"); return false; } catch (e) { return e instanceof rg.ReadFailed && e.read === "a" && e.where === "t34"; }
  });
N("P104908", "rows() on a read that SUCCEEDED with nothing gives an empty list, not a throw",
  "ReadSet.rows() over { data: null, error: null }", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [okRead("a", null)]));
    return Array.isArray(value.rows("a")) && value.rows("a").length === 0;
  });
N("P104909", "one() gives null for an empty successful read and the first row otherwise",
  "ReadSet.one()", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [okRead("e", []), okRead("f", [{ n: 1 }, { n: 2 }])]));
    return value.one("e") === null && value.one("f").n === 1;
  });
N("P104910", "count() on a FAILED read throws — it can never print a confident zero",
  "ReadSet.count() over a failed head-count", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [badRead("c", { message: "down" })]));
    try { value.count("c"); return false; } catch (e) { return e instanceof rg.ReadFailed; }
  });
N("P104911", "count() on a read that never ASKED for a count throws, rather than guessing",
  "ReadSet.count() over a rows read", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [okRead("c", [1, 2, 3])]));
    try { value.count("c"); return false; } catch (e) { return /did not ask for a count/.test(e.cause?.message || ""); }
  });
N("P104912", "…and a genuine zero count is returned as 0, because that one IS true",
  "ReadSet.count() over { count: 0 }", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [okRead("c", null, { count: 0 })]));
    return value.count("c") === 0;
  });
N("P104913", "rowsOr() hands back the caller's own fallback on a failure and never throws",
  "ReadSet.rowsOr() over a failed read", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [badRead("a", { message: "x" })]));
    return JSON.stringify(value.rowsOr("a", ["fallback"])) === '["fallback"]'
        && JSON.stringify(value.rowsOr("never-filed", [])) === "[]";
  });
N("P104914", "partial() names each broken part ONCE, even when two failed reads share a key",
  "ReadSet.partial() with two names mapped to one screen key", () => {
    const { value } = captureErr(() => new rg.ReadSet("t34", [badRead("a", { message: "1" }), badRead("b", { message: "2" }), okRead("c", [])]));
    const p = value.partial({ a: "expenses", b: "expenses", c: "purchases" });
    return p.length === 1 && p[0] === "expenses";
  });
N("P104915", "'every read failed' is false for an empty set and true only when they all did",
  "ReadSet.allFailed / anyFailed", () => {
    const empty = captureErr(() => new rg.ReadSet("t34", [])).value;
    const some = captureErr(() => new rg.ReadSet("t34", [badRead("a", { message: "1" }), okRead("b", [])])).value;
    const all = captureErr(() => new rg.ReadSet("t34", [badRead("a", { message: "1" }), badRead("b", { message: "2" })])).value;
    return empty.allFailed === false && empty.anyFailed === false
        && some.allFailed === false && some.anyFailed === true
        && all.allFailed === true && all.failedNames.join(",") === "a,b";
  });
N("P104916", "fanning a read over several restaurants keeps the ones that answered AND says how many did not",
  "keepWhatAnswered() — the 'a group total must not quietly become a subset' rule", () => {
    const r = rg.keepWhatAnswered([{ error: null, v: 1 }, { error: { message: "x" } }, { error: null, v: 3 }]);
    const none = rg.keepWhatAnswered([]);
    const dead = rg.keepWhatAnswered([{ error: { message: "x" } }]);
    return r.ok.length === 2 && r.missing === 1 && r.allFailed === false && r.firstError.message === "x"
        && none.allFailed === false && dead.allFailed === true;
  });
N("P104917", "the database's own words are logged OUR side exactly once, with the route name — never returned",
  "capture console.error while a ReadSet is built from two failures", () => {
    const { logged } = captureErr(() => new rg.ReadSet("owner/inventory", [
      badRead("summary", { message: "permission denied for table expenses", code: "42501" }),
      okRead("ok2", []),
    ]));
    return logged.length === 1 && /owner\/inventory/.test(logged[0]) && /42501/.test(logged[0])
        && /permission denied/.test(logged[0]) && /7ms/.test(logged[0]);
  });
N("P104918", "no route files two reads under ONE name — a second would silently replace the first",
  "scan every `new ReadSet(...)` in app/ and lib/ and look for a repeated rd()/named() name", () => {
    let total = 0; const dups = [];
    for (const f of tsFiles) {
      const s = read(f);
      const re = /new ReadSet\(/g; let m;
      while ((m = re.exec(s))) {
        let i = m.index + m[0].length, depth = 1;
        while (i < s.length && depth > 0) { const c = s[i]; if (c === "(") depth++; else if (c === ")") depth--; i++; }
        const block = s.slice(m.index, i);
        // A `cond ? rd("x", …) : rd("x", …)` pair is ONE read under one name, not two — only one
        // arm ever runs. Counting it as a duplicate is the detector being wrong, not the route.
        const names = [...block.matchAll(/\b(?:rd|named)\(\s*"([^"]+)"/g)].map((x) => x[1]);
        const ternary = new Set([...block.matchAll(/\?\s*(?:\n\s*)?rd\(\s*"([^"]+)"[\s\S]{0,400}?:\s*(?:\n\s*)?rd\(\s*"([^"]+)"/g)].flatMap((x) => [x[1], x[2]]));
        const seen = new Set();
        for (const n of names) { if (seen.has(n) && !ternary.has(n)) dups.push(`${f}:${n}`); seen.add(n); }
        total += names.length;
      }
    }
    return dups.length === 0 ? { ok: true, note: `${total} named reads across every ReadSet in the repo, no repeated name` }
                             : { ok: false, note: dups.join(", ") };
  });

// ── lib/dbRefusal.ts — ONE ledger row before today, 287 lines (14) ────────────────────────────
N("P104919", "a CHECK the database refuses is a 400 the person must read, never a 500 the queue retries",
  "refusalStatus over SQLSTATE 23514 — on the CODE ALONE, and separately on the prose alone", () => {
    // TWO SEPARATE PATHS, ASSERTED SEPARATELY ON PURPOSE. A message that happens to carry the
    // words "violates check constraint" is classified by the TEXT rule, so a single example
    // carrying both a code and that prose stays green even if the code is deleted from the list —
    // measured here on 2026-09-18 by removing 23514 and watching this row pass anyway.
    const codeOnly = dbr.refusalStatus({ code: "23514", message: "the value 18 is not acceptable here" }) === 400;
    const proseOnly = dbr.refusalStatus({ message: 'new row violates check constraint "x"' }) === 400;
    return codeOnly && proseOnly ? { ok: true, note: "code path and prose path each refuse on their own" }
                                 : { ok: false, note: `code path ${codeOnly}, prose path ${proseOnly}` };
  });
N("P104920", "…and it is said in the words of the screen, not Postgres prose",
  "refusalMessage over the floor_per_row constraint", () =>
    dbr.refusalMessage({ code: "23514", message: 'new row for relation "settings" violates check constraint "settings_floor_per_row_range"' })
      === "Tables per row has to be a whole number between 2 and 30.");
N("P104921", "…and that sentence still matches the range the database actually enforces",
  "read the latest migration that defines settings_floor_per_row_range", () => {
    const migs = readdirSync(join(root, "supabase/migrations")).filter((f) => /\.sql$/.test(f)).sort();
    let range = null;
    for (const f of migs) {
      const m = read(`supabase/migrations/${f}`).match(/settings_floor_per_row_range[\s\S]{0,200}?CHECK \(floor_per_row >= (\d+) AND floor_per_row <= (\d+)\)/);
      if (m) range = [m[1], m[2]];
    }
    return !!range && dbr.refusalMessage({ code: "23514", message: "settings_floor_per_row_range" }).includes(`${range[0]} and ${range[1]}`);
  });
N("P104922", "a row that is simply gone is a 404 with a sentence, not a red crash row",
  "isMissingRow / refusalStatus / worthLogging over PGRST116 · 0 rows", () => {
    const e = { code: "PGRST116", message: "Cannot coerce the result to a single JSON object", details: "The result contains 0 rows" };
    return dbr.isMissingRow(e) && dbr.refusalStatus(e) === 404 && dbr.worthLogging(e) === false
        && /not there any more/.test(dbr.refusalMessage(e));
  });
N("P104923", "…but 'more than one row' stays a real fault with its 500 and its red row",
  "PGRST116 whose detail says 2 rows", () => {
    const e = { code: "PGRST116", message: "Cannot coerce the result to a single JSON object", details: "The result contains 2 rows" };
    return dbr.isMissingRow(e) === false && dbr.refusalStatus(e) === 500 && dbr.worthLogging(e) === true;
  });
N("P104924", "a database that did not answer is 503 + the busy sentence, so the device shows its saved copy",
  "isDbUnreachable over a timeout, a dropped socket and the pooler recycling us", () => {
    const cases = [
      { name: "TimeoutError", message: "The operation was aborted due to timeout" },
      { message: "fetch failed", cause: { code: "ECONNRESET" } },
      { code: "57P01", message: "terminating connection due to administrator command" },
      { code: "53300", message: "too many connections" },
    ];
    return cases.every((e) => dbr.isDbUnreachable(e) && dbr.refusalStatus(e) === 503 && dbr.refusalMessage(e) === dbr.BUSY_MESSAGE);
  });
N("P104925", "…and that sentence never blames the person's own internet",
  "read BUSY_MESSAGE", () => !/internet|connection|offline|network/i.test(dbr.BUSY_MESSAGE) && /busy/i.test(dbr.BUSY_MESSAGE));
N("P104926", "a busy database is STILL written to the repair board — only a gone row is not",
  "worthLogging over the busy shapes", () =>
    dbr.worthLogging({ code: "57P01" }) && dbr.worthLogging({ code: "23514" })
    && dbr.worthLogging({ name: "TimeoutError", message: "aborted due to timeout" }));
N("P104927", "a refusal of the VALUE is never re-read as 'the server is busy' — the two can never both be true",
  "isDataRefusal and isDbUnreachable over every refusal code the file lists", () => {
    const codes = ["22001", "22003", "22007", "22P02", "23502", "23503", "23505", "23514", "23P01", "LFH01", "LFH02", "LFH03"];
    return codes.every((code) => dbr.isDataRefusal({ code }) && dbr.isDbUnreachable({ code }) === false);
  });
N("P104928", "our own three refusals are CONFLICTS (409) with their own sentence, never raw SQL prose",
  "refusalStatus / refusalMessage over LFH01–LFH03", () => {
    const want = {
      LFH01: /settled[\s\S]*credit note/i,
      LFH02: /credit can't be more than/i,
      LFH03: /Say why this bill is being reopened/i,
    };
    return Object.entries(want).every(([code, re]) => {
      const e = { code, message: "lfh: invoice locked — raw prose written for the error log" };
      return dbr.refusalStatus(e) === 409 && re.test(dbr.refusalMessage(e)) && !/lfh:/.test(dbr.refusalMessage(e));
    });
  });
N("P104929", "every one of our own codes has BOTH a sentence and a place on the refusal list",
  "cross-check OWN_CODE_TEXT against REFUSAL_CODES in the source", () => {
    const own = [...srcRefusal.matchAll(/^\s{2}(LFH\d+):/gm)].map((m) => m[1]);
    const listed = [...srcRefusal.matchAll(/"(LFH\d+)",/g)].map((m) => m[1]);
    return own.length >= 3 && own.every((c) => listed.includes(c)) && own.every((c) => !!dbr.refusalMessage({ code: c }));
  });
N("P104930", "rethrowing a database error keeps its code, so the status a person gets stays honest",
  "pgError() then re-classify", () => {
    const err = dbr.pgError({ code: "23514", message: "violates check constraint \"x\"", details: "d", hint: "h" });
    return err instanceof Error && err.code === "23514" && err.details === "d" && err.hint === "h"
        && dbr.refusalStatus(err) === 400;
  });
N("P104931", "…and an error carrying no message at all still produces a sentence rather than 'undefined'",
  "pgError({}) and refusalMessage of it", () => {
    const err = dbr.pgError({});
    return err.message === "database error" && !/undefined|\[object Object\]|NaN/.test(dbr.refusalMessage(err));
  });
N("P104932", "anything this file does not recognise keeps its 500 — a real bug is never dressed up as a busy moment",
  "refusalStatus over an ordinary app error", () => {
    const e = new Error("Cannot read properties of undefined (reading 'map')");
    return dbr.refusalStatus(e) === 500 && dbr.refusalMessage(e) === e.message
        && dbr.isDataRefusal(e) === false && dbr.isDbUnreachable(e) === false;
  });

// ── lib/idempotencyRule.ts (4 rows before today) and the claim it drives (4) ──────────────────
N("P104933", "a refusal reported inside a 200 is NOT remembered, so the same basket can be sent again",
  "didSomething over the guest-order RPC's refusal shapes", () =>
    ["sold_out", "rate_limited", "session_closed"].every((reason) => idr.didSomething(200, { ok: false, reason }) === false)
    && idr.didSomething(200, { ok: true, order_id: "x" }) === true);
N("P104934", "every 4xx and 5xx is released too, so a person who fixes the cause can simply try again",
  "didSomething over statuses", () => [400, 401, 403, 404, 409, 422, 500, 503].every((s) => idr.didSomething(s, { ok: true }) === false)
    && [200, 201, 204].every((s) => idr.didSomething(s, null) === true));
N("P104935", "an old row that WAS wrongly remembered heals itself instead of replaying the refusal forever",
  "storedIsRefusal + the self-heal branch in lib/idempotency.ts", () =>
    idr.storedIsRefusal({ ok: false }) === true && idr.storedIsRefusal({ ok: true }) === false
    && idr.storedIsRefusal(null) === false && idr.storedIsRefusal("ok:false") === false
    && /storedIsRefusal\(stored\)/.test(srcIdem) && /done: false, result: null/.test(srcIdem));
N("P104936", "the rule file still imports nothing, so the guard executes the rule that SHIPS",
  "grep lib/idempotencyRule.ts for an import", () => !/^\s*import\s/m.test(srcIdemRule) && /export function didSomething/.test(srcIdemRule));

// ── docs/SAAS-EFFICIENCY-PLAYBOOK.md — ZERO ledger rows before today (6) ──────────────────────
N("P104937", "the playbook's rule 1 still points at code that exists: the compute-on-view snapshot cache",
  "read §0.1 and check lib/ownerCache.ts + owner_analytics_cache", () =>
    /cachedOwnerPayload/.test(playbook) && /cachedOwnerPayload/.test(read("lib/ownerCache.ts"))
    && readdirSync(join(root, "supabase/migrations")).some((f) => /owner_analytics_cache|196_/.test(f + read(`supabase/migrations/${f}`).slice(0, 400))));
N("P104938", "rule 3 still points at a floor read that is shared and a guard that watches it",
  "read §0.3 and check lib/floorSummary.ts + verify:floor", () =>
    /invalidateFloor/.test(playbook) && /invalidateFloor/.test(read("lib/floorSummary.ts")) && /"verify:floor"/.test(read("package.json")));
N("P104939", "the two items §5 says are DONE really are done — the blocklist reads still name columns and cap",
  "read the admin custlog + editor blocklist reads", () => {
    const admin = tsFiles.filter((f) => /custlog/i.test(f)).map(read).join("\n");
    return /\.limit\(200\)/.test(admin) && /blocklist/i.test(editorRoute) && /\.limit\(500\)/.test(editorRoute);
  });
N("P104940", "…and the login candidate loop is still capped, which was the other CPU-per-attempt one",
  "read lib/userAuth.ts for MAX_LOGIN_CANDIDATES", () => {
    const ua = read("lib/userAuth.ts");
    // \b on purpose: without it the pattern also matched a cap that had been widened to 5000,
    // and this row passed with the fault present (measured 2026-09-18).
    return /MAX_LOGIN_CANDIDATES\s*=\s*50\b/.test(ua) && /\.limit\(MAX_LOGIN_CANDIDATES\)/.test(ua);
  });
N("P104941", "the three items §5 still lists as OPEN are honestly open — none has quietly been done",
  "check each unticked box against today's code", () => {
    const open = [...playbook.matchAll(/^- \[ \] \*\*(.+?)\*\*/gm)].map((m) => m[1]);
    const allergenLoopStillThere = /for \(const/.test(editorRoute) && /order_items/.test(editorRoute) && /allerg/i.test(editorRoute);
    const starSelectStillThere = /billsMode \? BILLS_COLS : "\*"/.test(editorRoute);
    return open.length === 3 && allergenLoopStillThere && starSelectStillThere;
  });
N("P104942", "the playbook still refuses infrastructure, which is the rule people come here looking to break",
  "read the closing section", () =>
    /Redis, job queues and read replicas are Stage-3/.test(playbook) && /Do not add them early/i.test(playbook)
    && /Order volume is not the risk/.test(playbook));

// ── lib/paySplit.ts vs the PRINTED BILL, on random bills (5) ──────────────────────────────────
// THE GROUND NOBODY STOOD ON. The existing suite runs 30,000 random bills through lib/tax.ts's
// splitBill. NOTHING has ever run the REAL settleBillInParts and asked whether the due it demands
// equals the total the paper prints for the same rows — which is the failure the whole file is
// written to prevent ("the paper says ₹1,000 and Pay-in-parts refuses every split until the parts
// add to ₹1,050, a button no waiter can satisfy"). So: drive it against a stand-in client, read
// the due back out of its own refusal sentence, and compare with BILLDOC.billMoney.
const paySplit = await import(pathToFileURL(join(root, "lib/paySplit.ts")).href);
function stubSb({ rows, settings }) {
  const table = (name) => {
    const q = {
      select: () => q, eq: () => q, neq: () => q, is: () => q, in: () => q,
      order: () => q, limit: () => q, insert: () => q, update: () => q,
      maybeSingle: async () => ({ data: name === "settings" ? settings : null, error: null }),
      then: (res) => res({ data: name === "orders" ? rows : [], error: null }),
    };
    return q;
  };
  return { from: table };
}
async function dueOf(rows, settings, mustNotEqual) {
  // Deliberately mismatched parts: the sum is put a clear ₹1,000 away from anything this bill
  // could be, so the function ALWAYS refuses and states the due it computed. Nothing is written —
  // it returns before the insert. (A sentinel that could accidentally EQUAL the due would let the
  // settle proceed, which is the one thing a check must never do to a money path.)
  const far = Math.abs(Number(mustNotEqual) || 0) + 1000;
  const r = await paySplit.settleBillInParts(stubSb({ rows, settings }), {
    rid: "00000000-0000-0000-0000-000000000001", table: "5",
    splits: [{ amount: r2(far / 2), method: "Cash" }, { amount: r2(far / 2), method: "Cash" }],
  });
  if (r.ok) return { err: "the stand-in settle was ACCEPTED — the sentinel matched a real due" };
  const m = /bill due is ₹(-?[\d.]+)/.exec(r.message);
  return m ? { due: Number(m[1]) } : { err: r.message.slice(0, 140) };
}
let seed = 20260918;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (n) => Math.round(n * 100) / 100;
const PROFILES = [
  ["a flat 5% restaurant", { tax_rate: 0.05 }],
  ["an 18% banquet rate", { tax_rate: 0.18 }],
  ["CGST 2.5 + SGST 2.5 as named parts", { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] }],
  ["a composition-scheme restaurant", { price_tax_mode: "composition", tax_rate: 0.18 }],
  ["a restaurant that has configured nothing", {}],
];
function randomBill() {
  const n = 1 + Math.floor(rnd() * 4);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const base = r2(rnd() * 3000);
    const ntx = rnd() < 0.3 ? r2(rnd() * 400) : 0;
    const mrp = ntx > 0 && rnd() < 0.6 ? r2(Math.min(ntx, rnd() * 400)) : 0;
    rows.push({
      id: `o${i}`, session_id: "s1", status: "served", payment_status: "pending",
      subtotal: r2(base + ntx), taxable_base: base, nontax_amount: ntx, mrp_amount: mrp,
      discount: rnd() < 0.4 ? r2(rnd() * 900) : 0,
      tax_rate: pick([null, null, 0.05, 0.18, 0]),
    });
  }
  return rows;
}
const SPLIT_IDS = ["P104943", "P104944", "P104945", "P104946", "P104947"];
PROFILES.forEach(([pname, raw], i) => {
  N(SPLIT_IDS[i], `${pname}: the due Pay-in-parts demands is exactly the total the printed bill shows`,
    "600 random bills through the REAL settleBillInParts (stand-in client, no row written) vs BILLDOC.billMoney",
    async () => {
      seed = 20260918;
      for (let k = 0; k < 600; k++) {
        const rows = randomBill();
        const paper = BILLDOC.billMoney(rows, raw).total;
        const got = await dueOf(rows, raw, paper);
        if (got.err) return { ok: false, note: `bill ${k}: ${got.err}` };
        if (Math.abs(got.due - paper) > 0.005) return { ok: false, note: `bill ${k}: split wants ₹${got.due}, paper says ₹${paper} · ${JSON.stringify(rows).slice(0, 220)}` };
      }
      return { ok: true, note: "600 bills, every due equal to the paper to the paisa" };
    });
});

// ── lib/clash.ts — the ground the existing rows read but never drove (3) ──────────────────────
N("P104948", "every table the gate may compare is either scoped by restaurant or IS the restaurant",
  "read COMPARABLE_TABLES against TENANT_ROW_TABLES in lib/clash.ts", () => {
    const tables = [...srcClash.matchAll(/^\s{2}([a-z_]+):\s*"(id|restaurant_id)",/gm)].map((m) => m[1]);
    const tenant = (srcClash.match(/TENANT_ROW_TABLES = new Set\(\[([^\]]+)\]/) || [])[1] || "";
    const tenantSet = new Set([...tenant.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    // Every table on the list is handled by exactly one of the two branches, and the tenant ones
    // are refused outright for an id that is not the caller's own restaurant.
    return tables.length >= 12 && [...tenantSet].every((t) => tables.includes(t))
        && /if \(TENANT_ROW_TABLES\.has\(table\) && id !== rid\) return null;/.test(srcClash)
        && /if \(!TENANT_ROW_TABLES\.has\(table\)\) q = q\.eq\("restaurant_id", rid\);/.test(srcClash);
  });
N("P104949", "every plain-words name the refusal can print matches a column something really sends",
  "cross-check readable()'s map against the expectations live call sites send", () => {
    const named = [...srcClash.matchAll(/^\s{4}([a-z_]+):\s*"/gm)].map((m) => m[1]);
    // lib/clash.ts is EXCLUDED from the haystack on purpose: the file's own comments name columns
    // that were removed for matching nothing (`reorder_level`), so searching it would let a
    // re-added orphan find itself and this row would pass with the fault present (measured
    // 2026-09-18 by adding reorder_level back).
    const everywhere = tsFiles.filter((f) => f !== "lib/clash.ts").map(read).join("\n")
      + appJs + read("public/panels/tablet/app.js") + read("public/panels/billdoc.js");
    const orphans = named.filter((c) => !new RegExp(`\\b${c}\\b`).test(everywhere));
    return orphans.length === 0 ? { ok: true, note: `${named.length} plain-words names, every one matches a real column` }
                                : { ok: false, note: `names matching no column anywhere: ${orphans.join(", ")}` };
  });
N("P104950", "a switch is described to an admin as on/off and a blob is never quoted as [object Object]",
  "the describe() branches, through a real expectation refusal path", () => {
    // describe() is private, so read it through the sentences the file can build.
    return /return v \? "on" : "off";/.test(srcClash)
        && /isPlainObject\(v\)\) return "something different now"/.test(srcClash)
        && /s === "pin"\) return "on, but asking for a manager PIN"/.test(srcClash)
        && /QUIET_COLUMNS\.has\(c\) \|\| isPlainObject\(current\)/.test(srcClash);
  });

// ══════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const seen = new Set();
  for (const d of defs) { if (seen.has(d.id)) throw new Error(`duplicate id ${d.id}`); seen.add(d.id); }
  const rows = [];
  for (const d of defs) {
    if (ONLY && d.id !== ONLY) continue;
    let res, note = "";
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 160); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    rows.push({ ...d, mark, note });
  }
  if (ARGV.includes("--ledger")) {
    console.log("| id | what it checks | how it is re-run | result | note |");
    console.log("|---|---|---|---|---|");
    const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
    for (const r of rows) if (/^P1049|^P10500/.test(r.id)) console.log(`| ${r.id} | ${esc(r.what)} | ${esc(r.how)} | ${r.mark} | ${esc(r.note)} |`);
    process.exit(0);
  }
  const bad = rows.filter((r) => r.mark === "❌");
  for (const r of rows) {
    if (QUIET && r.mark === "✅") continue;
    console.log(`${r.mark} ${r.id}  ${r.what}${r.note ? `  → ${r.note}` : ""}`);
  }
  console.log(`\n${bad.length ? "✗ FAIL" : "✓ PASS"} — ${rows.length} checks · ${rows.filter((r) => r.mark === "✅").length} ✅ · ${bad.length} ❌ · ${rows.filter((r) => r.mark === "⏭").length} ⏭`);
  process.exit(bad.length ? 1 : 0);
}
await main();
