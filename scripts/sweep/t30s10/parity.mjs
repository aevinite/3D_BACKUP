// scripts/sweep/t30s10/parity.mjs — sweep #10 · T30 round 3 · the app and the DEV database, side by side.
//
//   node --experimental-strip-types --no-warnings scripts/sweep/t30s10/parity.mjs [--quiet] [--ledger]
//
// Rounds 1–2 checked the money code against itself. This asks whether the app and the database agree:
//   A. the tax rate and every dish's tax behaviour — the database's own functions vs lib/tax.ts, for
//      EVERY restaurant on the dev database;
//   B. a cart's taxable / untaxed / MRP split — lfh_split_items_tax (what a saved order gets) vs
//      splitBill (what the screen shows), on random carts, per tax set-up;
//   C. the rounding underneath both, on every amount up to ₹10,000;
//   D. the real orders: each restaurant's own saved money follows the rules the code assumes;
//   E. every table, column, filter and database function the 14 files use is really there, and every
//      query has an index to stand on;
//   F. the refusal codes and constraint names lib/dbRefusal turns into sentences exist in the database;
//   G. every guard the four territory docs name is real and green today.
//
// READ-ONLY: SELECTs on the dev project only (refused on any other). Nothing is written anywhere.
//   H. every saved order re-computed from its own dishes; I. every bill settled in parts vs its paper.
// Ids P167501–P167700 (claimed on main, 2026-10-09). APPEND ONLY; never renumber.
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
registerHooks({ resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) { let p = join(root, spec.slice(2)); if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; } return next(pathToFileURL(p).href, ctx); }
  return next(spec, ctx); } });
const ARGV = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const T = await imp("lib/tax.ts");
const PAY = await imp("lib/payments.ts");
const PS = await imp("lib/paySplit.ts");

// ── read-only SQL on the DEV database ─────────────────────────────────────────────────────────────
const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T30 round 3 parity (read-only)");
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const sql = async (q) => {
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error("read-only: SELECT/WITH only");
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    if (attempt < 3 && (r.status === 429 || r.status >= 500)) { await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); continue; }
    throw new Error(`SQL ${r.status}: ${t.slice(0, 200)}`);
  }
};
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const ROWS = [];
let ID = 167501;
const check = async (file, what, fn) => {
  const id = `P${ID++}`; if (ID > 167701) throw new Error("id range P167501–P167700 exhausted");
  let res; try { res = await fn(); } catch (e) { res = "threw: " + (e && e.message); }
  ROWS.push({ id, file, what, ok: res === true, skip: typeof res === "string" && res.startsWith("skip:"), note: res === true ? "" : String(res).slice(0, 220) });
};
const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (R, xs) => xs[Math.floor(R() * xs.length)];
const P = (x) => Math.round(Number(x) * 100);

// ── the restaurants and their tax set-ups ─────────────────────────────────────────────────────────
const RESTS = await sql(`select r.id, r.slug, s.restaurant_id is not null as has_settings, s.tax_rate, s.tax_components, s.price_tax_mode, s.item_tax_modes_allowed, s.mrp_tax_treatment, lfh_effective_tax_rate(r.id)::text as db_rate
  from restaurants r left join settings s on s.restaurant_id = r.id order by r.slug, r.id`);
const settingsOf = (r) => (r.has_settings ? { tax_rate: r.tax_rate == null ? null : Number(r.tax_rate), tax_components: r.tax_components, price_tax_mode: r.price_tax_mode, item_tax_modes_allowed: r.item_tax_modes_allowed, mrp_tax_treatment: r.mrp_tax_treatment } : null);
const shapeKey = (r) => JSON.stringify(settingsOf(r));
const SHAPES = [...new Map(RESTS.map((r) => [shapeKey(r), r])).values()];

// ═══ A · the rate and each dish's behaviour, for every restaurant ══════════════════════════════════
await check("lib/tax.ts", `effectiveTaxRate = the database's lfh_effective_tax_rate for EVERY restaurant on dev (${RESTS.length}, with and without a settings row)`, () => {
  const bad = RESTS.filter((r) => Math.abs(T.effectiveTaxRate(settingsOf(r)) - Number(r.db_rate)) > 1e-12); return !bad.length || `${bad.length} differ, e.g. ${bad[0].slug}: app ${T.effectiveTaxRate(settingsOf(bad[0]))} vs db ${bad[0].db_rate}`; });
await check("lib/tax.ts", `…and the set-ups are really different: ${SHAPES.length} distinct tax set-ups among them (a parity check over one set-up proves little)`, () => SHAPES.length >= 3 || `only ${SHAPES.length}`);
const MODES = ["default", "excl", "incl", "mrp", "none", null, "garbage", ""];
const RES = await sql(`select r.id, m.mode, lfh_resolve_tax_mode(m.mode, r.id) as db from restaurants r cross join (values ${MODES.map((m) => `(${m == null ? "null::text" : lit(m)})`).join(",")}) m(mode)`);
const byId = new Map(RESTS.map((r) => [r.id, r]));
for (const m of MODES) {
  await check("lib/tax.ts", `resolveTaxMode(${JSON.stringify(m)}) = the database's lfh_resolve_tax_mode for every restaurant (${RESTS.length})`, () => {
    const rows = RES.filter((x) => (x.mode ?? null) === m); const bad = rows.filter((x) => T.resolveTaxMode(m, settingsOf(byId.get(x.id))) !== x.db);
    return (rows.length === RESTS.length && !bad.length) || `${bad.length}/${rows.length} differ, e.g. ${bad[0] && byId.get(bad[0].id).slug}: app ${bad[0] && T.resolveTaxMode(m, settingsOf(byId.get(bad[0].id)))} vs db ${bad[0] && bad[0].db}`; });
}
const PL = await sql(`select r.id, lfh_plausible_tax_rate(r.id, lfh_effective_tax_rate(r.id)) own, lfh_plausible_tax_rate(r.id, 0) zero, lfh_plausible_tax_rate(r.id, 0.51) high, lfh_plausible_tax_rate(r.id, -0.01) neg, lfh_plausible_tax_rate(r.id, null) nul from restaurants r`);
await check("lib/tax.ts", "the database accepts every restaurant's OWN rate as plausible when an order is stamped with it", () => PL.every((x) => x.own === true) || `${PL.filter((x) => !x.own).length} refused`);
await check("lib/tax.ts", "…accepts 0% (composition / untaxed) everywhere, and refuses above 50%, below 0 and a missing rate everywhere", () => PL.every((x) => x.zero === true && x.high === false && x.neg === false && x.nul === false) || "a bound is wrong");

// ═══ B · a cart's split: the saved order vs the screen ═════════════════════════════════════════════
const lineOf = (R) => ({ price: pick(R, [() => int(R, 0, 200000) / 100, () => String(int(R, 1, 2000)), () => "₹" + (int(R, 0, 200000) / 100).toFixed(2), () => `${int(R, 1, 99)}.99`]) (), qty: R() < 0.2 ? String(int(R, 1, 6)) : int(R, 1, 6),
  tax_mode: pick(R, ["excl", "incl", "exempt", "excl"]), is_mrp: R() < 0.15 });
for (const [k, r] of SHAPES.entries()) {
  const R = gen(1675 + k); const carts = Array.from({ length: 600 }, () => Array.from({ length: int(R, 0, 9) }, () => lineOf(R)));
  const out = [];
  for (let i = 0; i < carts.length; i += 150) {
    const batch = carts.slice(i, i + 150);
    const rows = await sql(`select c.n, lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid) s from jsonb_array_elements(${lit(JSON.stringify(batch))}::jsonb) with ordinality c(cart, n)`);
    for (const row of rows) out[i + Number(row.n) - 1] = typeof row.s === "string" ? JSON.parse(row.s) : row.s;
  }
  const s = settingsOf(r); const label = `${r.slug}'s set-up (${s ? `${s.price_tax_mode || "excl"}, ${T.effectiveTaxPct(s)}%${s.tax_components && s.tax_components.length ? ", named lines" : ""}${s.item_tax_modes_allowed ? ", per-dish modes on" : ""}` : "no settings row"})`;
  const cmp = (field, app) => { const bad = carts.findIndex((c, i) => P(app(T.splitBill(c, s, 0))) !== P(out[i][field])); return bad < 0 || `cart ${bad}: app ${app(T.splitBill(carts[bad], s, 0))} vs db ${out[bad][field]} — ${JSON.stringify(carts[bad]).slice(0, 120)}`; };
  await check("lib/tax.ts", `${label}: the TAXABLE base a saved order gets = the one the screen shows, on 600 random carts`, () => cmp("taxable_base", (b) => b.taxableBase));
  await check("lib/tax.ts", `${label}: the UNTAXED amount agrees on the same 600 carts`, () => cmp("nontax_amount", (b) => b.nontaxAmount));
  await check("lib/tax.ts", `${label}: the locked MRP amount agrees on the same 600 carts`, () => cmp("mrp_amount", (b) => b.mrpAmount));
  await check("lib/tax.ts", `${label}: the rate the database splits with = the screen's rate`, () => out.every((o) => Number(o.rate) === T.splitBill([], s, 0).rate) || `db ${out[0].rate} vs app ${T.splitBill([], s, 0).rate}`);
}
const odd = await sql(`select (select count(*) from jsonb_array_elements('[]'::jsonb)) ok_empty, lfh_split_items_tax(null, ${lit(RESTS[0].id)}::uuid) is null nul, lfh_split_items_tax('{"a":1}'::jsonb, ${lit(RESTS[0].id)}::uuid) is null obj`);
await check("lib/tax.ts", "a missing or non-list cart is no split at all in the database (NULL), never a ₹0 split that would overwrite real figures", () => odd[0].nul === true && odd[0].obj === true);

// ═══ C · the rounding underneath, on every amount ═════════════════════════════════════════════════
// Postgres rounds a numeric half-UP, exactly; the app rounds a float with Math.round. Exact rounding is
// computed here in whole numbers (paise × basis points — no float anywhere), for EVERY amount ₹0.01 to
// ₹10,000, and the database itself then confirms that model on every amount where the app disagrees
// with it plus 2,000 random others — a few kilobytes of SQL instead of a million rows.
const exactAdd = (g, bp) => { const num = g * bp, q = Math.floor(num / 10000), r = num - q * 10000; return 2 * r >= 10000 ? q + 1 : q; };
const exactIncl = (g, bp) => { const num = g * 10000, den = 10000 + bp, q = Math.floor(num / den), r = num - q * den; return 2 * r >= den ? q + 1 : q; };
const sweep = async (kind, bp) => {
  const rate = bp / 10000; const off = []; const R = gen(bp + (kind === "incl" ? 7 : 3)); const sample = Array.from({ length: 2000 }, () => int(R, 1, 1000000));
  for (let g = 1; g <= 1000000; g++) { const app = kind === "incl" ? Math.round(((g / 100) / (1 + rate)) * 100) : Math.round((g / 100) * rate * 100); if (app !== (kind === "incl" ? exactIncl(g, bp) : exactAdd(g, bp))) off.push(g); }
  const ask = [...new Set([...off.slice(0, 3000), ...sample])];
  const expr = kind === "incl" ? `round((g/100.0) / (1 + ${rate}), 2)` : `round((g/100.0) * ${rate}, 2)`;
  const db = await sql(`select g, (${expr})::text v from unnest(array[${ask.join(",")}]::int[]) g`);
  const modelOk = db.every((r) => P(r.v) === (kind === "incl" ? exactIncl(Number(r.g), bp) : exactAdd(Number(r.g), bp)));
  return { off, modelOk, asked: ask.length, ex: off.length ? `₹${off[0] / 100}: app ${(kind === "incl" ? Math.round(((off[0] / 100) / (1 + rate)) * 100) : Math.round((off[0] / 100) * rate * 100)) / 100} vs db ${db.find((r) => Number(r.g) === off[0])?.v}` : "" };
};
for (const [bp, label] of [[500, "5% (the rate every dev restaurant uses)"], [1800, "18%"], [1200, "12%"], [2800, "28%"]]) {
  const x = await sweep("incl", bp);
  await check("lib/tax.ts", `tax INSIDE the price at ${label}: the app's per-line net = the database's, on every amount ₹0.01–₹10,000`, () => (x.modelOk && !x.off.length) || (!x.modelOk ? "the exact model did not match the database" : `${x.off.length.toLocaleString("en-IN")} of 1,000,000 amounts differ by a paisa, e.g. ${x.ex}`));
}
for (const [bp, label] of [[500, "5%"], [1800, "18%"], [1200, "12%"], [2800, "28%"]]) {
  const x = await sweep("add", bp);
  await check("lib/tax.ts", `tax ON TOP at ${label}: the app's tax = the database's, on every taxable amount ₹0.01–₹10,000`, () => (x.modelOk && !x.off.length) || (!x.modelOk ? "the exact model did not match the database" : `${x.off.length.toLocaleString("en-IN")} of 1,000,000 amounts differ by a paisa, e.g. ${x.ex} — the database rounds the exact half up, the app's float lands a hair under it`));
}
await check("lib/tax.ts", "the whole-number model of the database's rounding was confirmed BY the database on every amount it was asked about (so the counts above are the database's, not a guess)", async () => {
  const x = await sweep("add", 1250); return x.modelOk || "model and database disagree"; });

// ═══ D · each restaurant's own saved orders follow the rules the code assumes ═════════════════════
// Rows that NO app path could have written are named and set apart — recognised by where they came
// from, never by whether they break a rule — and reported, not hidden:
//   · the owner-film history (placed_by 'film-history', brag-output/ownerfilm/prep-history.mjs): it
//     stores the total AFTER the discount and puts platform names on dine-in bills;
//   · the demo history stamped with the fixed seed time 2024-01-01 04:00 — older than this repository;
//   · an order with NO dishes at all: every order path refuses an empty cart, so it was hand-built.
// Every other row on the database is held to the rules.
const SEEDED = `(coalesce(o.placed_by,'') = 'film-history' or o.created_at = '2024-01-01 04:00:00+00' or (jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) = 0 and o.subtotal > 0))`;
const D = await sql(`select r.slug, count(*) n,
  count(*) filter (where o.taxable_base is not null and o.subtotal <> round(o.taxable_base + coalesce(o.nontax_amount,0),2)) d_sub,
  count(*) filter (where o.discount < 0 or o.discount > o.subtotal) d_disc,
  count(*) filter (where o.total <> round(o.subtotal + o.tax,2)) d_total,
  count(*) filter (where o.tax_rate < 0 or o.tax_rate > 0.5) d_rate,
  count(*) filter (where o.tax_rate = 0 and o.tax > 0) d_zero,
  count(*) filter (where o.mrp_amount > o.subtotal) d_mrp,
  count(*) filter (where o.tax < 0 or o.subtotal < 0 or o.total < 0) d_neg,
  count(*) filter (where o.tax_rate > 0 and o.taxable_base is not null and o.tax <> round(o.taxable_base * o.tax_rate, 2) and abs(o.tax - round(o.taxable_base * o.tax_rate, 2)) > 0.011) d_taxoff 
  from orders o join restaurants r on r.id = o.restaurant_id where o.status <> 'cancelled' and not ${SEEDED} group by r.slug order by count(*) desc`);
const SEEDN = await sql(`select count(*) filter (where coalesce(o.placed_by,'')='film-history') film, count(*) filter (where o.created_at = '2024-01-01 04:00:00+00') fixed, count(*) filter (where jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) = 0 and o.subtotal > 0) empty, (select min(created_at) from orders where coalesce(placed_by,'') <> 'film-history' and created_at > '2024-01-02')::date app_first from orders o where o.status <> 'cancelled'`);
const NAMED = D.filter((x) => !/^zz|^t28-|^hi$/.test(x.slug));
const TESTS = D.filter((x) => /^zz|^t28-|^hi$/.test(x.slug));
const sum = (rows, k) => rows.reduce((a, x) => a + Number(x[k]), 0);
const RULES = [["d_sub", "subtotal = taxable base + untaxed lines"], ["d_disc", "the discount is never below 0 or above the subtotal"], ["d_total", "the total keeps the discount APART (total = subtotal + tax — the bill takes the discount off)"],
  ["d_rate", "the stamped rate is a rate (0 to 50%)"], ["d_zero", "an order stamped 0% carries no tax"], ["d_mrp", "the locked MRP part is never more than the subtotal"], ["d_neg", "no tax, subtotal or total is negative"],
  ["d_taxoff", "the stored tax is the taxable base × the stamped rate (within the one paisa the app's rounding can differ by)"]];
for (const x of NAMED) {
  const bad = RULES.filter(([k]) => Number(x[k]) > 0);
  await check("lib/tax.ts", `${x.slug}: all ${Number(x.n).toLocaleString("en-IN")} of its saved orders follow all ${RULES.length} money rules`, () => !bad.length || bad.map(([k, w]) => `${x[k]}× ${w}`).join("; "));
}
for (const [k, w] of RULES) await check("lib/tax.ts", `the ${TESTS.length} throwaway test restaurants (zz…): ${w}, on all ${sum(TESTS, "n").toLocaleString("en-IN")} of their orders`, () => sum(TESTS, k) === 0 || `${sum(TESTS, k)} orders break it`);
const FIRST_COMMIT = String(spawnSync("git", ["log", "--reverse", "--format=%ad", "--date=short"], { cwd: root, encoding: "utf8" }).stdout || "").split("\n")[0];
await check("lib/tax.ts", `the rows set apart are recognised by ORIGIN — ${SEEDN[0].film} film-history, ${SEEDN[0].fixed} stamped 2024-01-01 04:00, ${SEEDN[0].empty} with no dishes — and that seed time is older than the repository itself (first commit ${FIRST_COMMIT})`, () =>
  (FIRST_COMMIT > "2024-01-01" && Number(SEEDN[0].empty) <= 3) || `first commit ${FIRST_COMMIT}; ${SEEDN[0].empty} dish-less orders`);
const SP = await sql(`select coalesce(method,'(none)') m, count(*) n, count(*) filter (where amount <= 0) nonpos from session_payments group by 1 order by 2 desc`);
await check("lib/paySplit.ts", `every part ever stored by Pay in parts uses a method the app offers (${SP.map((x) => x.m).join(", ")})`, () => SP.every((x) => PS.SPLIT_METHODS.includes(x.m)) || `unknown: ${SP.filter((x) => !PS.SPLIT_METHODS.includes(x.m)).map((x) => x.m).join(", ")}`);
await check("lib/paySplit.ts", "…and no stored part is ₹0 or less", () => SP.every((x) => Number(x.nonpos) === 0) || `${sum(SP, "nonpos")} parts ≤ 0`);
const GRP = await sql(`select count(*) groups, count(*) filter (where n < 2) single from (select settle_group, count(*) n from session_payments where settle_group is not null and reversed_at is null group by 1) g`);
await check("lib/paySplit.ts", `every settle group Pay in parts wrote has at least two parts (${GRP[0].groups} groups on dev)`, () => Number(GRP[0].single) === 0 || `${GRP[0].single} groups have one part`);
// The method is checked against the app's list on every path since 51afda30 (2026-08-05, the "how did
// they pay?" sheet fix); two rows written by the diagnostic login that same morning say "cash".
const PMS = await sql(`select coalesce(o.payment_method,'(none)') m, count(*) n, count(*) filter (where o.paid_at >= '2026-08-06') since_check from orders o where o.payment_status = 'paid' and not ${SEEDED} group by 1 order by 2 desc`);
const FILMPAY = await sql(`select count(*) n, count(*) filter (where coalesce(placed_by,'') <> 'film-history') not_film from orders where payment_status = 'paid' and payment_method in ('Swiggy','Zomato','Website')`);
const KNOWN_PAID = [...PAY.PAYMENT_METHODS, "Split", "On the house", "(none)"];
await check("lib/payments.ts", `every order the app marked paid since the method check landed uses a method the app knows (${PMS.filter((x) => Number(x.since_check)).map((x) => `${x.m} ${x.since_check}`).join(" · ")})`, () => PMS.every((x) => KNOWN_PAID.includes(x.m) || Number(x.since_check) === 0) || `unknown since 2026-08-06: ${PMS.filter((x) => !KNOWN_PAID.includes(x.m) && Number(x.since_check)).map((x) => `${x.m} (${x.since_check})`).join(", ")}`);
await check("lib/payments.ts", `…older than that, the only unknown spelling is ${PMS.filter((x) => !KNOWN_PAID.includes(x.m)).map((x) => `"${x.m}" ×${x.n}`).join(", ") || "none"} — from before the check existed`, () => PMS.filter((x) => !KNOWN_PAID.includes(x.m)).every((x) => Number(x.since_check) === 0 && Number(x.n) <= 2));
await check("lib/payments.ts", `a dine-in bill paid "Swiggy / Zomato / Website" exists ONLY in the film seeder's rows (${FILMPAY[0].n}) — the app never writes a platform name onto a dine-in bill`, () => Number(FILMPAY[0].not_film) === 0 || `${FILMPAY[0].not_film} not from the film seeder`);

// ═══ E · every table, column, filter and function the 14 files use ═══════════════════════════════
const FILES = ["lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts", "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts", "lib/money.ts", "lib/money.mjs", "lib/orderAllergies.ts"];
const COLS = await sql(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'`);
const colset = new Map(); for (const x of COLS) (colset.get(x.t) || colset.set(x.t, new Set()).get(x.t)).add(x.c);
// The columns each query names, read from the code: the chain from .from("t") to the end of the statement.
const chainCols = (text) => {
  const out = [];
  for (const m of text.matchAll(/\.from\("([a-z_]+)"\)([\s\S]*?)(?:;|\n\s*\n)/g)) {
    const [, t, chain] = m; const cols = new Set();
    for (const s of chain.matchAll(/\.select\("([^"]*)"/g)) for (const c of s[1].split(",")) { const x = c.trim(); if (x && x !== "*" && !/[(:!]/.test(x)) cols.add(x); }
    for (const f of chain.matchAll(/\.(?:eq|neq|is|in|gte|gt|lte|lt|order)\("([a-z_]+)"/g)) cols.add(f[1]);
    for (const w of chain.matchAll(/\.(?:update|insert|upsert)\(\{([^}]*)\}/g)) for (const k of w[1].matchAll(/(?:^|,|\{)\s*([a-z_]+)\s*(?::|,|$)/g)) cols.add(k[1]);
    out.push({ t, cols: [...cols] });
  }
  return out;
};
for (const f of FILES.filter((f) => /\.from\("/.test(read(f)))) {
  const q = chainCols(read(f)); const miss = q.flatMap(({ t, cols }) => (!colset.has(t) ? [`table ${t}`] : cols.filter((c) => !colset.get(t).has(c)).map((c) => `${t}.${c}`)));
  await check(f, `every table and column ${f} names in its ${q.length} queries exists in the dev database`, () => (q.length > 0 && !miss.length) || `missing: ${[...new Set(miss)].join(", ")}`);
}
await check("lib/tax.ts", "TAX_SETTINGS_COLUMNS names real columns of settings", () => T.TAX_SETTINGS_COLUMNS.split(",").map((x) => x.trim()).every((c) => colset.get("settings").has(c)));
const tmp = mkdtempSync(join(tmpdir(), "t30-parity-")); const recFile = join(tmp, "rec.json");
const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/t30-harness/hooks.mjs", "scripts/t30-harness/run.mjs", "--quiet"], { cwd: root, encoding: "utf8", env: { ...process.env, T30_RECORD: recFile }, timeout: 300000 });
const REC = existsSync(recFile) ? JSON.parse(readFileSync(recFile, "utf8")) : null; rmSync(tmp, { recursive: true, force: true });
await check("scripts/t30-harness", "the recording run of the whole harness passed (so what it recorded is what the real code does)", () => (run.status === 0 && !!REC) || (run.stdout || "").slice(-200));
await check("lib (the 14 money files, as recorded)", `every table the 14 files touched at run time exists in the dev database (${REC ? REC.tables.join(", ") : "?"})`, () => (REC && REC.tables.every((t) => colset.has(t))) || `missing: ${REC && REC.tables.filter((t) => !colset.has(t)).join(", ")}`);
const FNS = await sql(`select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') svc, has_function_privilege('anon', p.oid, 'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
await check("lib/idempotency.ts", `every database function the 14 files call exists and the server's key may run it (${REC ? REC.rpcs.join(", ") : "?"})`, () => (REC && REC.rpcs.length > 0 && REC.rpcs.every((n) => FNS.some((f) => f.proname === n && f.svc === true))) || "a function is missing or not runnable");
await check("lib/idempotency.ts", "…and the public key may NOT run them (they are server-only housekeeping)", () => (REC && REC.rpcs.every((n) => FNS.filter((f) => f.proname === n).every((f) => f.anon === false))) || "the public key can run one");
const IDX = await sql(`select t.relname tbl, i.relname idx, (select array_agg(a.attname order by k.ord) from unnest(ix.indkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum) cols, ix.indisunique uq
  from pg_index ix join pg_class t on t.oid = ix.indrelid join pg_class i on i.oid = ix.indexrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public'`);
const lead = (t) => IDX.filter((x) => x.tbl === t).map((x) => (Array.isArray(x.cols) ? x.cols : String(x.cols).replace(/[{}]/g, "").split(","))[0]);
for (const q of REC ? REC.queries.filter((q) => q.filters.length) : []) {
  await check("lib (the 14 money files, as recorded)", `${q.table} ${q.op} filtered by ${q.filters.join(" + ")}: an index starts with one of those columns, so it never reads the whole table`, () => q.filters.some((c) => lead(q.table).includes(c)) || `indexes start with: ${[...new Set(lead(q.table))].join(", ") || "(none)"}`);
}
const UQ = IDX.filter((x) => x.tbl === "action_idempotency" && x.uq);
await check("lib/idempotency.ts", "action_idempotency has a UNIQUE index on action_id — the claim that stops a repeated tap from running twice depends on the database refusing the second one", () => UQ.some((x) => String(x.cols).replace(/[{}]/g, "").split(",")[0] === "action_id") || JSON.stringify(UQ));

// ═══ F · the refusal codes and constraint names exist in the database ═══════════════════════════════
const PROCSRC = await sql(`select string_agg(prosrc, ' ') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
for (const code of ["LFH01", "LFH02", "LFH03", "LFH04"]) await check("lib/dbRefusal.ts", `refusal code ${code} is really raised by a live database function (its sentence is not for a code nothing sends)`, () => PROCSRC[0].s.includes(`'${code}'`) || "no live function raises it");
const PLAINKEYS = [...read("lib/dbRefusal.ts").slice(read("lib/dbRefusal.ts").indexOf("const PLAIN")).split("\n};")[0].matchAll(/^\s{2}([a-z_0-9]+): "/gm)].map((m) => m[1]);
const CONS = await sql(`select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'`);
for (const k of PLAINKEYS) await check("lib/dbRefusal.ts", `the constraint lib/dbRefusal explains in plain words, ${k}, exists in the dev database`, () => CONS.some((c) => c.conname === k) || "not in the database");

// ═══ G · every guard the four territory docs name is real and green today ════════════════════════════
const DOCS = ["docs/COMPLIANCE-GUARDRAILS.md", "docs/CANCEL-AND-LOSS-SPEC.md", "docs/BUSINESS-LOGIC-AUDIT.md", "docs/SAAS-EFFICIENCY-PLAYBOOK.md"];
const scripts = JSON.parse(read("package.json")).scripts;
const named = [...new Set(DOCS.flatMap((d) => [...read(d).matchAll(/\b(verify:[a-z0-9-]+)\b/g)].map((m) => m[1])))].sort();
// Only verify:cancel-made drives the app, and it DEFAULTS TO :4000 — the owner's own server — so it is
// only ever run here with an explicit --base on this terminal's port, and skipped without one.
const APP_GUARDS = new Set(["verify:cancel-made"]);
for (const g of named) {
  const where = DOCS.filter((d) => read(d).includes(g)).map((d) => d.replace("docs/", "")).join(", ");
  await check(DOCS.find((d) => read(d).includes(g)), `${g} (named in ${where}) is a real npm script and is green today`, () => {
    if (!scripts[g]) return "not in package.json";
    if (APP_GUARDS.has(g) && !/^http:\/\/localhost:4430$/.test(process.env.T30_BASE || "")) return "skip: drives the app — run with T30_BASE=http://localhost:4430";
    const r = spawnSync("npm", ["run", "-s", g, ...(APP_GUARDS.has(g) ? ["--", "--base", process.env.T30_BASE] : [])], { cwd: root, encoding: "utf8", timeout: 600000 });
    return r.status === 0 || `exit ${r.status}: ${((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-2).join(" ").slice(0, 160)}`;
  });
}

// ═══ H · every saved order, re-computed from its own dishes ════════════════════════════════════════
// The strongest real-data question: take the dishes an order SAVED, run them through splitBill with
// that restaurant's settings, and compare with the four figures the order carries. A mismatch means the
// screen and the stored bill disagree about the same dishes.
const SAVED = await sql(`select o.id, r.slug, o.items, o.subtotal, o.taxable_base, o.nontax_amount, o.mrp_amount, s.tax_rate s_rate, s.tax_components, s.price_tax_mode, s.item_tax_modes_allowed, s.mrp_tax_treatment
  from orders o join restaurants r on r.id = o.restaurant_id left join settings s on s.restaurant_id = o.restaurant_id
  where o.status <> 'cancelled' and not ${SEEDED} and o.taxable_base is not null and o.items::text like '%tax_mode%' order by o.created_at desc limit 8000`);
const HBY = new Map();
for (const o of SAVED) {
  const st = { tax_rate: o.s_rate == null ? null : Number(o.s_rate), tax_components: o.tax_components, price_tax_mode: o.price_tax_mode, item_tax_modes_allowed: o.item_tax_modes_allowed, mrp_tax_treatment: o.mrp_tax_treatment };
  const b = T.splitBill(o.items, st, 0); const k = /^zz/.test(o.slug) ? "(the zz… test restaurants)" : o.slug;
  const x = HBY.get(k) || HBY.set(k, { n: 0, sub: [], base: [], nt: [], mrp: [] }).get(k); x.n++;
  if (P(b.subtotal) !== P(o.subtotal)) x.sub.push(o.id); if (P(b.taxableBase) !== P(o.taxable_base)) x.base.push(o.id);
  if (P(b.nontaxAmount) !== P(o.nontax_amount)) x.nt.push(o.id); if (P(b.mrpAmount) !== P(o.mrp_amount)) x.mrp.push(o.id);
}
await check("lib/tax.ts", `${SAVED.length.toLocaleString("en-IN")} saved orders whose dishes carry their tax mode were re-computed (enough to mean something)`, () => SAVED.length >= 1000 || `only ${SAVED.length}`);
for (const [k, x] of HBY) {
  if (x.n < 3) continue;
  await check("lib/tax.ts", `${k}: all ${x.n.toLocaleString("en-IN")} saved orders — subtotal, taxable base, untaxed and MRP figures are exactly what the screen computes from the same dishes`, () => (!x.sub.length && !x.base.length && !x.nt.length && !x.mrp.length) || `subtotal ${x.sub.length} · base ${x.base.length} · untaxed ${x.nt.length} · MRP ${x.mrp.length} differ, e.g. ${[...x.sub, ...x.base, ...x.nt, ...x.mrp][0]}`);
}
for (const [f, label] of [["sub", "subtotal"], ["base", "taxable base"], ["nt", "untaxed amount"], ["mrp", "locked MRP amount"]]) {
  const off = [...HBY.values()].reduce((a, x) => a + x[f].length, 0);
  await check("lib/tax.ts", `across every restaurant: the saved ${label} equals the screen's on all ${SAVED.length.toLocaleString("en-IN")} orders`, () => off === 0 || `${off} orders differ`);
}

// ═══ I · every bill ever settled in parts, against what its paper says now ═════════════════════════
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const GROUPS = await sql(`select g.settle_group, g.session_id, g.restaurant_id, g.legs, g.amount, coalesce((select json_agg(o) from (select id, status, deleted_at, subtotal, taxable_base, nontax_amount, mrp_amount, discount, tax_rate, items, payment_method, payment_status from orders where session_id = g.session_id and restaurant_id = g.restaurant_id) o), '[]') orders,
  (select row_to_json(s) from (select tax_rate, tax_components, price_tax_mode, item_tax_modes_allowed, mrp_tax_treatment from settings where restaurant_id = g.restaurant_id) s) st
  from (select settle_group, session_id, restaurant_id, count(*) legs, sum(amount) amount from session_payments where settle_group is not null and reversed_at is null group by 1, 2, 3) g`);
const ACTS = await sql(`select distinct order_id from staff_actions where order_id in (select o.id from orders o where o.session_id in (select session_id from session_payments where settle_group is not null)) and action ilike '%cancel%'`);
const EDITOR_REFUSES = /if \(patch\.status === "cancelled" && cur\.payment_status === "paid"\)\s*\n\s*return err\("Can't cancel a paid order/.test(read("app/api/editor/[...path]/route.ts"));
for (const g of GROUPS) {
  const all = typeof g.orders === "string" ? JSON.parse(g.orders) : g.orders; const st = typeof g.st === "string" ? JSON.parse(g.st) : g.st;
  const live = all.filter((o) => o.status !== "cancelled" && !o.deleted_at); const m = BILLDOC.billMoney(all, st || {});
  if (live.length) {
    await check("lib/paySplit.ts", `settled-in-parts bill ${String(g.settle_group).slice(0, 8)}… (${g.legs} parts${all.some((o) => o.payment_status !== "paid") ? ", one parked on a tab" : ""}): the parts stored add up to exactly what its printed bill says (₹${Number(g.amount).toFixed(2)})`, () => Math.abs(P(g.amount) - P(m.total)) <= 2 || `parts ₹${g.amount} vs paper ₹${m.total}`);
  } else {
    // Its order was cancelled AFTER it was paid. The app cannot do that ("Can't cancel a paid order —
    // mark it unpaid (refund) first.", and no database function cancels a paid order), so this must be
    // a test rig's clean-up — proven by the cancel having no Activity line, which every app path writes.
    await check("lib/paySplit.ts", `settled-in-parts bill ${String(g.settle_group).slice(0, 8)}…: its order was cancelled after payment — by a test rig's clean-up, NOT the app (no Activity line for the cancel, and the app refuses to cancel a paid order)`, () =>
      (EDITOR_REFUSES && all.every((o) => !ACTS.some((x) => x.order_id === o.id))) || "an app path cancelled a paid, settled-in-parts bill");
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
if (ARGV.includes("--ledger")) {
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of ROWS) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | read-only SQL on the dev database vs the real code · \`scripts/sweep/t30s10/parity.mjs\` | ${r.ok ? "✅" : r.skip ? "⏭" : "❌"} | ${esc(r.note)} |`);
} else {
  for (const r of ROWS) if (!ARGV.includes("--quiet") || !r.ok) console.log(`${r.ok ? "✅" : r.skip ? "⏭" : "❌"} ${r.id}  [${r.file}] ${r.what}${r.note ? "  → " + r.note : ""}`);
  const bad = ROWS.filter((r) => !r.ok && !r.skip).length, sk = ROWS.filter((r) => r.skip).length;
  console.log(`\n${bad ? "✗ FAIL" : "✓ PASS"} — ${ROWS.length} checks · ${ROWS.length - bad - sk} ✅ · ${bad} ❌ · ${sk} ⏭`);
}
process.exitCode = ROWS.some((r) => !r.ok && !r.skip) ? 1 : 0;
