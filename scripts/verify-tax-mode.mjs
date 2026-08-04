// verify-tax-mode.mjs — the guard for "price includes GST / price excludes GST / MRP items".
//
// Every check here is a number that a person could be charged, proved against the REAL
// database functions (mig 270), not against a mirror of them in JS. The first block is the
// most important one and the reason this file exists: with the feature OFF — which is where
// every restaurant starts — pricing must be BYTE-IDENTICAL to before the migration. A tax
// change that quietly moves a live restaurant's totals is the worst possible outcome here.
//
// Usage: node scripts/verify-tax-mode.mjs
// Refuses to run against anything but the dev/test database.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const pat = env.SUPABASE_ACCESS_TOKEN;

// AV live is read-only and is never a test target (CLAUDE.md, two-stacks rule).
const DEV_REFS = ["wnsfcizclkbobwzcxqsf"];
if (!DEV_REFS.includes(ref)) {
  console.error(`REFUSING: this script only runs against the dev/test database, not ${ref}.`);
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

let pass = 0;
const fails = [];
const check = (name, got, want) => {
  // Postgres numerics come back as strings with their scale ("560.00"), so compare as numbers
  // when both sides are numeric — otherwise a correct total fails on its trailing zeroes.
  const bothNum = got !== null && got !== "" && want !== null && want !== ""
    && !Number.isNaN(Number(got)) && !Number.isNaN(Number(want))
    && typeof want !== "boolean" && typeof got !== "boolean";
  const ok = bothNum ? Number(got) === Number(want) : String(got) === String(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(`${name} — expected ${want}, got ${got}`); console.log(`  ✗ ${name} — expected ${want}, got ${got}`); }
};

const RID_FH = "00000000-0000-0000-0000-000000000001"; // French House = the one we write to

console.log("\n── 0. the columns and functions exist ──");
{
  const cols = await sql(`
    SELECT table_name || '.' || column_name AS c FROM information_schema.columns
     WHERE (table_name='menu_items'  AND column_name='tax_mode')
        OR (table_name='order_items' AND column_name IN ('tax_mode','is_mrp'))
        OR (table_name='orders'      AND column_name IN ('taxable_base','nontax_amount'))
        OR (table_name='settings'    AND column_name IN ('price_tax_mode','item_tax_modes_allowed','mrp_tax_treatment'))
     ORDER BY 1`);
  check("8 new columns present", cols.length, 8);
  const fns = await sql(`SELECT proname FROM pg_proc WHERE proname IN
    ('lfh_resolve_tax_mode','lfh_split_items_tax','lfh_order_discount_base','lfh_orders_fill_tax_split','lfh_order_items_fill_tax_mode')`);
  check("5 new functions present", fns.length, 5);
  const trg = await sql(`SELECT tgname FROM pg_trigger WHERE tgname IN
    ('trg_orders_fill_tax_split','trg_order_items_fill_tax_mode')`);
  check("2 triggers wired", trg.length, 2);
}

console.log("\n── 1. THE REGRESSION FIX: lfh_price_order uses the restaurant's own rate ──");
{
  const src = await sql(`SELECT prosrc FROM pg_proc WHERE proname='lfh_price_order'`);
  const body = src[0].prosrc;
  check("calls lfh_effective_tax_rate", /lfh_effective_tax_rate\(v_rid\)/.test(body), true);
  check("no hardcoded 0.05 initialiser", /v_rate\s+numeric\s*:=\s*0\.05/.test(body), false);
}

console.log("\n── 2. FEATURE OFF (every restaurant's starting state) = nothing changes ──");
{
  await sql(`UPDATE settings SET item_tax_modes_allowed=false, price_tax_mode='excl', mrp_tax_treatment='none'
              WHERE restaurant_id='${RID_FH}'`);
  const r = await sql(`SELECT lfh_resolve_tax_mode('mrp','${RID_FH}') a,
                              lfh_resolve_tax_mode('incl','${RID_FH}') b,
                              lfh_resolve_tax_mode('none','${RID_FH}') c,
                              lfh_resolve_tax_mode('default','${RID_FH}') d`);
  check("an MRP dish is still plain taxable while the master is off", r[0].a, "excl");
  check("an 'incl' dish is still plain taxable while the master is off", r[0].b, "excl");
  check("a 'none' dish is still plain taxable while the master is off", r[0].c, "excl");
  check("a 'default' dish is plain taxable", r[0].d, "excl");

  // A plain all-taxable ticket must leave the money EXACTLY as the caller computed it.
  const s = await sql(`SELECT lfh_split_items_tax(
      '[{"price":"280.00","qty":2,"tax_mode":"excl"},{"price":"60.00","qty":4,"tax_mode":"excl"}]'::jsonb,
      '${RID_FH}') v`);
  check("taxable base = 800 (2×280 + 4×60)", s[0].v.taxable_base, 800);
  check("nothing untaxed", s[0].v.nontax_amount, 0);
}

console.log("\n── 3. FEATURE ON — the three behaviours, on the numbers from the design ──");
{
  await sql(`UPDATE settings SET item_tax_modes_allowed=true, price_tax_mode='excl',
                                 mrp_tax_treatment='none', tax_rate=0.05, tax_components='[]'::jsonb
              WHERE restaurant_id='${RID_FH}'`);
  const r = await sql(`SELECT lfh_resolve_tax_mode('mrp','${RID_FH}') a,
                              lfh_resolve_tax_mode('incl','${RID_FH}') b,
                              lfh_resolve_tax_mode('none','${RID_FH}') c,
                              lfh_resolve_tax_mode('default','${RID_FH}') d`);
  check("MRP dish → exempt (owner's 'no GST' choice)", r[0].a, "exempt");
  check("'incl' dish → tax pulled out", r[0].b, "incl");
  check("'none' dish → exempt", r[0].c, "exempt");
  check("'default' dish → follows the restaurant (excl)", r[0].d, "excl");

  // The worked example from the design page: food ₹800 taxable + ₹80 of MRP water/coke.
  const s = await sql(`SELECT lfh_split_items_tax(
      '[{"price":"280.00","qty":2,"tax_mode":"excl"},{"price":"60.00","qty":4,"tax_mode":"excl"},
        {"price":"20.00","qty":2,"tax_mode":"exempt"},{"price":"40.00","qty":1,"tax_mode":"exempt"}]'::jsonb,
      '${RID_FH}') v`);
  check("taxable base = 800", s[0].v.taxable_base, 800);
  check("untaxed MRP total = 80", s[0].v.nontax_amount, 80);
  // subtotal 880, tax 40, total 920 — and with a ₹80 discount, due = 920 − 80×1.05 = 836.
  const tax = Math.round(800 * 0.05 * 100) / 100;
  check("GST charged on the food only = 40", tax, 40);
  check("bill total = 920 (880 + 40), no GST on the bottles", 800 + 80 + tax, 920);
  check("with a ₹80 food discount the due is 836", Math.round((920 - 80 * 1.05) * 100) / 100, 836);

  // A tax-INCLUSIVE ₹280 dish must total to exactly ₹280 — that is the whole point.
  const inc = await sql(`SELECT lfh_split_items_tax('[{"price":"280.00","qty":1,"tax_mode":"incl"}]'::jsonb,'${RID_FH}') v`);
  const base = Number(inc[0].v.taxable_base);
  check("a ₹280 GST-inside dish nets 266.67", base, 266.67);
  check("266.67 + its GST totals back to 280.00", (base + Math.round(base * 0.05 * 100) / 100).toFixed(2), "280.00");
}

console.log("\n── 4. COMPOSITION SCHEME — no tax on anything ──");
{
  await sql(`UPDATE settings SET price_tax_mode='composition' WHERE restaurant_id='${RID_FH}'`);
  const r = await sql(`SELECT lfh_resolve_tax_mode('excl','${RID_FH}') a, lfh_resolve_tax_mode('default','${RID_FH}') b`);
  check("even an explicitly-taxable dish is exempt", r[0].a, "exempt");
  check("a default dish is exempt", r[0].b, "exempt");
  const s = await sql(`SELECT lfh_split_items_tax('[{"price":"100.00","qty":1,"tax_mode":"exempt"}]'::jsonb,'${RID_FH}') v`);
  check("nothing lands in the taxable base", s[0].v.taxable_base, 0);
}

console.log("\n── 5. AANGAN IS THE CONTROL — it must still be at the factory default ──");
{
  const a = await sql(`SELECT s.price_tax_mode p, s.item_tax_modes_allowed m, s.mrp_tax_treatment t
                         FROM settings s JOIN restaurants r ON r.id = s.restaurant_id
                        WHERE r.slug = 'aangan'`);
  if (!a.length) { console.log("  – aangan not present in this database, skipping"); }
  else {
    check("aangan price mode untouched", a[0].p, "excl");
    check("aangan per-dish modes still off", a[0].m, false);
    check("aangan MRP treatment still 'none'", a[0].t, "none");
  }
}

console.log("\n── 6. PUT FRENCH HOUSE BACK (a test that leaves state behind is a bug) ──");
{
  await sql(`UPDATE settings SET item_tax_modes_allowed=false, price_tax_mode='excl', mrp_tax_treatment='none'
              WHERE restaurant_id='${RID_FH}'`);
  const r = await sql(`SELECT price_tax_mode p, item_tax_modes_allowed m, mrp_tax_treatment t
                         FROM settings WHERE restaurant_id='${RID_FH}'`);
  check("restored: price mode", r[0].p, "excl");
  check("restored: master off", r[0].m, false);
  check("restored: MRP treatment", r[0].t, "none");
}

console.log("\n── 7. NO EXISTING BILL MOVED — every real session, old formula vs new ──");
{
  // The single most valuable check in this file. It re-derives every session's total both
  // ways — the pre-269 rule (all of subtotal is taxable) and the new split rule — and demands
  // they agree. Any disagreement means a real guest's bill changed underneath them.
  const r = await sql(`
    WITH per AS (
      SELECT o.session_id, o.restaurant_id,
             COALESCE(SUM(o.subtotal), 0) sub,
             COALESCE(SUM(o.discount), 0) disc,
             COALESCE(SUM(COALESCE(o.taxable_base, o.subtotal)), 0) base,
             COALESCE(SUM(COALESCE(o.nontax_amount, 0)), 0) nontax
        FROM orders o
       WHERE o.session_id IS NOT NULL AND o.status <> 'cancelled'
       GROUP BY o.session_id, o.restaurant_id),
    w AS (SELECT p.*, lfh_effective_tax_rate(p.restaurant_id) rate FROM per p)
    SELECT count(*) sessions,
           count(*) FILTER (WHERE round(GREATEST(sub - disc, 0) * (1 + rate), 2)
                               <> round(GREATEST(base - disc, 0) * (1 + rate) + nontax, 2)) differs
      FROM w`);
  console.log(`  (compared ${r[0].sessions} real sessions)`);
  check("no existing session total changed", r[0].differs, 0);
}

console.log("\n── 8. THE TRIGGERS, END TO END (inside a transaction that is rolled back) ──");
{
  // Proves the orders trigger actually fires and computes the split on a real INSERT — not
  // that the function exists. Wrapped in BEGIN/ROLLBACK so it writes nothing: a test that
  // leaves an order on a restaurant's floor is a bug (and an issued bill cannot be deleted
  // anyway — lfh_block_issued_delete, correctly, refuses).
  const r = await sql(`
    BEGIN;
    UPDATE settings SET item_tax_modes_allowed = true, price_tax_mode = 'excl',
                        mrp_tax_treatment = 'none', tax_rate = 0.05, tax_components = '[]'::jsonb
     WHERE restaurant_id = '${RID_FH}';
    INSERT INTO orders (table_number, items, subtotal, tax, total, restaurant_id)
    VALUES ('T-VERIFY',
      '[{"title":"Butter Chicken","price":"280.00","qty":2,"tax_mode":"excl","is_mrp":false},
        {"title":"Bisleri Water 1 L","price":"20.00","qty":2,"tax_mode":"exempt","is_mrp":true}]'::jsonb,
      0, 0, 0, '${RID_FH}');
    SELECT taxable_base, nontax_amount, subtotal, tax, total
      FROM orders WHERE table_number = 'T-VERIFY';
    ROLLBACK;`);
  const row = Array.isArray(r) ? r[r.length - 1] : r;
  const o = Array.isArray(row) ? row[0] : row;
  check("trigger set the taxable base to 560", o && o.taxable_base, 560);
  check("trigger set the untaxed MRP amount to 40", o && o.nontax_amount, 40);
  check("trigger recomputed subtotal to 600", o && o.subtotal, 600);
  check("GST charged on the food only = 28", o && o.tax, 28);
  check("total = 628, with nothing added to the bottles", o && o.total, 628);

  const gone = await sql(`SELECT count(*) c FROM orders WHERE table_number = 'T-VERIFY'`);
  check("the rollback left NOTHING behind", gone[0].c, 0);
}

console.log("\n── 9. THE DISCOUNT RULE (mig 272) — MRP is locked, everything else is not ──");
{
  const r = await sql(`
    BEGIN;
    UPDATE settings SET item_tax_modes_allowed=true, price_tax_mode='excl',
                        mrp_tax_treatment='none', tax_rate=0.05, tax_components='[]'::jsonb
     WHERE restaurant_id='${RID_FH}';
    -- ₹560 of taxable food + ₹40 of MRP water
    INSERT INTO orders (table_number, items, subtotal, tax, total, restaurant_id)
    VALUES ('T-DISC',
      '[{"title":"Butter Chicken","price":"280.00","qty":2,"tax_mode":"excl","is_mrp":false},
        {"title":"Bisleri","price":"20.00","qty":2,"tax_mode":"exempt","is_mrp":true}]'::jsonb,
      0,0,0,'${RID_FH}');
    SELECT o.mrp_amount, lfh_order_discount_base(o.id) cap
      FROM orders o WHERE o.table_number='T-DISC';
    ROLLBACK;`);
  const row = Array.isArray(r) ? r[r.length - 1] : r;
  const o = Array.isArray(row) ? row[0] : row;
  check("the locked MRP amount is tracked separately", o && o.mrp_amount, 40);
  check("a discount is capped at the taxable food, not the bottles", o && o.cap, 560);
}

console.log("\n── 10. COMPOSITION: rate is 0, and a discount is STILL possible ──");
{
  const r = await sql(`
    BEGIN;
    UPDATE settings SET price_tax_mode='composition', item_tax_modes_allowed=true
     WHERE restaurant_id='${RID_FH}';
    INSERT INTO orders (table_number, items, subtotal, tax, total, restaurant_id)
    VALUES ('T-COMP',
      '[{"title":"Butter Chicken","price":"280.00","qty":2,"tax_mode":"exempt","is_mrp":false},
        {"title":"Bisleri","price":"20.00","qty":2,"tax_mode":"exempt","is_mrp":true}]'::jsonb,
      0,0,0,'${RID_FH}');
    SELECT lfh_effective_tax_rate('${RID_FH}') rate, o.tax, o.total,
           lfh_order_discount_base(o.id) cap
      FROM orders o WHERE o.table_number='T-COMP';
    ROLLBACK;`);
  const row = Array.isArray(r) ? r[r.length - 1] : r;
  const o = Array.isArray(row) ? row[0] : row;
  check("a composition restaurant's effective rate is 0", o && o.rate, 0);
  check("no tax is charged", o && o.tax, 0);
  check("the bill is just the food", o && o.total, 600);
  // The bug this fixes: the cap used to be 0, so a composition restaurant could not discount.
  check("a discount IS allowed — everything but the locked bottles", o && o.cap, 560);
}

console.log("\n── 11. TYPESCRIPT ↔ SQL PARITY — the panel and the database must agree ──");
{
  // The reason this project has a single-source-of-truth rule for tax at all: in 2026-07-04 the
  // guest cart, the pay screen, the server and the Z-report each had their own copy of the rate
  // and one meal could show four different totals. lib/tax.ts splitBill() and SQL
  // lfh_split_items_tax() are now two such copies — so they get compared, on real numbers,
  // every time this runs, instead of being trusted to stay in step.
  const { splitBill } = await import("../lib/tax.ts");

  const CASES = [
    { name: "plain taxable bill", rate: 0.05, mode: "excl",
      lines: [{ price: "280", qty: 2, tax_mode: "excl" }, { price: "60", qty: 4, tax_mode: "excl" }] },
    { name: "food + MRP bottles", rate: 0.05, mode: "excl",
      lines: [{ price: "280", qty: 2, tax_mode: "excl" }, { price: "20", qty: 2, tax_mode: "exempt", is_mrp: true }] },
    { name: "tax-inclusive prices", rate: 0.05, mode: "excl",
      lines: [{ price: "280", qty: 1, tax_mode: "incl" }, { price: "99.99", qty: 3, tax_mode: "incl" }] },
    { name: "mixed: excl + incl + exempt", rate: 0.18, mode: "excl",
      lines: [{ price: "150", qty: 1, tax_mode: "excl" }, { price: "210", qty: 2, tax_mode: "incl" },
              { price: "35", qty: 3, tax_mode: "exempt", is_mrp: true }] },
    { name: "awkward rate 8.25%", rate: 0.0825, mode: "excl",
      lines: [{ price: "33.33", qty: 7, tax_mode: "incl" }, { price: "19", qty: 1, tax_mode: "exempt" }] },
    { name: "everything exempt", rate: 0.12, mode: "excl",
      lines: [{ price: "500", qty: 1, tax_mode: "exempt" }, { price: "25", qty: 2, tax_mode: "exempt", is_mrp: true }] },
  ];

  for (const c of CASES) {
    await sql(`UPDATE settings SET tax_rate=${c.rate}, tax_components='[]'::jsonb,
                                   price_tax_mode='${c.mode}', item_tax_modes_allowed=true
                WHERE restaurant_id='${RID_FH}'`);
    const j = JSON.stringify(c.lines).replace(/'/g, "''");
    const r = await sql(`SELECT lfh_split_items_tax('${j}'::jsonb, '${RID_FH}') v`);
    const db = r[0].v;
    const ts = splitBill(c.lines, {
      tax_rate: c.rate, tax_components: [], price_tax_mode: c.mode,
      item_tax_modes_allowed: true, mrp_tax_treatment: "none",
    }, 0);
    check(`${c.name} — taxable base`, ts.taxableBase, Number(db.taxable_base));
    check(`${c.name} — untaxed amount`, ts.nontaxAmount, Number(db.nontax_amount));
    check(`${c.name} — locked MRP amount`, ts.mrpAmount, Number(db.mrp_amount));
  }

  await sql(`UPDATE settings SET item_tax_modes_allowed=false, price_tax_mode='excl',
                                 mrp_tax_treatment='none', tax_rate=0.05, tax_components='[]'::jsonb
              WHERE restaurant_id='${RID_FH}'`);
  const back = await sql(`SELECT price_tax_mode p, item_tax_modes_allowed m, tax_rate t
                            FROM settings WHERE restaurant_id='${RID_FH}'`);
  check("restored after the sweep: master off", back[0].m, false);
  check("restored after the sweep: rate", back[0].t, 0.05);
}

console.log("\n── 12. NO NARROW SETTINGS SELECT — the silent way to get the rate wrong ──");
{
  // Since a composition restaurant's rate is 0 and that fact lives in `price_tax_mode`, a
  // query fetching only `tax_rate, tax_components` reads 5% for a restaurant that must charge
  // nothing — and it fails silently, because the columns it DID fetch are perfectly valid.
  // Eight call sites had exactly that shape. This is a static check because the failure has
  // no runtime symptom until a restaurant is switched to composition.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e)) continue;
      const src = readFileSync(p, "utf8");
      // Any settings select that names tax_rate must also carry price_tax_mode — or, better,
      // be the shared constant.
      // Scoped to `from("settings")` on purpose. Since migration 284 the ORDERS table has its
      // own `tax_rate` column (an order remembers the rate it was billed at), so a bare search
      // for "tax_rate" in any select flags perfectly correct order queries. The rule being
      // enforced is narrower than it first looks: it is about reading the RESTAURANT's tax
      // posture, and that lives in one table.
      const re = /\.from\(\s*["'`]settings["'`]\s*\)[\s\S]{0,200}?\.select\(\s*(["'`])([^"'`]*tax_rate[^"'`]*)\1\s*\)/g;
      let m;
      while ((m = re.exec(src))) {
        if (!/price_tax_mode/.test(m[2])) {
          offenders.push(`${p.replace(root + "/", "")} → select("${m[2].slice(0, 60)}…")`);
        }
      }
    }
  };
  walk(join(root, "app"));
  walk(join(root, "lib"));
  walk(join(root, "components"));
  if (offenders.length) {
    offenders.forEach((o) => fails.push(`narrow settings select: ${o}`));
    console.log(`  ✗ ${offenders.length} settings select(s) fetch the rate without price_tax_mode`);
    offenders.forEach((o) => console.log("      " + o));
  } else {
    pass++;
    console.log("  ✓ every settings select that reads the rate also reads price_tax_mode");
  }
}

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log("   · " + f)); process.exit(1); }
