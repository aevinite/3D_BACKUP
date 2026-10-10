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
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
let NOTE = ""; const note = (t) => { NOTE = String(t); return true; };
// PERMANENT IDS (round 4, 2026-10-10). Several sections are enumerated from live data — the
// constraints lib/dbRefusal names, the guards the docs name, the bills settled in parts, the
// restaurants — so a numbered position is NOT a permanent id: item 11 added one constraint and every
// row after it moved one place. Each row now has a KEY (its subject, numbers stripped, or an explicit
// one) and its id is looked up in parity-ids.json, seeded from the round-3 ledger; a subject seen for
// the first time takes the next free id in the block and is written there with --assign-ids.
const IDFILE = join(root, "scripts/sweep/t30s10/parity-ids.json");
const IDS = existsSync(IDFILE) ? JSON.parse(readFileSync(IDFILE, "utf8")) : {};
// counts drift with the data (3+ digits, comma-grouped, or rupees); short codes and rates (LFH01, 18%) do not
const keyOf = (file, what) => file + "|" + String(what).replace(/₹[\d,.]+|\b\d{1,3}(?:,\d{2,3})+\b|\b\d{3,}(?:\.\d+)?\b/g, "#").replace(/\s+/g, " ").trim();
const seen = new Set(); const unassigned = [];
const check = async (file, what, fn, key = keyOf(file, what)) => {
  if (seen.has(key)) throw new Error(`two rows share the key ${key}`); seen.add(key);
  let id = IDS[key];
  // round 3's block (P167501–P167700) is closed; a subject first seen in round 4 or later takes the next id
  // from this terminal's round-4 block, P166301–P166600 (claimed on main, PR #1470).
  // (round 5 on: new subjects take P210801–P210900 of this terminal's round-5 block, PR #1479 — the harness's
  // round-5 suites own P210001–P210700; the first try here started at P210501 and collided with u-round5b)
  if (!id) { const used = new Set(Object.values(IDS)); let n = 210801; while (used.has(`P${n}`)) n++; if (n > 210900) { id = "P—"; unassigned.push(key + " (block full)"); } else { id = `P${n}`; IDS[key] = id; unassigned.push(key); } }
  let res; NOTE = ""; try { res = await fn(); } catch (e) { res = "threw: " + (e && e.message); }
  ROWS.push({ id, key, file, what, ok: res === true, skip: typeof res === "string" && res.startsWith("skip:"), note: res === true ? NOTE.slice(0, 220) : String(res).slice(0, 220) });
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
await check("lib/tax.ts", `…and the set-ups are really different: ${SHAPES.length} distinct tax set-ups among them (a parity check over one set-up proves little)`, () => SHAPES.length >= 3 || `only ${SHAPES.length}`, "lib/tax.ts|setups-differ");
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
  // the APP side is the app's own rule (lib/tax.ts roundPaise — what splitBill, the paper and Pay in parts use)
  const appOf = (g) => P(kind === "incl" ? T.roundPaise((g / 100) / (1 + rate)) : T.roundPaise((g / 100) * rate));
  for (let g = 1; g <= 1000000; g++) { if (appOf(g) !== (kind === "incl" ? exactIncl(g, bp) : exactAdd(g, bp))) off.push(g); }
  const ask = [...new Set([...off.slice(0, 3000), ...sample])];
  const expr = kind === "incl" ? `round((g/100.0) / (1 + ${rate}), 2)` : `round((g/100.0) * ${rate}, 2)`;
  const db = await sql(`select g, (${expr})::text v from unnest(array[${ask.join(",")}]::int[]) g`);
  const modelOk = db.every((r) => P(r.v) === (kind === "incl" ? exactIncl(Number(r.g), bp) : exactAdd(Number(r.g), bp)));
  return { off, modelOk, asked: ask.length, ex: off.length ? `₹${off[0] / 100}: app ${appOf(off[0]) / 100} vs db ${db.find((r) => Number(r.g) === off[0])?.v}` : "" };
};
for (const [bp, label] of [[500, "5% (the rate every dev restaurant uses)"], [1800, "18%"], [1200, "12%"], [2800, "28%"]]) {
  const x = await sweep("incl", bp);
  await check("lib/tax.ts", `tax INSIDE the price at ${label}: the app's per-line net = the database's, on every amount ₹0.01–₹10,000`, () => (x.modelOk && !x.off.length) || (!x.modelOk ? "the exact model did not match the database" : `${x.off.length.toLocaleString("en-IN")} of 1,000,000 amounts differ by a paisa, e.g. ${x.ex}`), `lib/tax.ts|inside|${bp}`);
}
for (const [bp, label] of [[500, "5%"], [1800, "18%"], [1200, "12%"], [2800, "28%"]]) {
  const x = await sweep("add", bp);
  await check("lib/tax.ts", `tax ON TOP at ${label}: the app's tax = the database's, on every taxable amount ₹0.01–₹10,000`, () => (x.modelOk && !x.off.length) || (!x.modelOk ? "the exact model did not match the database" : `${x.off.length.toLocaleString("en-IN")} of 1,000,000 amounts differ by a paisa, e.g. ${x.ex} — the database rounds the exact half up, the app's float lands a hair under it`), `lib/tax.ts|on-top|${bp}`);
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
  await check("lib/tax.ts", `${x.slug}: all ${Number(x.n).toLocaleString("en-IN")} of its saved orders follow all ${RULES.length} money rules`, () => !bad.length || bad.map(([k, w]) => `${x[k]}× ${w}`).join("; "), `lib/tax.ts|saved-orders-rules|${x.slug}`);
}
for (const [k, w] of RULES) await check("lib/tax.ts", `the ${TESTS.length} throwaway test restaurants (zz…): ${w}, on all ${sum(TESTS, "n").toLocaleString("en-IN")} of their orders`, () => sum(TESTS, k) === 0 || `${sum(TESTS, k)} orders break it`, `lib/tax.ts|test-restaurants|${k}`);
const FIRST_COMMIT = String(spawnSync("git", ["log", "--reverse", "--format=%ad", "--date=short"], { cwd: root, encoding: "utf8" }).stdout || "").split("\n")[0];
await check("lib/tax.ts", `the rows set apart are recognised by ORIGIN — ${SEEDN[0].film} film-history, ${SEEDN[0].fixed} stamped 2024-01-01 04:00, ${SEEDN[0].empty} with no dishes — and that seed time is older than the repository itself (first commit ${FIRST_COMMIT})`, () =>
  (FIRST_COMMIT > "2024-01-01" && Number(SEEDN[0].empty) <= 3) || `first commit ${FIRST_COMMIT}; ${SEEDN[0].empty} dish-less orders`, "lib/tax.ts|set-apart-by-origin");
const SP = await sql(`select coalesce(method,'(none)') m, count(*) n, count(*) filter (where amount <= 0) nonpos from session_payments group by 1 order by 2 desc`);
await check("lib/paySplit.ts", `every part ever stored by Pay in parts uses a method the app offers (${SP.map((x) => x.m).join(", ")})`, () => SP.every((x) => PS.SPLIT_METHODS.includes(x.m)) || `unknown: ${SP.filter((x) => !PS.SPLIT_METHODS.includes(x.m)).map((x) => x.m).join(", ")}`);
await check("lib/paySplit.ts", "…and no stored part is ₹0 or less", () => SP.every((x) => Number(x.nonpos) === 0) || `${sum(SP, "nonpos")} parts ≤ 0`);
const GRP = await sql(`select count(*) groups, count(*) filter (where n < 2) single from (select settle_group, count(*) n from session_payments where settle_group is not null and reversed_at is null group by 1) g`);
await check("lib/paySplit.ts", `every settle group Pay in parts wrote has at least two parts (${GRP[0].groups} groups on dev)`, () => Number(GRP[0].single) === 0 || `${GRP[0].single} groups have one part`, "lib/paySplit.ts|groups-two-parts");
// The method is checked against the app's list on every path since 51afda30 (2026-08-05, the "how did
// they pay?" sheet fix); two rows written by the diagnostic login that same morning say "cash".
const PMS = await sql(`select coalesce(o.payment_method,'(none)') m, count(*) n, count(*) filter (where o.paid_at >= '2026-08-06') since_check from orders o where o.payment_status = 'paid' and not ${SEEDED} group by 1 order by 2 desc`);
const FILMPAY = await sql(`select count(*) n, count(*) filter (where coalesce(placed_by,'') <> 'film-history') not_film from orders where payment_status = 'paid' and payment_method in ('Swiggy','Zomato','Website')`);
const KNOWN_PAID = [...PAY.PAYMENT_METHODS, "Split", "On the house", "(none)"];
await check("lib/payments.ts", "every order the app marked paid since the method check landed uses a method the app knows", () => (PMS.every((x) => KNOWN_PAID.includes(x.m) || Number(x.since_check) === 0) && note(PMS.filter((x) => Number(x.since_check)).map((x) => `${x.m} ${x.since_check}`).join(" · "))) || `unknown since 2026-08-06: ${PMS.filter((x) => !KNOWN_PAID.includes(x.m) && Number(x.since_check)).map((x) => `${x.m} (${x.since_check})`).join(", ")}`);
await check("lib/payments.ts", "…older than that, any unknown spelling is from before the check existed (none since item 11's repair)", () => (PMS.filter((x) => !KNOWN_PAID.includes(x.m)).every((x) => Number(x.since_check) === 0 && Number(x.n) <= 2) && note(PMS.filter((x) => !KNOWN_PAID.includes(x.m)).map((x) => `"${x.m}" ×${x.n}`).join(", ") || "none left")), "lib/payments.ts|older-spelling");
// (re-stated round 4: item 12 repaired the film rows and mig 417 now refuses a platform name, so the rule is absolute)
await check("lib/payments.ts", "no dine-in bill is paid by \"Swiggy / Zomato / Website\" — not even the film seeder's (a platform sale is its own row in aggregator_orders)", () => (Number(FILMPAY[0].n) === 0 && note("0 rows")) || `${FILMPAY[0].n} rows (${FILMPAY[0].not_film} not from the film seeder)`, "lib/payments.ts|platform-names");

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
  await check(f, `every table and column ${f} names in its ${q.length} queries exists in the dev database`, () => (q.length > 0 && !miss.length) || `missing: ${[...new Set(miss)].join(", ")}`, `${f}|tables-and-columns`);
}
await check("lib/tax.ts", "TAX_SETTINGS_COLUMNS names real columns of settings", () => T.TAX_SETTINGS_COLUMNS.split(",").map((x) => x.trim()).every((c) => colset.get("settings").has(c)));
const tmp = mkdtempSync(join(tmpdir(), "t30-parity-")); const recFile = join(tmp, "rec.json");
const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/t30-harness/hooks.mjs", "scripts/t30-harness/run.mjs", "--quiet"], { cwd: root, encoding: "utf8", env: { ...process.env, T30_RECORD: recFile }, timeout: 300000 });
const REC = existsSync(recFile) ? JSON.parse(readFileSync(recFile, "utf8")) : null; rmSync(tmp, { recursive: true, force: true });
await check("scripts/t30-harness", "the recording run of the whole harness passed (so what it recorded is what the real code does)", () => (run.status === 0 && !!REC) || (run.stdout || "").slice(-200));
await check("lib (the 14 money files, as recorded)", "every table the 14 files touched at run time exists in the dev database", () => (REC && REC.tables.every((t) => colset.has(t)) && note(REC.tables.join(", "))) || `missing: ${REC && REC.tables.filter((t) => !colset.has(t)).join(", ")}`);
const FNS = await sql(`select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') svc, has_function_privilege('anon', p.oid, 'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
await check("lib/idempotency.ts", "every database function the 14 files call exists and the server's key may run it", () => (REC && REC.rpcs.length > 0 && REC.rpcs.every((n) => FNS.some((f) => f.proname === n && f.svc === true)) && note(REC.rpcs.join(", "))) || "a function is missing or not runnable");
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
  await check("lib/tax.ts", `${k}: all ${x.n.toLocaleString("en-IN")} saved orders — subtotal, taxable base, untaxed and MRP figures are exactly what the screen computes from the same dishes`, () => (!x.sub.length && !x.base.length && !x.nt.length && !x.mrp.length) || `subtotal ${x.sub.length} · base ${x.base.length} · untaxed ${x.nt.length} · MRP ${x.mrp.length} differ, e.g. ${[...x.sub, ...x.base, ...x.nt, ...x.mrp][0]}`, `lib/tax.ts|recomputed|${k}`);
}
for (const [f, label] of [["sub", "subtotal"], ["base", "taxable base"], ["nt", "untaxed amount"], ["mrp", "locked MRP amount"]]) {
  const off = [...HBY.values()].reduce((a, x) => a + x[f].length, 0);
  await check("lib/tax.ts", `across every restaurant: the saved ${label} equals the screen's on all ${SAVED.length.toLocaleString("en-IN")} orders`, () => off === 0 || `${off} orders differ`);
}

// ═══ I · every bill ever settled in parts, against what its paper says now ═════════════════════════
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const GROUPS = await sql(`select g.settle_group, g.session_id, g.restaurant_id, g.legs, g.amount, coalesce((select json_agg(o) from (select id, status, deleted_at, subtotal, taxable_base, nontax_amount, mrp_amount, discount, tax_rate, items, payment_method, payment_status from orders where session_id = g.session_id and restaurant_id = g.restaurant_id) o), '[]') orders,
  (select row_to_json(s) from (select tax_rate, tax_components, price_tax_mode, item_tax_modes_allowed, mrp_tax_treatment from settings where restaurant_id = g.restaurant_id) s) st
  from (select settle_group, session_id, restaurant_id, count(*) legs, sum(amount) amount, bool_and(reversed_at is not null) reversed, max(reversed_reason) why from session_payments where settle_group is not null group by 1, 2, 3) g`);
const ACTS = await sql(`select distinct order_id from staff_actions where order_id in (select o.id from orders o where o.session_id in (select session_id from session_payments where settle_group is not null)) and action ilike '%cancel%'`);
const EDITOR_REFUSES = /if \(patch\.status === "cancelled" && cur\.payment_status === "paid"\)\s*\n\s*return err\("Can't cancel a paid order/.test(read("app/api/editor/[...path]/route.ts"));
for (const g of GROUPS) {
  const all = typeof g.orders === "string" ? JSON.parse(g.orders) : g.orders; const st = typeof g.st === "string" ? JSON.parse(g.st) : g.st;
  const live = all.filter((o) => o.status !== "cancelled" && !o.deleted_at); const m = BILLDOC.billMoney(all, st || {});
  const gk = `lib/paySplit.ts|settled-in-parts bill ${String(g.settle_group).slice(0, 8)}`;
  if (g.reversed) {
    // (round 4, item 14) a test rig's bill whose parts were reversed with a reason — no longer counted.
    await check("lib/paySplit.ts", `settled-in-parts bill ${String(g.settle_group).slice(0, 8)}…: its order was cancelled after payment by a test rig, and its parts are now REVERSED with a reason — no longer counted as collected`, () =>
      (!live.length && !!g.why && all.every((o) => !ACTS.some((x) => x.order_id === o.id))) || "a reversed group with a live order, or no reason", gk);
  } else if (live.length) {
    await check("lib/paySplit.ts", `settled-in-parts bill ${String(g.settle_group).slice(0, 8)}… (${g.legs} parts${all.some((o) => o.payment_status !== "paid") ? ", one parked on a tab" : ""}): the parts stored add up to exactly what its printed bill says (₹${Number(g.amount).toFixed(2)})`, () => Math.abs(P(g.amount) - P(m.total)) <= 2 || `parts ₹${g.amount} vs paper ₹${m.total}`, gk);
  } else {
    // Its order was cancelled AFTER it was paid. The app cannot do that ("Can't cancel a paid order —
    // mark it unpaid (refund) first.", and no database function cancels a paid order), so this must be
    // a test rig's clean-up — proven by the cancel having no Activity line, which every app path writes.
    await check("lib/paySplit.ts", `settled-in-parts bill ${String(g.settle_group).slice(0, 8)}…: its order was cancelled after payment — by a test rig's clean-up, NOT the app (no Activity line for the cancel, and the app refuses to cancel a paid order)`, () =>
      (EDITOR_REFUSES && all.every((o) => !ACTS.some((x) => x.order_id === o.id))) || "an app path cancelled a paid, settled-in-parts bill", gk);
  }
}

// ═══ J · per NAMED restaurant (appended — ids above stay put): each one's own settings row is what lfh_split_items_tax reads, so each is
// asked separately (200 random carts each) — a restaurant whose row drifts from the shared shape shows.
for (const r of RESTS.filter((x) => x.has_settings && !/^zz|^t28-|^hi$/.test(x.slug))) {
  const R = gen(9100 + RESTS.indexOf(r)); const carts = Array.from({ length: 200 }, () => Array.from({ length: int(R, 1, 8) }, () => lineOf(R)));
  const rows = await sql(`select c.n, lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid) s from jsonb_array_elements(${lit(JSON.stringify(carts))}::jsonb) with ordinality c(cart, n)`);
  const s = settingsOf(r); let bad = null;
  for (const row of rows) { const db = typeof row.s === "string" ? JSON.parse(row.s) : row.s; const b = T.splitBill(carts[Number(row.n) - 1], s, 0);
    if (P(b.taxableBase) !== P(db.taxable_base) || P(b.nontaxAmount) !== P(db.nontax_amount) || P(b.mrpAmount) !== P(db.mrp_amount)) { bad = `cart ${row.n}: app ${b.taxableBase}/${b.nontaxAmount}/${b.mrpAmount} vs db ${db.taxable_base}/${db.nontax_amount}/${db.mrp_amount}`; break; } }
  await check("lib/tax.ts", `${r.slug}: its OWN settings give the same taxable / untaxed / MRP split in the app and the database, on 200 random carts`, () => (rows.length === 200 && !bad) || bad || `${rows.length} rows`, `lib/tax.ts|own-settings-split|${r.slug}`);
}

// ═══════════════════════════ ROUND 4 (2026-10-10) — items 10–16 against the database ═══════════════════════════
// PROBE: a write the database must REFUSE or ACCEPT, tried inside a DO block that always ends by raising its
// own exception — so whatever the answer, NOTHING is ever committed. Dev project only (as every call here).
const probe = async (body) => {
  const q = `DO $probe$ BEGIN ${body}; RAISE EXCEPTION 'T30-PROBE-ROLLBACK'; END $probe$;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const t = await r.text(); return { accepted: /T30-PROBE-ROLLBACK/.test(t), text: t.slice(0, 240) };
};
const TF4 = await imp("lib/taxFiling.ts");
const BD4 = (await imp("public/panels/billdoc.js")).default;

// ── K · whole bills: the printed bill (billMoney) = the database's own sums, at every rate ──
for (const bp of [500, 1200, 1800, 2800, 250, 1250]) {
  const rate = bp / 10000; const R = gen(7700 + bp);
  const bills = Array.from({ length: 1500 }, () => { const base = int(R, 1, 2000000), nontax = R() < 0.3 ? int(R, 1, 50000) : 0, disc = R() < 0.4 ? int(R, 0, base) : 0; return [base, nontax, disc]; });
  const rows = await sql(`select n, round((b - d) / 100.0 * ${rate}, 2)::text tax, round((b + x - d) / 100.0 + round((b - d) / 100.0 * ${rate}, 2), 2)::text total
    from unnest(array[${bills.map((v) => v[0]).join(",")}]::bigint[], array[${bills.map((v) => v[1]).join(",")}]::bigint[], array[${bills.map((v) => v[2]).join(",")}]::bigint[]) with ordinality u(b, x, d, n)`);
  let tbad = null, obad = null;
  for (const r of rows) {
    const [b, x, d] = bills[Number(r.n) - 1];
    const m = BD4.billMoney([{ status: "served", subtotal: (b + x) / 100, taxable_base: b / 100, nontax_amount: x / 100, mrp_amount: 0, discount: d / 100, tax_rate: rate, items: [] }], { tax_rate: rate });
    if (!tbad && P(m.tax) !== P(r.tax)) tbad = `₹${b / 100} − ₹${d / 100}: paper ${m.tax} vs db ${r.tax}`;
    if (!obad && P(m.total) !== P(r.total)) obad = `paper ${m.total} vs db ${r.total}`;
  }
  await check("public/panels/billdoc.js", `whole bills at ${bp / 100}%: the printed bill's tax = the database's round((base − discount) × rate), on 1,500 random bills`, () => !tbad || tbad, `r4|whole-bill-tax|${bp}`);
  await check("public/panels/billdoc.js", `whole bills at ${bp / 100}%: …and the printed bill's total = the database's, to the paisa`, () => !obad || obad, `r4|whole-bill-total|${bp}`);
}
// the GST report (lib/taxFiling) and the printed bill (billdoc) split a whole-rupee tax into CGST / SGST the same way
{ let bad = null; for (let w = 0; w <= 20000 && !bad; w++) for (const comps of [[2.5, 2.5], [9, 9], [6, 6]]) {
    const a = TF4.splitTax(comps, w), b = BD4.splitTax(w, comps.map((r, i) => ({ label: i ? "SGST" : "CGST", rate: r }))).map((x) => Number(x.amt));
    if (b.length === a.length && b.some((v, i) => P(v) !== P(a[i])) && a.every((v) => Number.isInteger(v))) bad = `₹${w} at ${comps}: report ${a} vs paper ${b}`; }
  await check("lib/taxFiling.ts", "a whole-rupee tax (₹0–₹20,000) splits into the same CGST and SGST on the GST report and on the printed bill", () => !bad || bad, "r4|report-vs-paper-split"); }
// the trigger path: an order with an untaxed line has its tax written by the DATABASE — it must equal the screen's
for (const [k, r] of SHAPES.entries()) {
  const s = settingsOf(r); const R = gen(8800 + k);
  const carts = Array.from({ length: 300 }, () => [...Array.from({ length: int(R, 1, 5) }, () => ({ ...lineOf(R), tax_mode: pick(R, ["excl", "incl"]) })), { ...lineOf(R), tax_mode: "exempt" }]);
  const rows = await sql(`select c.n, (lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid)->>'taxable_base')::numeric * (lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid)->>'rate')::numeric b, round((lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid)->>'taxable_base')::numeric * (lfh_split_items_tax(c.cart, ${lit(r.id)}::uuid)->>'rate')::numeric, 2)::text tax from jsonb_array_elements(${lit(JSON.stringify(carts))}::jsonb) with ordinality c(cart, n)`);
  const bad = rows.find((row) => P(T.splitBill(carts[Number(row.n) - 1], s, 0).tax) !== P(row.tax));
  await check("lib/tax.ts", `${r.slug}'s set-up: an order with an untaxed line gets its tax from the database trigger — and it equals the screen's tax, on 300 random carts`, () => !bad || `cart ${bad.n}: screen ${T.splitBill(carts[Number(bad.n) - 1], s, 0).tax} vs db ${bad.tax}`, `r4|trigger-tax|${r.slug}`);
}

// ── L · item 11: the database itself refuses a made-up payment method (probes always roll back) ──
const FH = "00000000-0000-0000-0000-000000000001";   // French House — the restaurant this sweep writes to
const PROBE_ORDER = (await sql(`select id from orders where restaurant_id = '${FH}' and archived and status <> 'cancelled' order by created_at limit 1`))[0]?.id;
const PROBE_BEFORE = PROBE_ORDER ? JSON.stringify((await sql(`select payment_method, payment_status, total, updated_flag from (select payment_method, payment_status, total, 1 updated_flag from orders where id = '${PROBE_ORDER}') x`))[0]) : null;
for (const v of ["Swiggy", "Zomato", "Website", "cash", "UPI ", "", "Pay later", "card", "Bitcoin"]) {
  const r = PROBE_ORDER ? await probe(`UPDATE public.orders SET payment_method = ${lit(v)} WHERE id = '${PROBE_ORDER}'`) : { accepted: true, text: "no order" };
  await check("lib/payments.ts", `the database REFUSES a bill paid by ${JSON.stringify(v)} (orders_payment_method_is_known) — tried, and rolled back`, () => (!r.accepted && /orders_payment_method_is_known/.test(r.text)) || r.text, `r4|method-refused|${v}`);
}
for (const v of ["UPI", "Cash", "Card", "Other", "Split", "On the house", null]) {
  const r = PROBE_ORDER ? await probe(`UPDATE public.orders SET payment_method = ${v == null ? "NULL" : lit(v)} WHERE id = '${PROBE_ORDER}'`) : { accepted: false, text: "no order" };
  await check("lib/payments.ts", `…and ACCEPTS ${v == null ? "no method (an unpaid bill)" : JSON.stringify(v)} — tried, and rolled back`, () => r.accepted || r.text, `r4|method-accepted|${v}`);
}
{ const after = PROBE_ORDER ? JSON.stringify((await sql(`select payment_method, payment_status, total, updated_flag from (select payment_method, payment_status, total, 1 updated_flag from orders where id = '${PROBE_ORDER}') x`))[0]) : null;
  await check("lib/payments.ts", "every probe above was rolled back — the order the probes used is exactly as it was", () => (!!PROBE_BEFORE && after === PROBE_BEFORE) || `${PROBE_BEFORE} → ${after}`, "r4|probes-rolled-back"); }
{ const c = await sql(`select convalidated v from pg_constraint where conname = 'orders_payment_method_is_known'`);
  await check("lib/payments.ts", "the rule is VALIDATED on dev — every bill ever stored already obeys it", () => c[0]?.v === true, "r4|method-rule-validated"); }

// ── M · item 16: each reviewed dish, at each restaurant, through lfh_dish_reviews ──
const RV = await sql(`with d as (select distinct restaurant_id, item_slug from reviews where restaurant_id in (select id from restaurants where slug !~ '^zz'))
  select rs.slug rest, d.item_slug slug, d.restaurant_id rid,
    (select json_agg(x) from (select name, stars, comment, created_at, mine from lfh_dish_reviews(d.item_slug, d.restaurant_id, (select device_id from reviews r where r.restaurant_id = d.restaurant_id and r.item_slug = d.item_slug order by created_at desc limit 1))) x) fn,
    (select json_agg(x) from (select name, stars, comment, created_at from reviews r where r.restaurant_id = d.restaurant_id and r.item_slug = d.item_slug order by created_at desc limit 20) x) direct,
    (select count(*) from lfh_dish_reviews(d.item_slug, d.restaurant_id, null) where mine) mine_null
  from d join restaurants rs on rs.id = d.restaurant_id order by 1, 2`);
for (const d of RV) {
  const fn = (typeof d.fn === "string" ? JSON.parse(d.fn) : d.fn) || [], dir = (typeof d.direct === "string" ? JSON.parse(d.direct) : d.direct) || [];
  const same = fn.length === dir.length && fn.every((x, i) => x.name === dir[i].name && x.stars === dir[i].stars && x.comment === dir[i].comment && x.created_at === dir[i].created_at);
  const mine = fn.filter((x) => x.mine);
  await check("lib/menu.ts", `${d.rest} · ${d.slug}: the dish page gets exactly this restaurant's newest ${fn.length} review(s), newest first; one reviewer's device marks exactly their review as mine, and no device id comes back`,
    () => (same && fn.length <= 20 && mine.length === 1 && mine[0].created_at === dir[0].created_at && Number(d.mine_null) === 0 && fn.every((x) => !("device_id" in x))) || `same ${same}, ${fn.length} rows, ${mine.length} mine, ${d.mine_null} mine with no device`, `r4|reviews|${d.rest}|${d.slug}`);
}
{ const g = await sql(`select has_table_privilege('anon','public.reviews','select') a, has_table_privilege('authenticated','public.reviews','select') u, has_table_privilege('service_role','public.reviews','select') svc,
    has_function_privilege('anon','public.lfh_dish_reviews(text,uuid,text)','execute') fa, has_function_privilege('public','public.lfh_dish_reviews(text,uuid,text)','execute') fp,
    (select string_agg(policyname, ',') from pg_policies where schemaname = 'public' and tablename = 'reviews') pol,
    (select proconfig::text from pg_proc where proname = 'lfh_dish_reviews') cfg`);
  await check("lib/menu.ts", "the guest and signed-in keys can NOT read the reviews table directly; the server key still can (the owner and manager screens)", () => (g[0].a === false && g[0].u === false && g[0].svc === true) || JSON.stringify(g[0]), "r4|reviews-table-closed");
  // (re-stated with item 29: mig 419 adds back ONE read policy, for the three ratings columns only)
  await check("lib/menu.ts", "…the guest key may run lfh_dish_reviews, it is not left open to PUBLIC, it has a fixed search_path, and the only read policy left is the ratings-columns one (the old whole-table one is gone)", () => (g[0].fa === true && g[0].fp === false && /search_path=public/.test(g[0].cfg || "") && g[0].pol === "guest_reads_ratings_columns_only") || JSON.stringify(g[0]), "r4|reviews-function-grants"); }
await check("lib/menu.ts", `all ${RV.length} reviewed dishes were checked (each slug exists at two restaurants, so each answer proves it is scoped to ITS restaurant)`, () => RV.length >= 100 || `${RV.length}`, "r4|reviews-count");

// ── M2 · item 29 (a regression of item 16, caught by a screenshot): the guest menu's ratings ──
// The item_ratings view runs with the ASKING key's rights, so it is asked here AS the guest key would
// ask it — inside a transaction that only reads (SET LOCAL ROLE lasts until the COMMIT).
const asGuest = async (select) => {
  if (!/^\s*select\b/i.test(select)) throw new Error("asGuest: one SELECT only");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `BEGIN; SET LOCAL ROLE anon; ${select}; COMMIT;` }) });
  const t = await r.text(); if (!r.ok) throw new Error(`as guest: ${t.slice(0, 160)}`); return JSON.parse(t);
};
{ const guestRatings = await asGuest(`SELECT restaurant_id::text rid, item_slug, review_count, avg_rating::text avg FROM public.item_ratings WHERE restaurant_id IN (${[...new Set(RV.map((d) => lit(d.rid)))].join(", ")})`).catch((e) => ({ error: e.message }));
  const truth = await sql(`select restaurant_id::text rid, item_slug, count(*)::int n, round(avg(stars), 1)::text avg from reviews where restaurant_id in (select id from restaurants where slug in ('french-house', 'aevidine')) group by 1, 2`);
  const G = Array.isArray(guestRatings) ? new Map(guestRatings.map((x) => [`${x.rid}|${x.item_slug}`, x])) : new Map();
  await check("lib/menu.ts", "the guest menu's ratings view ANSWERS for the guest key (it runs with the asker's rights — mig 418 had silently emptied it)", () => (Array.isArray(guestRatings) && guestRatings.length > 0) || JSON.stringify(guestRatings).slice(0, 160), "r4|ratings-answer-guest");
  for (const d of RV) {
    const tr = truth.find((x) => x.rid === d.rid && x.item_slug === d.slug); const g = G.get(`${d.rid}|${d.slug}`);
    await check("lib/menu.ts", `${d.rest} · ${d.slug}: the dish card's rating, as the guest menu reads it, is the real count and average of its reviews`, () => (!!g && !!tr && Number(g.review_count) === tr.n && g.avg === tr.avg) || `guest ${g ? `${g.review_count} @ ${g.avg}` : "nothing"} vs real ${tr ? `${tr.n} @ ${tr.avg}` : "?"}`, `r4|rating|${d.rest}|${d.slug}`);
  }
  const col = await sql(`select ${["item_slug", "stars", "restaurant_id", "device_id", "name", "comment", "created_at", "id"].map((c) => `has_column_privilege('anon','public.reviews','${c}','select') "${c}"`).join(", ")}`);
  const c = col[0];
  await check("lib/menu.ts", "the guest key may read exactly the three review columns the ratings need (dish, stars, restaurant) — never the device id, the name, the comment, the date or the row id", () => (c.item_slug && c.stars && c.restaurant_id && !c.device_id && !c.name && !c.comment && !c.created_at && !c.id) || JSON.stringify(c), "r4|reviews-columns"); }

// ── N · the data repairs of items 12–15 hold ──
const N = (await sql(`select
  (select count(*) from orders where placed_by = 'film-history' and status <> 'cancelled' and (total <> round(subtotal + tax, 2) or taxable_base <> subtotal or tax <> round(taxable_base * tax_rate, 2))) film_off,
  (select count(*) from orders where payment_method in ('Swiggy','Zomato','Website')) platform,
  (select count(*) from orders where restaurant_id = '00000000-0000-0000-0000-0000000000a1' and created_at = '2024-01-01 04:00:00+00' and tax_rate = 0 and tax > 0) stamps,
  (select count(*) from session_payments where reversed_by like 'T30 sweep%' and reversed_reason is not null) reversed,
  (select coalesce(sum(amount), 0) from session_payments where reversed_by like 'T30 sweep%')::text reversed_amt,
  (select count(*) from orders where payment_method = 'cash') lower_cash,
  (select count(*) from orders where tax_rate = 0 and tax > 0 and status <> 'cancelled') zero_taxed`))[0];
await check("lib/tax.ts", "item 12: every film-history bill now stores total = subtotal + tax with the whole subtotal as its base — the app's own shape", () => Number(N.film_off) === 0 || `${N.film_off} rows off`, "r4|film-shape");
await check("lib/payments.ts", "item 12: no bill anywhere is paid by Swiggy / Zomato / Website", () => Number(N.platform) === 0 || `${N.platform}`, "r4|film-methods");
await check("lib/tax.ts", "item 13: no aevidine 2024 demo order is stamped 0% while charging tax — and no order anywhere is", () => (Number(N.stamps) === 0 && Number(N.zero_taxed) === 0) || `${N.stamps} / ${N.zero_taxed}`, "r4|demo-stamps");
await check("lib/paySplit.ts", "item 14: the test rig's 10 payment parts (₹1,449) are reversed, each with its reason", () => (Number(N.reversed) === 10 && P(N.reversed_amt) === 144900) || `${N.reversed} parts ₹${N.reversed_amt}`, "r4|rig-parts");
await check("lib/payments.ts", "before item 11: no bill says \"cash\" in lower case", () => Number(N.lower_cash) === 0 || `${N.lower_cash}`, "r4|lower-cash");
{ const film = await sql(`select r.slug, count(*) n, count(*) filter (where o.discount > 0) disc from orders o join restaurants r on r.id = o.restaurant_id where o.placed_by = 'film-history' and o.status <> 'cancelled' group by 1 order by 1`);
  for (const f of film) {
    const rev = await sql(`select coalesce(sum(total - disc_gross), 0)::text a, coalesce(sum(round((subtotal - discount) * (1 + tax_rate), 2)), 0)::text b from orders where placed_by = 'film-history' and status <> 'cancelled' and restaurant_id = (select id from restaurants where slug = ${lit(f.slug)}) and discount > 0`);
    await check("lib/tax.ts", `item 12 · ${f.slug}: its ${f.disc} discounted film bills now count ONCE in the owner's revenue (total − disc_gross = (subtotal − discount) × (1 + rate))`, () => Math.abs(P(rev[0].a) - P(rev[0].b)) <= Number(f.disc) || `${rev[0].a} vs ${rev[0].b}`, `r4|film-revenue|${f.slug}`);
  } }

// ═══════════════════════════ ROUND 5 (2026-10-10) — how the database really runs each query ═══════════════════════════
// The planner is asked how it WOULD run each query shape the 14 files make (EXPLAIN without ANALYZE runs
// nothing), with real French House values. On a table big enough for it to matter, a plan that reads the
// whole table is the "unoptimized" this round hunts.
const explain = async (q) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `EXPLAIN (FORMAT JSON) ${q}` }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 160)); const j = JSON.parse(t); return j[0]["QUERY PLAN"][0].Plan; };
const nodesOf = (p, out = []) => { out.push(p); for (const c of p.Plans || []) nodesOf(c, out); return out; };
// A plan reads the whole table when it scans the table itself, OR walks a whole index with only a Filter
// and no Index Cond — that second kind still says "Index Only Scan", and on 2026-10-10 it was found that a
// Seq-Scan-only check passed `orders where total = 123.45`, which walks every row of an index to find it.
const wholeReads = (plan, table) => nodesOf(plan).filter((n) => n["Relation Name"] === table && (n["Node Type"] === "Seq Scan" || (/^Index (Only )?Scan$/.test(n["Node Type"]) && !n["Index Cond"]))).map((n) => `${n["Node Type"]}${n["Index Name"] ? ` of ${n["Index Name"]}` : ""}`);
const SIZE = Object.fromEntries((await sql(`select relname, reltuples::bigint n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r'`)).map((x) => [x.relname, Number(x.n)]));
for (const q of REC ? REC.queries.filter((x) => x.filters.length) : []) {
  const cols = q.filters; const key = `r5|plan|${q.table}|${q.op}|${cols.join(",")}`;
  await check("lib (the 14 money files, as recorded)", `${q.table} ${q.op} by ${cols.join(" + ")}: the database's planner uses an index, not a read of the whole table (${(SIZE[q.table] ?? 0).toLocaleString("en-IN")} rows)`, async () => {
    const sample = (await sql(`select ${cols.map((c) => `${c}::text as "${c}"`).join(", ")} from public.${q.table} where ${cols.includes("restaurant_id") ? `restaurant_id = '${FH}'` : "true"} and ${cols.map((c) => `${c} is not null`).join(" and ")} limit 1`))[0];
    if (!sample) return (SIZE[q.table] ?? 0) < 2000 || "no sample row to plan with";
    const where = cols.map((c) => `${c} = ${lit(sample[c])}`).join(" and ");
    const plan = await explain(`select 1 from public.${q.table} where ${where}`);
    const whole = wholeReads(plan, q.table);
    return (!whole.length || (SIZE[q.table] ?? 0) < 2000) || `reads all of ${q.table}: ${whole.join(", ")}`;
  }, key);
}
{ const known = await explain(`select 1 from public.orders where (total + 1)::int = 7`), keyed = await explain(`select 1 from public.orders where id = '${FH}'`);
  await check("scripts/sweep/t30s10/parity.mjs", "the whole-read rule really sees one: an unindexable filter on orders is flagged, a lookup by id is not", () => (wholeReads(known, "orders").length > 0 && wholeReads(keyed, "orders").length === 0) || `known ${JSON.stringify(wholeReads(known, "orders"))} · keyed ${JSON.stringify(wholeReads(keyed, "orders"))}`, "r5|plan|rule-sees-one"); }
await check("lib (the 14 money files, as recorded)", "the planner was really asked — the recording found query shapes and the biggest tables have thousands of rows", () => (REC && REC.queries.length >= 20 && (SIZE.orders || 0) > 10000) || `${REC && REC.queries.length} shapes, orders ${SIZE.orders}`, "r5|plan|asked");
// the new reviews function and the guest ratings view, planned too
{ const pr = await explain(`select * from public.reviews r where r.item_slug = 'truffle-and-wild-mushroom-pizza' and r.restaurant_id = '${FH}' order by r.created_at desc limit 20`);
  await check("lib/menu.ts", "lfh_dish_reviews' query (one dish of one restaurant, newest 20) does not read the whole reviews table", () => !wholeReads(pr, "reviews").length || (SIZE.reviews || 0) < 2000 || wholeReads(pr, "reviews").join(", "), "r5|plan|dish-reviews"); }

// migrations 415–419 are live exactly as their files say
{ const C = await sql(`select conname, convalidated v, pg_get_constraintdef(oid) d from pg_constraint where conname in ('settings_tax_rate_is_a_rate', 'orders_payment_method_is_known')`);
  const byN = Object.fromEntries(C.map((x) => [x.conname, x]));
  await check("supabase/migrations/415_a_restaurant_tax_rate_must_be_a_rate.sql", "migration 415 is live: settings_tax_rate_is_a_rate allows 0 to 0.5 and is validated", () => (byN.settings_tax_rate_is_a_rate?.v === true && /0\.5/.test(byN.settings_tax_rate_is_a_rate?.d || "")) || JSON.stringify(byN.settings_tax_rate_is_a_rate), "r5|mig|415");
  const G = await sql(`select count(*) n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('deletion_audit', 'table_merges')`);
  await check("supabase/migrations/416_the_last_seven_tables_lose_their_unused_guest_write_grants.sql", "migration 416 is live: the guest and signed-in keys hold nothing on deletion_audit or table_merges", () => Number(G[0].n) === 0 || `${G[0].n} grants`, "r5|mig|416");
  await check("supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql", "migration 417 is live: orders_payment_method_is_known lists exactly the six methods, validated", () => (byN.orders_payment_method_is_known?.v === true && ["UPI", "Cash", "Card", "Other", "Split", "On the house"].every((m) => (byN.orders_payment_method_is_known?.d || "").includes(`'${m}'`))) || JSON.stringify(byN.orders_payment_method_is_known), "r5|mig|417");
  const F = await sql(`select prosecdef, provolatile, proconfig::text cfg, pg_get_function_result(oid) res from pg_proc where proname = 'lfh_dish_reviews'`);
  await check("supabase/migrations/418_a_dish_page_learns_which_review_is_mine_not_every_device_id.sql", "migration 418 is live: lfh_dish_reviews is SECURITY DEFINER, STABLE, with a fixed search_path, and returns no device id", () => (F[0]?.prosecdef === true && F[0]?.provolatile === "s" && /search_path=public/.test(F[0]?.cfg || "") && !/device/.test(F[0]?.res || "")) || JSON.stringify(F[0]), "r5|mig|418");
  const P = await sql(`select policyname, roles::text r from pg_policies where schemaname = 'public' and tablename = 'reviews'`);
  await check("supabase/migrations/419_the_ratings_view_reads_three_review_columns_and_never_the_device.sql", "migration 419 is live: the one reviews policy is guest_reads_ratings_columns_only, for the guest and signed-in keys", () => (P.length === 1 && P[0].policyname === "guest_reads_ratings_columns_only" && /anon/.test(P[0].r) && /authenticated/.test(P[0].r)) || JSON.stringify(P), "r5|mig|419"); }

// No id here may sit inside a block a harness suite hands out — `suite(name, first, size)` in each
// scripts/t30-harness/u-*.mjs. (Round 5's first allocation started at P210501, inside u-round5b's
// P210301–P210700, and 28 numbers meant two different checks until the ledger merge noticed.)
{ const H = join(root, "scripts/t30-harness"); const blocks = [];
  for (const f of readdirSync(H).filter((x) => /^u-.*\.mjs$/.test(x))) for (const m of readFileSync(join(H, f), "utf8").matchAll(/\bsuite\("[^"]*",\s*(\d+),\s*(\d+)\)/g)) blocks.push([f, Number(m[1]), Number(m[1]) + Number(m[2]) - 1]);
  const inside = Object.values(IDS).map((v) => Number(v.slice(1))).flatMap((n) => blocks.filter(([, a, b]) => n >= a && n <= b).map(([f]) => `P${n} (${f})`));
  await check("scripts/sweep/t30s10/parity.mjs", "no id here is one a harness suite hands out (each suite's block is read from its own suite(…) line)", () => (blocks.length >= 20 && !inside.length) || (blocks.length < 20 ? `only ${blocks.length} suite blocks found — the reader is not seeing them` : `inside a harness block: ${inside.slice(0, 6).join(" · ")}`), "parity|ids-clear-of-harness"); }
await check("scripts/sweep/t30s10/parity.mjs", "every row has a PERMANENT id — none is new to parity-ids.json (a new subject is given one with --assign-ids)", () => !unassigned.length || `new: ${unassigned.join(" · ")}`, "parity|ids");
if (ARGV.includes("--assign-ids") && unassigned.length) { (await import("node:fs")).writeFileSync(IDFILE, JSON.stringify(IDS, null, 1) + "\n"); console.log(`assigned ${unassigned.length} new id(s) in parity-ids.json`); }

// ── report ───────────────────────────────────────────────────────────────────────────────────────
if (ARGV.includes("--keys")) { console.log(JSON.stringify(ROWS.map((r) => ({ key: r.key, what: r.what })))); process.exit(0); }
if (ARGV.includes("--ledger")) {
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of ROWS) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | read-only SQL on the dev database vs the real code · \`scripts/sweep/t30s10/parity.mjs\` | ${r.ok ? "✅" : r.skip ? "⏭" : "❌"} | ${esc(r.note)} |`);
} else {
  for (const r of ROWS) if (!ARGV.includes("--quiet") || !r.ok) console.log(`${r.ok ? "✅" : r.skip ? "⏭" : "❌"} ${r.id}  [${r.file}] ${r.what}${r.note ? "  → " + r.note : ""}`);
  const bad = ROWS.filter((r) => !r.ok && !r.skip).length, sk = ROWS.filter((r) => r.skip).length;
  console.log(`\n${bad ? "✗ FAIL" : "✓ PASS"} — ${ROWS.length} checks · ${ROWS.length - bad - sk} ✅ · ${bad} ❌ · ${sk} ⏭`);
}
process.exitCode = ROWS.some((r) => !r.ok && !r.skip) ? 1 : 0;
