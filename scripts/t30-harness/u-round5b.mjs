// Round 5, second half — every PUBLIC function of the 14 money files under hostile input, every hot one
// against its own growth curve, the printed bill for every tax set-up, and every pointer in the four docs.
// One row per function / set-up / doc, so a failure names its subject. APPEND ONLY; ids are permanent.
import { suite } from "./lib.mjs";
import { world } from "./sb.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
import { req } from "./lib.mjs";
const t = suite("round 5 (every function, every set-up, every doc)", 210301, 400);
const src = (p) => readFileSync(join(root, p), "utf8");
const sb = (await import("./sb.mjs")).supabaseAdmin;
const M = {
  tax: await import("@/lib/tax.ts"), tf: await import("@/lib/taxFiling.ts"), ps: await import("@/lib/paySplit.ts"), pm: await import("@/lib/payments.ts"),
  dc: await import("@/lib/discountCap.ts"), cl: await import("@/lib/clash.ts"), cc: await import("@/lib/clashCompare.ts"), id: await import("@/lib/idempotency.ts"),
  ir: await import("@/lib/idempotencyRule.ts"), db: await import("@/lib/dbRefusal.ts"), rg: await import("@/lib/readGuard.ts"), mo: await import("@/lib/money.ts"),
  mj: await import("@/lib/money.mjs"), oa: await import("@/lib/orderAllergies.ts"),
};
const BILLDOC = (await import("@/public/panels/billdoc.js")).default;
const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1)); const pick = (R, xs) => xs[Math.floor(R() * xs.length)];

// ── A · every public function, hostile input ──────────────────────────────────────────────────────
// A parameter is fed junk OF ITS KIND: "any" gets anything, "arr" a list of anything, "num" anything
// number-ish, "fn" a function that returns anything. (A list parameter handed a number is a caller bug the
// type system already refuses; what matters is that real-shaped garbage — nulls, NaN, junk strings, holes —
// can never throw out of a money function and take a screen down.)
const JUNK = [undefined, null, NaN, Infinity, -Infinity, 0, -1, 1e308, "", "abc", "12.5", "₹1,250", {}, [], [null], { a: 1 }, true, false, -0.005, 0.005];
// "obj" is an object the CODE builds (never null, fields junk); "int" a number a programmer passes (a
// fallback status, a tick count) — those are contracts the types enforce, not data that can arrive broken.
const junkOf = (R, kind) => kind === "obj" ? Object.fromEntries(["code", "plain", "todo", "retryable", "id", "added_allergens", "removed_flag", "a"].filter(() => R() < 0.6).map((k) => [k, pick(R, JUNK)]))
  : kind === "int" ? int(R, 1, 12)
  : kind === "arr" ? Array.from({ length: int(R, 0, 6) }, () => pick(R, JUNK))
  : kind === "num" ? pick(R, [undefined, null, NaN, 0, -1, 1e9, -1e9, 0.005, "12.5", "", "x"])
  : kind === "fn" ? () => pick(R, JUNK) : pick(R, JUNK);
const PURE = [
  ["lib/tax.ts", "taxComponents", M.tax.taxComponents, ["any"], "object"], ["lib/tax.ts", "effectiveTaxRate", M.tax.effectiveTaxRate, ["any"], "number"],
  ["lib/tax.ts", "effectiveTaxPct", M.tax.effectiveTaxPct, ["any"], "number"], ["lib/tax.ts", "priceTaxMode", M.tax.priceTaxMode, ["any"], "string"],
  ["lib/tax.ts", "itemTaxModesAllowed", M.tax.itemTaxModesAllowed, ["any"], "boolean"], ["lib/tax.ts", "resolveTaxMode", M.tax.resolveTaxMode, ["any", "any"], "string"],
  ["lib/tax.ts", "isMrpDish", M.tax.isMrpDish, ["any", "any"], "boolean"], ["lib/tax.ts", "splitBill", M.tax.splitBill, ["arr", "any", "any"], "object"],
  ["lib/tax.ts", "roundPaise", M.tax.roundPaise, ["num"], "number"],
  ["lib/taxFiling.ts", "splitTax", M.tf.splitTax, ["arr", "num"], "object"], ["lib/taxFiling.ts", "allocateWhole", M.tf.allocateWhole, ["num", "arr"], "object"],
  ["lib/taxFiling.ts", "taxableValue", M.tf.taxableValue, ["any", "num"], "number"], ["lib/taxFiling.ts", "netSalesOf", M.tf.netSalesOf, ["any"], "number"],
  ["lib/taxFiling.ts", "exemptTolerance", M.tf.exemptTolerance, ["num"], "number"], ["lib/taxFiling.ts", "exemptIsMaterial", M.tf.exemptIsMaterial, ["any", "num"], "boolean"],
  ["lib/taxFiling.ts", "taxableFor", M.tf.taxableFor, ["any", "num", "any"], "number"], ["lib/taxFiling.ts", "buildFiling", M.tf.buildFiling, ["arr", "arr", "fn"], "object"],
  ["lib/paySplit.ts", "badSplitShape", M.ps.badSplitShape, ["any"], "string|object"],
  ["lib/discountCap.ts", "discountRole", M.dc.discountRole, ["any"], "string|object"], ["lib/discountCap.ts", "overDiscountCap", M.dc.overDiscountCap, ["num", "num", "num"], "boolean"],
  ["lib/clash.ts", "clashJson", M.cl.clashJson, ["obj"], "object"],
  ["lib/clashCompare.ts", "stableJson", M.cc.stableJson, ["any"], "string"], ["lib/clashCompare.ts", "isPlainObject", M.cc.isPlainObject, ["any"], "boolean"],
  ["lib/clashCompare.ts", "sameValue", M.cc.sameValue, ["any", "any"], "boolean"],
  ["lib/idempotency.ts", "withIdempotency", M.id.withIdempotency, ["fn", "any"], "function"],
  ["lib/idempotencyRule.ts", "didSomething", M.ir.didSomething, ["num", "any"], "boolean"], ["lib/idempotencyRule.ts", "storedIsRefusal", M.ir.storedIsRefusal, ["any"], "boolean"],
  ["lib/idempotencyRule.ts", "withoutSecrets", M.ir.withoutSecrets, ["any"], "any"], ["lib/idempotencyRule.ts", "keptReply", M.ir.keptReply, ["any", "any"], "object"],
  ["lib/idempotencyRule.ts", "replyFor", M.ir.replyFor, ["any", "any"], "object"],
  ["lib/dbRefusal.ts", "ownRefusalCode", M.db.ownRefusalCode, ["any"], "string|object"], ["lib/dbRefusal.ts", "isMissingRow", M.db.isMissingRow, ["any"], "boolean"],
  ["lib/dbRefusal.ts", "pgError", M.db.pgError, ["any"], "object"], ["lib/dbRefusal.ts", "isDataRefusal", M.db.isDataRefusal, ["any"], "boolean"],
  ["lib/dbRefusal.ts", "isDbUnreachable", M.db.isDbUnreachable, ["any"], "boolean"], ["lib/dbRefusal.ts", "worthLogging", M.db.worthLogging, ["any"], "boolean"],
  ["lib/dbRefusal.ts", "refusalStatus", M.db.refusalStatus, ["any", "int"], "number"], ["lib/dbRefusal.ts", "refusalMessage", M.db.refusalMessage, ["any"], "string"],
  ["lib/readGuard.ts", "named", M.rg.named, ["any", "any"], "object"],
  ["lib/money.ts", "compactINR", M.mo.compactINR, ["num"], "string"], ["lib/money.ts", "roundTicks", M.mo.roundTicks, ["num", "num", "int"], "object"],
  ["lib/money.mjs", "niceUsd", M.mj.niceUsd, ["num"], "number"], ["lib/money.mjs", "snapToStep", M.mj.snapToStep, ["num", "num"], "number"],
  ["lib/money.mjs", "displayAmount", M.mj.displayAmount, ["num", "num", "num"], "number"], ["lib/money.mjs", "minorRound", M.mj.minorRound, ["num", "num"], "number"],
  ["lib/orderAllergies.ts", "spreadOne", M.oa.spreadOne, ["obj", "arr", "arr"], "object"], ["lib/orderAllergies.ts", "groupSpread", M.oa.groupSpread, ["arr", "arr", "arr"], "object"],
];
let seedA = 5100;
for (const [file, name, fn, kinds, want] of PURE) {
  const R = gen(seedA++); let bad = null;
  for (let i = 0; i < 3000 && !bad; i++) {
    const args = kinds.map((k) => junkOf(R, k));
    try { const out = fn(...args); const k = out === null ? "object" : typeof out; if (want !== "any" && !want.split("|").includes(k)) bad = `returned ${k} for ${JSON.stringify(args).slice(0, 60)}`; }
    catch (e) { bad = `threw ${e && e.message} for ${JSON.stringify(args, (_, v) => (typeof v === "function" ? "fn" : v)).slice(0, 80)}`; }
  }
  t(`${file} ${name}(): 3,000 calls with hostile input of the right kind — it never throws and always answers a ${want}`, !bad, bad || "");
}
// the public functions that talk to the database, with junk options against the in-memory database
{ const quiet = async (f) => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };
  const R = gen(5900); const A = [];
  for (let i = 0; i < 300; i++) A.push({ rid: pick(R, JUNK), table: pick(R, JUNK), splits: junkOf(R, "arr"), sessionId: pick(R, JUNK), since: pick(R, JUNK), orderId: pick(R, JUNK) });
  for (const [file, name, call] of [
    ["lib/paySplit.ts", "settleBillInParts", (a) => M.ps.settleBillInParts(sb, { rid: a.rid, table: a.table, splits: a.splits })],
    ["lib/paySplit.ts", "reverseSplitLegs", (a) => M.ps.reverseSplitLegs(sb, { rid: a.rid, sessionId: a.sessionId, since: a.since })],
    ["lib/discountCap.ts", "discountCapPct", (a) => M.dc.discountCapPct(a.rid, pick(R, ["manager", "waiter", null]))],
    ["lib/orderAllergies.ts", "spreadOrderAllergies", (a) => M.oa.spreadOrderAllergies(sb, a.rid, a.orderId, junkOf(R, "arr"), junkOf(R, "arr"))],
    ["lib/clash.ts", "expectClash", (a) => M.cl.expectClash(req({ "x-lfh-expect": pick(R, ["", "{", encodeURIComponent(JSON.stringify({ table: "orders", id: a.orderId, fields: a.splits })), JSON.stringify({ table: "orders", id: String(a.orderId).replace(/[^\x20-\x7e]/g, ""), fields: { status: 1 } }), "null"]) }), a.rid)],
    ["lib/clash.ts", "replayClash", (a) => M.cl.replayClash(req({ "x-lfh-replay": "1", "x-lfh-queued-at": new Date(Date.now() - 60000).toISOString() }), a.rid, pick(R, ["tables", "sessions", "orders", "x"]), a.table, pick(R, ["pay", "shift", "merge", ""]), a.splits)],
    ["lib/readGuard.ts", "rd", (a) => M.rg.rd(String(a.rid), async () => pick(R, [{ data: a.splits, error: null }, { data: null, error: { message: "x" } }, {}]))],
  ]) {
    let bad = null;
    for (const a of A) { world({ sessions: [], orders: [], settings: [], session_payments: [], khata_customers: [], restaurants: [], order_items: [], action_idempotency: [] });
      try { await quiet(() => call(a)); } catch (e) { if (!(name === "reverseSplitLegs" && /couldn't/.test(e.message))) { bad = `threw ${e && e.message}`; break; } } }
    t(`${file} ${name}(): 300 calls with junk options against an empty database — it answers (a refusal, a null or a number) and never throws`, !bad, bad || "");
  } }

// ── B · speed: each hot function against its own growth curve ────────────────────────────────────
// Timed at size n and 8n (best of five, so a garbage-collection pause cannot fake a result). Linear work
// grows ~8×; a function that grew ~64× would be quadratic — the "unoptimized" this hunt is about. The
// bar is 24× (generous for noise), and the big size must also finish inside its budget.
const best = (f) => { let b = Infinity; for (let k = 0; k < 5; k++) { const s = performance.now(); f(); b = Math.min(b, performance.now() - s); } return Math.max(b, 0.01); };
const R0 = gen(6100);
const lines = (n) => Array.from({ length: n }, () => ({ price: (int(R0, 100, 300000) / 100).toFixed(2), qty: int(R0, 1, 5), tax_mode: pick(R0, ["excl", "incl", "exempt"]), is_mrp: R0() < 0.1 }));
const deep = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { v: i, list: [i, "x", { y: i }] }]));
for (const [what, small, mk, run, budget] of [
  ["lib/tax.ts splitBill — a cart of n dishes", 2000, lines, (x) => M.tax.splitBill(x, { tax_rate: 0.05 }, 10), 100],
  ["lib/taxFiling.ts allocateWhole — n rows", 5000, (n) => Array.from({ length: n }, () => R0() * 100), (w) => M.tf.allocateWhole(123456, w), 150],
  ["lib/taxFiling.ts buildFiling — n period rows", 2000, (n) => Array.from({ length: n }, () => ({ t: R0() * 1000 })), (rows) => M.tf.buildFiling(rows, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], (r) => r.t), 150],
  ["lib/taxFiling.ts splitTax — n tax lines", 2000, (n) => Array.from({ length: n }, () => int(R0, 1, 9)), (r) => M.tf.splitTax(r, 123456.78), 100],
  ["lib/clashCompare.ts stableJson — an object of n keys", 2000, deep, (o) => M.cc.stableJson(o), 150],
  ["lib/clashCompare.ts sameValue — two lists of n items", 2000, (n) => Array.from({ length: n }, (_, i) => `a${i % 97}`), (xs) => M.cc.sameValue(xs, [...xs].reverse()), 150],
  ["lib/idempotencyRule.ts withoutSecrets — a reply of n keys", 2000, (n) => ({ ...deep(n), password: "x", token: "y" }), (o) => M.ir.withoutSecrets(o), 150],
  ["lib/orderAllergies.ts groupSpread — an order of n dishes", 2000, (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, added_allergens: i % 3 ? ["egg"] : [] })), (d) => M.oa.groupSpread(d, ["nuts"], ["egg"]), 150],
  ["lib/orderAllergies.ts spreadOne — a dish with n marks", 2000, (n) => ({ id: "x", added_allergens: Array.from({ length: n }, (_, i) => `a${i}`) }), (d) => M.oa.spreadOne(d, ["nuts"], ["a1"]), 100],
  ["lib/tax.ts effectiveTaxRate — n tax components", 2000, (n) => ({ tax_components: Array.from({ length: n }, (_, i) => ({ label: `C${i}`, rate: 0.1 })) }), (s) => M.tax.effectiveTaxRate(s), 100],
  ["lib/paySplit.ts badSplitShape — n parts (it refuses past 12 before looking at any)", 2000, (n) => Array.from({ length: n }, () => ({ amount: 1, method: "Cash" })), (sp) => M.ps.badSplitShape(sp), 50],
  ["lib/dbRefusal.ts refusalMessage — a database message n characters long", 20000, (n) => ({ code: "23514", message: "x".repeat(n) + ' violates check constraint "settings_tax_rate_is_a_rate"' }), (e) => M.db.refusalMessage(e), 50],
  ["lib/money.ts roundTicks — a range n times wider (it must stay a handful of ticks)", 1000, (n) => n * 1000, (span) => M.mo.roundTicks(0, span, 6), 20],
  ["public/panels/billdoc.js billMoney — a bill of n orders (it runs on every printed bill)", 500, (n) => Array.from({ length: n }, () => ({ status: "served", subtotal: 500, taxable_base: 500, nontax_amount: 0, discount: 0, tax_rate: 0.05, items: lines(3) })), (o) => BILLDOC.billMoney(o, { tax_rate: 0.05 }), 200],
]) {
  const a = mk(small), b = mk(small * 8); const ta = best(() => run(a)), tb = best(() => run(b)); const ratio = tb / ta;
  t(`speed · ${what}: 8× the input costs ${ratio < 24 ? "about linear" : "FAR more than linear"} (${ratio.toFixed(1)}×), and the big one runs in ${tb.toFixed(1)} ms (budget ${budget} ms)`, ratio < 24 && tb < budget, `${ta.toFixed(2)} ms → ${tb.toFixed(2)} ms`);
}

// ── C · the printed bill for every one of the 72 tax set-ups ──────────────────────────────────────
{ const COMPS = { "CGST 2.5 + SGST 2.5": [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], "CGST 9 + SGST 9": [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }], "IGST 28": [{ label: "IGST", rate: 28 }], "VAT 12.5": [{ label: "VAT", rate: 12.5 }] };
  const RATES = [...Object.entries(COMPS).map(([k, c]) => [k, { tax_components: c }]), ["a typed 12%", { tax_rate: 0.12, tax_components: [] }], ["nothing set (5%)", { tax_rate: null, tax_components: [] }]];
  for (const pm of ["excl", "incl", "composition"]) for (const allowed of [false, true]) for (const mt of ["inclusive", "none"]) for (const [rl, rs] of RATES) {
    const s = { ...rs, price_tax_mode: pm, item_tax_modes_allowed: allowed, mrp_tax_treatment: mt }; const R = gen(7000 + pm.length * 31 + (allowed ? 5 : 0) + mt.length * 7 + rl.length * 3);
    let rows = null, lines2 = null;
    for (let i = 0; i < 200 && !(rows && lines2); i++) {
      const orders = Array.from({ length: int(R, 1, 3) }, () => { const ls = Array.from({ length: int(R, 1, 5) }, () => ({ title: "Dish " + int(R, 1, 40), price: (int(R, 100, 200000) / 100).toFixed(2), qty: int(R, 1, 3), tax_mode: M.tax.resolveTaxMode(pick(R, ["default", "excl", "incl", "mrp", "none"]), s) }));
        const b = M.tax.splitBill(ls, s, 0); const d = R() < 0.4 ? Math.min(b.discountBase, int(R, 0, 30000) / 100) : 0;
        return { status: "served", subtotal: b.subtotal, taxable_base: b.taxableBase, nontax_amount: b.nontaxAmount, mrp_amount: b.mrpAmount, discount: d, tax_rate: b.rate, items: ls }; });
      const d = BILLDOC.billData({ settings: s, orders, restaurant: {} }); const r = BILLDOC.billRows(d);
      if (!rows && Math.round((r.subtotal - r.discount + r.tax + r.nontax + r.roundOff) * 100) !== Math.round(r.total * 100)) rows = JSON.stringify(r).slice(0, 120);
      const sum = (d.taxRows || []).reduce((a, x) => a + Number(x.amt || 0), 0);
      if (!lines2 && (d.taxRows || []).length && (Math.round(sum * 100) !== Math.round(r.tax * 100) || (d.taxRows || []).some((x) => Number(x.amt) < 0))) lines2 = `${sum} vs ${r.tax}`;
      if (!lines2 && pm === "composition" && (d.taxRows || []).length) lines2 = "a composition bill printed a tax line";
    }
    const label = `${pm}, per-dish modes ${allowed ? "on" : "off"}, MRP ${mt}, ${rl}`;
    t(`printed bill · "${label}": on 200 random bills the rows add up — subtotal − discount + tax + untaxed + round-off = the total printed`, !rows, rows || "");
    t(`printed bill · "${label}": …and its tax lines add up to the tax it prints, none negative${pm === "composition" ? ", and a composition bill prints none at all" : ""}`, !lines2, lines2 || "");
  } }

// ── D · every pointer in the four territory docs leads somewhere real ────────────────────────────────
{ const migs = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")); const all = migs.map((f) => src(`supabase/migrations/${f}`)).join("\n");
  const scripts = JSON.parse(src("package.json")).scripts;
  for (const d of ["docs/BUSINESS-LOGIC-AUDIT.md", "docs/CANCEL-AND-LOSS-SPEC.md", "docs/COMPLIANCE-GUARDRAILS.md", "docs/SAAS-EFFICIENCY-PLAYBOOK.md"]) {
    const s = src(d);
    const paths = [...new Set([...s.matchAll(/\b((?:lib|app|scripts|public|components|tests|supabase\/migrations|docs)\/[A-Za-z0-9_.\/\[\]-]+\.(?:ts|tsx|mjs|js|md|sql|json))\b/g)].map((m) => m[1]))];
    const missing = paths.filter((p) => !existsSync(join(root, p)));
    t(`${d}: every one of the ${paths.length} files it names exists`, !missing.length, missing.join(", "));
    const npm = [...new Set([...s.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]))]; const gone = npm.filter((k) => !scripts[k]);
    t(`${d}: every one of the ${npm.length} npm commands it names is a real script`, !gone.length, gone.join(", "));
    const nums = [...new Set([...s.matchAll(/\b[Mm]ig(?:ration)?s?\.?\s+(\d{3})\b/g)].map((m) => m[1]))]; const noMig = nums.filter((n) => !migs.some((f) => f.startsWith(n + "_")));
    t(`${d}: every one of the ${nums.length} migration numbers it names is a real migration file`, !noMig.length, noMig.join(", "));
    const fns = [...new Set([...s.matchAll(/`((?:lfh|admin)_[a-z0-9_]+)(?:\(|`)/g)].map((m) => m[1]))]; const noFn = fns.filter((f) => !new RegExp(`\\b${f}\\b`).test(all));
    t(`${d}: every one of the ${fns.length} database functions it names is defined by a migration`, !noFn.length, noFn.join(", "));
  } }
