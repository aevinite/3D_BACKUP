// scripts/sweep/t12r3/fh-banquet.mjs — band F, group 8: banquet billing from the waiter's handheld —
// the plate steppers, the totals, the optional table, the PIN, no internet, and every refusal.
// Fixture world: nothing is written anywhere; what the panel SENT is read back from the world's log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, typePin, toastsNow, clearToastsNow, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const ITEMS = [{ id: "bq-veg", title: "Veg buffet", price: 450, unit: "per plate" }, { id: "bq-kid", title: "Kids plate", price: 200, unit: "per child" }];
const scene = async (build, settings = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  w.banquet = { items: ITEMS.map((x) => ({ ...x })) };
  if (build) build(w);
  const { ctx, page } = await openWorld(w);
  return { w, ctx, page };
};
const open = async (page) => { await page.evaluate(() => openBanquet()); await page.waitForSelector("#bqBody [data-bq-qty], #bqBody .muted", { timeout: 8000 }); await settle(page, 200); };
const totals = (page) => page.evaluate(() => ({ sub: document.getElementById("bqSub").textContent, tax: document.getElementById("bqTax").textContent, tot: document.getElementById("bqTotal").textContent }));

export async function blockFH(R, id) {
  const { check } = R;
  {
    const { w, ctx, page } = await scene();
    await open(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#bqBody [data-bq-qty]")].map((i) => i.closest("div[style*='grid']").innerText.replace(/\s+/g, " ")));
    await check(id(), F, "🎪 Banquet billing lists each banquet item with its price and unit", H, () => ok(rows.length === 2 && /Veg buffet ₹450 per plate/.test(rows[0]) && /Kids plate ₹200 per child/.test(rows[1]), rows.join(" | ")));
    await check(id(), F, "…announced as a dialog, 'Banquet billing'", H, async () => ok(await page.evaluate(() => { const d = document.querySelector('[aria-label="Banquet billing"]'); return d && d.getAttribute("role") === "dialog" && d.getAttribute("aria-modal") === "true"; })));
    for (let i = 0; i < 3; i++) await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]');
    await page.click('[data-bq-step="1"][data-bq-id="bq-kid"]');
    const t = await totals(page);
    const rate = await page.evaluate(() => banquetRate());
    const sub = 3 * 450 + 200, tax = Math.round(sub * rate * 100) / 100;
    await check(id(), F, "…the steppers count plates and the totals follow: subtotal, tax at the restaurant's banquet rate, total", H, () => ok(t.sub === "₹1,550" && t.tax === `₹${tax.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`.replace(/\.0+$/, "") || t.tax.replace(/[₹,]/g, "") == String(Math.round(tax)), JSON.stringify(t) + " rate " + rate));
    await page.click('[data-bq-step="-1"][data-bq-id="bq-kid"]'); await page.click('[data-bq-step="-1"][data-bq-id="bq-kid"]');
    await check(id(), F, "…− never goes below zero", H, async () => ok(await page.evaluate(() => document.querySelector('[data-bq-qty="bq-kid"]').value) === "0"));
    await page.fill('[data-bq-qty="bq-veg"]', "9000");
    await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]');
    await check(id(), F, "…and the stepper caps a count at 5,000 plates", H, async () => ok(await page.evaluate(() => document.querySelector('[data-bq-qty="bq-veg"]').value) === "5000"));
    await page.fill('[data-bq-qty="bq-veg"]', "2");
    await page.fill("#bqTable", "4.5");
    await clearToastsNow(page); await page.click("#bqCreate");
    await check(id(), F, "…a table number that isn't a whole number is refused, saying it can be left blank", H, async () => ok(await waitToast(page, /That table number doesn't look right — or leave it blank\./), (await toastsNow(page)).join(" | ")));
    w.answer("POST", /^\/banquet\/place/, { body: { ok: true, total: 945 } });
    await page.fill("#bqTable", "12"); await page.click("#bqCreate"); await settle(page, 600);
    const p = w.sent("POST", /^\/banquet\/place/);
    await check(id(), F, "…Create sends only the lines with plates, and the table", H, () => ok(p.length === 1 && p[0].body.table === "12" && JSON.stringify(p[0].body.lines) === JSON.stringify([{ id: "bq-veg", qty: 2 }]), JSON.stringify(p[0] && p[0].body)));
    await check(id(), F, "…says 'Banquet bill created on table 12 — total ₹945.' and closes", H, async () => ok(await waitToast(page, /^Banquet bill created on table 12 — total ₹945\.$/) && !(await page.$("#bqBody")), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene();
    await open(page);
    const state0 = await page.evaluate(() => { const b = document.getElementById("bqCreate"); return { disabled: b.disabled, dim: getComputedStyle(b).opacity }; });
    await clearToastsNow(page);
    await page.click("#bqCreate", { force: true });
    await settle(page, 400);
    const said = await toastsNow(page);
    await check(id(), F, "Create with no plates yet SAYS 'Set a plate count first.' — the button never swallows the tap", H, () => ok(said.includes("Set a plate count first."), `button ${JSON.stringify(state0)} · said: ${said.join(" | ") || "nothing"}`));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene();
    w.answer("POST", /^\/banquet\/place/, { body: { ok: true, total: 472.5 } });
    await open(page); await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]'); await page.click("#bqCreate");
    await check(id(), F, "a banquet bill with no table says the manager settles it under Bills", H, async () => ok(await waitToast(page, /^Banquet bill created — total ₹473\. The manager settles it under Bills\.$|^Banquet bill created — total ₹472\.5\. The manager settles it under Bills\.$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene(null, { tablet_banquet: "pin" });
    w.answer("POST", /^\/banquet\/place/, { fn: (r) => r.body.managerPin === "8642" ? { status: 200, body: { ok: true, total: 472.5 } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await open(page); await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]'); await page.click("#bqCreate");
    await typePin(page, "1111"); await settle(page, 300);
    const err = await page.evaluate(() => document.querySelector(".pp-err")?.textContent);
    await check(id(), F, "on a PIN restaurant a wrong PIN keeps the box open and says it didn't match", H, () => ok(err === "That PIN didn't match — try again.", err));
    await page.fill(".pp-in", "8642"); await page.click(".pp-ok");
    await check(id(), F, "…the right PIN creates the bill", H, async () => ok(await waitToast(page, /^Banquet bill created/) && w.sent("POST", /banquet\/place/).pop().body.managerPin === "8642", (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene(null, { tablet_banquet: "pin" });
    w.answer("POST", /^\/banquet\/place/, { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } });
    await open(page); await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]'); await page.click("#bqCreate");
    await page.waitForSelector(".pp-cancel"); await page.click(".pp-cancel"); await settle(page, 300);
    await check(id(), F, "…cancelling the PIN leaves the sheet open and the button usable again", H, async () => ok(await page.evaluate(() => !!document.getElementById("bqCreate") && !document.getElementById("bqCreate").disabled)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene();
    w.answer("POST", /^\/banquet\/place/, { status: 400, body: { error: "Table 99 isn't on the floor plan." } });
    await open(page); await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]'); await page.fill("#bqTable", "99"); await page.click("#bqCreate");
    await check(id(), F, "a refused banquet bill says 'Couldn't create the bill:' and why, and lets the waiter fix it", H, async () => ok(await waitToast(page, /^Couldn't create the bill: Table 99 isn't on the floor plan\.$/) && await page.evaluate(() => !document.getElementById("bqCreate").disabled), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene();
    await open(page); await page.click('[data-bq-step="1"][data-bq-id="bq-veg"]');
    await ctx.setOffline(true);
    await page.click("#bqCreate");
    await check(id(), F, "a banquet bill made with no internet is SAVED, and says the bill is made when it goes through", H, async () => ok(await waitToast(page, /The banquet bill is made the moment it goes through\.$/, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.setOffline(false);
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { w.banquet = { items: [] }; });
    await open(page);
    const t = await page.evaluate(() => document.getElementById("bqBody").textContent.trim());
    await check(id(), F, "a restaurant with no banquet items is told where they are added", H, () => ok(t === "No banquet items yet — the manager adds them in the manager panel’s Banquet tab.", t));
    await page.click("#bqBack");
    await check(id(), F, "…← Back closes it", H, async () => ok(!(await page.$("#bqBody"))));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => w.answer("GET", /^\/banquet-items/, { status: 403, body: { error: "Banquet billing is switched off." } }));
    await page.evaluate(() => openBanquet());
    await check(id(), F, "if the banquet menu can't be read, it says so and closes (never an endless 'Loading…')", H, async () => ok(await waitToast(page, /^Couldn't open banquet billing: Banquet billing is switched off\.$/) && (await settle(page, 300), !(await page.$("#bqBody"))), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
}
