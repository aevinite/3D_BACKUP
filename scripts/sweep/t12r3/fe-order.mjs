// scripts/sweep/t12r3/fe-order.mjs — band F, group 5: taking an order — the dish grid, the cart, the
// options popup, open-price dishes, sold-out / off-menu dishes, search, sending (and every refusal),
// adding to a placed order, ⚡ quick order, the phone's view-order screen, and editing a placed dish.
// Fixture world: nothing is written anywhere; what the panel SENT is read back from the world's log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, answerConfirm, toastsNow, clearToastsNow, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
// Five dishes with every shape the grid must handle, added to French House's recorded menu.
const addDishes = (w) => {
  const cat = w.summary.categories[0].slug;
  w.summary.dishes.unshift(
    { id: "t-plain", title: "Test Lassi", price: "120", category: cat, tags: [], options: [] },
    { id: "t-opt", title: "Test Pizza", price: "300", category: cat, tags: [], options: [
      { name: "Size", type: "single", choices: [{ label: "Small", price: 0 }, { label: "Large", price: 100 }] },
      { name: "Extras", type: "multi", choices: [{ label: "Cheese", price: 40 }, { label: "Olives", price: 30 }] }] },
    { id: "t-open", title: "Soda Can", price: "0", category: cat, tags: [], options: [], open_price: true },
    { id: "t-out", title: "Sold Soup", price: "200", category: cat, tags: ["sold-out"], options: [] },
    { id: "t-hid", title: "Staff Meal", price: "100", category: cat, tags: ["hidden"], options: [] },
  );
};
// The cart is never a side pane while browsing (style.css: .om.lite:not(.vieworder) .om-cart hidden):
// the order is reviewed on its own screen behind the floating "View order" pill, exactly as a waiter
// does it — so review()/browse() move between the two, and the cart's buttons are tapped THERE.
const scene = async (build, settings = {}, device = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  addDishes(w);
  const made = build(w) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);
const cart = (page) => page.evaluate(() => state.cart.map((l) => ({ id: l.id, qty: l.qty, price: l.price, open: !!l.open_price, opts: (l.options || []).map((o) => o.label).join("+"), avoid: (l.avoid || []).join(","), note: l.note || "" })));
const takeOrder = async (page, n) => { await openTable(page, n); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish"); };
const dishTap = (page, id) => page.click(`#omScroll .dish[data-dish="${id}"] .dname`);
const review = async (page) => { await page.click("#omViewBtn"); await page.waitForSelector("#voBack"); };
const browse = async (page) => { await page.click("#voBack"); await page.waitForSelector("#omScroll .dish"); };

export async function blockFE(R, id) {
  const { check } = R;

  // ── the grid and the cart ──────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await takeOrder(page, 5);
    const head = await page.evaluate(() => ({ h: document.querySelector(".om-head h2").textContent, exit: document.getElementById("omExit").textContent, cats: document.querySelectorAll(".om-nav .om-cat").length }));
    await check(id(), F, "＋ Take order opens the dish browser titled with the table, a search box, ← back and the category rail", H, () => ok(head.h === "T5" && head.exit === "← back" && head.cats > 1, JSON.stringify(head)));
    const out = await page.evaluate(() => { const b = document.querySelector('.dish[data-dish="t-out"]'); return { dis: b.disabled, price: b.querySelector(".dprice").textContent, edit: !!b.querySelector(".dedit") }; });
    await check(id(), F, "a sold-out dish reads SOLD OUT, cannot be tapped, and has no ✎", H, () => ok(out.dis && out.price === "SOLD OUT" && !out.edit, JSON.stringify(out)));
    const hid = await page.evaluate(() => document.querySelector('.dish[data-dish="t-hid"] .doffmenu')?.textContent);
    await check(id(), F, "a dish hidden from guests is labelled OFF MENU — and still orderable here", H, () => ok(hid === "OFF MENU"));
    const op = await page.evaluate(() => document.querySelector('.dish[data-dish="t-open"] .dprice').textContent);
    await check(id(), F, "an open-price dish says 'Set price', never ₹0", H, () => ok(op === "Set price", op));
    await dishTap(page, "t-plain"); await dishTap(page, "t-plain"); await dishTap(page, "t-hid");
    const c1 = await cart(page);
    await check(id(), F, "tapping a plain dish twice stacks it (×2); the off-menu dish adds like any other", H, () => ok(c1.length === 2 && c1[0].qty === 2 && c1[1].id === "t-hid", JSON.stringify(c1)));
    const badge = await page.evaluate(() => document.querySelector('.dish[data-dish="t-plain"] .dqty')?.textContent);
    await check(id(), F, "…the tile shows ×2 and the cart totals ₹340", H, async () => ok(badge === "×2" && /₹340/.test(await page.evaluate(() => document.querySelector("#omCart .ctotal b").textContent)), badge));
    await page.click('.dish[data-dish="t-plain"] [data-dishminus]');
    await check(id(), F, "…the tile's − takes ONE off", H, async () => ok((await cart(page))[0].qty === 1));
    await review(page);
    await page.click('#omCart [data-plus="0"]'); await page.click('#omCart [data-plus="0"]');
    await check(id(), F, "…the cart's + adds one at a time", H, async () => ok((await cart(page))[0].qty === 3));
    for (let i = 0; i < 3; i++) await page.click('#omCart [data-minus="0"]');
    await check(id(), F, "…and − down to nothing drops the line", H, async () => ok((await cart(page)).every((l) => l.id !== "t-plain"), JSON.stringify(await cart(page))));
    await browse(page);
    // open price
    await dishTap(page, "t-open"); await page.waitForSelector(".pr-ok");
    await page.fill(".pr-in", "0"); await page.click(".pr-ok");
    const e0 = await page.evaluate(() => document.querySelector(".pr-err").textContent);
    await page.fill(".pr-in", "200000"); await page.click(".pr-ok");
    const e1 = await page.evaluate(() => document.querySelector(".pr-err").textContent);
    await check(id(), F, "an open-price dish asks its price first: 0 → 'Enter a price greater than 0.', too much → 'That price looks too high.'", H, () => ok(e0 === "Enter a price greater than 0." && e1 === "That price looks too high.", `${e0} / ${e1}`));
    await page.fill(".pr-in", "45.5"); await page.click(".pr-ok");
    await dishTap(page, "t-open"); await page.waitForSelector(".pr-in"); await page.fill(".pr-in", "50"); await page.click(".pr-ok");
    const c2 = (await cart(page)).filter((l) => l.id === "t-open");
    await check(id(), F, "…each can is its own line at its own typed price (₹45.50 and ₹50)", H, () => ok(c2.length === 2 && c2[0].price === 45.5 && c2[1].price === 50 && c2.every((l) => l.open), JSON.stringify(c2)));
    const idx = await page.evaluate(() => state.cart.findIndex((l) => l.id === "t-open"));
    await review(page);
    await page.click(`#omCart [data-edit="${idx}"]`); await page.waitForSelector(".pr-in");
    const pre = await page.evaluate(() => document.querySelector(".pr-in").value);
    await page.fill(".pr-in", "40"); await page.click(".pr-ok");
    await check(id(), F, "…✎ on an open-price line re-asks the price (already filled in) instead of an empty options popup", H, async () => ok(pre === "45.5" && (await cart(page)).find((l) => l.id === "t-open").price === 40, pre));
    await browse(page);
    await dishTap(page, "t-open"); await page.waitForSelector(".pr-cancel"); await page.click(".pr-cancel");
    await check(id(), F, "…and Cancel on the price adds nothing", H, async () => ok((await cart(page)).filter((l) => l.id === "t-open").length === 2));
    await ctx.close();
  }

  // ── the options popup ──────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await takeOrder(page, 5);
    await dishTap(page, "t-opt"); await page.waitForSelector("#optOverlay #optAdd");
    await check(id(), F, "a dish with sizes/extras opens its popup instead of quick-adding", H, async () => ok((await cart(page)).length === 0 && await page.evaluate(() => document.querySelector("#optOverlay h3").textContent) === "Test Pizza"));
    await page.click('[data-optl="Large"]'); await page.click('[data-optl="Cheese"]'); await page.click('[data-optl="Olives"]');
    await page.click("#optPlus");
    const tot = await page.evaluate(() => document.querySelector("#optOverlay .ctotal").innerText.replace(/\s+/g, " "));
    await check(id(), F, "…a size, two extras and ×2 price it live: '2 × ₹470 ₹940'", H, () => ok(tot === "2 × ₹470 ₹940", tot));
    await page.click('[data-optl="Large"]');
    await check(id(), F, "…tapping a chosen single-choice option again un-chooses it", H, async () => ok(await page.evaluate(() => document.querySelector("#optOverlay .ctotal b").textContent) === "₹740"));
    await page.click('[data-optl="Large"]'); await page.click('[data-optl="Olives"]');
    await page.fill("#optNote", "less ice");
    await page.click('#optOverlay [data-alg="nuts"]');
    await page.click("#optOverlay [data-alg-other]"); await page.waitForSelector(".alg-in"); await page.fill(".alg-in", "Coriander"); await page.click(".alg-ok");
    await page.click("#optAdd");
    const c = await cart(page);
    await check(id(), F, "…Add to order puts ONE line: Large + Cheese, ₹440 each ×2, no nuts/coriander, the note kept apart", H, () => ok(c.length === 1 && c[0].opts === "Large+Cheese" && c[0].price === 440 && c[0].qty === 2 && c[0].avoid === "nuts,coriander" && c[0].note === "less ice", JSON.stringify(c)));
    await check(id(), F, "…and the popup is gone", H, async () => ok(!(await page.$("#optOverlay"))));
    await review(page);
    await page.click('#omCart [data-edit="0"]'); await page.waitForSelector("#optAdd");
    const ed = await page.evaluate(() => ({ btn: document.getElementById("optAdd").textContent, q: document.getElementById("optQ").textContent, note: document.getElementById("optNote").value, on: [...document.querySelectorAll("#optOverlay .optchoice.on")].map((b) => b.textContent.trim()) }));
    await check(id(), F, "✎ on that line reopens it filled in, as 'Update item'", H, () => ok(ed.btn === "Update item" && ed.q === "2" && ed.note === "less ice" && ed.on.some((x) => /Large/.test(x)), JSON.stringify(ed)));
    await page.click("#optMinus"); await page.click("#optAdd");
    await check(id(), F, "…Update item changes that line in place (still one line, now ×1)", H, async () => { const cc = await cart(page); return ok(cc.length === 1 && cc[0].qty === 1, JSON.stringify(cc)); });
    await browse(page);
    await page.click('.dish[data-dish="t-plain"] .dedit'); await page.waitForSelector("#optAdd");
    await check(id(), F, "the small ✎ on a plain tile opens its popup (and does not also quick-add)", H, async () => ok(await page.evaluate(() => document.querySelector("#optOverlay h3").textContent) === "Test Lassi" && (await cart(page)).length === 1));
    await page.click("#optClose");
    // a dish that leaves the menu mid-order
    await page.evaluate(() => { state.data.dishes = state.data.dishes.filter((d) => d.id !== "t-plain"); });
    await clearToastsNow(page); await dishTap(page, "t-plain");
    await check(id(), F, "tapping a dish that has just left the menu says so and redraws the menu", H, async () => ok(await waitToast(page, /That dish just changed — refreshing the menu/) && !(await page.$('.dish[data-dish="t-plain"]')), (await toastsNow(page)).join(" | ")));
    await page.evaluate(() => { state.data.dishes = state.data.dishes.filter((d) => d.id !== "t-opt"); });
    await review(page);
    await clearToastsNow(page); await page.click('#omCart [data-edit="0"]');
    await check(id(), F, "✎ on a cart line whose dish has left the menu says to remove it — and leaves the line for the waiter to decide", H, async () => ok(await waitToast(page, /That dish has left the menu — remove this line and pick another\./) && (await cart(page)).length === 1, (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── search, the rail, an empty menu ────────────────────────────────────────────────────────
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await takeOrder(page, 5);
    await page.fill("#dishSearch", "TEST LAS");
    const r1 = await page.evaluate(() => ({ dishes: [...document.querySelectorAll("#omScroll .dish")].map((b) => b.dataset.dish), nav: document.querySelectorAll(".om-nav .om-cat").length, h: document.querySelector(".om-sec-h")?.textContent }));
    await check(id(), F, "search narrows to the matching dishes, case-blind, and hides the category rail", H, () => ok(r1.dishes.join(",") === "t-plain" && r1.nav === 0 && /Search results/.test(r1.h), JSON.stringify(r1)));
    await page.fill("#dishSearch", "zzzz");
    await check(id(), F, "…no match says 'No dishes match.'", H, async () => ok(await page.evaluate(() => document.getElementById("omScroll").textContent.trim()) === "No dishes match."));
    await page.fill("#dishSearch", "");
    await check(id(), F, "…clearing it brings the sections and the rail back", H, async () => ok(await page.evaluate(() => document.querySelectorAll(".om-nav .om-cat").length > 1 && document.querySelectorAll("#omScroll .om-sec").length > 1)));
    const second = await page.evaluate(() => document.querySelectorAll(".om-nav .om-cat")[1].dataset.cat);
    await page.click(`.om-nav .om-cat[data-cat="${second}"]`); await settle(page, 200);
    const jump = await page.evaluate((c) => ({ on: document.querySelector(".om-nav .om-cat.on").dataset.cat, top: document.getElementById("omScroll").scrollTop, at: document.querySelector(`.om-sec[data-cat="${c}"]`).offsetTop }), second);
    await check(id(), F, "a category chip jumps straight to its section and lights up", H, () => ok(jump.on === second && Math.abs(jump.top - (jump.at - 6)) < 4, JSON.stringify(jump)));
    await page.evaluate(() => { const b = document.querySelector(".om-nav .om-cat"); b.dataset.cat = "no-such-group"; });
    await clearToastsNow(page); await page.click('.om-nav .om-cat[data-cat="no-such-group"]');
    await check(id(), F, "a chip whose section is missing says 'Nothing in that group right now.' (never a dead chip)", H, async () => ok(await waitToast(page, /Nothing in that group right now\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); w.summary.dishes = []; });
    await openTable(page, 5); await tap(page, "#takeOrder");
    await page.waitForFunction(() => /No dishes on the menu yet\.|Loading the menu…/.test(document.getElementById("omScroll")?.textContent || ""), null, { timeout: 8000 });
    await page.waitForFunction(() => /No dishes on the menu yet\./.test(document.getElementById("omScroll").textContent), null, { timeout: 10000 }).catch(() => {});
    const t = await page.evaluate(() => document.getElementById("omScroll").textContent.trim());
    await check(id(), F, "an empty menu first tries ONE fresh load, then says 'No dishes on the menu yet.' (not 'No dishes match')", H, () => ok(t === "No dishes on the menu yet." && w.sent("GET", /^\/summary$/).length >= 2, t));
    await ctx.close();
  }

  // ── sending ────────────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    w.answer("POST", /^\/order$/, { body: { ok: true, kot_no: 777 } });
    await takeOrder(page, 5);
    await dishTap(page, "t-plain"); await dishTap(page, "t-plain");
    await dishTap(page, "t-open"); await page.waitForSelector(".pr-in"); await page.fill(".pr-in", "30"); await page.click(".pr-ok");
    await dishTap(page, "t-opt"); await page.waitForSelector("#optAdd"); await page.click('[data-optl="Large"]'); await page.fill("#optNote", "extra spicy"); await page.click('#optOverlay [data-alg="nuts"]'); await page.click("#optAdd");
    await review(page);
    await page.click('#orderAlg [data-oalg="dairy"]');
    await page.click("#sendOrder");
    const q = await answerConfirm(page, false);
    await check(id(), F, "SEND TO KITCHEN asks once, counting the plates: 'Send 4 items to the kitchen for table 5?'", H, () => ok(q === "Send 4 items to the kitchen for table 5?", q));
    await check(id(), F, "…Cancel sends nothing and keeps the cart", H, async () => ok(posts(w, /^\/order$/).length === 0 && (await cart(page)).length === 3));
    await page.click("#sendOrder"); await answerConfirm(page, true); await settle(page, 600);
    const body = posts(w, /^\/order$/)[0] && posts(w, /^\/order$/)[0].body;
    const ln = (id) => body.items.find((x) => x.id === id);
    await check(id(), F, "…the order carries each line: plain ×2 (no price — the server prices it), the can WITH its typed price", H, () => ok(ln("t-plain").qty === 2 && ln("t-plain").price === undefined && ln("t-open").price === 30, JSON.stringify(body.items)));
    await check(id(), F, "…the pizza's size as group+label, and its own allergy worded 'no X' joined to the note typed verbatim", H, () => ok(JSON.stringify(ln("t-opt").options) === JSON.stringify([{ group: "Size", label: "Large" }]) && ln("t-opt").note === "⚠ no nuts · extra spicy", JSON.stringify(ln("t-opt"))));
    await check(id(), F, "…and the whole-order avoid list separately (dairy), never folded into one dish", H, () => ok(JSON.stringify(body.allergies) === JSON.stringify(["dairy"]) && body.table === "5", JSON.stringify(body.allergies)));
    await check(id(), F, "…then says 'Sent! Kitchen ticket #777', empties the cart and leaves order mode", H, async () => ok(await waitToast(page, /^Sent! Kitchen ticket #777$/) && await page.evaluate(() => !state.ordering && state.cart.length === 0), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    w.answer("POST", /^\/order$/, { fn: (r) => r.body.confirmDuplicate ? { status: 200, body: { ok: true, kot_no: 778 } } : { status: 409, body: { error: "Looks like a repeat.", duplicateWarning: true } } });
    await takeOrder(page, 5); await dishTap(page, "t-plain"); await review(page);
    await page.click("#sendOrder"); await answerConfirm(page, true);
    const q = await answerConfirm(page, false);
    await check(id(), F, "an order that looks like one sent seconds ago asks before sending it AGAIN", H, () => ok(q === "This looks just like an order you sent seconds ago for this table. Send it AGAIN anyway?", q));
    await check(id(), F, "…No sends nothing more and keeps the cart", H, async () => ok(posts(w, /^\/order$/).length === 1 && (await cart(page)).length === 1));
    await page.click("#sendOrder"); await answerConfirm(page, true); await answerConfirm(page, true); await settle(page, 600);
    await check(id(), F, "…'Send anyway' resends it marked as meant", H, () => { const p = posts(w, /^\/order$/); return ok(p.length === 3 && p[2].body.confirmDuplicate === true, p.map((x) => !!x.body.confirmDuplicate).join(",")); });
    await ctx.close();
  }
  for (const [reason, item, want] of [["sold_out", "Sold Soup", /^😕 Sold Soup just sold out — remove it from the order and send again\.$/],
    ["unknown_item", "Test Lassi", /^😕 Test Lassi is no longer on the menu — remove it and send again\.$/],
    ["closed", null, /^Couldn't send the order: closed\. Please try again\.$/]]) {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    w.answer("POST", /^\/order$/, { body: { ok: false, reason, item } });
    await takeOrder(page, 5); await dishTap(page, "t-plain"); await review(page);
    await page.click("#sendOrder"); await answerConfirm(page, true);
    await check(id(), F, `a refused order (${reason}) gets a sentence a waiter can act on — and keeps the cart to fix and resend`, H, async () => ok(await waitToast(page, want) && (await cart(page)).length === 1 && await page.evaluate(() => state.ordering), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await takeOrder(page, 5); await dishTap(page, "t-plain"); await review(page);
    await ctx.setOffline(true);
    await page.click("#sendOrder"); await answerConfirm(page, true);
    await check(id(), F, "an order sent with no internet is SAVED and says it goes to the kitchen when back online", H, async () => ok(await waitToast(page, /^Order saved ✓ — it'll go to the kitchen the moment you're back online\.$/, 8000) && await page.evaluate(() => !state.ordering), (await toastsNow(page)).join(" | ")));
    await ctx.setOffline(false);
    await ctx.close();
  }

  // ── adding to an order already placed ──────────────────────────────────────────────────────
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing" }] }));
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true); await tap(page, "[data-add-dish]");
    await page.waitForSelector("#omScroll .dish");
    const head = await page.evaluate(() => ({ h: document.querySelector(".om-head h2").textContent, hint: document.querySelector(".om-hint")?.textContent, cart: !!document.getElementById("omCart") }));
    await check(id(), F, "＋ Add dish opens the browser in ADD mode: 'Add · T5', a one-line hint, no cart", H, () => ok(head.h === "Add · T5" && /Tap a dish to add it to this order/.test(head.hint) && !head.cart, JSON.stringify(head)));
    let release; w.hold = new Promise((r) => { release = r; });
    await dishTap(page, "t-plain"); await dishTap(page, "t-plain"); await dishTap(page, "t-plain");
    await settle(page, 200); w.hold = null; release(); await settle(page, 1200);
    const adds = posts(w, new RegExp(`^/orders/${orders[0].id}/add-item`));
    await check(id(), F, "three fast taps while the first add is in flight are never lost: one add, then ONE add of the other two", H, () => ok(adds.length === 2 && adds[0].body.qty === 1 && adds[1].body.qty === 2, adds.map((a) => a.body.qty).join(",")));
    await check(id(), F, "…the Done button keeps a running tally: '✓ Done (3 added)'", H, async () => ok(await page.evaluate(() => document.getElementById("omExit").textContent) === "✓ Done (3 added)", await page.evaluate(() => document.getElementById("omExit").textContent)));
    await dishTap(page, "t-opt"); await page.waitForSelector("#optAdd"); await page.click('[data-optl="Small"]'); await page.click('#optOverlay [data-alg="nuts"]'); await page.fill("#optNote", "less salt"); await page.click("#optAdd"); await settle(page, 600);
    const o = posts(w, /add-item/).pop();
    await check(id(), F, "…an options dish added in place carries its option and 'no X · note' as the kitchen note", H, () => ok(o.body.dishId === "t-opt" && JSON.stringify(o.body.options) === JSON.stringify([{ group: "Size", label: "Small" }]) && o.body.note === "⚠ no nuts · less salt", JSON.stringify(o.body)));
    await dishTap(page, "t-open"); await page.waitForSelector(".pr-in"); await page.fill(".pr-in", "25"); await page.click(".pr-ok"); await settle(page, 600);
    await check(id(), F, "…an open-price dish added in place carries its typed price", H, () => { const p = posts(w, /add-item/).pop(); return ok(p.body.dishId === "t-open" && p.body.price === 25, JSON.stringify(p.body)); });
    w.answer("POST", /add-item/, { body: { ok: false, reason: "That order is already paid." } });
    await clearToastsNow(page); await dishTap(page, "t-hid");
    await check(id(), F, "…an add the server rejects says 'Couldn't add:' and why", H, async () => ok(await waitToast(page, /^Couldn't add: That order is already paid\.$/), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /add-item/, { status: 400, body: { error: "Order is closed." } });
    await clearToastsNow(page); await dishTap(page, "t-hid");
    await check(id(), F, "…and a refusal says 'Failed:' and why", H, async () => ok(await waitToast(page, /^Failed: Order is closed\.$/), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    await ctx.setOffline(true);
    await clearToastsNow(page); await dishTap(page, "t-hid");
    await check(id(), F, "…with no internet: 'Dish saved ✓ — adds when you're back online'", H, async () => ok(await waitToast(page, /^Dish saved ✓ — adds when you're back online$/, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.setOffline(false);
    await page.click("#omExit"); await settle(page, 300);
    await check(id(), F, "…✓ Done goes back to the table", H, async () => ok(await page.evaluate(() => !state.ordering && state.table === "5" && !state.addToOrderId)));
    await ctx.close();
  }

  // ── ⚡ quick order ──────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); seat(w, 6, {}); w.slices["6"].sessions = []; w.summary.merges = [{ parent_table: "5", child_table: "6" }]; w.summary.my_tables = ["5", "6", "7", "8"]; });
    w.answer("POST", /^\/order$/, { body: { ok: true, kot_no: 901 } });
    await page.evaluate(() => openQuickOrder()); await page.waitForSelector("#omScroll .dish");
    const h = await page.evaluate(() => ({ h: document.querySelector(".om-head h2").textContent, send: document.getElementById("sendOrder").textContent }));
    await check(id(), F, "⚡ Quick order builds first: '⚡ Quick order', and its button says 'CHOOSE TABLE & SEND →'", H, () => ok(h.h === "⚡ Quick order" && h.send === "CHOOSE TABLE & SEND →", JSON.stringify(h)));
    await dishTap(page, "t-plain"); await dishTap(page, "t-plain");
    await clearToastsNow(page); await page.evaluate(() => openQuickOrder());
    await check(id(), F, "…a second ⚡ while an order is being built says so: 'You're already building an order (2 items)'", H, async () => ok(await waitToast(page, /You're already building an order \(2 items\) — send it or go back first\./), (await toastsNow(page)).join(" | ")));
    await page.click("#sendOrder"); await page.waitForSelector(".qdest-grid [data-qdest]");
    const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-qdest]")].map((b) => [b.dataset.qdest, b.querySelector("small").textContent])));
    await check(id(), F, "…SEND opens 'Which table?' — only the waiter's section, each saying free / joins its bill / joins T5's bill", H, () => ok(JSON.stringify(Object.keys(tiles)) === JSON.stringify(["5", "6", "7", "8"]) && tiles["5"] === "joins its bill" && tiles["6"] === "joins T5's bill" && tiles["7"] === "free", JSON.stringify(tiles)));
    await check(id(), F, "…and no are-you-sure: picking the table IS the second step", H, async () => ok(await page.evaluate(() => document.getElementById("confirmOverlay").hidden)));
    await page.click('[data-qdest="7"]'); await settle(page, 600);
    await check(id(), F, "…tapping T7 sends there and says 'Sent to T7! Kitchen ticket #901'", H, async () => ok(posts(w, /^\/order$/).some((p) => p.body.table === "7") && await waitToast(page, /^Sent to .*7! Kitchen ticket #901$/), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page); await page.evaluate(() => openQuickDest());
    await check(id(), F, "a table picker with an empty cart says 'Add at least one dish first'", H, async () => ok(await waitToast(page, /Add at least one dish first/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { w.summary.my_tables = []; });
    await page.evaluate(() => openQuickOrder()); await page.waitForSelector("#omScroll .dish");
    await dishTap(page, "t-plain"); await page.evaluate(() => document.getElementById("sendOrder").click()); await page.waitForSelector(".qdest-box");
    const t = await page.evaluate(() => document.querySelector(".qdest-box").innerText.replace(/\s+/g, " "));
    await check(id(), F, "a waiter with no section gets words, not an empty grid: 'No tables assigned to you yet' and the order is safe", H, () => ok(/No tables assigned to you yet/.test(t) && /This order is safe — nothing has been sent yet\./.test(t), t));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(() => {});
    await page.evaluate(() => selectTable("9")); await settle(page, 400);
    await page.evaluate(() => { state.ordering = true; state.cart = []; renderPanel(); }); await page.waitForSelector("#omExit");
    await page.click("#omExit"); await settle(page, 300);
    await check(id(), F, "← back from an order on a still-FREE table returns to the floor, not to an empty table popup", H, async () => ok(await page.evaluate(() => state.table === null && !document.querySelector("#panel .detail-pop"))));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), {}, { width: 1194, height: 834, touch: true });
    await takeOrder(page, 5); await dishTap(page, "t-plain");
    const lay = await page.evaluate(() => ({ cart: getComputedStyle(document.getElementById("omCart")).display, pill: getComputedStyle(document.getElementById("omViewBtn")).display }));
    await check(id(), F, "while browsing, the order is reviewed through the floating 'View order' pill (no side pane squeezing the dishes)", H, () => ok(lay.cart === "none" && lay.pill !== "none", JSON.stringify(lay)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), {}, { width: 390, height: 844, touch: true, mobile: true, dpr: 2 });
    await takeOrder(page, 5);
    await dishTap(page, "t-plain"); await dishTap(page, "t-plain");
    const pill = await page.evaluate(() => document.getElementById("omViewBtn").innerText.replace(/\s+/g, " "));
    await check(id(), F, "on a phone the floating pill counts the plates and the money: '2 View order ₹240 →'", H, () => ok(pill === "2 View order ₹240 →", pill));
    await page.click("#omViewBtn"); await page.waitForSelector("#voBack");
    await check(id(), F, "…tapping it opens 'Your order · T5' with the cart and SEND", H, async () => ok(await page.evaluate(() => document.querySelector(".vieworder h2").textContent === "Your order · T5" && !!document.getElementById("sendOrder"))));
    await page.click("#voBack"); await page.waitForSelector("#omScroll .dish");
    await check(id(), F, "…← Menu goes back ONE step, to the dish list, with the cart kept", H, async () => ok(await page.evaluate(() => state.ordering && !state.viewOrder && state.cart.length === 1)));
    await ctx.close();
  }

  // ── editing a dish already on the order ────────────────────────────────────────────────────
  {
    const { w, ctx, page, items, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing", allergies: ["dairy"], items: [{ title: "Test Lassi", price: 120, status: "preparing", note: "less ice" }, { title: "Mint Melon Juice", price: 380, status: "served" }] }] }));
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true);
    await page.click(`[data-edit-dish="${items[0].id}"]`); await page.waitForSelector(".dish-edit-overlay");
    const box = await page.evaluate(() => ({ h: document.querySelector(".dish-edit-overlay h3").textContent, note: document.querySelector(".dish-edit-note").value, all: [...document.querySelectorAll(".dish-alg-list .talg.on")].map((c) => c.textContent) }));
    await check(id(), F, "✎ Edit on a dish opens its box: its note, and the order-wide avoid tagged 'all'", H, () => ok(box.h === "Edit dish · Test Lassi" && box.note === "less ice" && box.all.some((x) => /all$/.test(x)), JSON.stringify(box)));
    await page.fill(".dish-edit-note", "no ice"); await page.click(".dish-edit-save"); await settle(page, 600);
    await check(id(), F, "…a note-only save asks no reason and sends the note with what it was before", H, () => { const p = posts(w, /\/note$/); return ok(p.length === 1 && p[0].body.note === "no ice" && /"note":"less ice"/.test(p[0].headers["x-lfh-expect"] || "") && !posts(w, /removed|allergies/).length, JSON.stringify(p[0] && p[0].body)); });
    await page.click(`[data-edit-dish="${items[0].id}"]`).catch(async () => { await tap(page, "[data-edit-order]"); await answerConfirm(page, true); await page.click(`[data-edit-dish="${items[0].id}"]`); });
    await page.waitForSelector(".dish-edit-overlay");
    await page.click('.dish-alg-list [data-slug="dairy"]');
    const q = await answerConfirm(page, true);
    await check(id(), F, "…turning off an order-wide avoid warns it comes off EVERY dish", H, () => ok(/is set for the WHOLE order\. Removing it here takes it off EVERY dish on this order/.test(q), q));
    await page.click('.dish-alg-list [data-slug="nuts"]');
    await page.click(".dish-edit-save"); await page.waitForSelector(".alg-why-chips button");
    const why = await page.evaluate(() => document.querySelector(".alg-why-chips").parentElement.innerText);
    await check(id(), F, "…an allergy change asks the reason first: 'Allergies for “Test Lassi” are changing.'", H, () => ok(/Allergies for “Test Lassi” are changing\./.test(why), why.slice(0, 120)));
    await page.click('.alg-why-chips button[data-v="Kitchen checked the dish"]'); await settle(page, 700);
    const rem = posts(w, /\/removed$/), alg = posts(w, /\/allergies$/);
    await check(id(), F, "…then nuts goes on THIS dish only, and dairy comes off the whole order — both with the one reason", H, () => ok(rem.length === 1 && JSON.stringify(rem[0].body.removed) === JSON.stringify(["nuts"]) && rem[0].body.reason === "Kitchen checked the dish" && alg.length === 1 && alg[0].body.allergies.length === 0 && alg[0].body.reason === "Kitchen checked the dish", JSON.stringify({ rem: rem[0] && rem[0].body, alg: alg[0] && alg[0].body })));
    await check(id(), F, "…and says 'Dish updated'", H, async () => ok(await waitToast(page, /^Dish updated$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing", items: [{ title: "Test Lassi", price: 120, status: "served" }] }] }));
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true);
    await page.click(`[data-edit-dish="${items[0].id}"]`); await page.waitForSelector(".dish-edit-overlay");
    const locked = await page.evaluate(() => ({ txt: document.querySelector(".dish-edit-overlay").innerText, save: document.querySelector(".dish-edit-save").disabled }));
    await check(id(), F, "a SERVED dish's box says it is locked and offers '↩ Send back to kitchen'; Save is off", H, () => ok(/already served — allergens & note are locked now/.test(locked.txt) && /Send back to kitchen/.test(locked.txt) && locked.save, locked.txt.slice(0, 160)));
    await page.click(".dish-edit-unserve");
    const q = await answerConfirm(page, true); await settle(page, 500);
    await check(id(), F, "…Send back asks first, then puts the dish back to 'preparing'", H, () => { const p = posts(w, /\/items\/[^/]+\/status/); return ok(/^Send "Test Lassi" back to the kitchen\?/.test(q) && p.length === 1 && p[0].body.status === "preparing", q); });
    await ctx.close();
  }
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing", items: [{ title: "Test Lassi", price: 120, status: "preparing" }] }] }));
    w.answer("POST", /\/note$/, { status: 409, body: { error: "clash_changed_elsewhere", clash: { plain: "Someone else changed this dish's note to “more ice”.", todo: "Your change was NOT saved." } } });
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true);
    await page.click(`[data-edit-dish="${items[0].id}"]`); await page.waitForSelector(".dish-edit-note");
    await page.fill(".dish-edit-note", "less sugar"); await page.click(".dish-edit-save");
    await check(id(), F, "a dish edit someone else beat closes the box and says both halves", H, async () => ok(await waitToast(page, /^Someone else changed this dish's note to “more ice”\. Your change was NOT saved\.$/) && !(await page.$(".dish-edit-overlay")), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /\/note$/, { status: 400, body: { error: "Notes are limited to 200 characters." } });
    await page.click(`[data-edit-dish="${items[0].id}"]`); await page.waitForSelector(".dish-edit-note");
    await page.fill(".dish-edit-note", "x"); await page.click(".dish-edit-save");
    await check(id(), F, "…a refusal says 'Couldn't save:' and keeps the box open to fix", H, async () => ok(await waitToast(page, /^Couldn't save: Notes are limited to 200 characters\.$/) && !!(await page.$(".dish-edit-overlay")), (await toastsNow(page)).join(" | ")));
    await page.click(".dish-edit-cancel");
    w.overrides.length = 0;
    await ctx.setOffline(true);
    await page.click(`[data-edit-dish="${items[0].id}"]`); await page.waitForSelector(".dish-edit-note");
    await page.fill(".dish-edit-note", "warm"); await clearToastsNow(page); await page.click(".dish-edit-save"); await settle(page, 1500);
    const said = await toastsNow(page);
    await check(id(), F, "a dish edit saved with no internet says it is SAVED, not 'Dish updated'", H, () => ok(said.some((t) => /[Ss]aved/.test(t)) && !said.includes("Dish updated"), said.join(" | ")));
    await ctx.setOffline(false);
    await clearToastsNow(page);
    await page.evaluate(() => openDishEditModal("no-such-dish"));
    await check(id(), F, "editing a dish that has just left the order says so", H, async () => ok(await waitToast(page, /That dish is no longer on the order\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
}
