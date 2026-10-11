// verify-parcels-in-gst.mjs — a counter parcel is in the GST reports, with the tax it was really charged.
//
// WHY (owner, 2026-10-11: "do parcel one"). A counter parcel is a sale the restaurant itself owes GST on,
// but it lives in aggregator_orders, which neither GST report read — and its row kept only `total`, so
// the tax inside it was on no record at all. Mig 421 + this change:
//   1. both doors that make a parcel (manager QO/P, waiter tablet) SAVE the split they priced it with
//      (lib/tax.ts parcelTaxColumns of the splitBill that set `total`) — tax_basis 'at_sale';
//   2. older parcels were backfilled ONLY where their own lines reproduce their total to the paisa
//      ('repriced'); the rest are 'none_recorded' (saved without tax, before 2026-08-02) or 'unmatched',
//      and are NAMED with their value in every report, never guessed and never silently dropped;
//   3. the owner's Tax / GST report folds the known ones into its periods with ONE function
//      (lib/taxFiling withParcels) — so tiles, split, chart and filing table agree; the manager's GST
//      report and the compiled statement ("GST TO FILE") count them too; the Sales / Day figures stay
//      dine-in and SAY what the Tax report adds;
//   4. basis = the dine-in figure's: paid, not cancelled, by the day it was made; Zomato / Swiggy never
//      (the app pays that GST, CGST §9(5)).
//
//   node scripts/verify-parcels-in-gst.mjs          static: repo files only (part of verify:static)
//   node scripts/verify-parcels-in-gst.mjs --db     + the same rules against the DEV database, read-only
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "");
let passed = 0, failed = 0;
const check = (ok, good, bad) => { if (ok) { passed++; console.log(`  ✓ ${good}`); } else { failed++; console.log(`  ✗ ${bad}`); } };
console.log("\nPARCELS IN GST · the tax a parcel was charged is recorded, and every GST report counts it\n");

// ── the migration ──────────────────────────────────────────────────────────────────────────────
const mig = readdirSync(join(root, "supabase/migrations")).find((f) => /^421_.*parcel/.test(f));
check(!!mig, `migration 421 is in the one migrations folder (${mig})`, "migration 421 is missing");
const M = mig ? code(read(`supabase/migrations/${mig}`)) : "";
check(["subtotal", "discount", "taxable_base", "nontax_amount", "mrp_amount", "tax_rate", "tax", "tax_basis"].every((c) => new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(M)),
  "a parcel row can carry the same split a dine-in order does (eight additive columns)", "a split column is missing from mig 421");
check(/tax_basis IN \('at_sale', 'repriced', 'none_recorded', 'unmatched'\)/.test(M) && /WHEN tax_basis IN \('at_sale', 'repriced'\)\s+THEN tax IS NOT NULL AND tax_rate IS NOT NULL/.test(M) && /ELSE tax IS NULL END/.test(M),
  "a known basis must carry its figures and an unknown one may carry none (no half-written or invented tax)", "the basis / figures constraints are gone or loosened");
check(/a\.source = 'parcel'/.test(M) && /a\.paid = true/.test(M) && /a\.status NOT IN \('cancelled', 'rejected'\)/.test(M),
  "the report counts paid, not-cancelled COUNTER PARCELS only — the dine-in basis, and never a Zomato / Swiggy row", "lfh_owner_parcel_tax's basis changed");
check(/SUM\(a\.tax\) FILTER \(WHERE a\.tax_basis IN \('at_sale', 'repriced'\)\)/.test(M) && /AS untaxed_parcels/.test(M) && /AS untaxed_total/.test(M),
  "only KNOWN tax is summed, and parcels without a tax record are counted with their value (never dropped)", "the known/untaxed split in lfh_owner_parcel_tax changed");
check(/\(p_restaurant_id IS NOT NULL OR p_ids IS NOT NULL\)/.test(M), "a call naming no restaurant answers nothing", "an unscoped call is no longer refused");
check(/REVOKE ALL ON FUNCTION public\.lfh_owner_parcel_tax\([^)]*\) FROM PUBLIC, anon, authenticated;/.test(M) && /GRANT EXECUTE ON FUNCTION public\.lfh_owner_parcel_tax\([^)]*\) TO service_role;/.test(M),
  "only the server (service_role) may call it", "the REVOKE/GRANT pair is missing");

// ── the two doors save the split they priced with ──────────────────────────────────────────────
const TX = read("lib/tax.ts");
check(/export function parcelTaxColumns\(sp: BillSplit, basis: "at_sale" \| "repriced" = "at_sale"\)/.test(TX)
  && ["subtotal: sp.subtotal", "discount: sp.discount", "taxable_base: sp.taxableBase", "nontax_amount: sp.nontaxAmount", "mrp_amount: sp.mrpAmount", "tax_rate: sp.rate", "tax: sp.tax", "tax_basis: basis"].every((x) => TX.includes(x)),
  "lib/tax.ts parcelTaxColumns writes every figure of the split, from the split itself", "parcelTaxColumns lost a figure or its signature");
const E = code(read("app/api/editor/[...path]/route.ts")), T = code(read("app/api/tablet/[...path]/route.ts"));
check(/const parcelSplit = splitBill\(picked, parcelSet, parcelDisc\);\s*total = parcelSplit\.total;/.test(E) && /\.\.\.parcelTaxColumns\(parcelSplit\)/.test(E),
  "the manager's parcel door saves the SAME split that set its total", "the manager door no longer saves its parcel split");
check(/const parcelSplit = splitBill\(picked, parcelSet, 0\);\s*total = parcelSplit\.total;/.test(T) && /\.\.\.parcelTaxColumns\(parcelSplit\)/.test(T),
  "the waiter tablet's parcel door saves the SAME split that set its total (twin)", "the tablet door no longer saves its parcel split");

// ── the backfill never invents ─────────────────────────────────────────────────────────────────
const B = read("scripts/backfill-parcel-tax.mjs");
check(/refuseUnlessDevTestDb\(/.test(B) && /tax_basis=is\.null/.test(B) && /Math\.abs\(sp\.total - stored\) < 0\.005/.test(B) && !/"total"\s*:|total:\s*sp\.total/.test(B.replace(/\/\/.*$/gm, "")),
  "the backfill writes a split only where it reproduces the stored total, only on unclassified rows, never `total`, dev/test only", "the backfill's rules changed");

// ── the reports ────────────────────────────────────────────────────────────────────────────────
const R = code(read("app/api/owner/reports/route.ts"));
check(/sb\.rpc\("lfh_owner_parcel_tax"/.test(R) && /parcelRows: parcelRowsMain \?\? undefined, drillParcelRows: drillParcelRows \?\? undefined/.test(R),
  "every money payload carries the parcels per period (main and auto-drill) and a summary", "the reports route no longer sends per-period parcels");
check(/const cacheKey = `reports:v8:/.test(R) && /moneyType \? moneyFingerprint\(\)/.test(R) && /pc:unread:\$\{Date\.now\(\)\}/.test(R),
  "the money snapshot key moved (v8) and its change-detector sees parcels — a failed look recomputes", "the cache key or the parcel-aware fingerprint is gone");
check(/partialKeys\.push\("parcels"\)/.test(R), "a failed parcel read is said (partial 'parcels'), never a confident zero", "a failed parcel read is no longer reported");
check(!/type === "tax"\)? ?return out|if \(type !== "tax"\) return out/.test(R), "there is NO second fold-in on the server — the Tax screen's withParcels() is the only one", "a server-side fold-in for type=tax came back (two copies of one rule)");
const TF = read("lib/taxFiling.ts");
check(/export function withParcels/.test(TF) && /export function totalsOf/.test(TF) && !/^\s*import\s/m.test(TF), "the one fold-in lives in lib/taxFiling.ts, which still imports nothing", "withParcels/totalsOf moved, or taxFiling gained an import");
const P = code(read("app/owner/reports/page.tsx"));
check(/if \(bk === "tax" && \(data\.parcelRows\?\.length \|\| data\.drillParcelRows\?\.length\)\)/.test(P) && /withParcels\(\(data\.rows \?\? \[\]\) as MoneyRow\[\], data\.parcelRows\)/.test(P) && /totals: totalsOf\(/.test(P),
  "the Tax screen folds parcels into its rows and re-sums its totals from them (the screen fetches type=sales — found by its screenshot)", "the Tax screen no longer folds parcels in");
check((P.match(/sub=\{parcelGstHint\(data\.parcels\)/g) || []).length === 2 && /parcelGstHint\(money\?\.data\?\.parcels\)/.test(P),
  "the dine-in GST tiles that open the Tax report (Sales, Day summary, hub) say what it adds", "a dine-in GST tile lost its parcel note");
check(/older parcel/.test(read("app/owner/reports/page.tsx")) && /couldn&apos;t read your counter parcels/.test(read("app/owner/reports/page.tsx")),
  "the Tax screen names parcels saved without tax, and says when parcels couldn't be read", "the Tax screen's parcel notes are gone");
const G = code(read("app/api/editor/[...path]/route.ts"));
check(/from\("aggregator_orders"\)\.select\("taxable_base,nontax_amount,discount,tax_rate,tax,total,tax_basis,created_at"\)\s*\.eq\("restaurant_id", rid\)\.eq\("source", "parcel"\)\.eq\("paid", true\)\.not\("status", "in", "\(cancelled,rejected\)"\)/.test(G)
  && /if \(pr\.tax_basis !== "at_sale" && pr\.tax_basis !== "repriced"\) \{ untaxedParcels\+\+/.test(G),
  "the manager's GST report counts paid, not-cancelled parcels with a known tax, and names the rest", "the manager's GST report no longer counts parcels the same way");
const DOC = read("components/owner/ownerReportDoc.ts");
check(/= GST TO FILE — dine-in \+ counter parcels/.test(DOC) && /Older parcels saved without their tax/.test(DOC) && /parcels: m && !m\.error \?/.test(read("lib/ownerReportGather.ts")),
  "the compiled statement prints parcels and the GST to file, from the same payload", "the statement lost its parcel lines");
{ const { gstToFile } = await import(pathToFileURL(join(root, "components/owner/ownerReportDoc.ts")).href);
  const { withParcels, totalsOf } = await import(pathToFileURL(join(root, "lib/taxFiling.ts")).href);
  const rows = [{ bucket: "2026-10-01T18:30:00.000Z", orders: 2, paidOrders: 2, subtotal: 200, tax: 10, discount: 0, revenue: 210 }];
  const merged = withParcels(rows, [{ bucket: "2026-10-01T18:30:00Z", parcels: 1, subtotal: 298, discount: 0, tax: 14.9, total: 312.9 }, { bucket: "2026-10-02T18:30:00Z", parcels: 1, subtotal: 100, discount: 10, tax: 4.5, total: 94.5 }, { bucket: "2026-10-03T18:30:00Z", parcels: 0, subtotal: 0, discount: 0, tax: 0, total: 0 }]);
  const tot = totalsOf({ orders: 2, paidOrders: 2, subtotal: 200, tax: 10, discount: 0, revenue: 210, cancelledOrders: 1 }, merged);
  check(merged.length === 2 && merged[0].tax === 24.9 && merged[0].paidOrders === 3 && merged[1].tax === 4.5 && rows[0].tax === 10 && tot.tax === 29.4 && tot.cancelledOrders === 1 && tot.revenue === 617.4,
    "withParcels adds a parcel to its own period (same instant, any ISO spelling), makes a period that had none, skips an empty one, never mutates the input; totals re-sum from the rows", `withParcels/totalsOf: ${JSON.stringify(merged)} · ${JSON.stringify(tot)}`);
  check(gstToFile({ taxTotal: 10, parcels: { tax: 14.9 } }) === 24.9 && gstToFile({ taxTotal: null, parcels: { tax: 1 } }) === null && gstToFile({ taxTotal: 10, parcels: null }) === 10,
    "the statement's GST to file = dine-in GST + parcel GST (unknown dine-in → unknown)", "gstToFile's arithmetic changed"); }

// ── --db: the same rules against the dev database (read-only) ─────────────────────────────────
if (process.argv.includes("--db")) {
  const { refuseUnlessDevTestDb } = await import("./sweep/devStacks.mjs");
  const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this guard reads the database");
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const sql = async (q) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t); };
  const { splitBill, TAX_SETTINGS_COLUMNS } = await import(pathToFileURL(join(root, "lib/tax.ts")).href);
  const cols = String(TAX_SETTINGS_COLUMNS).split(",").map((c) => c.trim()).filter(Boolean);
  const parcels = await sql(`select a.id, a.total::float8 total, a.items, coalesce((a.payload->>'discount')::float8, 0) disc, a.tax_basis, a.subtotal::float8 subtotal, a.discount::float8 discount, a.taxable_base::float8 taxable_base, a.nontax_amount::float8 nontax_amount, a.tax_rate::float8 tax_rate, a.tax::float8 tax, row_to_json(s.*) st
    from aggregator_orders a join settings s on s.restaurant_id = a.restaurant_id where a.source = 'parcel'`);
  check(parcels.length > 0 && parcels.every((p) => p.tax_basis !== null), `every one of the ${parcels.length} parcels on dev has been classified (none left unexamined)`, `${parcels.filter((p) => p.tax_basis === null).length} parcel(s) have no tax_basis — run scripts/backfill-parcel-tax.mjs`);
  const known = parcels.filter((p) => p.tax_basis === "at_sale" || p.tax_basis === "repriced");
  const off = known.filter((p) => { const st = Object.fromEntries(cols.map((c) => [c, p.st[c]])); const sp = splitBill(p.items || [], st, p.disc);
    return [["total", sp.total, p.total], ["tax", sp.tax, p.tax], ["taxable_base", sp.taxableBase, p.taxable_base], ["subtotal", sp.subtotal, p.subtotal], ["discount", sp.discount, p.discount], ["nontax_amount", sp.nontaxAmount, p.nontax_amount]].some(([, a, b]) => Math.abs(a - b) > 0.005); });
  check(known.length > 0 && !off.length, `every parcel with a known tax (${known.length}) carries exactly the split lib/tax.ts gives its own lines — total, tax, taxable, subtotal, discount, exempt`, `${off.length} known parcel(s) disagree with their own lines: ${off.slice(0, 3).map((p) => p.id).join(", ")}`);
  const want = await sql(`select a.restaurant_id id, count(*) filter (where a.tax_basis in ('at_sale','repriced')) n, coalesce(sum(a.tax) filter (where a.tax_basis in ('at_sale','repriced')), 0)::numeric(14,2)::text tax,
      count(*) filter (where a.tax_basis is distinct from 'at_sale' and a.tax_basis is distinct from 'repriced') un, coalesce(sum(a.total) filter (where a.tax_basis is distinct from 'at_sale' and a.tax_basis is distinct from 'repriced'), 0)::numeric(14,2)::text untot
    from aggregator_orders a where a.source = 'parcel' and a.paid = true and a.status not in ('cancelled','rejected') and a.created_at >= now() - interval '800 days' group by 1`);
  let bad = [];
  for (const w of want) { const g = (await sql(`select coalesce(sum(parcels),0)::int n, coalesce(sum(tax),0)::numeric(14,2)::text tax, coalesce(sum(untaxed_parcels),0)::int un, coalesce(sum(untaxed_total),0)::numeric(14,2)::text untot from lfh_owner_parcel_tax('${w.id}', now() - interval '800 days', now(), 'month')`))[0];
    if (g.n !== Number(w.n) || g.tax !== w.tax || g.un !== Number(w.un) || g.untot !== w.untot) bad.push(`${w.id}: ${JSON.stringify(g)} vs ${JSON.stringify(w)}`); }
  check(want.length > 0 && !bad.length, `lfh_owner_parcel_tax equals an independent sum for every restaurant with paid parcels (${want.length})`, `differs: ${bad.slice(0, 2).join(" · ")}`);
  check(Number((await sql(`select count(*) n from lfh_owner_parcel_tax(null, now() - interval '800 days', now(), 'month', null)`))[0].n) === 0, "a call naming no restaurant answers nothing", "an unscoped call answered rows");
  const priv = Object.fromEntries((await sql(`select r.rolname, has_function_privilege(r.rolname, 'public.lfh_owner_parcel_tax(uuid,timestamptz,timestamptz,text,uuid[])', 'execute') can from pg_roles r where r.rolname in ('anon','authenticated','service_role')`)).map((x) => [x.rolname, x.can]));
  check(priv.anon === false && priv.authenticated === false && priv.service_role === true, "in the live catalog only service_role may call it", `privileges: ${JSON.stringify(priv)}`);
  check(Number((await sql(`select count(*) n from aggregator_orders where source <> 'parcel' and tax_basis is not null`))[0].n) === 0, "no Zomato / Swiggy / website row carries a parcel tax basis (their GST is the app's)", "a platform row was given a tax basis");
}

console.log(`\n${failed ? "✗ FAIL" : "✓ PASS"} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
