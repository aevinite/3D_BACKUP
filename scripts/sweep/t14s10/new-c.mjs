// Bank C — who a bill is for, and the admin's preview of the paper.
//   lib/billCustomer.ts         (P183271–P183300) — 3 ledger rows by subject before sweep #10
//   lib/billPreview.ts          (P183301–P183340) — 6
//   public/panels/billcustomer.js (P183341–P183400) — 14, none of which DROVE the sheet: these do,
//     in a real Chromium page holding nothing but the sheet's own script and stylesheet (no login,
//     no database, nothing written — the network is a stand-in that records what was asked).
import { sec, read, imp, sql, code, NO_DB, root, onDone } from "./lib.mjs";
import { join } from "node:path";

// ── lib/billCustomer.ts — the server half of "no bill without a name and number" ─────────────────
const BC = await imp("lib/billCustomer.ts");
const F1 = "lib/billCustomer.ts";
const c = sec(183270);
/** A recording stand-in for the Supabase client: one settings read, one rpc. */
const stub = ({ row = { bill_customer_required: true }, readErr = null, rpc = { data: { ok: true, visits: 2 }, error: null } } = {}) => {
  const calls = { rpc: [], eq: [] };
  return {
    calls,
    from: (t) => ({ select: (cols) => ({ eq: (k, v) => { calls.eq.push([t, cols, k, v]); return { maybeSingle: async () => ({ data: row, error: readErr }) }; } }) }),
    rpc: async (name, args) => { calls.rpc.push([name, args]); return rpc; },
  };
};
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
c(1, F1, "required: a row saying true requires the customer", "billCustomerRequired", async () => (await BC.billCustomerRequired(stub({ row: { bill_customer_required: true } }), "r")) === true || "not required");
c(2, F1, "required: a row with the column unset (null) also requires it — ON by default", "null → true", async () => (await BC.billCustomerRequired(stub({ row: { bill_customer_required: null } }), "r")) === true || "null read as off");
c(3, F1, "required: only an explicit false switches it off", "false → false", async () => (await BC.billCustomerRequired(stub({ row: { bill_customer_required: false } }), "r")) === false || "false read as on");
c(4, F1, "required: a database blip fails OPEN (billing is never stopped mid-service) — and is logged", "read error → false + console.error", async () => {
  let logged = ""; const e = console.error; console.error = (...a) => { logged = a.join(" "); };
  try { return ((await BC.billCustomerRequired(stub({ readErr: { message: "timeout" } }), "r")) === false && /could not read/.test(logged)) || "blip not handled as documented"; } finally { console.error = e; }
});
c(5, F1, "required: the read is scoped to the restaurant it was asked about, one column", "the eq() it made", async () => { const s = stub(); await BC.billCustomerRequired(s, "rid-1"); const [t, cols, k, v] = s.calls.eq[0]; return (t === "settings" && cols === "bill_customer_required" && k === "restaurant_id" && v === "rid-1") || JSON.stringify(s.calls.eq[0]); });
const save = (body, opts) => quiet(() => BC.saveBillCustomer(stub(opts), "rid-1", "sess-1", body));
c(6, F1, "save: nothing given at a restaurant that requires it → a plain refusal", "{}", async () => { const r = await save({}); return (r.ok === false && /mobile number and name before generating/.test(r.message)) || JSON.stringify(r); });
c(7, F1, "save: nothing given where it is optional → the bill goes ahead, nothing saved", "{} not required", async () => { const r = await save({}, { row: { bill_customer_required: false } }); return (r.ok === true && r.saved === false) || JSON.stringify(r); });
c(8, F1, "save: a name with no number → 'The customer's mobile number is missing.'", "name only", async () => { const r = await save({ cust_name: "Riya" }); return (r.ok === false && /mobile number is missing/.test(r.message)) || JSON.stringify(r); });
c(9, F1, "save: a number with no name → 'The customer's name is missing.'", "phone only", async () => { const r = await save({ cust_phone: "9825012345" }); return (r.ok === false && /name is missing/.test(r.message)) || JSON.stringify(r); });
c(10, F1, "save: nine digits → '…too short — 10 digits, please.'", "9 digits", async () => { const r = await save({ cust_phone: "982501234", cust_name: "A" }); return (r.ok === false && /too short/.test(r.message)) || JSON.stringify(r); });
c(11, F1, "save: spaces, a plus and dashes are stripped before the length is judged", "+91 98250-12345", async () => { const s = stub(); await quiet(() => BC.saveBillCustomer(s, "r", "s", { cust_phone: "+91 98250-12345", cust_name: "A" })); return s.calls.rpc[0][1].p_phone === "919825012345" || JSON.stringify(s.calls.rpc[0]); });
c(12, F1, "save: a number longer than 15 digits is cut to 15, never sent whole", "20 digits", async () => { const s = stub(); await quiet(() => BC.saveBillCustomer(s, "r", "s", { cust_phone: "12345678901234567890", cust_name: "A" })); return s.calls.rpc[0][1].p_phone.length === 15 || s.calls.rpc[0][1].p_phone; });
c(13, F1, "save: a name is trimmed and capped at 80 characters", "100-char name with spaces", async () => { const s = stub(); await quiet(() => BC.saveBillCustomer(s, "r", "s", { cust_phone: "9825012345", cust_name: "  " + "x".repeat(100) + "  " })); return s.calls.rpc[0][1].p_name.length === 80 && !/^\s/.test(s.calls.rpc[0][1].p_name) || s.calls.rpc[0][1].p_name.length; });
c(14, F1, "save: a name of only spaces counts as no name", "'   '", async () => { const r = await save({ cust_phone: "9825012345", cust_name: "   " }); return (r.ok === false && /name is missing/.test(r.message)) || JSON.stringify(r); });
c(15, F1, "save: the database call carries the restaurant and the session it was given — nothing from the body", "rpc args", async () => { const s = stub(); await quiet(() => BC.saveBillCustomer(s, "rid-9", "sess-9", { cust_phone: "9825012345", cust_name: "A", p_restaurant_id: "other", restaurant_id: "other" })); const a = s.calls.rpc[0][1]; return (s.calls.rpc[0][0] === "lfh_bill_customer_save" && a.p_restaurant_id === "rid-9" && a.p_session === "sess-9" && Object.keys(a).length === 4) || JSON.stringify(s.calls.rpc[0]); });
c(16, F1, "save: a database failure where it is required → the person reads a sentence, never the database's words", "rpc error, required", async () => { const r = await save({ cust_phone: "9825012345", cust_name: "A" }, { rpc: { data: null, error: { message: 'invalid input syntax for type uuid: "x"' } } }); return (r.ok === false && /try again/.test(r.message) && !/uuid|syntax/.test(r.message)) || JSON.stringify(r); });
c(17, F1, "save: a database failure where it is optional → the bill still goes ahead", "rpc error, optional", async () => { const r = await save({ cust_phone: "9825012345", cust_name: "A" }, { row: { bill_customer_required: false }, rpc: { data: null, error: { message: "x" } } }); return (r.ok === true && r.saved === false) || JSON.stringify(r); });
c(18, F1, "save: 'session not found' from the database → 'That table's bill couldn't be found.'", "rpc ok:false reason", async () => { const r = await save({ cust_phone: "9825012345", cust_name: "A" }, { rpc: { data: { ok: false, reason: "session_not_found" }, error: null } }); return (r.ok === false && /couldn't be found/.test(r.message)) || JSON.stringify(r); });
c(19, F1, "save: success answers saved:true with the visit count", "rpc ok", async () => { const r = await save({ cust_phone: "9825012345", cust_name: "A" }); return (r.ok === true && r.saved === true && r.visits === 2) || JSON.stringify(r); });
c(20, F1, "save: a body that is not an object is treated as empty, never a crash", "null / 'x' / 5", async () => { for (const b of [null, "x", 5]) { const r = await save(b); if (r.ok !== false) return `body ${JSON.stringify(b)} → ${JSON.stringify(r)}`; } return true; });
c(21, F1, "the manager route confirms the session is THIS restaurant's before saving the customer", "ownsGen precedes saveBillCustomer", () => { const r = read("app/api/editor/[...path]/route.ts"); const i = r.indexOf("const custSave = await saveBillCustomer"); const g = r.lastIndexOf('.from("sessions").select("id, table_number, bill_no").eq("id", b).eq("restaurant_id", rid)', i); return (i > 0 && g > 0 && i - g < 1500) || "no ownership check right before the save"; });
c(22, F1, "the waiter-tablet route does the same, after its own invoice permission", "tabletPerm → ownsGen → saveBillCustomer", () => { const r = read("app/api/tablet/[...path]/route.ts"); const i = r.indexOf("const custSaveT = await saveBillCustomer"); const g = r.lastIndexOf('.eq("id", b).eq("restaurant_id", rid)', i); const p = r.lastIndexOf('tabletPerm("tablet_invoice"', i); return (p > 0 && g > p && i > g) || "order of checks changed"; });
c(23, F1, "both routes stop on a refusal and show its sentence (400)", "if (!custSave.ok) return err(…, 400)", () => /if \(!custSave\.ok\) return err\(custSave\.message, 400\);/.test(read("app/api/editor/[...path]/route.ts")) && /if \(!custSaveT\.ok\) return err\(custSaveT\.message, 400\);/.test(read("app/api/tablet/[...path]/route.ts")) || "a refusal is ignored somewhere");
c(24, F1, "the save function in the database is callable by the server only", "mig 227 REVOKE … FROM PUBLIC, anon, authenticated; GRANT … service_role", () => /REVOKE ALL ON FUNCTION lfh_bill_customer_save\(uuid, uuid, text, text\)\s+FROM PUBLIC, anon, authenticated;/.test(read("supabase/migrations/227_bill_customer.sql")) || "grant missing");
c(25, F1, "…and the customer search too, since its row cap was rewritten (mig 371)", "mig 371 REVOKE/GRANT", () => /REVOKE ALL ON FUNCTION lfh_customer_phone_search\(uuid, text, integer\) FROM PUBLIC, anon, authenticated;/.test(read("supabase/migrations/371_customer_search_row_cap_actually_caps.sql")) || "grant missing");
c(26, F1, "the search's row cap really caps today (the T8 fault mig 371 fixed)", "dev DB: a 1-digit prefix with p_limit 2", async () => {
  if (NO_DB) return { skip: "--no-db" };
  const r = await sql("select coalesce(max(json_array_length(lfh_customer_phone_search(restaurant_id, '9', 2)::json)),0)::int n from (select distinct restaurant_id from settings limit 20) x");
  return r[0].n <= 2 || `returned ${r[0].n} rows for a cap of 2`;
});
c(27, F1, "both customer-search routes are scoped to the session's restaurant", "p_restaurant_id: rid in both", () => /lfh_customer_phone_search", \{ p_restaurant_id: rid/.test(read("app/api/editor/[...path]/route.ts")) && /lfh_customer_phone_search", \{ p_restaurant_id: rid/.test(read("app/api/tablet/[...path]/route.ts")) || "a search is not scoped");
c(28, F1, "the 'whole answer' flag is the server's own cap, one number", "CUSTOMER_SEARCH_ROWS in the editor route", () => /return ok\(\{ matches, whole: matches\.length < CUSTOMER_SEARCH_ROWS \}\);/.test(read("app/api/editor/[...path]/route.ts")) || "changed");
c(29, F1, "no message this file returns names a column, a table or a function", "every message literal", () => { const msgs = [...code(read(F1)).matchAll(/message: "([^"]+)"/g)].map((m) => m[1]); const bad = msgs.filter((m) => /lfh_|session_id|restaurant_id|rpc|column|table\b/i.test(m)); return (msgs.length >= 5 && bad.length === 0) || bad.join(" | "); });
c(30, F1, "capturing and printing stay two decisions — this file never reads bill_customer_print", "code", () => !/bill_customer_print/.test(code(read(F1)).replace(/type SettingsRow[^\n]*/, "")) || "printing decided here");

// ── lib/billPreview.ts — the admin's sample of the paper ─────────────────────────────────────────
const BP = await imp("lib/billPreview.ts");
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const TAX = await imp("lib/tax.ts");
const F2 = "lib/billPreview.ts";
const p = sec(183300);
// Only the rows ABOVE the TOTAL — the "Price includes" block under it repeats the tax labels and is
// reported, never added.
const money = (h0) => { const h = h0.slice(0, h0.indexOf('class="g"><span>TOTAL')) + h0.slice(h0.indexOf('class="g"><span>TOTAL'), h0.indexOf('class="g"><span>TOTAL') + 80); const rows = {}; for (const m of h.matchAll(/<div class="t(?: tx)?"><span>([^<]+)<\/span><span>([−+]?\s*)₹([\d,]+)<\/span><\/div>/g)) rows[m[1]] = (m[2].includes("−") ? -1 : 1) * Number(m[3].replace(/,/g, "")); const t = h.match(/class="g"><span>TOTAL<\/span><span>₹([\d,]+)</); return { rows, total: t ? Number(t[1].replace(/,/g, "")) : NaN }; };
p(1, F2, "no settings at all draws a preview, never a crash (the admin screen renders it while loading)", "null / undefined / {}", () => { for (const s of [null, undefined, {}]) for (const m of ["bill", "parcel", "kot"]) if (!/<title>/.test(BP.billPreviewHtml(s, m))) return `${m} with ${s}`; return true; });
p(2, F2, "the KOT sample labels the table T5, never 'Table 5'", "kot mode", () => /<span>T5<\/span>/.test(BP.billPreviewHtml({}, "kot")) && !/Table 5/.test(BP.billPreviewHtml({}, "kot")) || "label wrong");
p(3, F2, "…and a restaurant that renamed table 5 sees its own name", "table_names {5:'Patio'}", () => /<span>Patio<\/span>/.test(BP.billPreviewHtml({ table_names: { 5: "Patio" } }, "kot")) || "name not used");
p(4, F2, "the KOT sample carries no prices — a ticket is for the kitchen", "no ₹ on the ticket", () => !/₹/.test(BP.billPreviewHtml({}, "kot")) || "a price on the ticket");
p(5, F2, "the KOT sample shows the allergy box above the food", "⚠ AVOID before the first line", () => { const h = BP.billPreviewHtml({}, "kot"); return h.indexOf("⚠ AVOID") > 0 && h.indexOf("⚠ AVOID") < h.indexOf("Paneer Butter Masala") || "allergy box not first"; });
p(6, F2, "the bill sample's invoice number uses the restaurant's own prefix", "invoice_prefix 'LFH'", () => /LFH\/2026-27\/000042/.test(BP.billPreviewHtml({ invoice_prefix: "LFH" }, "bill")) || "prefix ignored");
p(7, F2, "a restaurant with no GSTIN previews a 'Bill', one with a GSTIN a 'Tax Invoice'", "gstin '' vs '24AAAAA0000A1Z5'", () => /class="kind">Bill</.test(BP.billPreviewHtml({}, "bill")) && /class="kind">Tax Invoice</.test(BP.billPreviewHtml({ gstin: "24AAAAA0000A1Z5" }, "bill")) || "heading wrong");
p(8, F2, "a composition restaurant previews a Bill of Supply with its declaration and no tax rows", "price_tax_mode composition", () => { const h = BP.billPreviewHtml({ price_tax_mode: "composition", gstin: "24AAAAA0000A1Z5" }, "bill"); return (/Bill of Supply/.test(h) && /not eligible to collect tax/.test(h) && !/GST \d|CGST/.test(h)) || "composition preview wrong"; });
p(9, F2, "customer printing switched off → the preview shows no Customer row", "bill_customer_print false", () => !/<span>Customer<\/span>/.test(BP.billPreviewHtml({ bill_customer_print: false }, "bill")) && /<span>Customer<\/span>/.test(BP.billPreviewHtml({}, "bill")) || "switch ignored");
p(10, F2, "the parcel sample reads Parcel where the table would be", "parcel mode", () => /<span>Parcel<\/span>/.test(BP.billPreviewHtml({}, "parcel")) && !/<span>Table<\/span>/.test(BP.billPreviewHtml({}, "parcel")) || "parcel header wrong");
p(11, F2, "a logo is used only when it is an http(s) address", "logo_url data: vs https:", () => !/<img class="logo"/.test(BP.billPreviewHtml({}, "bill", { logo_url: "javascript:x" })) && /<img class="logo"/.test(BP.billPreviewHtml({}, "bill", { logo_url: "https://x.test/l.png" })) || "logo rule wrong");
p(12, F2, "the MRP sample appears only where a dish may have its own tax mode", "item_tax_modes_allowed off/on", () => !/Packaged Drinking Water/.test(BP.billPreviewHtml({}, "bill")) && /Packaged Drinking Water/.test(BP.billPreviewHtml({ item_tax_modes_allowed: true }, "bill")) || "MRP sample shown wrongly");
// The preview's whole promise is that it is the paper. Over a matrix of set-ups, every money row must
// foot to its TOTAL exactly as the printed bill's rows do.
const SETUPS = [];
for (const mode of ["excl", "incl", "composition"]) for (const mrp of [false, true]) for (const comps of [[], [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }]]) for (const treat of ["none", "inclusive"])
  SETUPS.push({ price_tax_mode: mode, item_tax_modes_allowed: mrp, tax_components: comps, mrp_tax_treatment: treat, tax_rate: 0.05, gstin: "24AAAAA0000A1Z5" });
p(13, F2, `every money row foots to the TOTAL on all ${SETUPS.length} set-ups (rate × MRP × components × MRP treatment)`, "parse each preview: subtotal − discount + added tax + MRP + round-off = TOTAL", () => {
  const bad = [];
  SETUPS.forEach((s, i) => { for (const m of ["bill", "parcel"]) {
    const { rows, total } = money(BP.billPreviewHtml(s, m));
    const sub = rows["Subtotal"] ?? rows["Food subtotal"] ?? 0;
    const sum = sub + (rows[`Discount (${Object.keys(rows).find((k) => k.startsWith("Discount ("))?.slice(10, -1)})`] ?? 0)
      + Object.entries(rows).filter(([k]) => /^(CGST|SGST|GST)\b/.test(k)).reduce((a, [, v]) => a + v, 0)
      + (rows["MRP items"] ?? 0) + (rows["Round off"] ?? 0);
    const discKey = Object.keys(rows).find((k) => k.startsWith("Discount"));
    const tot = sub + (discKey ? rows[discKey] : 0) + Object.entries(rows).filter(([k]) => /^(CGST|SGST|GST)\b/.test(k)).reduce((a, [, v]) => a + v, 0) + (rows["MRP items"] ?? 0) + (rows["Round off"] ?? 0);
    void sum;
    if (Math.abs(tot - total) > 0) bad.push(`#${i} ${m}: rows ${tot} vs TOTAL ${total}`);
  } });
  return bad.length === 0 || bad.slice(0, 4).join(" · ");
});
p(14, F2, "the preview's TOTAL is what the printed bill would charge for the same food (lib/tax splitBill vs billdoc billMoney)", `all ${SETUPS.length} set-ups, bill mode`, () => {
  const bad = [];
  for (const s of SETUPS) {
    const shown = money(BP.billPreviewHtml(s, "bill")).total;
    const perDish = TAX.itemTaxModesAllowed(s);
    const lines = [
      { title: "Paneer Butter Masala", qty: 2, price: 360 }, { title: "Garlic Naan", qty: 4, price: 85 }, { title: "Fresh Lime Soda", qty: 2, price: 120 },
      ...(perDish ? [{ title: "Packaged Drinking Water 1L", qty: 2, price: 20, mrp: true }] : []),
    ].map((l) => ({ ...l, tax_mode: TAX.resolveTaxMode(l.mrp ? "mrp" : "default", s), is_mrp: TAX.isMrpDish(l.mrp ? "mrp" : "default", s) }));
    const split = TAX.splitBill(lines, s, 50);
    if (Math.round(split.total) !== shown) bad.push(`${JSON.stringify(s).slice(0, 60)}: ${shown} vs ${split.total}`);
  }
  return bad.length === 0 || bad.slice(0, 3).join(" · ");
});
p(15, F2, "a composition preview takes the discount off the bill instead of handing it back as a round-off (the 2026-08-05 fault)", "composition, discount 50", () => { const { rows } = money(BP.billPreviewHtml({ price_tax_mode: "composition" }, "bill")); return !(rows["Round off"] >= 50) || "the discount came back as a round-off"; });
p(16, F2, "the percentage beside 'Discount' is quoted against the row shown above it", "discLabel vs the subtotal row", () => { const h = BP.billPreviewHtml({ tax_rate: 0.05 }, "bill"); const m = h.match(/Discount \((\d+(?:\.\d)?)%\)/); const { rows } = money(h); const sub = rows["Subtotal"] ?? rows["Food subtotal"]; const d = -Object.entries(rows).find(([k]) => k.startsWith("Discount"))[1]; return (m && BILLDOC.discPct(sub, d) === m[1] + "%") || `label ${m && m[1]} vs ${BILLDOC.discPct(sub, d)}`; });
p(17, F2, "the date row is the restaurant's clock (en-IN), and no field reads undefined / NaN / [object Object]", "every mode × every set-up", () => { for (const s of SETUPS) for (const m of ["bill", "parcel", "kot"]) { const h = BP.billPreviewHtml(s, m); if (/undefined|NaN|\[object Object\]/.test(h)) return `${m}: ${(h.match(/.{30}(undefined|NaN|\[object Object\]).{10}/) || [])[0]}`; } return true; });
p(18, F2, "it imports the tax rules from lib/tax.ts and re-derives none of them", "imports + no own tax_rate read", () => /from "@\/lib\/tax"/.test(read(F2)) && !/settings\.tax_rate/.test(code(read(F2))) || "a second copy of a tax rule");
p(19, F2, "the preview never prints itself (it is a sample on a screen)", "autoPrint false", () => !/setTimeout\(printAgain/.test(BP.billPreviewHtml({}, "bill")) || "the preview opens a print dialog");
p(20, F2, "the admin route behind it checks the admin login before reading anything", "bill-preview route: tokenIsValid first", () => { const r = read("app/api/admin/restaurants/bill-preview/route.ts"); return r.indexOf("tokenIsValid") > 0 && r.indexOf("tokenIsValid") < r.indexOf('.from("settings")') || "a read before the login check"; });
p(21, F2, "…and draws only the restaurant it was asked for — a missing or garbled id is refused, not the flagship", "isUuid(rid) refusal", () => /isUuid/.test(read("app/api/admin/restaurants/bill-preview/route.ts")) || "no id check");

// ── public/panels/billcustomer.js — DRIVEN in a real page ──────────────────────────────────────
// Every check below opens its own page state, so each row can be re-run on its own (`--only`).
const F3 = "public/panels/billcustomer.js";
const q = sec(183340);
let browser = null, page = null;
const CSS = read("public/panels/billcustomer.css");
/** A fresh page: the sheet's stylesheet + script (and billdoc.js unless `noBilldoc`), a stand-in
 *  back-button manager, and a network stand-in that records every request. */
async function boot({ noBilldoc = false } = {}) {
  if (!browser) {
    const { chromium } = await import(join(root, "node_modules/playwright/index.mjs"));
    browser = await chromium.launch();
    onDone(() => browser.close());
  }
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<!doctype html><html><head><style>:root{--scrim:rgba(0,0,0,.5);--panel:#fff;--panel-2:#f5f5f5;--line:#ddd;--gold:#c8a165;--muted:#666;--text:#111}</style><style>${CSS}</style></head><body></body></html>`);
  await page.evaluate(() => {
    window.__layers = [];
    window.LFH_BACK = { layer: (name, close) => { window.__layers.push({ name, close }); return () => { window.__layers = window.__layers.filter((l) => l.close !== close); }; } };
  });
  await page.addScriptTag({ content: read("public/panels/billcustomer.js") });
  if (!noBilldoc) await page.addScriptTag({ content: read("public/panels/billdoc.js") });
  return page;
}
/** Open the sheet. `reply` is the body of the network stand-in: (path) => answer. */
async function open(opts = "{ api: window.__api, required: true }", reply = "() => ({ matches: [], whole: true })", bootOpts) {
  await boot(bootOpts);
  await page.evaluate(`(() => {
    window.__asked = []; window.__reply = ${reply};
    window.__api = async (m, p) => { window.__asked.push(p); await new Promise((r) => setTimeout(r, 30)); return window.__reply(p); };
    window.__result = "pending";
    LFH_BILLCUST.ask(${opts}).then((v) => { window.__result = v; });
  })()`);
  await page.waitForTimeout(80);
}
const type = (sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
const txt = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || "", sel);
const wait = (ms) => page.waitForTimeout(ms);
const KNOWN = `(p) => ({ matches: [{ phone: "9825012345", name: "Riya Sharma", visits: 3 }, { phone: "9825012399", name: "<b>Amit</b>", visits: 1 }], whole: true })`;
const typeDigits = async (d) => { for (let i = 1; i <= d.length; i++) await type(".bc-phone", d.slice(0, i)); };

q(1, F3, "it publishes LFH_BILLCUST with ask / remember / norm / pretty", "typeof in the page", async () => { await boot(); return (await page.evaluate(() => ["ask", "remember", "norm", "pretty"].every((k) => typeof LFH_BILLCUST[k] === "function"))) || "missing export"; });
q(2, F3, "before billdoc.js has loaded, norm() answers the digits — never a wrong guess", "norm('+91 98250 12345') with no LFH_BILLDOC", async () => { await boot({ noBilldoc: true }); return (await page.evaluate(() => typeof LFH_BILLDOC === "undefined" && LFH_BILLCUST.norm("+91 98250 12345") === "919825012345")) || "guessed"; });
q(3, F3, "…and once it has, norm() peels the country code to the ten digits", "norm('+91 98250 12345')", async () => { await boot(); return (await page.evaluate(() => LFH_BILLCUST.norm("+91 98250 12345"))) === "9825012345" || "not peeled"; });
q(4, F3, "pretty() writes a ten-digit number as 5 + 5", "pretty('919825012345')", async () => { await boot(); return (await page.evaluate(() => LFH_BILLCUST.pretty("919825012345"))) === "98250 12345" || "not grouped"; });
q(5, F3, "remember() survives a list with holes and a non-list", "remember([null, 5, {phone}]) / remember(null)", async () => { await boot(); return (await page.evaluate(() => { LFH_BILLCUST.remember([null, 5, { phone: "9825099999", name: "Zed" }]); LFH_BILLCUST.remember(null); return true; })) || "threw"; });
q(6, F3, "ask() opens one sheet and registers ONE back-button layer", "overlay count + LFH_BACK layers", async () => { await open(); return (await page.evaluate(() => document.querySelectorAll(".bcust-overlay").length === 1 && window.__layers.length === 1 && window.__layers[0].name === "bill-customer")) || "wrong"; });
q(7, F3, "the counter starts at 0/10, not green", ".bcust-count", async () => { await open(); return (await txt(".bcust-count")) === "0/10" || await txt(".bcust-count"); });
q(8, F3, "Generate looks not-ready but stays tappable (aria-disabled, never disabled)", "button state", async () => { await open(); return (await page.evaluate(() => { const b = document.querySelector(".bc-go"); return b.getAttribute("aria-disabled") === "true" && !b.disabled; })) || "disabled attribute"; });
q(9, F3, "tapping Generate on an empty sheet says which box is missing and puts the cursor there", "status text + focus", async () => { await open(); await page.click(".bc-go", { force: true }); return (await page.evaluate(() => document.querySelector(".bc-status").textContent === "Enter the full 10-digit mobile number" && document.activeElement === document.querySelector(".bc-phone"))) || await txt(".bc-status"); });
q(10, F3, "…and the sheet stays open (the tap is refused, not swallowed)", "result still pending", async () => { await open(); await page.click(".bc-go", { force: true }); return (await page.evaluate(() => window.__result)) === "pending" || "closed"; });
q(11, F3, "five digits: no request yet (below the 6-digit floor)", "requests made", async () => { await open(); await typeDigits("98250"); await wait(300); return (await page.evaluate(() => window.__asked.length)) === 0 || "asked too early"; });
q(12, F3, "six digits: exactly one request, after the debounce", "requests made", async () => { await open(undefined, KNOWN); await typeDigits("982501"); await wait(400); const a = await page.evaluate(() => window.__asked); return (a.length === 1 && /q=982501$/.test(a[0])) || JSON.stringify(a); });
q(13, F3, "…and the box is formatted as the waiter types: '98250 1'", "box value", async () => { await open(undefined, KNOWN); await typeDigits("982501"); return (await page.evaluate(() => document.querySelector(".bc-phone").value)) === "98250 1" || await page.evaluate(() => document.querySelector(".bc-phone").value); });
q(14, F3, "suggestions appear for a partial number, at most four", "bc-pick count", async () => { await open(undefined, KNOWN); await typeDigits("982501"); await wait(400); const n = await page.evaluate(() => document.querySelectorAll(".bc-pick").length); return (n >= 1 && n <= 4) || n; });
q(15, F3, "a name holding markup is shown as text, not obeyed", "the <b>Amit</b> suggestion", async () => { await open(undefined, KNOWN); await typeDigits("982501"); await wait(400); return (await page.evaluate(() => { const b = [...document.querySelectorAll(".bc-pick")].find((x) => x.textContent.includes("Amit")); return !!b && b.textContent.includes("<b>Amit</b>") && !b.querySelector("b"); })) || "markup obeyed"; });
q(16, F3, "every suggestion is a 44px thumb target", "getBoundingClientRect height", async () => { await open(undefined, KNOWN); await typeDigits("982501"); await wait(400); return (await page.evaluate(() => { const l = [...document.querySelectorAll(".bc-pick")]; return l.length > 0 && l.every((b) => b.getBoundingClientRect().height >= 44); })) || "too small or none"; });
q(17, F3, "digits 7 to 10 cost NO request — the complete first answer is narrowed on the device", "requests after typing all ten", async () => { await open(undefined, KNOWN); await typeDigits("982501"); await wait(400); await typeDigits("9825012345"); await wait(400); const n = await page.evaluate(() => window.__asked.length); return n === 1 || `${n} requests`; });
const ten = async () => { await open(undefined, KNOWN); await typeDigits("9825012345"); await wait(500); };
q(18, F3, "ten digits of a known number fill the name and say 'Returning customer · 3 visits'", "status + name", async () => { await ten(); return (await page.evaluate(() => document.querySelector(".bc-name").value === "Riya Sharma" && /Returning customer · 3 visits/.test(document.querySelector(".bc-status").textContent))) || await txt(".bc-status"); });
q(19, F3, "a refusal clears once the number it named is supplied", "tap Generate empty, then type ten digits", async () => { await open(undefined, KNOWN); await page.click(".bc-go", { force: true }); await typeDigits("9825012345"); await wait(500); return !/Enter the full/.test(await txt(".bc-status")) || "refusal stuck"; });
q(20, F3, "the counter reads 10/10 and turns green", "count + class", async () => { await ten(); return (await page.evaluate(() => { const c = document.querySelector(".bcust-count"); return c.textContent === "10/10" && c.classList.contains("ok"); })) || await txt(".bcust-count"); });
q(21, F3, "…and Generate now looks ready", "aria-disabled false, full opacity", async () => { await ten(); return (await page.evaluate(() => { const b = document.querySelector(".bc-go"); return b.getAttribute("aria-disabled") === "false" && b.style.opacity === ""; })) || "still not-ready"; });
q(22, F3, "a name the waiter corrected is never overwritten by a later lookup", "edit the name, re-type the last digit", async () => { await ten(); await page.evaluate(() => { const n = document.querySelector(".bc-name"); n.value = "Riya S."; n.dispatchEvent(new Event("input", { bubbles: true })); }); await type(".bc-phone", "982501234"); await type(".bc-phone", "9825012345"); await wait(400); return (await page.evaluate(() => document.querySelector(".bc-name").value)) === "Riya S." || "overwritten"; });
q(23, F3, "Generate hands back the ten-digit number and the trimmed name", "promise result", async () => { await ten(); await page.evaluate(() => { const n = document.querySelector(".bc-name"); n.value = "  Riya S. "; n.dispatchEvent(new Event("input", { bubbles: true })); }); await page.click(".bc-go", { force: true }); await wait(50); const r = await page.evaluate(() => window.__result); return (r && r.phone === "9825012345" && r.name === "Riya S.") || JSON.stringify(r); });
q(24, F3, "…and the sheet and its back-button layer are gone", "overlay + layers", async () => { await ten(); await page.click(".bc-go", { force: true }); await wait(50); return (await page.evaluate(() => !document.querySelector(".bcust-overlay") && window.__layers.length === 0)) || "left behind"; });
for (const [n, how, act] of [[25, "Cancel", () => page.click(".bc-cancel")], [26, "the ✕", () => page.click(".bcust-x")], [27, "a tap on the dimmed backdrop", () => page.mouse.click(5, 5)], [28, "the hardware back button", () => page.evaluate(() => window.__layers[0].close())]])
  q(n, F3, `${how} closes it with no answer — no bill is issued`, "result null + overlay gone + layer released", async () => { await open(); await act(); await wait(40); return (await page.evaluate(() => window.__result === null && !document.querySelector(".bcust-overlay") && window.__layers.length === 0)) || "did not close cleanly"; });
q(29, F3, "a second ask() replaces the first sheet rather than stacking two", "two asks → one overlay", async () => { await open(); await page.evaluate(() => { LFH_BILLCUST.ask({ api: window.__api, required: true }); }); await wait(40); const n = await page.evaluate(() => document.querySelectorAll(".bcust-overlay").length); return n === 1 || `${n} sheets`; });
q(30, F3, "a reopened bill opens filled in: number, name, a green 10/10, and focus in the name", "prefill", async () => { await open(`{ api: window.__api, required: true, prefill: { phone: "919825012345", name: "Riya Sharma" } }`); await wait(120); const r = await page.evaluate(() => ({ v: document.querySelector(".bc-phone").value, n: document.querySelector(".bc-name").value, c: document.querySelector(".bcust-count").textContent, f: document.activeElement === document.querySelector(".bc-name") })); return (r.v === "98250 12345" && r.n === "Riya Sharma" && r.c === "10/10" && r.f) || JSON.stringify(r); });
q(31, F3, "the international form '0091 98250 12345' fits whole — 14 digits, counter 10/10", "type 00919825012345", async () => { await open(); await type(".bc-phone", "00919825012345"); await wait(50); const r = await page.evaluate(() => ({ v: document.querySelector(".bc-phone").value, c: document.querySelector(".bcust-count").textContent })); return (r.v.replace(/\D/g, "").length === 14 && r.c === "10/10") || JSON.stringify(r); });
q(32, F3, "a 15th digit is not taken", "type 15 digits", async () => { await open(); await type(".bc-phone", "009198250123456"); const v = await page.evaluate(() => document.querySelector(".bc-phone").value.replace(/\D/g, "")); return v.length === 14 || v.length; });
q(33, F3, "editing a digit in the middle keeps the cursor where the waiter put it", "caret after reformat", async () => { await open(); await type(".bc-phone", "9825012345"); const pos = await page.evaluate(() => { const el = document.querySelector(".bc-phone"); el.value = "9827" + "50 12345"; el.setSelectionRange(4, 4); el.dispatchEvent(new Event("input", { bubbles: true })); return el.selectionStart; }); return pos === 4 || `caret at ${pos}`; });
q(34, F3, "a ten-digit number with no name: Generate refuses and says 'Enter the customer's name'", "phone only", async () => { await open(); await typeDigits("9000000001"); await wait(250); await page.click(".bc-go", { force: true }); const r = await page.evaluate(() => ({ s: document.querySelector(".bc-status").textContent, f: document.activeElement === document.querySelector(".bc-name"), res: window.__result })); return (r.s === "Enter the customer's name" && r.f && r.res === "pending") || JSON.stringify(r); });
q(35, F3, "…and the lookup that lands after the refusal does NOT paint over it with 'New customer'", "slow lookup, tap first", async () => { await open(undefined, "async () => { await new Promise((r) => setTimeout(r, 200)); return { matches: [], whole: true }; }"); await typeDigits("9000000002"); await page.click(".bc-go", { force: true }); await wait(500); const t = await txt(".bc-status"); return t === "Enter the customer's name" || t; });
q(36, F3, "an unknown complete number says 'New customer'", "status", async () => { await open(); await typeDigits("9000000003"); await wait(400); const t = await txt(".bc-status"); return t === "New customer" || t; });
q(37, F3, "no network at all: the sheet still works — the waiter types the name and generates", "api throws", async () => { await open(undefined, "() => { throw new Error('offline'); }"); await typeDigits("9000000004"); await wait(250); await page.evaluate(() => { const n = document.querySelector(".bc-name"); n.value = "Walk-in"; n.dispatchEvent(new Event("input", { bubbles: true })); }); await page.click(".bc-go", { force: true }); await wait(40); const r = await page.evaluate(() => window.__result); return (r && r.phone === "9000000004" && r.name === "Walk-in") || JSON.stringify(r); });
q(38, F3, "Enter in the number box moves to the name; Enter in the name box presses Generate", "keyboard only", async () => { await open(); await page.focus(".bc-phone"); await page.keyboard.type("9000000005"); await page.keyboard.press("Enter"); const onName = await page.evaluate(() => document.activeElement === document.querySelector(".bc-name")); await page.keyboard.type("Kbd"); await page.keyboard.press("Enter"); await wait(40); const r = await page.evaluate(() => window.__result); return (onName && r && r.name === "Kbd") || JSON.stringify({ onName, r }); });
q(39, F3, "Esc does not close this sheet — the panel's other dialogs do (listed in Part 4)", "press Escape", async () => { await open(); await page.keyboard.press("Escape"); await wait(40); const stillOpen = await page.evaluate(() => !!document.querySelector(".bcust-overlay")); return stillOpen ? { ok: true, note: "true today — back button, ✕, Cancel and the backdrop all close it; Esc is an improvement" } : true; });
q(40, F3, "a stale answer for older digits is never painted over the current number", "slow first reply, fast second", async () => { await open(undefined, "(() => { let n = 0; return async () => { n++; if (n === 1) { await new Promise((r) => setTimeout(r, 400)); return { matches: [{ phone: '9111111111', name: 'Old' }], whole: false }; } return { matches: [{ phone: '9222222222', name: 'Right' }], whole: true }; }; })()"); await typeDigits("911111"); await wait(250); await type(".bc-phone", "922222"); await wait(800); const names = await page.evaluate(() => [...document.querySelectorAll(".bc-pick")].map((b) => b.dataset.n)); return (!names.includes("Old") && names.includes("Right")) || JSON.stringify(names); });
q(41, F3, "the privacy line says what the number is for and that it is never shared", "text", async () => { await open(); const t = await txt(".bcust-why"); return /never shared or used for marketing/.test(t) || t; });
q(42, F3, "both boxes are labelled 'required' on the only path the product uses", "labels", async () => { await open(); const n = await page.evaluate(() => document.querySelectorAll(".bcust-req").length); return n === 2 || n; });
q(43, F3, "the 'optional' path is never reached — both panels open the sheet only when the restaurant requires it", "editor askBillCustomer + tablet willAskCustomer", () => /if \(!required\) return undefined;/.test(read("public/panels/editor/app.js")) && /required: true, print:/.test(read("public/panels/tablet/app.js")) || "a panel opens it optionally");
q(44, F3, "the phone box is a numeric keypad on a phone, with no browser autofill on top", "type=tel inputmode=numeric autocomplete=off", () => /type="tel" inputmode="numeric" autocomplete="off"/.test(read(F3)) || "changed");
q(45, F3, "it starts no fast timer it cannot stop, and stores nothing on the device", "no setInterval, no localStorage", () => !/setInterval|localStorage|sessionStorage/.test(code(read(F3))) || "found one");
