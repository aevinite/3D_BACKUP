// Round 4 · E — THE SAME DINER THROUGH EVERY DOOR. A guest reaches the menu three ways — /menu, /r/<slug>/menu
// and a printed table QR (/q/<code>) — and every rule for the basket, the bell and the dish page must hold in
// all three (PR #761's lesson). A fourth door, another restaurant's menu, proves an order and a call from it
// name THAT restaurant and never French House. Orders and calls are caught in the browser: nothing is sent.
import { check } from "./h4.mjs";
import { sql, FH_ID } from "./db.mjs";
import { page, open, addDish, openBill } from "./live4.mjs";

let R = null;
async function ctx() {
  if (R) return R;
  const fh = await FH_ID();
  const [pp] = await sql(`select id, slug, name from restaurants where slug='pizza-palace'`);
  const [fhr] = await sql(`select name from restaurants where id='${fh}'`);
  const [q7] = await sql(`select code from table_qr_codes where restaurant_id='${fh}' and table_number=7`);
  R = { fh, fhName: fhr.name, pp, DOORS: [["/menu?table=7", fh, "7"], ["/r/french-house/menu?table=7", fh, "7"], [`/q/${q7.code}`, fh, "7"], ["/r/pizza-palace/menu?table=3", pp.id, "3"]] };
  return R;
}
// catch everything that could leave the phone as an order or a call, answer it, keep what it carried
async function catchAll(p) {
  const got = { order: [], call: [] };
  await p.route("**/api/guest/place-order", (r) => { got.order.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }); });
  await p.route("**/api/guest/call-waiter", (r) => { got.call.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await p.route("**/rest/v1/rpc/lfh_call_waiter_table*", (r) => { got.call.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
  return got;
}
for (let d = 0; d < 4; d++) {
  const tag = ["/menu", "/r/<slug>/menu", "/q/<code>", "another restaurant"][d];
  check(`R4-E${d + 1}1`, "E", `door ${tag}: the menu opens on the right restaurant with no page error, and the table it carries is remembered`, async () => {
    const { DOORS, fhName, pp } = await ctx(); const [path, , table] = DOORS[d];
    const { ctx: c, p, errs } = await page({ w: 390 });
    try {
      await open(p, path);
      // the brand may be set in its own capitals and across lines ("My / little French house"): compared as words
      const url = p.url(); const text = (await p.locator("body").innerText()).toLowerCase().replace(/\s+/g, " ");
      const name = d === 3 ? pp.name : fhName; const low = (n) => n.toLowerCase().replace(/\s+/g, " ").split(" ").slice(-2).join(" ");   // "french house": the hero animates the brand letter by letter, so its first word may sit apart
      const remembered = await p.evaluate(() => Object.keys(localStorage).filter((k) => /scanned|table/i.test(k)).map((k) => localStorage.getItem(k)).join("|"));
      const leak = d === 3 && text.includes(low(fhName));
      return { ok: text.includes(low(name)) && !leak && !errs.length && remembered.includes(table), note: `${path} → ${url.replace(/^https?:\/\/[^/]+/, "")} · shows "${name}"${leak ? ` AND "${fhName}"` : ""} · remembers table ${table}: ${remembered.includes(table)}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await c.close(); }
  });
  check(`R4-E${d + 1}2`, "E", `door ${tag}: Place order carries THIS restaurant and THIS table, with the table box already filled`, async () => {
    const { DOORS } = await ctx(); const [path, rid, table] = DOORS[d];
    const { ctx: c, p } = await page({ w: 390 });
    try {
      const got = await catchAll(p); await open(p, path); await addDish(p, 0); await addDish(p, 4); await openBill(p);
      const box = await p.locator("#cart-table").inputValue().catch(() => "(no box)");
      if (!box) await p.locator("#cart-table").fill(table);
      await p.locator(".cart-foot .btn-gold").click();
      for (let i = 0; i < 20 && !got.order.length; i++) await p.waitForTimeout(300);
      const b = got.order[0];
      return { ok: !!b && b.restaurantId === rid && b.table === table && box === table, note: `box said "${box}" · sent restaurant ${b?.restaurantId === rid ? "✓" : b?.restaurantId}, table ${b?.table}` };
    } finally { await c.close(); }
  });
  check(`R4-E${d + 1}3`, "E", `door ${tag}: the bell rings for THIS restaurant and THIS table`, async () => {
    const { DOORS } = await ctx(); const [path, rid, table] = DOORS[d];
    const { ctx: c, p } = await page({ w: 390 });
    try {
      const got = await catchAll(p); await open(p, path);
      await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900);
      const box = await p.locator("#chef-table").inputValue();
      await p.locator(".chef-reason").nth(1).click();
      for (let i = 0; i < 20 && !got.call.length; i++) await p.waitForTimeout(300);
      const b = got.call[0] || {};
      const sentRid = b.p_restaurant_id || b.restaurantId, sentT = b.p_table || b.table;
      return { ok: sentRid === rid && String(sentT) === table && box === table, note: `box "${box}" · sent restaurant ${sentRid === rid ? "✓" : sentRid}, table ${sentT}` };
    } finally { await c.close(); }
  });
  check(`R4-E${d + 1}4`, "E", `door ${tag}: a dish page opened from this menu keeps the restaurant and the table, and its Rate tab answers`, async () => {
    const { DOORS } = await ctx(); const [path, , table] = DOORS[d];
    const { ctx: c, p, errs } = await page({ w: 390 });
    try {
      await open(p, path);
      const href = await p.locator("a.item-card-link").first().getAttribute("href");
      await p.goto(new URL(href, p.url()).href, { waitUntil: "domcontentloaded" });
      await p.locator(".review-tab-btn").first().waitFor({ timeout: 60000 }); await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(800);
      const stars = await p.locator(".sr-toggle").count();
      await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {}); await p.waitForTimeout(1500);
      const still = await p.evaluate(() => Object.keys(localStorage).filter((k) => /scanned|table/i.test(k)).map((k) => localStorage.getItem(k)).join("|"));
      const same = d === 3 ? /pizza-palace/.test(href) : /french-house/.test(href);
      return { ok: same && stars === 5 && still.includes(table) && !errs.length, note: `${href} · ${stars} stars · table ${table} still remembered: ${still.includes(table)}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await c.close(); }
  });
}
