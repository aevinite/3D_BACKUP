// Round 4 (owner, 2026-10-10: "do all the things you have listed") — items 10–16, checked from the real
// files with the in-memory database. APPEND ONLY; ids are permanent.
import { suite } from "./lib.mjs";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("round 4 (items 10–16)", 166001, 200);
const src = (p) => readFileSync(join(root, p), "utf8");
const DB = await import("@/lib/dbRefusal.ts");
const PAY = await import("@/lib/payments.ts");
const TT = await import("@/lib/tableTags.ts");

// ── item 11: a bill is paid by a method the app knows ──
{ const mig = existsSync(join(root, "supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql")) ? src("supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql") : "";
  const lists = [...mig.matchAll(/payment_method (?:NOT )?IN \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort().join("|"));
  const app = [...PAY.PAYMENT_METHODS, "Split", TT.ON_THE_HOUSE_METHOD].sort().join("|");
  t("item 11: migration 417 adds orders_payment_method_is_known, NOT VALID first, validated only when no row breaks it", /ADD CONSTRAINT orders_payment_method_is_known/.test(mig) && /NOT VALID;/.test(mig) && /IF NOT EXISTS \(\s*SELECT 1 FROM public\.orders[\s\S]*?VALIDATE CONSTRAINT orders_payment_method_is_known/.test(mig));
  t("item 11: …its list is EXACTLY the app's — PAYMENT_METHODS + 'Split' (Pay in parts) + ON_THE_HOUSE_METHOD — in both places it is written", lists.length === 2 && lists.every((l) => l === app), `${lists.join(" / ")} vs ${app}`);
  t("item 11: …and it rewrites no data (no UPDATE or DELETE outside comments)", !/\b(UPDATE|DELETE)\b/i.test(mig.replace(/--.*$/gm, "")));
  t("item 11: a refused method reads as a sentence that says what to pick", /pick UPI, cash, card or other/.test(DB.refusalMessage({ code: "23514", message: 'new row for relation "orders" violates check constraint "orders_payment_method_is_known"' })));
  t("item 11: the Pay in parts and on-the-house spellings the app writes are the ones the rule allows", /payment_method: "Split"/.test(src("lib/paySplit.ts")) && TT.ON_THE_HOUSE_METHOD === "On the house"); }

// ── item 10: the panels' own copies of the bill rule, lifted out and RUN against lib/tax.ts ──
const T = await import("@/lib/tax.ts");
const BILLDOC = (await import("@/public/panels/billdoc.js")).default;
const fnSrc = (text, name) => { const at = text.search(new RegExp(`^(?:async )?function ${name}\\(`, "m")); if (at < 0) throw new Error(`${name} not found`); const end = text.indexOf("\n}\n", at); return text.slice(at, end + 2); };
const lineOf = (text, re) => (text.match(re) || [""])[0];
const ED = src("public/panels/editor/app.js"), TB = src("public/panels/tablet/app.js");
const edMR = lineOf(ED, /^const moneyRound = .*$/m), tbMR = lineOf(TB, /^const moneyRound = .*$/m);
const EDF = new Function("LFH_BILLDOC", "state", [edMR, ...["taxModel", "priceTaxMode", "itemTaxModesAllowed", "resolveTaxMode", "isMrpDish", "splitCartLines"].map((n) => fnSrc(ED, n))].join("\n") + "\nreturn { taxModel, priceTaxMode, resolveTaxMode, isMrpDish, splitCartLines, moneyRound };");
const TBF = new Function("LFH_BILLDOC", "state", [tbMR, lineOf(TB, /^const preTax = .*$/m), ...["effRate", "orderTaxSplit"].map((n) => fnSrc(TB, n))].join("\n") + "\nreturn { effRate, orderTaxSplit, moneyRound };");
const gen = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const int = (R, a, b) => a + Math.floor(R() * (b - a + 1)); const pick = (R, xs) => xs[Math.floor(R() * xs.length)];
const COMPS = [[], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }], [{ label: "IGST", rate: 28 }], [{ label: "VAT", rate: 12.5 }]];
const setOf = (R) => ({ tax_rate: pick(R, [null, 0.05, 0.12, 0.18, 0.28]), tax_components: pick(R, COMPS), price_tax_mode: pick(R, ["excl", "incl", "composition", "excl"]), item_tax_modes_allowed: R() < 0.5, mrp_tax_treatment: pick(R, ["inclusive", "none"]) });
const dishLine = (R) => ({ price: pick(R, [() => int(R, 1, 200000) / 100, () => String(int(R, 1, 2000)), () => "₹" + (int(R, 1, 200000) / 100).toFixed(2)])(), qty: int(R, 1, 5), tax_mode: pick(R, ["default", "excl", "incl", "mrp", "none", null]) });
let SEED = 4001;
const prop = (what, n, make, ok) => { const R = gen(SEED++); let bad = null; for (let i = 0; i < n && !bad; i++) { const x = make(R); let r; try { r = ok(x); } catch (e) { r = "threw: " + e.message; } if (r !== true) bad = { x, r }; }
  t(`${what} — ${n.toLocaleString("en-IN")} random cases`, !bad, bad ? `counter-example ${JSON.stringify(bad.x).slice(0, 140)} → ${String(bad.r).slice(0, 60)}` : ""); };
{ const E = EDF(BILLDOC, { data: { settings: {} } });
  t("item 10: the manager panel's bill rules can be lifted out and run (taxModel, resolveTaxMode, isMrpDish, splitCartLines, moneyRound)", typeof E.splitCartLines === "function" && E.moneyRound(0.7 * 0.05) === 0.04);
  prop("item 10: the manager's quick-order cart split (splitCartLines) = lib/tax.ts splitBill on the same dishes — taxable, untaxed and MRP, to the paisa", 20000, (R) => ({ s: setOf(R), lines: Array.from({ length: int(R, 0, 8) }, () => dishLine(R)) }), ({ s, lines }) => {
    const p = E.splitCartLines(lines, s); const b = T.splitBill(lines.map((l) => ({ ...l, tax_mode: T.resolveTaxMode(l.tax_mode, s), is_mrp: T.isMrpDish(l.tax_mode, s) })), s, 0);
    return (p.taxableBase === b.taxableBase && p.nontax === b.nontaxAmount && p.mrpAmount === b.mrpAmount) || `panel ${p.taxableBase}/${p.nontax}/${p.mrpAmount} vs lib ${b.taxableBase}/${b.nontaxAmount}/${b.mrpAmount}`; });
  prop("item 10: the manager panel's resolveTaxMode and isMrpDish = lib/tax.ts's, for every dish mode and set-up", 20000, (R) => ({ s: setOf(R), m: pick(R, ["default", "excl", "incl", "mrp", "none", null, "x"]) }), ({ s, m }) => (E.resolveTaxMode(m, s) === T.resolveTaxMode(m, s) && E.isMrpDish(m, s) === T.isMrpDish(m, s)) || `${E.resolveTaxMode(m, s)} vs ${T.resolveTaxMode(m, s)}`);
  prop("item 10: the manager panel's rate (taxModel, the shared bill file's) = lib/tax.ts effectiveTaxRate", 20000, setOf, (s) => E.taxModel(s).rate === T.effectiveTaxRate(s) || `${E.taxModel(s).rate} vs ${T.effectiveTaxRate(s)}`); }
{ const NO = new Function("state", edMR + "\nreturn moneyRound;")({});
  t("item 10: before billdoc.js has loaded, the panel helper still answers (the old float rounding, by design) — it never throws", NO(1.234) === 1.23 && typeof NO(NaN) === "number"); }
prop("item 10: the waiter tablet's order split (orderTaxSplit) = lib/tax.ts splitBill on the order's dishes", 20000, (R) => ({ s: { ...setOf(R), price_tax_mode: "excl" }, items: Array.from({ length: int(R, 1, 8) }, () => ({ ...dishLine(R), tax_mode: pick(R, ["excl", "incl", "exempt"]) })) }), ({ s, items }) => {
  const P = TBF(BILLDOC, { data: { settings: s } }); const o = P.orderTaxSplit({ items, total: 0 }); const b = T.splitBill(items, s, 0);
  return (o.base === b.taxableBase && o.nontax === b.nontaxAmount) || `tablet ${o.base}/${o.nontax} vs lib ${b.taxableBase}/${b.nontaxAmount}`; });
prop("item 10: the waiter tablet's rate (effRate) = lib/tax.ts effectiveTaxRate for every tax set-up — composition included", 20000, setOf, (s) => { const r = TBF(BILLDOC, { data: { settings: s } }).effRate(); return r === T.effectiveTaxRate(s) || `tablet ${r} vs lib ${T.effectiveTaxRate(s)} (${s.price_tax_mode})`; });
// ── item 28 (found by the check above): the tablet's rate knows the composition scheme ──
t("item 28: a composition-scheme restaurant's rate on the waiter tablet is 0 — with billdoc.js loaded AND before it has", TBF(BILLDOC, { data: { settings: { price_tax_mode: "composition", tax_rate: 0.05 } } }).effRate() === 0 && TBF(undefined, { data: { settings: { price_tax_mode: "composition", tax_rate: 0.05 } } }).effRate() === 0);
prop("item 28: …and before billdoc.js has loaded, the tablet's fallback still agrees with lib/tax.ts on every set-up", 20000, setOf, (s) => { const r = TBF(undefined, { data: { settings: s } }).effRate(); return r === T.effectiveTaxRate(s) || `${r} vs ${T.effectiveTaxRate(s)}`; });

// ── item 10: each of the 18 places a money × rate was rounded the float way, now on the one rule ──
const SITE = (p, re) => re.test(src(p));
for (const [p, re, what] of [
  ["lib/tax.ts", /const tax = roundPaise\(taxable \* rate\);/, "splitBill's tax"],
  ["lib/tax.ts", /taxableBase \+= roundPaise\(amt \/ \(1 \+ rate\)\);/, "splitBill's tax-inside net"],
  ["lib/tax.ts", /const amt = roundPaise\(unit \* qty\);/, "splitBill's line amount (₹1.005 × 1 is ₹1.01, as the database says)"],
  ["lib/paySplit.ts", /const r2 = roundPaise;/, "Pay in parts' due"],
  ["lib/taxFiling.ts", /const p2 = \(v: number\) => roundPaise\(Number\(v\) \|\| 0\);/, "the GST filing's split"],
  ["lib/billPreview.ts", /const r2 = roundPaise;/, "the bill preview's tax-inside net"],
  ["app/api/editor/[...path]/route.ts", /const r2 = BILLDOC\.moneyRound;/, "the manager route's billTaxOf (run by verify:audit with BILLDOC alone)"],
  ["app/api/inventory/[...path]/route.ts", /const amount = roundPaise\(qty \* rate\);/, "an inventory purchase line"],
  ["components/admin/RestaurantSettings.tsx", /const egNet = roundPaise\(EG \/ \(1 \+ gstRate\)\);/, "the admin's GST example"],
  ["public/panels/billdoc.js", /var r2 = moneyRound;/, "the printed bill's money (billMoney)"],
  ["public/panels/billdoc.js", /inside \+= amt - moneyRound\(amt \/ \(1 \+ rate\)\);/, "the tax inside an MRP line"],
  ["public/panels/billdoc.js", /: moneyRound\(taxAmt \* \(\(Number\(c\.rate\) \|\| 0\) \/ rateSum\)\);/, "the banquet bill's CGST / SGST split"],
  ["public/panels/editor/app.js", /taxableBase \+= moneyRound\(amt \/ \(1 \+ rate\)\);/, "the manager's quick-order cart split"],
  ["public/panels/editor/app.js", /return moneyRound\(sp\.taxableBase \+ sp\.nontax - d \+ moneyRound\(taxable \* rate\)\);/, "the parcel's 'pay now' estimate"],
  ["public/panels/editor/app.js", /const tax = moneyRound\(\(sub - disc\) \* tm\.rate\);/, "the banquet quick bill's tax"],
  ["public/panels/editor/app.js", /const tm = taxModel\(s\);\n  const r2 = moneyRound;/, "the per-dish GST example in Edit menu"],
  ["public/panels/tablet/app.js", /else if \(mode === "incl"\) base \+= moneyRound\(amt \/ \(1 \+ rate\)\);/, "the tablet's order split"],
  ["public/panels/tablet/app.js", /const round2 = moneyRound;\n  const rate = effRate\(\);\n  const due = round2\(/, "the tablet's bill due"],
]) t(`item 10: ${what} rounds by the one exact rule (${p})`, SITE(p, re));
t("item 10: billdoc.js exports moneyRound and its type file declares it", typeof BILLDOC.moneyRound === "function" && /export function moneyRound\(n: number\): number;/.test(src("public/panels/billdoc.d.ts")));
t("item 10: lib/tax.ts still imports nothing (it runs in a browser bundle, the server and a plain guard alike) — roundPaise lives in it", !/^\s*import\s/m.test(src("lib/tax.ts")) && /export function roundPaise\(n: number\): number/.test(src("lib/tax.ts")));
t("item 10: verify-money-round-twins is in the static-guard list CI runs", /\["verify-money-round-twins\.mjs",/.test(src("scripts/verify-static.mjs")));

// ── item 16: a dish page learns which review is mine ──
{ const M418 = src("supabase/migrations/418_a_dish_page_learns_which_review_is_mine_not_every_device_id.sql");
  const MENU = src("lib/menu.ts"), ITEM = src("app/item/[slug]/ItemClient.tsx");
  t("item 16: migration 418's function returns name, stars, comment, created_at and mine — and no device id", /RETURNS TABLE \(name text, stars integer, comment text, created_at timestamptz, mine boolean\)/.test(M418));
  t("item 16: …it is SECURITY DEFINER, STABLE, with a fixed search_path, scoped to one dish of one restaurant, newest 20", /LANGUAGE sql STABLE SECURITY DEFINER\s*\nSET search_path TO 'public'/.test(M418) && /WHERE r\.item_slug = p_slug AND r\.restaurant_id = p_restaurant_id/.test(M418) && /ORDER BY r\.created_at DESC\s*\n\s*LIMIT 20;/.test(M418));
  t("item 16: …'mine' is true only for a real device id the caller passed (never for a blank one)", /\(p_device IS NOT NULL AND p_device <> '' AND r\.device_id = p_device\) AS mine/.test(M418));
  t("item 16: …it is not left PUBLIC-executable by default: revoked from PUBLIC, granted to the guest, signed-in and server keys", /REVOKE ALL ON FUNCTION public\.lfh_dish_reviews\(text, uuid, text\) FROM PUBLIC;/.test(M418) && /GRANT EXECUTE ON FUNCTION public\.lfh_dish_reviews\(text, uuid, text\) TO anon, authenticated, service_role;/.test(M418));
  t("item 16: …and the table's direct guest read and its policy are gone", /DROP POLICY IF EXISTS public_read_reviews ON public\.reviews;/.test(M418) && /REVOKE SELECT ON public\.reviews FROM anon, authenticated;/.test(M418));
  t("item 16: lib/menu.ts asks lfh_dish_reviews and never reads the reviews table itself", /supabase\.rpc\("lfh_dish_reviews", \{ p_slug: slug, p_restaurant_id: restaurantId, p_device: deviceId \}\)/.test(MENU) && !/\.from\("reviews"\)/.test(MENU));
  t("item 16: the dish page passes its own device id and drops its own older review by 'mine', holding nobody's device id", /getItemReviews\(item\.slug, restaurantId, getDeviceId\(\)\)/.test(ITEM) && /localReviews\.filter\(\(r\) => !r\.mine\)/.test(ITEM) && !/deviceId\?: string\}\[\]>/.test(ITEM));
  const files = []; (function w(d) { for (const e of readdirSync(join(root, d))) { const q = join(d, e); if (statSync(join(root, q)).isDirectory()) w(q); else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(q); } })("app"); (function w(d) { for (const e of readdirSync(join(root, d))) { const q = join(d, e); if (statSync(join(root, q)).isDirectory()) w(q); else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(q); } })("components");
  const direct = files.filter((f) => !f.startsWith("app/api/") && /\.from\(["']reviews["']\)/.test(src(f)));
  t("item 16: no page or component reads the reviews table directly (only server routes, with the server key)", !direct.length, direct.join(", "));
  t("item 16: verify:grants knows the new function and that only four tables are guest-readable now", /lfh_dish_reviews: +"/.test(src("scripts/verify-db-grants.mjs")) && /const GUEST_READABLE = \["categories", "filters", "menu_items", "realtime_events"\];/.test(src("scripts/verify-db-grants.mjs"))); }

// ── item 12: the film seeder writes bills the way the app does (the file lives outside git) ──
{ const SEEDER = "/Users/aevinite/Documents/Projects/backup_Menu/brag-output/ownerfilm/prep-history.mjs";
  const S = existsSync(SEEDER) ? readFileSync(SEEDER, "utf8") : "";
  t("item 12: the film seeder pays dine-in bills by UPI / Cash / Card only — no platform name", !!S && !/\["(Swiggy|Zomato|Website)",/.test(S) && (S.match(/methods: \[\["UPI", \d+\], \["Cash", \d+\], \["Card", \d+\]\]/g) || []).length === 3, S ? "" : "the seeder file is not on this machine");
  t("item 12: …and stores total = subtotal + tax with the taxable base the whole subtotal (the discount apart)", !!S && /const taxable = subtotal;/.test(S) && /const total = \+\(subtotal \+ tax\)\.toFixed\(2\);/.test(S)); }

// ── item 10, configuration by configuration: every tax set-up a restaurant can choose (72), the four
//    copies of the bill rule — lib/tax.ts, the manager cart, the waiter tablet, the printed bill — agree ──
{ const RATES = [["CGST 2.5 + SGST 2.5", { tax_components: COMPS[1] }], ["CGST 9 + SGST 9", { tax_components: COMPS[2] }], ["IGST 28", { tax_components: COMPS[3] }], ["VAT 12.5", { tax_components: COMPS[4] }], ["a typed 12%", { tax_rate: 0.12, tax_components: [] }], ["nothing set (5%)", { tax_rate: null, tax_components: [] }]];
  const E = EDF(BILLDOC, { data: { settings: {} } });
  for (const pm of ["excl", "incl", "composition"]) for (const allowed of [false, true]) for (const mt of ["inclusive", "none"]) for (const [rl, rs] of RATES) {
    const s = { ...rs, price_tax_mode: pm, item_tax_modes_allowed: allowed, mrp_tax_treatment: mt }; const R = gen(5000 + pm.length * 97 + (allowed ? 7 : 0) + mt.length * 13 + rl.length);
    let bad = null;
    for (let i = 0; i < 300 && !bad; i++) {
      const lines = Array.from({ length: int(R, 1, 7) }, () => dishLine(R));
      const resolved = lines.map((l) => ({ ...l, tax_mode: T.resolveTaxMode(l.tax_mode, s), is_mrp: T.isMrpDish(l.tax_mode, s) }));
      const b = T.splitBill(resolved, s, 0); const p = E.splitCartLines(lines, s);
      const tb = TBF(BILLDOC, { data: { settings: s } }); const o = tb.orderTaxSplit({ items: resolved, total: 0 });
      const m = BILLDOC.billMoney([{ status: "served", subtotal: b.subtotal, taxable_base: b.taxableBase, nontax_amount: b.nontaxAmount, mrp_amount: b.mrpAmount, discount: 0, tax_rate: b.rate, items: resolved }], s);
      if (p.taxableBase !== b.taxableBase || p.nontax !== b.nontaxAmount || p.mrpAmount !== b.mrpAmount) bad = `manager cart ${p.taxableBase}/${p.nontax} vs ${b.taxableBase}/${b.nontaxAmount}`;
      else if (o.base !== b.taxableBase || o.nontax !== b.nontaxAmount || tb.effRate() !== b.rate) bad = `tablet ${o.base}/${o.nontax} @${tb.effRate()} vs ${b.taxableBase}/${b.nontaxAmount} @${b.rate}`;
      else if (m.total !== b.total || m.tax !== b.tax || BILLDOC.taxModel(s).rate !== b.rate) bad = `paper ${m.total}/${m.tax} vs screen ${b.total}/${b.tax}`;
    }
    t(`set-up "${pm}, per-dish modes ${allowed ? "on" : "off"}, MRP ${mt}, ${rl}": the screen, the manager cart, the tablet and the printed bill give the same figures on 300 random carts`, !bad, bad || "");
  } }

// ── the printed bill's own money (billdoc.js — item 10 moved every figure in it onto the one rule) ──
{ const billOf = (R) => { const s = { tax_rate: pick(R, [0.05, 0.12, 0.18]), tax_components: pick(R, [COMPS[1], COMPS[2], []]) };
    const orders = Array.from({ length: int(R, 1, 4) }, () => { const lines = Array.from({ length: int(R, 1, 5) }, () => ({ title: "Dish " + int(R, 1, 50), price: (int(R, 100, 300000) / 100).toFixed(2), qty: int(R, 1, 3), tax_mode: pick(R, ["excl", "excl", "incl", "exempt"]) }));
      const b = T.splitBill(lines, s, 0); const d = R() < 0.4 ? Math.min(b.discountBase, int(R, 0, 50000) / 100) : 0;
      return { status: "served", subtotal: b.subtotal, taxable_base: b.taxableBase, nontax_amount: b.nontaxAmount, mrp_amount: 0, discount: d, tax_rate: b.rate, items: lines }; });
    return { s, orders }; };
  prop("the printed bill: total = subtotal − discount + tax, every figure a whole number of paise, for multi-ticket bills", 10000, billOf, ({ s, orders }) => {
    const m = BILLDOC.billMoney(orders, s); const w = (x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
    return (BILLDOC.moneyRound(m.subtotal - m.disc + m.tax) === m.total && [m.subtotal, m.disc, m.tax, m.total, m.taxable].every(w)) || `${m.subtotal} − ${m.disc} + ${m.tax} ≠ ${m.total}`; });
  prop("the printed bill's tax = the tax of each rate's taxable slice, each rounded once by the one rule", 10000, billOf, ({ s, orders }) => {
    const m = BILLDOC.billMoney(orders, s); const want = m.rateRows.reduce((a, r) => BILLDOC.moneyRound(a + BILLDOC.moneyRound(r.taxable * r.rate)), 0);
    return m.tax === want || `${m.tax} vs ${want}`; });
  prop("the paper's rows (billRows) add up: subtotal − discount + tax + untaxed + round-off = the total printed", 10000, billOf, ({ s, orders }) => {
    const d = BILLDOC.billData({ settings: s, orders, restaurant: {} }); const r = BILLDOC.billRows(d);
    return Math.round((r.subtotal - r.discount + r.tax + r.nontax + r.roundOff) * 100) === Math.round(r.total * 100) || JSON.stringify(r); });
  prop("the paper's CGST / SGST lines add up to the tax it prints", 10000, billOf, ({ s, orders }) => {
    const d = BILLDOC.billData({ settings: s, orders, restaurant: {} }); const r = BILLDOC.billRows(d); const lines = (d.taxRows || []).reduce((a, x) => a + Number(x.amt || 0), 0);
    return !(d.taxRows || []).length || Math.round(lines * 100) === Math.round(r.tax * 100) || `${lines} vs ${r.tax}`; });
  for (const comps of [[2.5, 2.5], [9, 9], [6, 6], [2.5, 2.5, 1]]) {
    let bad = null; const cs = comps.map((r, i) => ({ label: ["CGST", "SGST", "Cess"][i], rate: r }));
    for (let w = 0; w <= 20000 && !bad; w++) { const parts = BILLDOC.splitTax(w, cs); const sum = parts.reduce((a, x) => a + Number(x.amt), 0);
      if (Math.round(sum * 100) !== w * 100 || parts.some((x) => Number(x.amt) < 0) || (w > 0 && parts.some((x) => Number(x.amt) === 0))) bad = `₹${w}: ${parts.map((x) => x.amt).join(" + ")}`; }
    t(`the printed bill's tax split at ${comps.join(" + ")}%: every whole-rupee tax ₹0–₹20,000 splits into lines that add up exactly, none negative, none ₹0 when tax was charged`, !bad, bad || ""); } }
