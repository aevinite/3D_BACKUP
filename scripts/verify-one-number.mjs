// verify-one-number.mjs — ONE revenue number, checked against the real database.
//
// WHY THIS EXISTS. The owner, 2026-08-12: "everywhere should be the same data … in some areas of
// report there is another number and in some area another number." He was right, and the cause was
// always the same shape: each money surface wrote the net-revenue arithmetic out for itself.
//
//   revenue = total − discount × (1 + rate)
//
// Every copy of that line is a chance to pick a different `rate`. Five of them resolved the rate
// from settings as it is RIGHT NOW (`lfh_effective_tax_rate`), while the printed bill, the Z-report
// and pay-in-parts use the rate the order was actually CHARGED at (`orders.tax_rate`, mig 284,
// grossed into `orders.disc_gross` by mig 301). So the owner's dish report and the waiter's tile
// could differ from the paper the guest was handed by `discount × (rate_now − rate_charged)`.
//
// Migration 310 removed the arithmetic instead of fixing each copy: `orders.net_amount` is a
// GENERATED STORED column, so the net is computed once by the database from that order's own
// numbers, and every reader just sums it. This file makes sure it STAYS that way — a new report,
// or a `CREATE OR REPLACE` from an older copy, cannot quietly reintroduce a second definition.
//
// READ-ONLY. Only SELECTs (pg_proc, pg_attribute, one COUNT). Safe to run while others work.
//
//   node scripts/verify-one-number.mjs
//   node scripts/verify-one-number.mjs --quiet    # only failures
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => console.log("\n" + m);

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// ── THE ONE WRITER ───────────────────────────────────────────────────────────────────────────
// Exactly one function is allowed to gross a discount by a rate: the trigger that fills
// orders.disc_gross at write time (mig 301). It is the only place that legitimately asks "what
// rate was this order charged at", because it is the place holding the row.
const GROSS_WRITER = "lfh_fill_disc_gross";

// ── THE ROLLUP EXCEPTION, WRITTEN DOWN SO IT IS NOT REDISCOVERED ──────────────────────────────
// The pre-aggregated tables (mig 190/201) store `gross_paid` and `disc_gross_paid` as two columns,
// so these three readers still subtract one from the other on the ROLLUP path. They agree with
// net_amount today — the fix is to make the rollup carry `net_paid`, which is the same change one
// level up and is deliberately NOT done yet. Anything NOT on this list must use net_amount.
const ROLLUP_READERS = new Set([
  "lfh_owner_overview",
  "lfh_owner_restaurant_revenue",
  "lfh_owner_payment_breakdown",
  "lfh_owner_revenue_timeseries",
  "lfh_owner_sales_report",
  "lfh_refresh_orders_daily_agg",
  "lfh_refresh_orders_report_monthly_agg",
]);

// The guest's live table bill still resolves the rate from settings AND splits MRP / non-taxable
// amounts (migs 270/272), so it needs its own pass. Named here so it shows up as work, not as a
// silent exception.
const KNOWN_TODO = new Set(["lfh_session_state"]);

// Functions that need the rate to decide a LIMIT or a TAX LINE — never to compute a net. Each one
// carries its reason, so adding a name here is a decision someone wrote down.
const RATE_FOR_LIMITS = new Map([
  ["lfh_order_discount_base",
    "how much of this order a discount may come off (MRP lock + taxable base, migs 270/272) — it asks whether tax applies at all, and returns a BASE, never a revenue"],
]);

head("orders.net_amount — the one definition");
const col = await q(`
  SELECT a.attname, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS expr, format_type(a.atttypid, a.atttypmod) AS typ
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid AND c.relname = 'orders'
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attname = 'net_amount' AND NOT a.attisdropped`);
if (!col.length) fail("orders.net_amount does not exist — migration 310 has not been applied here");
else {
  const c = col[0];
  if (c.attgenerated === "s") pass("it is GENERATED … STORED, so nothing can write it by hand or let it go stale");
  else fail(`orders.net_amount is not a stored generated column (attgenerated=${JSON.stringify(c.attgenerated)})`);
  const expr = (c.expr || "").replace(/\s+/g, " ").trim();
  if (/^\(?total - disc_gross\)?$/.test(expr)) pass(`its expression is still exactly "${expr}"`);
  else fail(`its expression changed to "${expr}" — expected "total - disc_gross"`);
  if (c.typ === "numeric") pass("it is numeric, so summing it is exact (no float drift on money)");
  else fail(`orders.net_amount is ${c.typ}, not numeric`);
}

head("nobody works the net out for themselves");
const fns = await q(`
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  ORDER BY 1`);

const grossers = fns.filter((f) => /discount\s*\*\s*\(\s*1\s*\+/i.test(f.def) && f.name !== GROSS_WRITER);
if (!grossers.length) pass(`no function grosses a discount by a rate except ${GROSS_WRITER}() (the one writer)`);
else for (const g of grossers) {
  if (ROLLUP_READERS.has(g.name)) pass(`${g.name} still does it on the ROLLUP path only — a written-down exception`);
  else fail(`${g.name}(${g.args}) computes "discount × (1 + rate)" itself — sum orders.net_amount instead`);
}

const handRolled = fns.filter((f) => /\btotal\s*-\s*(o\.)?disc_gross\b/i.test(f.def));
if (!handRolled.length) pass("no function subtracts disc_gross from total by hand — they all read net_amount");
else for (const h of handRolled) {
  if (ROLLUP_READERS.has(h.name)) pass(`${h.name} subtracts it on the rollup path only — known exception`);
  else fail(`${h.name}(${h.args}) writes "total - disc_gross" out by hand — use orders.net_amount`);
}

const rateResolvers = fns.filter((f) => /lfh_effective_tax_rate/.test(f.def) && !ROLLUP_READERS.has(f.name)
  && f.name !== GROSS_WRITER && f.name !== "lfh_effective_tax_rate");
head("who still asks settings for a tax rate (fine for TAX, never for the NET)");
for (const r of rateResolvers) {
  if (KNOWN_TODO.has(r.name)) pass(`${r.name} — known, named as the next pass (guest live bill, MRP split)`);
  else if (RATE_FOR_LIMITS.has(r.name)) pass(`${r.name} — allowed: ${RATE_FOR_LIMITS.get(r.name)}`);
  else if (/discount/i.test(r.def)) fail(`${r.name}(${r.args}) reads today's rate AND touches discount — check it is not re-deriving a net`);
  else pass(`${r.name} uses the rate for tax/pricing, not for a net`);
}

head("the printed paper and the screens agree on WHICH rate");
try {
  const doc = readFileSync(join(root, "public/panels/billdoc.js"), "utf8");
  if (/Number\(o\.tax_rate\)\s*>\s*0/.test(doc)) pass("billdoc.js still takes each order's OWN tax_rate (mig 284) — the same rate net_amount is built from");
  else fail("billdoc.js no longer reads each order's tax_rate — the paper and orders.net_amount can now disagree");
} catch { fail("public/panels/billdoc.js not found"); }

head("the stored column cannot be stale");
const drift = await q(`SELECT count(*)::int AS n FROM public.orders WHERE net_amount IS DISTINCT FROM (total - disc_gross)`);
if (drift[0].n === 0) pass(`all orders agree with the definition (0 rows out of step)`);
else fail(`${drift[0].n} orders have a net_amount that disagrees with total - disc_gross`);

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — two screens can now show different revenue`
  : "\n✓ one revenue number: computed once in the database, read the same way everywhere");
process.exit(failed ? 1 : 0);
