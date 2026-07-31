// Final pass over everything shipped 2026-07-30/31: the bill's customer capture, the
// redesigned printed bill, and the two Customers pages. Runs against the QA server on the
// DEV database — never AV live (that stack is verified read-only, separately).
//
// Discipline: ONE login per role for the whole run (a login inside a loop is what pinged
// the owner's phone about himself), and every fixture it creates is cleaned up at the end.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "./sweep/login.mjs";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "") || "http://localhost:4000";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RID1 = "00000000-0000-0000-0000-000000000001";      // french-house

const results = [];
// Wait for a condition instead of guessing a sleep: this database is shared with other
// sessions' load tests, and a fixed wait made the guard report their saturation as our bug.
const until = async (fn, ms = 9000, step = 250) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* keep waiting */ }
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, step));
  }
};
const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());
const ok = (name, pass, note = "") => { results.push({ name, pass, note }); console.log(`${pass ? "  ✓" : "  ✗"} ${name}${note ? "  — " + note : ""}`); };
const section = (t) => console.log("\n" + t);
const cleanupPhones = new Set();

const b = await chromium.launch();

/* ─────────────── A. the money + gate rules on the server ─────────────── */
section("A. Server rules — no bill without a customer");
const mctx = await b.newContext();
await loginAs(mctx, "manager", BASE);                       // ONE manager login
const octx = await b.newContext();
await loginAs(octx, "owner", BASE);                         // ONE owner login
const actx = await b.newContext();
// Zero-request admin auth: present the gate cookie instead of signing in. A login per run
// is what pushed the owner's own panel over the admin login limit and pinged his phone.
await actx.addCookies([adminCookie(BASE)]);

// The guard MAKES its own bill instead of hunting for an existing one. Hunting meant each run
// consumed a fixture (it issues an invoice on it), so a second run had nothing to test and
// reported nine failures that were entirely the test's fault. Every row created here is torn
// down at the end, on a table number far above any real floor.
// A table number unique to THIS run, far above any real floor: two runs must never collide
// (the app rightly refuses a second open session on the same table).
const RUN_TAG = String(Date.now()).slice(-5);
const FIXTURE_TABLES = [`9${RUN_TAG}1`, `9${RUN_TAG}2`, `9${RUN_TAG}3`];
let fixtureIdx = 0;
const madeSessions = [];
const freshBill = async () => {
  const table = FIXTURE_TABLES[fixtureIdx++];
  if (!table) return null;
  const { data: ses, error: e1 } = await sb.from("sessions")
    .insert({ restaurant_id: RID1, table_number: table, status: "open", auto_approve: true })
    .select("id, table_number").single();
  if (e1) { console.log("    (could not create a test bill: " + e1.message + ")"); return null; }
  const { error: e2 } = await sb.from("orders").insert({
    restaurant_id: RID1, session_id: ses.id, table_number: table,
    items: [{ title: "QA Test Dish", qty: 1, price: "100.00", status: "received" }],
    subtotal: 100, tax: 5, total: 105, status: "received", payment_status: "unpaid",
  });
  if (e2) console.log("    (test order not created: " + e2.message + ")");
  madeSessions.push(ses.id);
  return ses;
};
let s1 = await freshBill();
if (s1) {
  const post = (body) => mctx.request.post(`${BASE}/api/editor/sessions/${s1.id}/invoice`, { data: body });
  const r1 = await post({});
  ok("refuses with no customer", r1.status() === 400, (await r1.json()).error);
  const r2 = await post({ cust_phone: "98250", cust_name: "Half" });
  ok("refuses a short number", r2.status() === 400, (await r2.json()).error);
  const r3 = await post({ cust_phone: "9825012345" });
  ok("refuses a missing name", r3.status() === 400, (await r3.json()).error);
  const r4 = await post({ cust_phone: "+91 98765 43210", cust_name: "QA Guest" });
  const j4 = await r4.json();
  cleanupPhones.add("9876543210");
  ok("accepts both and issues the invoice", r4.status() === 200 && j4.invoice_no != null, `invoice #${j4.invoice_no}`);
  ok("+91 spelling stored as 10 digits", j4.cust_phone === "9876543210", j4.cust_phone);
} else ok("a fresh un-invoiced bill was available", false, "no open session on #1 — cannot test the gate");

/* ─────────────── B. one person, one record ─────────────── */
section("B. One person, one record");
const spellings = ["9876543210", "+91 98765 43210", "098765 43210"];
for (const sp of spellings) {
  const { data } = await sb.rpc("lfh_customer_phone_search", { p_restaurant_id: RID1, p_prefix: sp, p_limit: 5 });
  const hit = (data || []).find((r) => r.phone === "9876543210");
  ok(`search finds them by "${sp}"`, !!hit);
}
const { count: dupes } = await sb.from("customers").select("phone", { count: "exact", head: true })
  .eq("restaurant_id", RID1).in("phone", ["9876543210", "919876543210", "09876543210"]);
ok("only ONE row exists for that person", dupes === 1, `${dupes} row(s)`);
const { data: shortP } = await sb.rpc("lfh_customer_phone_search", { p_restaurant_id: RID1, p_prefix: "98" });
ok("a 2-digit query returns nothing", Array.isArray(shortP) && shortP.length === 0);

/* ─────────────── C. the printed bill ─────────────── */
section("C. The printed bill");
const mp = await mctx.newPage();
const pageErrs = [];
mp.on("pageerror", (e) => pageErrs.push("manager: " + e.message));
await mp.goto(BASE + "/manager", { waitUntil: "domcontentloaded" });
await mp.waitForTimeout(8000);
const fr = mp.frames().find((f) => /panels\/editor/.test(f.url()));
ok("manager panel loads", !!fr);
if (fr) {
  const printed = await fr.evaluate(async () => {
    const orders = await api("GET", "/orders");
    state.data.orders = orders;
    const row = orders.find((o) => o.bill_cust_name || o.bill_cust_phone) || orders[0];
    if (!row) return { html: "", note: "no orders" };
    const os = orders.filter((o) => String(o.table_number) === String(row.table_number));
    let html = ""; const real = window.open;
    window.open = () => ({ document: { write: (s) => { html += s; }, close() {} }, print() {}, focus() {} });
    try { printBill(row.table_number, { invoice_no: os[0].invoice_no, bill_no: os[0].bill_no }, os); }
    finally { window.open = real; }
    return { html, cust: { n: row.bill_cust_name, p: row.bill_cust_phone } };
  });
  const h = printed.html || "";
  const css = h.slice(h.indexOf("<style"), h.indexOf("</style>"));
  ok("prints as ONE continuous slip", h.includes("size:80mm"));
  ok("column header prints once (thead as row-group)", h.includes("table-row-group"));
  ok("no grey ink left in the styles", !/color:\s*#(777|555|333|444)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("no dotted/dashed pale rules", !/dotted #e2e2e2|dashed #(999|aaa)/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("no italics", !/font-style:\s*italic/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("sans face", /Helvetica/.test(css));
  ok("TAX INVOICE strip", h.includes("Tax Invoice"));
  ok("thank-you line kept", /class="foot"/.test(h));
  ok("money columns sized from the bill", h.includes("colgroup"));
  ok("Customer + Mobile print when captured", h.includes(">Customer<") && h.includes(">Mobile<"));

  // the print switch OFF must hide both lines — flipped in the DATABASE, not just in JS
  await sb.from("settings").update({ bill_customer_print: false }).eq("restaurant_id", RID1);
  await until(async () => (await fr.evaluate(async () => {
    const all = await api("GET", "/all");
    if (all && all.settings) state.data.settings = all.settings;
    return state.data.settings.bill_customer_print;
  })) === false);
  const off = await fr.evaluate(async () => {
    const all = await api("GET", "/all");                    // reload settings from the server
    if (all && all.settings) state.data.settings = all.settings;
    const orders = state.data.orders || [];
    const row = orders.find((o) => o.bill_cust_name || o.bill_cust_phone) || orders[0];
    const os = orders.filter((o) => String(o.table_number) === String(row.table_number));
    let html = ""; const real = window.open;
    window.open = () => ({ document: { write: (s) => { html += s; }, close() {} }, print() {}, focus() {} });
    try { printBill(row.table_number, { invoice_no: os[0].invoice_no, bill_no: os[0].bill_no }, os); }
    finally { window.open = real; }
    return { html, printFlag: state.data.settings.bill_customer_print };
  });
  ok("panel picked up print=OFF from the server", off.printFlag === false, String(off.printFlag));
  ok("print switch OFF hides Customer + Mobile", !off.html.includes(">Customer<") && !off.html.includes(">Mobile<"));
  await sb.from("settings").update({ bill_customer_print: true }).eq("restaurant_id", RID1);

  /* ── D. the capture sheet itself ── */
  // Builds its OWN fixture: a bill with no customer AND no invoice. Picking "whatever session
  // exists" made this order-dependent — on a second run it grabbed a bill that already had a
  // customer, so the sheet opened PRE-FILLED and every assertion below drifted.
  section("D. The capture sheet");
  const s2 = await freshBill();
  if (!s2) {
    ok("a clean bill was available for the sheet", false, "no open, un-invoiced, un-captured bill on #1");
  } else {
    await fr.evaluate(async (sid) => {
      const all = await api("GET", "/all");
      if (all && all.settings) state.data.settings = all.settings;
      state.data.orders = await api("GET", "/orders");
      window.__p = generateInvoice(sid);
    }, s2.id);
    await mp.waitForTimeout(1300);
    const sheetOpen = !!(await fr.$(".bcust-overlay"));
    ok("sheet opens on invoice generation", sheetOpen);
    if (sheetOpen) {
      const val = (sel) => fr.evaluate((q) => { const el = document.querySelector(q); return el ? (el.value !== undefined ? el.value : el.textContent) : null; }, sel);
      const disabled = () => fr.evaluate(() => { const g = document.querySelector(".bc-go"); return g ? g.disabled : null; });
      const type = (sel, v) => fr.evaluate(([q, v2]) => { const e = document.querySelector(q); e.value = v2; e.dispatchEvent(new Event("input")); }, [sel, v]);

      ok("opens empty for a bill with no customer yet", (await val(".bc-phone")) === "" && (await val(".bc-name")) === "");
      ok("Generate is disabled while empty", (await disabled()) === true);
      // A disabled button never dispatches a click, so "disabled" IS the visible refusal —
      // the sheet can't swallow a tap here. (The in-code red "which box is missing" message
      // only exists for the case where the button is somehow reachable.)
      await fr.evaluate(() => document.querySelector(".bc-go").click());
      await mp.waitForTimeout(350);
      ok("a tap on the disabled button changes nothing", !!(await fr.$(".bcust-overlay")) && (await disabled()) === true);

      await type(".bc-phone", "9700011122");
      const newMsg = await until(async () => { const v = await val(".bc-status"); return v && v.toLowerCase().includes("new customer") ? v : null; });
      ok('unknown number says "New customer"', !!newMsg, newMsg || (await val(".bc-status")) || "(no answer in 9s — server slow?)");
      ok("still disabled without a name", (await disabled()) === true);

      await type(".bc-phone", "9876543210");
      const backMsg = await until(async () => { const v = await val(".bc-status"); return v && v.toLowerCase().includes("returning") ? v : null; });
      ok("known number is recognised", !!backMsg, backMsg || (await val(".bc-status")) || "(no answer in 9s — server slow?)");
      ok("known number auto-fills the name", (await until(async () => (await val(".bc-name")) === "QA Guest" || null)) === true, await val(".bc-name"));
      ok("Generate enabled once both are there", (await disabled()) === false);

      await fr.evaluate(() => history.back());
      await mp.waitForTimeout(900);
      ok("hardware back closes only the sheet", !(await fr.$(".bcust-overlay")));
      const after = (await sb.from("sessions").select("invoice_no, cust_phone").eq("id", s2.id).maybeSingle()).data;
      ok("backing out issued NO invoice and saved nothing", after?.invoice_no == null && after?.cust_phone == null,
        `invoice ${after?.invoice_no}, phone ${after?.cust_phone}`);
    }
  }
}

/* ─────────────── E. admin Customers page ─────────────── */
section("E. Admin Customers");
const ap = await actx.newPage();
ap.on("pageerror", (e) => pageErrs.push("admin: " + e.message));
await ap.goto(BASE + "/aevinite/customers", { waitUntil: "domcontentloaded" });
await ap.waitForSelector("table tbody tr", { timeout: 30000 }).catch(() => {});
await ap.waitForTimeout(1000);
const rowsA = await ap.evaluate(() => document.querySelectorAll("table tbody tr").length);
ok("list loads", rowsA > 0, rowsA + " rows");
const bodyA = await ap.evaluate(() => document.body.innerText);
ok("tiles + spread render", has(bodyA, "Came back") && has(bodyA, "Where the guests are"));
ok("freshness stamp shows", /counted /i.test(bodyA));
ok("NO money anywhere on the admin page", !/₹/.test(bodyA), (bodyA.match(/₹[^\s]*/g) || []).slice(0, 2).join(","));
// segments
for (const [label, expect] of [["Regulars", "visits >= 2"], ["First-timers", "visits < 2"], ["Blocked", "blocked"]]) {
  await ap.evaluate((l) => { const b2 = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === l); if (b2) b2.click(); }, label);
  // POLL for the filtered list. A fixed wait read the PREVIOUS segment's rows on a second run
  // and reported a perfectly good filter as broken.
  const settled = await until(async () => {
    const rows = await ap.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((r) => r.innerText));
    const chips = rows.join(" ");
    const good = label === "Regulars" ? rows.length > 0 && !/first visit/i.test(chips)
      : label === "First-timers" ? rows.length > 0 && !/regular/i.test(chips)
      : rows.length === 0 || /blocked/i.test(chips);
    return good ? rows.length : null;
  });
  ok(`segment "${label}" filters correctly (${expect})`, settled !== null,
    settled !== null ? settled + " rows" : (await ap.evaluate(() => document.querySelectorAll("table tbody tr").length)) + " rows, still mixed after 9s");
}
await ap.evaluate(() => { const b2 = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Everyone"); if (b2) b2.click(); });
await ap.waitForTimeout(1200);
// sort by visits
await ap.evaluate(() => { const b2 = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Most visits"); if (b2) b2.click(); });
const sorted = await until(async () => {
  const col = await ap.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((r) => Number(r.children[2]?.innerText.trim()) || 0));
  return col.length > 1 && col.every((v, i) => i === 0 || col[i - 1] >= v) ? col : null;
});
ok("sort by most visits is descending", !!sorted,
  sorted ? sorted.slice(0, 5).join(">") : (await ap.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((r) => Number(r.children[2]?.innerText.trim()) || 0))).slice(0, 5).join(">") + " after 9s");
// search
await ap.fill('input[aria-label="Search customers"]', "9876543210");
const byPhone = await until(async () => {
  const rows = await ap.evaluate(() => [...document.querySelectorAll("table tbody tr")].map((r) => r.innerText));
  return rows.length === 1 ? rows : null;
});
ok("search by mobile finds exactly that guest", !!byPhone && has(byPhone[0], "QA Guest"),
  byPhone ? "1 row" : (await ap.evaluate(() => document.querySelectorAll("table tbody tr").length)) + " rows after 9s");
await ap.fill('input[aria-label="Search customers"]', "QA Gue");
const byName = await until(async () => {
  const n = await ap.evaluate(() => document.querySelectorAll("table tbody tr").length);
  return n >= 1 && n < 50 ? n : null;
});
ok("search by name works too", !!byName, byName ? byName + " row(s)" : "not narrowed in 9s");
await ap.fill('input[aria-label="Search customers"]', "");
await until(async () => (await ap.evaluate(() => document.querySelectorAll("table tbody tr").length)) > 1);
// the cross-restaurant record
const shared = await actx.request.get(`${BASE}/api/admin/customers?phone=9825099001`);
const sj = await shared.json();
ok("cross-restaurant record lists every restaurant", (sj.detail?.restaurants || []).length >= 2, (sj.detail?.restaurants || []).length + " restaurants");
ok("cross-restaurant record has no money", !JSON.stringify(sj).includes("lifetime"));
// paging
const p0 = await (await actx.request.get(`${BASE}/api/admin/customers`)).json();
const p1 = await (await actx.request.get(`${BASE}/api/admin/customers?page=1`)).json();
const overlap = (p0.customers || []).some((a) => (p1.customers || []).some((c) => c.phone === a.phone && c.restaurant_id === a.restaurant_id));
ok("page 2 returns different rows", (p1.customers || []).length === 0 || !overlap);

/* ─────────────── F. owner Customers page ─────────────── */
section("F. Owner Customers");
const op = await octx.newPage();
op.on("pageerror", (e) => pageErrs.push("owner: " + e.message));
await op.goto(BASE + "/owner/customers", { waitUntil: "domcontentloaded" });
await op.waitForSelector("table tbody tr", { timeout: 30000 }).catch(() => {});
await op.waitForTimeout(1000);
const rowsO = await op.evaluate(() => document.querySelectorAll("table tbody tr").length);
ok("list loads", rowsO > 0, rowsO + " rows");
const oj = await (await octx.request.get(`${BASE}/api/owner/customers`)).json();
ok("only the owner's own restaurants appear", (oj.customers || []).every((c) => c.restaurant_id === RID1), [...new Set((oj.customers || []).map((c) => c.restaurant_id))].length + " restaurant(s)");
ok("tiles carry a cache stamp", !!oj.summary?.cachedAt);
ok("restaurant column is a real name", (oj.customers || [])[0]?.restaurantName && !/^—$/.test((oj.customers || [])[0].restaurantName), (oj.customers || [])[0]?.restaurantName);
// the guest record WITH money
await op.click("table tbody tr");
await op.waitForTimeout(3000);
const dlg = await op.$('[role="dialog"]');
ok("guest record opens", !!dlg);
if (dlg) {
  const t = await dlg.innerText();
  ok("record shows bills + spend + average", has(t, "bills") && has(t, "spent with you") && has(t, "average bill"));
  const money = await (await octx.request.get(`${BASE}/api/owner/customers?phone=9737638206`)).json();
  const d = money.detail || {};
  const sum = (d.bills || []).reduce((a, x) => a + Number(x.total || 0), 0);
  ok("lifetime total matches the listed bills", d.bill_count > (d.bills || []).length || Math.abs(sum - Number(d.lifetime)) < 1, `Σbills ${sum} vs lifetime ${d.lifetime}`);
  ok("average bill = lifetime ÷ bills", d.bill_count === 0 || Math.abs(Number(d.avg_bill) - Number(d.lifetime) / d.bill_count) < 1);
  ok("no ₹0 (all-cancelled) bill is listed as a visit", (d.bills || []).every((x) => Number(x.total) > 0));
  await op.keyboard.press("Escape");
  await op.waitForTimeout(500);
  ok("Escape closes the record", !(await op.$('[role="dialog"]')));
}

/* ─────────────── G. cheapness at scale ─────────────── */
section("G. Cheap at scale");
const c1 = await (await actx.request.get(`${BASE}/api/admin/customers`)).json();
const c2 = await (await actx.request.get(`${BASE}/api/admin/customers`)).json();
ok("tiles come from the snapshot cache", c1.cachedAt === c2.cachedAt, c1.cachedAt || "no stamp");
const c3 = await (await actx.request.get(`${BASE}/api/admin/customers?refresh=1`)).json();
ok("Refresh forces a live recount", !!c3.cachedAt);
const { data: fpBefore } = await sb.rpc("lfh_customers_fingerprint", { p_restaurant_id: null });
ok("change-detector answers", typeof fpBefore === "string" && fpBefore !== "none", String(fpBefore));
const idx = await sb.rpc("lfh_admin_customer_spread");
ok("per-restaurant spread is one grouped read", Array.isArray(idx.data) && idx.data.length > 0, (idx.data || []).length + " restaurants");

/* ─────────────── H. the whole thing on a phone ─────────────── */
section("H. On a phone (390px)");
for (const [label, ctx2, url] of [["admin", actx, "/aevinite/customers"], ["owner", octx, "/owner/customers"]]) {
  const ph = await ctx2.newPage();
  await ph.setViewportSize({ width: 390, height: 850 });
  await ph.goto(BASE + url, { waitUntil: "domcontentloaded" });
  // wait for real CONTENT before judging the layout — an empty page always "fits"
  const rows = await until(async () => (await ph.evaluate(() => document.querySelectorAll("table tbody tr").length)) || null, 20000);
  const wide = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  ok(`${label} page fits a phone with rows on it, no sideways scroll`, !wide && !!rows, (rows || 0) + " rows");
  await ph.close();
}

/* ─────────────── I. nothing shouted in the console ─────────────── */
section("I. Console");
ok("no page errors anywhere", pageErrs.length === 0, pageErrs.slice(0, 3).join(" | "));

/* ─────────────── cleanup ─────────────── */
// Put the bills this run created beyond the floor's view. NOT a hard delete: the database
// rightly refuses to erase an issued bill ("an issued bill cannot be hard-deleted — soft-delete
// it instead"), which is the compliance guard that stops a sale being made to disappear. So the
// test respects it and soft-deletes, exactly like the app's own recycle bin does.
const gone = new Date().toISOString();
for (const sid of madeSessions) {
  await sb.from("customer_visits").delete().eq("session_id", sid);
  await sb.from("orders").update({ deleted_at: gone, delete_reason: "verify:customers fixture" }).eq("session_id", sid);
  const hard = await sb.from("sessions").delete().eq("id", sid);
  if (hard.error) {
    await sb.from("sessions").update({ status: "closed", deleted_at: gone, delete_reason: "verify:customers fixture" }).eq("id", sid);
  }
}
for (const ph of cleanupPhones) {
  const { data: ses } = await sb.from("sessions").select("id").eq("restaurant_id", RID1).eq("cust_phone", ph);
  for (const s of ses || []) await sb.from("customer_visits").delete().eq("session_id", s.id);
  await sb.from("sessions").update({ cust_name: null, cust_phone: null }).eq("restaurant_id", RID1).eq("cust_phone", ph);
  await sb.from("customers").delete().eq("restaurant_id", RID1).eq("phone", ph);
}
await sb.from("settings").update({ bill_customer_print: true, bill_customer_required: true }).eq("restaurant_id", RID1);

const failed = results.filter((r) => !r.pass);
console.log(`\n${"=".repeat(64)}\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("\nFAILURES:"); failed.forEach((f) => console.log("  ✗ " + f.name + (f.note ? "  — " + f.note : ""))); }
await b.close();
process.exit(failed.length ? 1 : 0);
