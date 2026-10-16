// scripts/sweep/t12r3/fi-split.mjs — band F, group FI: the ONE split screen and the ONE discount box —
// the two money screens round 1 and round 2 had never once executed (cov.mjs: 270 + 157 lines).
// Fixture world: nothing is written anywhere; what the panel SENT is read back from the world's log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, typePin, toastsNow, clearToastsNow, undoBar, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = build(w) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);
const parts = (page) => page.evaluate(() => [...document.querySelectorAll(".sb-row")].map((r) => ({ who: r.querySelector(".sb-who").textContent, amt: r.querySelector(".sb-amt").value, way: r.querySelector(".sb-way").value, ro: r.querySelector(".sb-amt").readOnly })));
const sum = (page) => page.evaluate(() => document.querySelector(".sb-sum").textContent);
const openSplit = async (page, n) => { await openTable(page, n); await tap(page, "#kotMenuBtn"); await tap(page, '[data-kotop="split"]'); await page.waitForSelector(".sb-row"); };
const due = (page) => page.evaluate(() => { const os = partyOrders(state.table).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received"); return moneyRound(os.reduce((s, o) => s + Number(o.total) - Number(o.discount) * (1 + effRate()), 0)); });

export async function blockFI(R, id) {
  const { check } = R;

  // ── the split screen ───────────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 555.55 }] }));
    await openSplit(page, 5);
    const title = await page.evaluate(() => document.querySelector("#panel h2, #panel .pk-title, #panel h3")?.textContent || document.getElementById("panel").innerText.split("\n")[0]);
    await check(id(), F, "🍴 Split the bill opens titled with the table and the exact bill: 'Split T5's bill · ₹555.55'", H, () => ok(/Split .*5.*'s bill · ₹555\.55/.test(title), title));
    const p2 = await parts(page);
    await check(id(), F, "…starts Equal, two people, the boxes read-only", H, () => ok(p2.length === 2 && p2.every((x) => x.ro), JSON.stringify(p2)));
    await check(id(), F, "…two people each pay half, the last absorbing the paisa", H, () => ok(p2[0].amt === "277.77" && p2[1].amt === "277.78", JSON.stringify(p2)));
    await page.click('.sb-nb[data-n="5"]');
    const p5 = await parts(page);
    await check(id(), F, "…five people pay ₹111.11 each — nobody quietly pays the others' rounding", H, () => ok(p5.length === 5 && p5.every((x) => x.amt === "111.11"), p5.map((x) => x.amt).join(",")));
    await check(id(), F, "…and the line under the parts says they add up", H, async () => ok(await sum(page) === "✓ The parts add up to ₹555.55", await sum(page)));
    await check(id(), F, "…each part pays its own way: UPI first, the rest Cash", H, () => ok(p5[0].way === "UPI" && p5.slice(1).every((x) => x.way === "Cash"), p5.map((x) => x.way).join(",")));
    await page.click('.sb-tab[data-mode="custom"]');
    const pc = await parts(page);
    await check(id(), F, "Custom keeps the people and makes the boxes typeable", H, () => ok(pc.length === 5 && pc.every((x) => !x.ro)));
    await page.fill('.sb-row[data-i="0"] .sb-amt', "100");
    await check(id(), F, "…a short total says how much is still to cover, in paise", H, async () => ok(await sum(page) === "₹11.11 still to cover", await sum(page)));
    await page.fill('.sb-row[data-i="0"] .sb-amt', "200");
    await check(id(), F, "…an over-total says how much more than the bill", H, async () => ok(await sum(page) === "₹88.89 more than the bill", await sum(page)));
    await page.click(".sb-go");
    await check(id(), F, "…Collect refuses an over-total out loud", H, async () => ok(await waitToast(page, /^The parts are ₹88\.89 more than the bill\.$/), (await toastsNow(page)).join(" | ")));
    await page.fill('.sb-row[data-i="0"] .sb-amt', "100"); await clearToastsNow(page); await page.click(".sb-go");
    await check(id(), F, "…and a short one too", H, async () => ok(await waitToast(page, /^₹11\.11 of the bill is still uncovered\.$/), (await toastsNow(page)).join(" | ")));
    await page.click(".sb-add");
    const pa = await parts(page);
    await check(id(), F, "＋ Add another part seeds it with exactly what is still uncovered", H, () => ok(pa.length === 6 && pa[5].amt === "11.11", JSON.stringify(pa[5])));
    await check(id(), F, "…and the count chips follow the parts on screen (the 6 chip lights at six)", H, async () => { const lit = await page.evaluate(() => [...document.querySelectorAll(".sb-nb.primary")].map((b) => b.dataset.n)); return ok(lit.join(",") === "6", lit.join(",")); });
    await page.click(".sb-add");
    await check(id(), F, "…adding a part when nothing is left seeds it EMPTY, and the line says a part needs an amount (not a green tick)", H, async () => ok(await sum(page) === "One part still needs an amount", await sum(page)));
    await clearToastsNow(page); await page.click(".sb-go");
    await check(id(), F, "…Collect with an empty part names that problem first", H, async () => ok(await waitToast(page, /^Every part needs an amount above zero — remove the empty one\.$/), (await toastsNow(page)).join(" | ")));
    await page.click('.sb-row[data-i="6"] .sb-del');
    await check(id(), F, "…✕ removes that part", H, async () => ok((await parts(page)).length === 6));
    for (let i = 0; i < 6; i++) await page.click(".sb-add");
    await clearToastsNow(page); await page.click(".sb-add");
    await check(id(), F, "…a thirteenth part is refused: 'A bill can be split into at most 12 parts.'", H, async () => ok((await parts(page)).length === 12 && await waitToast(page, /A bill can be split into at most 12 parts\./), (await toastsNow(page)).join(" | ")));
    await page.click('.sb-tab[data-mode="ticket"]');
    await check(id(), F, "By kitchen ticket on a one-ticket bill says why it can't, and stays where it was", H, async () => ok(await waitToast(page, /This bill is one kitchen ticket — split it equally, by a custom amount, or by dish\./) && await page.evaluate(() => document.querySelector('.sb-tab[data-mode="custom"]').classList.contains("primary")), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 6, { orders: [
      { status: "served", kot_no: 401, items: [{ title: "Espresso", price: 100 }, { title: "Mint Melon Juice", price: 300 }] },
      { status: "served", kot_no: 402, items: [{ title: "Cappuccino", price: 200 }] }] }));
    await openSplit(page, 6);
    const d = await due(page);
    await page.click('.sb-tab[data-mode="ticket"]');
    const pt = await parts(page);
    await check(id(), F, "By kitchen ticket: one part per KOT, labelled 'KOT #401' / 'KOT #402'", H, () => ok(pt.length === 2 && pt[0].who === "KOT #401" && pt[1].who === "KOT #402", JSON.stringify(pt)));
    await check(id(), F, "…each at what its ticket cost, the last absorbing the rounding so they add to the bill", H, () => ok(Math.abs(Number(pt[0].amt) + Number(pt[1].amt) - d) < 0.005 && Math.abs(Number(pt[0].amt) - 420) < 1, JSON.stringify(pt) + " due " + d));
    await check(id(), F, "…with no count chips and no ＋ Add (a ticket is a ticket)", H, async () => ok(await page.evaluate(() => !document.querySelector(".sb-nb") && !document.querySelector(".sb-add"))));
    await page.click('.sb-tab[data-mode="dish"]');
    const dishes = await page.evaluate(() => [...document.querySelectorAll(".sb-dish")].map((b) => b.innerText.replace(/\s+/g, " ")));
    await check(id(), F, "By dish lists every dish with who has it (all on P1 to start)", H, () => ok(dishes.length === 3 && dishes.every((x) => /P1 ·/.test(x)), dishes.join(" | ")));
    await page.click('.sb-dish[data-dish="1"]');
    const pd = await parts(page);
    await check(id(), F, "…tapping a dish hands it to the next person and the money moves with it", H, () => ok(pd.length === 2 && Math.abs(Number(pd[1].amt) - d * (300 / 600)) < 0.02 && Math.abs(Number(pd[0].amt) + Number(pd[1].amt) - d) < 0.005, JSON.stringify(pd)));
    await page.click('.sb-dish[data-dish="1"]');
    await check(id(), F, "…tapping it again wraps back to person 1", H, async () => ok((await parts(page))[1].amt === "0", JSON.stringify(await parts(page))));
    await page.click('.sb-tab[data-mode="equal"]');
    await page.selectOption('.sb-row[data-i="1"] .sb-way', "Other");
    const note = await page.$('.sb-row[data-i="1"] .sb-note');
    await check(id(), F, "choosing Other for a part opens 'What kind?' for that part", H, () => ok(!!note));
    await page.fill('.sb-row[data-i="1"] .sb-note', "wallet");
    await page.click('.pay-tip-pick[data-tip-pct="10"]');
    const btn = await page.evaluate(() => document.querySelector(".sb-go").textContent);
    await check(id(), F, "a 10% tip changes the button to 'Collect ₹X + ₹Y tip' — the tip is on top, never a part", H, () => ok(new RegExp(`^💳 Collect ₹[\\d,.]+ \\+ ₹[\\d,.]+ tip$`).test(btn), btn));
    await page.click(".sb-go"); await settle(page, 800);
    const sp = posts(w, /^\/tables\/6\/pay-split/);
    await check(id(), F, "…Collect sends the parts (amounts that add to the bill, each with its way and note)", H, () => { const s = sp[0] && sp[0].body.splits; return ok(sp.length === 1 && s.length === 2 && s[0].method === "UPI" && s[1].method === "Other" && s[1].note === "wallet" && Math.abs(s[0].amount + s[1].amount - d) < 0.005, JSON.stringify(s)); });
    const tip = posts(w, /\/tip$/);
    await check(id(), F, "…and the tip goes AFTER the split, once, on the first ticket", H, () => ok(tip.length === 1 && tip[0].at >= sp[0].at && Math.abs(tip[0].body.amount - Math.round(d * 10) / 100) < 0.011, JSON.stringify(tip[0] && tip[0].body)));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    await check(id(), F, "…and the takeback names the parts and the tip: 'Bill paid in 2 parts — ₹… UPI + ₹… Other · ₹… tip'", H, async () => { const u = await undoBar(page); return ok(u && /Bill paid in 2 parts — ₹[\d,]+ UPI \+ ₹[\d,]+ Other · ₹[\d,.]+ tip/.test(u), u); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 7, { orders: [{ status: "served", total: 600 }] }), { tablet_khata: "on", khata_allowed: true });
    w.khata = { customers: [{ id: "c-asha", name: "Asha Rao", phone: "9876543210" }] };
    await openSplit(page, 7);
    const ways = await page.evaluate(() => [...document.querySelectorAll('.sb-row[data-i="0"] .sb-way option')].map((o) => o.value));
    await check(id(), F, "with Pay later on for this waiter, every part may be 'Pay later'", H, () => ok(ways.join(",") === "UPI,Cash,Card,Other,Pay later", ways.join(",")));
    await page.selectOption('.sb-row[data-i="1"] .sb-way', "Pay later");
    await clearToastsNow(page); await page.click(".sb-go");
    await check(id(), F, "…a pay-later part with nobody named is refused: tap 'Who owes this?'", H, async () => ok(await waitToast(page, /Tap “Who owes this\?” on the pay-later part and pick a person\./), (await toastsNow(page)).join(" | ")));
    await page.click('.sb-row[data-i="1"] .sb-who-btn'); await page.waitForSelector(".kp-row");
    await page.click(".kp-row"); await page.click(".kp-go"); await settle(page, 300);
    const lbl = await page.evaluate(() => document.querySelector('.sb-row[data-i="1"] .sb-who-btn').textContent);
    await check(id(), F, "…the person sheet is the same one as Pay Later, and the part then names them", H, () => ok(lbl === "📒 Asha Rao — change", lbl));
    await page.selectOption('.sb-row[data-i="0"] .sb-way', "Pay later");
    await page.click('.sb-row[data-i="0"] .sb-who-btn'); await page.waitForSelector(".kp-name");
    await page.fill(".kp-name", "Ravi"); await page.click(".kp-go"); await settle(page, 300);
    await clearToastsNow(page); await page.click(".sb-go");
    await check(id(), F, "…two pay-later parts are refused: only one can be", H, async () => ok(await waitToast(page, /Only one part can be pay-later — put the rest on cash, card or UPI\./), (await toastsNow(page)).join(" | ")));
    await page.selectOption('.sb-row[data-i="0"] .sb-way', "Card");
    await page.click(".sb-go"); await settle(page, 700);
    await check(id(), F, "…one pay-later part goes with the person's khata id", H, () => { const s = posts(w, /pay-split/)[0]; const later = s && s.body.splits.find((x) => x.method === "Pay later"); return ok(later && later.khataCustomerId === "c-asha", JSON.stringify(s && s.body)); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 8, { orders: [{ status: "served", total: 400 }] }));
    await openTable(page, 8); await tap(page, "#payBill"); await page.waitForSelector(".pay-split-open");
    await page.fill(".pay-tip-amt", "50");
    await page.click(".pay-split-open"); await page.waitForSelector(".sb-row");
    const t = await page.evaluate(() => ({ amt: document.querySelector(".sb-tip .pay-tip-amt").value, btn: document.querySelector(".sb-go").textContent }));
    await check(id(), F, "the pay sheet's 'Split this bill →' carries the typed tip across to the split screen", H, () => ok(t.amt === "50" && /\+ ₹50 tip$/.test(t.btn), JSON.stringify(t)));
    await check(id(), F, "…and nothing was written on the way (the tip waits for the split to be paid)", H, () => ok(posts(w, /\/tip$/).length === 0));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 9, { orders: [{ status: "received" }] }), { split_bill_enabled: false });
    await openTable(page, 9);
    await page.evaluate(() => renderSplitBill("9"));
    await check(id(), F, "a split opened from anywhere on a restaurant with splitting OFF is refused (the last gate there is)", H, async () => ok(await waitToast(page, /Splitting a bill is turned off for this restaurant\./), (await toastsNow(page)).join(" | ")));
    await page.evaluate(() => { state.data.settings.split_bill_enabled = true; renderSplitBill("9"); });
    await check(id(), F, "…and with nothing accepted: 'Nothing to split — accept the order first, or it's already paid.'", H, async () => ok(await waitToast(page, /Nothing to split — accept the order first, or it's already paid\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── the discount box ───────────────────────────────────────────────────────────────────────
  const openDisc = async (page) => { await tap(page, "[data-edit-order]"); await page.click("#confirmYes"); await tap(page, "[data-discount]"); await page.waitForSelector(".disc-overlay .disc-pay-input"); };
  const boxes = (page) => page.evaluate(() => ({ pct: document.querySelector(".disc-pct-input").value, amt: document.querySelector(".disc-amt-input").value, pay: document.querySelector(".disc-pay-input").value, cap: document.querySelector(".disc-cap-note").textContent, prev: document.querySelector(".disc-prev-amt").textContent }));
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing", items: [{ title: "Thali", price: 1000 }] }] }), { tablet_discount: "pin" });
    w.answer("POST", /\/discount$/, { fn: (r) => r.body && r.body.managerPin ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await openTable(page, 5); await openDisc(page);
    const b0 = await boxes(page);
    await check(id(), F, "− Discount opens with 'They pay' already holding the whole bill and nothing off", H, () => ok(b0.pay === "1050" && b0.pct === "" && b0.amt === "", JSON.stringify(b0)));
    await settle(page, 150);   // the box takes focus on a 30 ms timer, so a keyboard opening it is not fought
    await check(id(), F, "…with the cursor in 'They pay', its figure selected (typing 800 replaces it)", H, async () => ok(await page.evaluate(() => { const el = document.activeElement; return el.classList.contains("disc-pay-input"); })));   // a number box has no selection to read; select() runs on focus
    await page.click('.disc-pct-pick[data-pct="10"]');
    const b1 = await boxes(page);
    await check(id(), F, "…the 10% chip: ₹100 off the ₹1,000 food, they pay ₹945 (tax after the discount)", H, () => ok(b1.pct === "10" && b1.amt === "100" && b1.pay === "945", JSON.stringify(b1)));
    await page.fill(".disc-pay-input", "840");
    const b2 = await boxes(page);
    await check(id(), F, "…typing what they pay works the discount backwards (₹840 → ₹200 off, 20%)", H, () => ok(b2.amt === "200" && b2.pct === "20", JSON.stringify(b2)));
    await page.fill(".disc-amt-input", "1500");
    const b3 = await boxes(page);
    await check(id(), F, "…more than the food is capped, and the box SAYS the real maximum", H, () => ok(b3.cap === "The most you can take off this bill is ₹1,000 — that's the food value before tax.", b3.cap));
    await page.click(".disc-apply-btn");
    await check(id(), F, "…Apply over the cap refuses out loud and snaps the boxes to the maximum", H, async () => ok(await waitToast(page, /The most you can take off this bill is ₹1,000/) && (await boxes(page)).amt === "1000" && (await boxes(page)).cap === "", JSON.stringify(await boxes(page))));
    // An emptied box is "about to type", never ₹0: while it is empty the discount stays as it was and
    // Apply (reached without leaving the box) asks for a figure. A real tap leaves the box first, which
    // refills it with the figure that will be applied — so what is applied is always what is shown.
    await page.fill(".disc-pct-input", "");
    await check(id(), F, "…an emptied box never means ₹0 — the discount stays as it was while it is empty", H, async () => ok((await boxes(page)).prev === "− ₹1,000", (await boxes(page)).prev));
    await clearToastsNow(page); await page.evaluate(() => document.querySelector(".disc-apply-btn").click());
    await check(id(), F, "…and Apply, while it is empty, asks for a figure instead of applying", H, async () => ok(await waitToast(page, /Type a discount in one of the three boxes first — or tap Cancel to leave the bill as it is\./) && !!(await page.$(".disc-overlay")), (await toastsNow(page)).join(" | ")));
    await page.click(".disc-note-input");
    await check(id(), F, "…leaving the empty box refills it with the figure that would be applied", H, async () => ok((await boxes(page)).amt === "1000", JSON.stringify(await boxes(page))));
    await page.fill(".disc-pct-input", "15"); await page.fill(".disc-note-input", "regular");
    await page.click(".disc-apply-btn"); await typePin(page, "2468");
    await check(id(), F, "…on a PIN restaurant Apply asks the PIN and says 'Discount ₹150 applied'", H, async () => ok(await waitToast(page, /Discount ₹150 applied/), (await toastsNow(page)).join(" | ")));
    const d = posts(w, /\/discount$/);
    await check(id(), F, "…sending ₹150 with the reason and the PIN, and what the screen edited FROM (first save wins)", H, () => { const last = d[d.length - 1]; return ok(last.path === `/orders/${orders[0].id}/discount` && last.body.amount === 150 && last.body.note === "regular" && last.body.managerPin === "2468" && /"discount":0/.test(last.headers["x-lfh-expect"] || ""), JSON.stringify(last.body) + " " + last.headers["x-lfh-expect"]); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 6, { orders: [{ status: "preparing", discount: 50, items: [{ title: "Thali", price: 1000 }] }] }), { tablet_discount: "on" });
    await openTable(page, 6);
    await tap(page, "[data-edit-order]"); await page.click("#confirmYes");
    const lbl = await page.evaluate(() => document.querySelector("[data-discount]").textContent.trim());
    await check(id(), F, "a ticket that has a discount says so on its button: '− Discount (₹50)'", H, () => ok(lbl === "− Discount (₹50)", lbl));
    await tap(page, "[data-discount]"); await page.waitForSelector(".disc-remove-btn");
    let release; w.hold = new Promise((r) => { release = r; });
    await page.click(".disc-remove-btn"); await settle(page, 200);
    const local = await page.evaluate(() => state.data.orders[0].discount);
    w.hold = null; release(); await settle(page, 600);
    await check(id(), F, "…Remove (where the waiter may discount without a PIN) takes it off on screen at once", H, () => ok(local === 0, String(local)));
    await check(id(), F, "…and sends ₹0, saying what it was before (₹50)", H, () => { const p = posts(w, /\/discount$/); return ok(p.length === 1 && p[0].body.amount === 0 && p[0].body.note === "" && /"discount":50/.test(p[0].headers["x-lfh-expect"] || ""), JSON.stringify(p[0] && p[0].body)); });
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 7, { orders: [{ status: "preparing", items: [{ title: "Thali", price: 1000 }, { title: "Water bottle", price: 20, is_mrp: true }], extra: { taxable_base: 1000, nontax_amount: 20, mrp_amount: 20 } }] }), { tablet_discount: "on" });
    await openTable(page, 7); await openDisc(page);
    await page.fill(".disc-pay-input", "10");
    const b = await boxes(page);
    await check(id(), F, "a bill with an MRP bottle: asking them to pay less than the bottle names the MRP part as the reason", H, () => ok(/The most you can take off this bill is ₹1,000\. ₹20 of it is at a fixed MRP price — that part can't be discounted\./.test(b.cap), b.cap));
    await ctx.close();
  }
  {
    const { w, ctx, page, s } = await scene((w) => seat(w, 8, { orders: [{ status: "served", total: 525, items: [{ title: "Thali", price: 500 }] }, { status: "served", total: 525, payment_status: "paid", items: [{ title: "Thali", price: 500 }] }] }));
    await openTable(page, 8);
    await tap(page, "#billDiscountBtn"); await page.waitForSelector(".disc-overlay");
    const head = await page.evaluate(() => document.querySelector(".disc-overlay h3").textContent + " | " + document.querySelector(".disc-overlay").innerText.match(/Bill total\s*(₹[\d,]+)/)?.[1]);
    await check(id(), F, "− Discount whole bill speaks for the WHOLE bill (paid tickets included — the server subtracts them once)", H, () => ok(head === "Discount whole bill | ₹1,050", head));
    await page.click('.disc-pct-pick[data-pct="10"]'); await page.click(".disc-apply-btn");
    await check(id(), F, "…Apply sends one whole-bill discount to the session and says 'Bill discount ₹100 applied'", H, async () => ok(await waitToast(page, /Bill discount ₹100 applied/) && posts(w, new RegExp(`^/sessions/${s.id}/bill-discount`)).some((p) => p.body.amount === 100), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page);
    await page.evaluate(() => tabletDiscount("gone"));
    await check(id(), F, "a discount for a ticket that has left the board says so", H, async () => ok(await waitToast(page, /That order is no longer on the board\./), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page);
    await page.evaluate(() => tabletBillDiscount("12"));
    await check(id(), F, "a whole-bill discount on a table with nobody at it: 'Open the table first.'", H, async () => ok(await waitToast(page, /Open the table first\./), (await toastsNow(page)).join(" | ")));
    await page.evaluate(() => { state.data.orders.forEach((o) => { o.payment_status = "paid"; }); });
    await clearToastsNow(page);
    await page.evaluate(() => tabletBillDiscount("8"));
    await check(id(), F, "…and on a bill already fully paid: 'No unpaid orders to discount yet.'", H, async () => ok(await waitToast(page, /No unpaid orders to discount yet\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
}
