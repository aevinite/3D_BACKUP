// Round 4 · F — THE ORDERING SCREENS IN THE OTHER TWO BROWSER ENGINES: WebKit (what every iPhone runs, Chrome
// and Safari alike) and Firefox, each at a phone's width and a laptop's. Round 3 drove Chromium only.
// Orders and calls are caught in the browser (nothing is sent), and the offline step closes its page while
// still offline (the round-3 rule).
import { check } from "./h4.mjs";
import { page, open, addDish, openBill, closeAll } from "./live4.mjs";

const money = (s) => Number((String(s).replace(/,/g, "").match(/\d+(?:\.\d+)?/) || ["NaN"])[0]);
async function catchAll(p) {
  const got = { order: [], call: [] };
  await p.route("**/api/guest/place-order", (r) => { got.order.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }); });
  await p.route("**/api/guest/call-waiter", (r) => { got.call.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await p.route("**/rest/v1/rpc/lfh_call_waiter_table*", (r) => { got.call.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
  return got;
}
const spill = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const RUNS = [["webkit", 390, true], ["webkit", 1280, false], ["firefox", 390, true], ["firefox", 1280, false]];
// Firefox must be installed AND able to start: on this Mac (macOS 27) Playwright's Firefox 155 exits with
// "Could not find profile folder" (2026-10-16) — every Firefox check then SKIPS saying so, never passes.
const { firefox } = await import("playwright");
const FF = await firefox.launch().then(async (b) => { await b.close(); return ""; }, (e) => String(e).match(/Executable doesn't exist|Could not find profile folder/)?.[0] || "it would not start");
let n = 0;
for (const [engine, w, touch] of RUNS) {
  if (engine === "firefox" && FF) { n++; for (let k = 1; k <= 6; k++) check(`R4-F${n}${k}`, "F", `Firefox at ${w}px: check ${k}`, async () => `skip: Firefox cannot start on this Mac (${FF})`); continue; }
  const tag = `${engine === "webkit" ? "iPhone/Safari engine" : "Firefox"} at ${w}px`; n++;
  check(`R4-F${n}1`, "F", `${tag}: two dishes in the basket, the bill adds up (subtotal + 5% GST in rupees = total), nothing spills sideways, no page error`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      await catchAll(p); await open(p); await addDish(p, 0); await addDish(p, 5); await openBill(p);
      const rows = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#cart-panel .bill-line")].map((l) => { const [k, ...v] = l.innerText.split("\n").map((x) => x.trim()).filter(Boolean); return [k.replace(/\s*\(.*\)/, "").toLowerCase(), v.join(" ")]; })));
      const s = money(rows.subtotal), g = money(rows.gst), t = money(rows.total); const sp = await spill(p);
      return { ok: s > 0 && g === Math.round(s * 0.05) && t === s + g && sp <= 1 && !errs.length, note: `₹${s} + ₹${g} = ₹${t} · spill ${sp}px${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
  check(`R4-F${n}2`, "F", `${tag}: the espresso popup — Large and Oat chosen, two of them — goes into the bill as one line at its price`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      await catchAll(p); await open(p);
      await p.locator('button[aria-label="Customize and add Espresso"]').evaluate((b) => { b.scrollIntoView({ block: "center" }); b.click(); });
      await p.locator(".order-confirm").waitFor({ timeout: 10000 });
      await p.locator(".order-confirm .oc-choice", { hasText: "Large" }).click(); await p.locator(".order-confirm .oc-choice", { hasText: "Oat" }).click();
      await p.locator(".order-confirm button", { hasText: "+" }).last().click();
      const pop = await p.locator(".order-confirm").innerText();
      await p.locator(".order-confirm-add").click(); await p.waitForTimeout(700); await openBill(p);
      const cart = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]"));
      const line = cart.find((c) => c.id === "espresso");
      const shown = money((pop.match(/TOTAL\s*₹[\d,.]+/i) || [""])[0]);
      return { ok: !!line && line.qty === 2 && shown === (250 + 42 + 34) * 2 && !errs.length, note: `popup TOTAL ₹${shown} · bill line ${line ? `${line.qty} × ${(line.options || []).map((o) => o.label).join("+")}` : "missing"}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
  check(`R4-F${n}3`, "F", `${tag}: the bell — a table typed as ٤٢ (Arabic digits) reads 42, and "Water" rings for table 42 (item 43)`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      const got = await catchAll(p); await open(p);
      await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900);
      await p.locator("#chef-table").fill("٤٢"); const box = await p.locator("#chef-table").inputValue();
      // 42 is above French House's 30 tables: the popup refuses it on the phone — so 12, written ١٢, is rung
      await p.locator("#chef-table").fill("١٢"); const box2 = await p.locator("#chef-table").inputValue();
      await p.locator(".chef-reason").nth(1).click();
      for (let i = 0; i < 20 && !got.call.length; i++) await p.waitForTimeout(300);
      const b = got.call[0] || {}; const t = String(b.p_table || b.table || "");
      return { ok: box === "42" && box2 === "12" && t === "12" && !errs.length, note: `typed ٤٢ → box "${box}" · typed ١٢ → box "${box2}" · rang table ${t || "(nothing sent)"}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
  check(`R4-F${n}4`, "F", `${tag}: with no connection, Place order saves the basket on the phone and the "On this phone" list shows it`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      await catchAll(p); await open(p); await addDish(p, 2); await openBill(p);
      await p.locator("#cart-table").fill("29"); await ctx.setOffline(true);
      await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(2500);
      await closeAll(p); await p.locator(".gob-chip").click({ timeout: 8000 }); await p.waitForTimeout(800);
      const sheet = await p.locator(".gob-sheet").innerText().catch(() => "");
      return { ok: /Waiting to send/i.test(sheet) && /×/.test(sheet) && !errs.length, note: `saved list: "${sheet.replace(/\s+/g, " ").slice(0, 110)}"${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }   // closed while still offline: nothing it saved can ever be sent
  });
  check(`R4-F${n}5`, "F", `${tag}: the dish page's Rate tab — tapping 4 stars then 2 shows the score 4 then 2`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      await p.route("**/rest/v1/rpc/lfh_submit_review*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
      await open(p, "/r/french-house/item/espresso?cat=coffee"); await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(700);
      await p.locator(".sr-toggle").nth(3).click(); await p.waitForTimeout(400); const a = await p.locator(".sr-score-num").innerText().catch(() => "?");
      await p.locator(".sr-toggle").nth(1).click(); await p.waitForTimeout(400); const b = await p.locator(".sr-score-num").innerText().catch(() => "?");
      return { ok: /4/.test(a) && /2/.test(b) && !errs.length, note: `score ${a} → ${b}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
  check(`R4-F${n}6`, "F", `${tag}: the browser's Back closes the open bill and leaves the diner on the menu`, async () => {
    const { ctx, p, errs } = await page({ engine, w, h: 900, touch });
    try {
      await catchAll(p); await open(p); await addDish(p, 1); await openBill(p);
      const before = await p.locator("#cart-panel.open").count(); await p.goBack().catch(() => {}); await p.waitForTimeout(1200);
      const after = await p.locator("#cart-panel.open").count();
      return { ok: before === 1 && after === 0 && /\/r\/french-house\/menu/.test(p.url()) && !errs.length, note: `bill open ${before} → ${after} · ${p.url().replace(/^https?:\/\/[^/]+/, "")}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
}
