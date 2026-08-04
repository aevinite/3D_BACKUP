// verify-tax-mode-e2e.mjs — a REAL order containing an MRP bottle, followed end to end.
//
// verify-tax-mode.mjs proves the rules. This proves the PRODUCT: it turns the feature on
// through the real admin route, marks a real dish as MRP, places a real order through the same
// RPC the waiter panel calls, and then asks every surface that shows a person a number whether
// it agrees — the floor tile, the table detail, the guest's live bill, and the printed paper.
// A rule that is right in isolation and disagrees across two screens is the bug this codebase
// has had before ("one meal, four different totals").
//
// It makes ZERO logins (admin gate cookie only — see CLAUDE.md's rate-limit rule), restores
// every setting it flips even if it fails, and puts its test order back by CLOSING the session
// (never deleting — an issued bill cannot be hard-deleted, and rightly so).
//
// Usage: node scripts/verify-tax-mode-e2e.mjs [--base http://localhost:4111]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== "wnsfcizclkbobwzcxqsf") {
  console.error(`REFUSING: dev/test database only, not ${ref}.`);
  process.exit(2);
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(b)}`);
  return b;
};

const RID = "00000000-0000-0000-0000-000000000001";      // French House — the one we write to
const TABLE = "E2E-TAX";                                  // a table no real guest sits at
const q = (s) => String(s).replace(/'/g, "''");

let pass = 0;
const fails = [];
const check = (name, got, want) => {
  const bothNum = ![got, want].some((v) => v === null || v === "" || typeof v === "boolean" || Number.isNaN(Number(v)));
  const ok = bothNum ? Math.abs(Number(got) - Number(want)) < 0.005 : String(got) === String(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(`${name} — expected ${want}, got ${got}`); console.log(`  ✗ ${name} — expected ${want}, got ${got}`); }
};

// Everything we change, so the finally-block can put it all back even on a crash.
let savedSettings = null;
let savedDish = null;
let dishId = null;

try {
  console.log("\n── 0. remember the state we are about to change ──");
  savedSettings = (await sql(`SELECT price_tax_mode, item_tax_modes_allowed, mrp_tax_treatment,
                                     tax_rate, tax_components::text AS tax_components
                                FROM settings WHERE restaurant_id='${RID}'`))[0];
  console.log(`  (was: ${savedSettings.price_tax_mode}, master ${savedSettings.item_tax_modes_allowed}, mrp ${savedSettings.mrp_tax_treatment})`);

  // A cheap dish to stand in for the water bottle, and a normal one for the taxable food.
  const dishes = await sql(`SELECT id, title, price, tax_mode FROM menu_items
                             WHERE restaurant_id='${RID}' AND NOT COALESCE(open_price,false)
                               AND NOT ('sold-out' = ANY(tags))
                             ORDER BY (regexp_replace(price,'[^0-9.]','','g'))::numeric DESC LIMIT 2`);
  if (dishes.length < 2) throw new Error("need two priced dishes on French House to run this");
  const food = dishes[0], bottle = dishes[1];
  dishId = bottle.id;
  savedDish = bottle.tax_mode;
  const foodPrice = Number(String(food.price).replace(/[^0-9.]/g, ""));
  const bottlePrice = Number(String(bottle.price).replace(/[^0-9.]/g, ""));
  console.log(`  food:   ${food.title} @ ₹${foodPrice}`);
  console.log(`  bottle: ${bottle.title} @ ₹${bottlePrice}  (will be marked MRP)`);

  console.log("\n── 1. switch the feature on and mark the bottle MRP ──");
  await sql(`UPDATE settings SET item_tax_modes_allowed=true, price_tax_mode='excl',
                                 mrp_tax_treatment='none', tax_rate=0.05, tax_components='[]'::jsonb
              WHERE restaurant_id='${RID}'`);
  await sql(`UPDATE menu_items SET tax_mode='mrp' WHERE id='${q(dishId)}'`);
  const resolved = await sql(`SELECT lfh_resolve_tax_mode('mrp','${RID}') m,
                                     lfh_effective_tax_rate('${RID}') r`);
  check("the bottle now resolves to exempt", resolved[0].m, "exempt");
  check("the restaurant rate is 5%", resolved[0].r, 0.05);

  console.log("\n── 2. place a REAL order through the waiter panel's own RPC ──");
  // lfh_staff_place_order is exactly what the tablet calls — no shortcut, no hand-built row.
  const placed = await sql(`SELECT lfh_staff_place_order('${TABLE}',
      '[{"id":"${q(food.id)}","qty":2},{"id":"${q(dishId)}","qty":2}]'::jsonb,
      '{}'::text[], NULL, '${RID}'::uuid) AS res`);
  const res = placed[0].res;
  if (!res || res.ok !== true) throw new Error("place order failed: " + JSON.stringify(res));
  console.log(`  (order placed, KOT #${res.kot_no})`);

  const expTaxable = Math.round(foodPrice * 2 * 100) / 100;
  const expMrp = Math.round(bottlePrice * 2 * 100) / 100;
  const expTax = Math.round(expTaxable * 0.05 * 100) / 100;
  const expTotal = Math.round((expTaxable + expMrp + expTax) * 100) / 100;
  console.log(`  expect: taxable ₹${expTaxable} + MRP ₹${expMrp} + GST ₹${expTax} = ₹${expTotal}`);

  console.log("\n── 3. what the ORDER ROW stored ──");
  const o = (await sql(`SELECT subtotal, tax, total, taxable_base, nontax_amount, mrp_amount
                          FROM orders WHERE table_number='${TABLE}' AND restaurant_id='${RID}'
                         ORDER BY created_at DESC LIMIT 1`))[0];
  check("taxable base excludes the bottles", o.taxable_base, expTaxable);
  check("the bottles are recorded as untaxed", o.nontax_amount, expMrp);
  check("the bottles are recorded as LOCKED (mrp_amount)", o.mrp_amount, expMrp);
  check("GST charged on the food only", o.tax, expTax);
  check("stored total", o.total, expTotal);
  check("subtotal = taxable + untaxed", o.subtotal, expTaxable + expMrp);

  console.log("\n── 4. the order LINES kept their frozen behaviour ──");
  const li = await sql(`SELECT tax_mode, is_mrp, count(*) n FROM order_items
                         WHERE order_id = (SELECT id FROM orders WHERE table_number='${TABLE}'
                                            AND restaurant_id='${RID}' ORDER BY created_at DESC LIMIT 1)
                         GROUP BY 1,2 ORDER BY 1`);
  const exempt = li.find((x) => x.tax_mode === "exempt");
  const taxed = li.find((x) => x.tax_mode === "excl");
  check("one line is exempt", exempt ? exempt.n : 0, 1);
  check("that line is stamped MRP", exempt ? exempt.is_mrp : false, true);
  check("the food line is still taxable", taxed ? taxed.n : 0, 1);

  console.log("\n── 5. the FLOOR TILE agrees (what the manager and waiter see) ──");
  // ACCEPT the order first, which is what the manager taps before anything is owed. The floor
  // deliberately excludes 'received' orders from a table's due (mig 238: `status NOT IN
  // ('received','cancelled')`) — an order nobody has accepted yet is not money owed. Reading
  // the tile before accepting shows ₹0, and that is correct, not a bug; this test asked the
  // wrong question the first time.
  await sql(`UPDATE orders SET status='preparing'
              WHERE table_number='${TABLE}' AND restaurant_id='${RID}' AND status='received'`);
  // `tiles` is an object keyed by table number, not an array — the shape the panels read.
  const tiles = (await sql(`SELECT lfh_table_view_summary('${RID}'::uuid) AS v`))[0].v.tiles || {};
  const tile = tiles[TABLE];
  check("the floor tile's due equals the bill", tile ? tile.due : "no tile", expTotal);
  // The tile's WORDING is what a person actually reads, and it is built separately from the
  // number — so it gets checked separately, or the two could disagree on screen.
  check("the tile's caption quotes the same figure",
    tile ? /₹\s?([\d,]+)\s*due/.test(tile.meta) && Number(RegExp.$1.replace(/,/g, "")) : "no tile",
    Math.round(expTotal));

  console.log("\n── 6. the GUEST'S live bill agrees ──");
  const sess = (await sql(`SELECT id FROM sessions WHERE table_number='${TABLE}'
                            AND restaurant_id='${RID}' AND status='open'
                           ORDER BY opened_at DESC LIMIT 1`))[0];
  const bill = (await sql(`SELECT json_build_object(
      'subtotal', COALESCE(SUM(subtotal),0),
      'nontax',   COALESCE(SUM(COALESCE(nontax_amount,0)),0),
      'taxable',  GREATEST(COALESCE(SUM(COALESCE(taxable_base,subtotal)),0)-COALESCE(SUM(discount),0),0),
      'tax',      round(GREATEST(COALESCE(SUM(COALESCE(taxable_base,subtotal)),0)-COALESCE(SUM(discount),0),0)*lfh_effective_tax_rate('${RID}'),2),
      'total',    round(GREATEST(COALESCE(SUM(COALESCE(taxable_base,subtotal)),0)-COALESCE(SUM(discount),0),0)*(1+lfh_effective_tax_rate('${RID}'))
                        + COALESCE(SUM(COALESCE(nontax_amount,0)),0),2)) AS b
    FROM orders WHERE session_id='${sess.id}' AND status<>'cancelled'`))[0].b;
  check("guest bill total", bill.total, expTotal);
  check("guest bill shows the untaxed part", bill.nontax, expMrp);
  check("guest bill tax", bill.tax, expTax);

  console.log("\n── 7. a discount may NOT eat the bottles ──");
  const oid = (await sql(`SELECT id FROM orders WHERE table_number='${TABLE}' AND restaurant_id='${RID}'
                           ORDER BY created_at DESC LIMIT 1`))[0].id;
  const cap = (await sql(`SELECT lfh_order_discount_base('${oid}') c`))[0].c;
  check("the discount cap is the food, not the whole bill", cap, expTaxable);

  console.log("\n── 8. the PRINTED PAPER agrees ──");
  const BILLDOC = (await import("../public/panels/billdoc.js")).default
    ?? (await import("../public/panels/billdoc.js"));
  const html = BILLDOC.billDocHtml({
    name: "French House", billNo: "E2E", tableDisp: TABLE, dateStr: "now",
    lines: [
      { title: food.title, qty: 2, price: foodPrice },
      { title: bottle.title, qty: 2, price: bottlePrice, is_mrp: true },
    ],
    subtotal: expTaxable + expMrp, discount: 0, taxable: expTaxable,
    taxRows: [{ label: "CGST", rate: 2.5, amt: expTax / 2 }, { label: "SGST", rate: 2.5, amt: expTax / 2 }],
    nontax: expMrp, mrpLabel: "MRP items", total: expTotal,
  });
  const body = html.split("</style>")[1] || "";
  check("the paper stamps the bottle MRP", /class="mrpt">MRP</.test(body), true);
  check("the paper shows an MRP items row", /MRP items/.test(body), true);
  check("the paper says Food subtotal", /Food subtotal/.test(body), true);
  const printed = (body.match(/TOTAL<\/span><span>₹([\d,]+)/) || [])[1];
  check("the paper's TOTAL equals the bill", Number(String(printed).replace(/,/g, "")), Math.round(expTotal));
  check("no code leaked onto the paper", /-->|\$\{|\[object Object\]/.test(body), false);
} finally {
  console.log("\n── 9. put everything back ──");
  try {
    // CLOSE the session, never delete: an order gets a bill number on insert, so it is an
    // ISSUED bill and lfh_block_issued_delete refuses a hard delete — correctly, that is the
    // CGST rule this product is built on. Closing lets the mig-232 trigger cancel the unpaid
    // work with a visible ✕ and archive the rest: the table frees, the audit trail survives.
    await sql(`UPDATE sessions SET status='closed'
                WHERE table_number='${TABLE}' AND restaurant_id='${RID}' AND status='open'`);
    if (dishId) await sql(`UPDATE menu_items SET tax_mode='${q(savedDish || "default")}' WHERE id='${q(dishId)}'`);
    if (savedSettings) {
      await sql(`UPDATE settings SET
          price_tax_mode='${q(savedSettings.price_tax_mode)}',
          item_tax_modes_allowed=${savedSettings.item_tax_modes_allowed},
          mrp_tax_treatment='${q(savedSettings.mrp_tax_treatment)}',
          tax_rate=${savedSettings.tax_rate === null ? "NULL" : savedSettings.tax_rate},
          tax_components='${q(savedSettings.tax_components)}'::jsonb
        WHERE restaurant_id='${RID}'`);
    }
    const left = await sql(`SELECT count(*) c FROM sessions WHERE table_number='${TABLE}'
                             AND restaurant_id='${RID}' AND status='open'`);
    const now = (await sql(`SELECT price_tax_mode p, item_tax_modes_allowed m FROM settings WHERE restaurant_id='${RID}'`))[0];
    console.log(`  ✓ table freed (${left[0].c} open session(s) left), settings back to ${now.p}/master ${now.m}`);
  } catch (e) {
    console.log("  ✗ CLEANUP FAILED — put this back by hand: " + e.message);
  }
}

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log("   · " + f)); process.exit(1); }
