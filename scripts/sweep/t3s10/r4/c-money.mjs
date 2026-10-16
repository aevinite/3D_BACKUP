// Round 4 · C — THE BILL ON THE PHONE AGAINST THE BILL THE DATABASE WOULD WRITE, for random baskets built by hand.
//
// A diner builds a basket the way a diner does — taps Add on random dishes, customises the espresso (size,
// milk, extras, quantity), taps − and + on the bill — and presses Place order for table 29. The order NEVER
// leaves the phone: the browser catches the request to /api/guest/place-order (and blocks every other way an
// order could go out), and the exact basket it carried is priced by the real database inside a rolled-back
// transaction (./db.mjs inTx). What the bill SHOWED must equal what the database WOULD store — subtotal, GST
// and total — and the basket sent must be the basket on screen. Nothing is written anywhere.
import { check, rng } from "./h4.mjs";
import { inTx, lit, FH_ID } from "./db.mjs";
import { page, open, openBill } from "./live4.mjs";
import { sql } from "./db.mjs";
import { minorRound } from "../../../../lib/money.mjs";

const money = (s) => { const m = String(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
async function readBill(p) {
  return p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#cart-panel .bill-line")].flatMap((l) => { const [k, ...v] = l.innerText.split("\n").map((x) => x.trim()).filter(Boolean); const key = k.replace(/\s*\(.*\)/, "").toLowerCase(); const pct = (k.match(/\(([\d.]+)%\)/) || [])[1]; return pct ? [[key, v.join(" ")], [key + "%", pct]] : [[key, v.join(" ")]]; })));
}
// every way an order could leave this phone is caught here: the guest door answers a refusal, and any direct
// database order call is cut off
async function catchOrders(p, answer) {
  const sent = [];
  await p.route("**/api/guest/place-order", (r) => { try { sent.push(r.request().postDataJSON()); } catch { sent.push(null); } r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); });
  await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
  return sent;
}
async function buildBasket(p, r) {
  const n = await p.locator('button[aria-label^="Add "][aria-label$=" to cart"]').count();
  const picks = 1 + Math.floor(r() * 4);
  for (let i = 0; i < picks; i++) {
    const k = Math.floor(r() * n), times = 1 + Math.floor(r() * 3);
    // the list of Add buttons changes as dishes go into the basket, so the k-th is taken of the list AS IT IS NOW
    for (let t = 0; t < times; t++) { await p.evaluate((k) => { const all = document.querySelectorAll('button[aria-label^="Add "][aria-label$=" to cart"]'); const b = all[k % all.length]; if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }, k); await p.waitForTimeout(350); }
  }
  let custom = null;
  if (r() < 0.75) {   // the espresso, customised in its popup
    await p.locator('button[aria-label="Customize and add Espresso"]').evaluate((b) => { b.scrollIntoView({ block: "center" }); b.click(); });
    await p.locator(".order-confirm").waitFor({ timeout: 8000 });
    const chips = await p.locator(".order-confirm .oc-choice").count();
    for (let c = 0; c < chips; c++) if (r() < 0.45) await p.locator(".order-confirm .oc-choice").nth(c).click();
    const plus = Math.floor(r() * 3); for (let q = 0; q < plus; q++) await p.locator(".order-confirm button", { hasText: "+" }).last().click();
    // the popup's TOTAL is for its own quantity; what must match the order is the price of ONE (the bill's
    // − / + taps below may change how many there are afterwards)
    const pop = await p.locator(".order-confirm").evaluate((m) => ({ t: (m.innerText.match(/TOTAL\s*₹[\d,.]+/i) || [""])[0], q: (m.innerText.match(/−\s*(\d+)\s*\+/) || [])[1] }));
    custom = money(pop.t) / (Number(pop.q) || 1);
    await p.locator(".order-confirm-add").click(); await p.waitForTimeout(800);
  }
  await openBill(p);
  const lines = await p.locator("#cart-panel .cart-qty-btn").count();
  for (let i = 0; i < Math.floor(r() * 4); i++) { const b = Math.floor(r() * lines); await p.locator("#cart-panel .cart-qty-btn").nth(b).click().catch(() => {}); await p.waitForTimeout(250); }
  return { custom };
}
const SEEDS = Array.from({ length: 14 }, (_, i) => i + 1);
let FH = null;
for (const seed of SEEDS) {
  check(`R4-C${String(seed).padStart(2, "0")}`, "C", `random basket #${seed}: subtotal, GST and total on the bill equal what the database would store for the basket the phone sent — to the rupee, as the printed bill rounds it`, async () => {
    FH ||= await FH_ID(); const r = rng(4400 + seed);
    const w = [360, 390, 768][seed % 3], skin = seed % 2 ? "dark" : "light";
    const { ctx, p, errs } = await page({ w, h: 900, skin });
    try {
      const sent = await catchOrders(p, { ok: false, reason: "sold_out", item: "round-4 test (nothing was sent)" });
      await open(p); const { custom } = await buildBasket(p, r);
      const shown = await readBill(p);
      const cart = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]"));
      if (!cart.length) return "skip: the basket ended empty (every line was tapped down to nothing)";
      await p.locator("#cart-table").fill("29"); await p.locator(".cart-foot .btn-gold").click();
      for (let i = 0; i < 20 && !sent.length; i++) await p.waitForTimeout(300);
      if (!sent.length || !sent[0]) return { ok: false, note: "the phone sent no order to the guest door" };
      const body = sent[0];
      const { r: ans, x } = await inTx(`lfh_place_order_public(${lit(body.table)}, ${lit(JSON.stringify(body.items))}::jsonb, ${lit("{" + (body.allergies || []).map((a) => '"' + String(a).replace(/"/g, "") + '"').join(",") + "}")}, '${FH}')`,
        `SELECT row_to_json(o) INTO x FROM (SELECT table_number, subtotal, tax, total, items FROM orders WHERE id = (r->>'order_id')::uuid) o;`);
      if (ans.ok !== true) return { ok: false, note: `the database would refuse this basket: ${JSON.stringify(ans).slice(0, 120)}` };
      const sub = money(shown.subtotal), gst = money(shown.gst ?? "0"), tot = money(shown.total);
      // the RUPEE rule (lib/format.ts toMinor, the printed bill's billRows): the GST row in whole rupees,
      // the total in whole rupees — never a paisa figure on an Indian bill. Prices are whole rupees, so
      // the phone's subtotal + rounded GST IS the paper's rounded total.
      const want = { sub: Number(x.subtotal), gst: minorRound(Number(x.tax), 1), tot: Math.round(Number(x.total)) };
      const same = (a, b) => Math.abs(a - b) < 0.005;
      const liveRate = Number((await sql(`select tax_rate from settings where restaurant_id='${FH}'`))[0].tax_rate);
      const qtySent = body.items.reduce((s, it) => s + (Number(it.qty) || 1), 0), qtyCart = cart.reduce((s, it) => s + it.qty, 0);
      const espresso = x.items.find((it) => it.id === "espresso");
      const espressoLines = x.items.filter((it) => it.id === "espresso");
      const customOk = custom === null || !espresso || espressoLines.some((it) => same(custom, Number(it.price)));
      const ok = same(sub, want.sub) && same(gst, want.gst) && same(tot, want.tot) && body.table === "29" && body.restaurantId === FH && qtySent === qtyCart && customOk && !errs.length;
      const why = [!same(sub, want.sub) && "subtotal", !same(gst, want.gst) && "GST", !same(tot, want.tot) && "total", body.table !== "29" && `table ${body.table}`, body.restaurantId !== FH && "restaurant", qtySent !== qtyCart && `sent ${qtySent} dishes, basket ${qtyCart}`, !customOk && `espresso popup ₹${custom} each but the order prices it ₹${espressoLines.map((it) => it.price).join("/")}`, errs.length && "page error"].filter(Boolean);
      return { ok, note: `${why.length ? "WRONG: " + why.join(", ") + " · " : ""}${w}px ${skin} · ${cart.length} lines, ${qtyCart} dishes · screen ₹${sub} + ₹${gst} = ₹${tot} · database ₹${want.sub} + ₹${want.gst} = ₹${want.tot} (exact ₹${x.tax} / ₹${x.total})${shown["gst%"] && Number(shown["gst%"]) / 100 !== liveRate ? ` · THE BILL SAID ${shown["gst%"]}% WHILE THE RESTAURANT'S RATE IS ${liveRate * 100}%` : ""}${custom !== null ? ` · espresso popup ₹${custom} each` : ""}${errs.length ? " · page error " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
}
check("R4-C20", "C", "after an order is accepted, the live status card's total is the database's total (nothing sent — the answer is played back)", async () => {
  FH ||= await FH_ID();
  const { ctx, p } = await page({ w: 390 });
  try {
    const fake = "00000000-0000-4000-8000-0000000000c4";
    const sent = await catchOrders(p, { ok: true, order_id: fake });
    await p.route("**/rest/v1/rpc/get_order_status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "received", table_number: "29", created_at: new Date().toISOString() }]) }));
    await open(p);
    for (const k of [0, 0, 3, 7]) { await p.evaluate((k) => { const b = document.querySelectorAll('button[aria-label^="Add "][aria-label$=" to cart"]')[k]; b.scrollIntoView({ block: "center" }); b.click(); }, k); await p.waitForTimeout(400); }
    await openBill(p); await p.locator("#cart-table").fill("29"); await p.locator(".cart-foot .btn-gold").click();
    for (let i = 0; i < 20 && !sent.length; i++) await p.waitForTimeout(300);
    const body = sent[0];
    const { x } = await inTx(`lfh_place_order_public('29', ${lit(JSON.stringify(body.items))}::jsonb, '{}', '${FH}')`, `SELECT row_to_json(o) INTO x FROM (SELECT total FROM orders WHERE id = (r->>'order_id')::uuid) o;`);
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(800);
    await p.locator(".cart-tabs button", { hasText: "Live status" }).click().catch(() => {}); await p.waitForTimeout(1500);
    const card = await p.locator("#cart-panel").innerText();
    const shown = money((card.match(/Total\s*₹\s*[\d,.]+/i) || [""])[0]);
    const recorded = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]")[0]?.total);
    return { ok: Math.abs(shown - Number(x.total)) < 0.005 && Math.abs(recorded - Number(x.total)) < 0.005, note: `card says ₹${shown}, the phone recorded ₹${recorded}, the database would store ₹${x.total}` };
  } finally { await ctx.close(); }
});
