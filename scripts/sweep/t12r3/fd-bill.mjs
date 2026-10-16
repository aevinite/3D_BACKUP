// scripts/sweep/t12r3/fd-bill.mjs — band F, group 4: the bill — print it, reopen it, the pay sheet (tip,
// methods, the guest's number, loyalty points), pay later, on the house, a table's type, the invoice.
// Fixture world: nothing is written anywhere; what the panel SENT is read back from the world's log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, answerConfirm, typePin, toastsNow, clearToastsNow, undoBar, tapUndo, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = build(w) || {};
  const { ctx, page } = await openWorld(w, device);
  // A bill window is a real pop-up in a browser; here it is caught so what was WRITTEN into it can be read.
  await page.evaluate(() => { window.__opened = []; window.open = () => { const doc = { html: "", open() {}, write(h) { this.html += h; }, close() {} }; const win = { document: doc, focus() {} }; window.__opened.push(win); return win; }; });
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);
const opened = (page) => page.evaluate(() => window.__opened.map((x) => x.document.html));
const queueLeft = (page, re) => page.evaluate((src) => { const s = window.LFH_OUTBOX.getSnapshot(); return [...s.queued, ...s.failed].filter((x) => new RegExp(src).test(x.path)).length; }, re.source);
const openPay = async (page) => { await tap(page, "#payBill"); await page.waitForSelector(".pay-overlay .pay-method-btn"); };

export async function blockFD(R, id) {
  const { check } = R;

  // ── printing the bill ──────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, s } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 399 }] }));
    w.answer("POST", /^\/print\/send/, { body: { noRoute: true } });
    await openTable(page, 5);
    await tap(page, "#printBillBtn"); await settle(page, 600);
    const p = posts(w, /^\/print\/send/);
    await check(id(), F, "🖨 Print bill first offers the bill to the computer that owns the paper (if any)", H, () => ok(p.length === 1 && p[0].body.kind === "bill" && p[0].body.sessionId === s.id, JSON.stringify(p[0] && p[0].body)));
    const docs = await opened(page);
    await check(id(), F, "…no computer owns it, so the bill opens HERE, naming the table and the amount", H, () => ok(docs.length === 1 && /T5/.test(docs[0]) && /399/.test(docs[0]), docs.length + " window(s)"));
    w.overrides.length = 0;
    w.answer("POST", /^\/print\/send/, { body: { queued: true, printer: "Counter", note: "Sent to Counter — it prints in a moment" } });
    await clearToastsNow(page); await tap(page, "#printBillBtn");
    await check(id(), F, "…a computer took it: the server's own sentence, and nothing opens on the tablet", H, async () => ok(await waitToast(page, /Sent to Counter — it prints in a moment/) && (await opened(page)).length === 1, (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /^\/print\/send/, { body: { queued: true, printer: "Counter" } });
    await clearToastsNow(page); await tap(page, "#printBillBtn");
    await check(id(), F, "…with no sentence from the server it says 'Sent to Counter'", H, async () => ok(await waitToast(page, /^Sent to Counter$/), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /^\/print\/send/, { abort: true });
    await clearToastsNow(page); await tap(page, "#printBillBtn");
    await check(id(), F, "…the counter can't be reached: the bill opens here and the waiter is told why", H, async () => ok(await waitToast(page, /the bill is open here instead/, 8000) && (await settle(page, 300), (await opened(page)).length === 2), (await toastsNow(page)).join(" | ")));
    await check(id(), F, "…and that print request is taken back out of the queue (it can never come out later)", H, async () => ok(await queueLeft(page, /print\/send/) === 0));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }));
    await openTable(page, 5);
    await ctx.setOffline(true);
    await clearToastsNow(page); await tap(page, "#printBillBtn");
    await check(id(), F, "with no internet at all the toast says so: 'No internet — the bill is open here…'", H, async () => ok(await waitToast(page, /No internet — the bill is open here instead of at the counter printer\./, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.setOffline(false);
    await page.evaluate(() => { window.open = () => null; });
    w.answer("POST", /^\/print\/send/, { body: { noRoute: true } });
    await clearToastsNow(page); await tap(page, "#printBillBtn");
    await check(id(), F, "a blocked pop-up says 'Allow pop-ups to print the bill.'", H, async () => ok(await waitToast(page, /Allow pop-ups to print the bill\./), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page);
    await page.evaluate(() => { const b = LFH_BILLDOC.billData; LFH_BILLDOC.billData = null; printTableBill("5"); LFH_BILLDOC.billData = b; });
    await check(id(), F, "if the bill maker failed to load: 'Can't print just now — reload the panel.'", H, async () => ok(await waitToast(page, /Can't print just now — reload the panel\./), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page);
    await page.evaluate(() => printTableBill("9"));
    await check(id(), F, "a table with nothing on it: 'Nothing on this table to print yet.'", H, async () => ok(await waitToast(page, /Nothing on this table to print yet\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    // No party row at all (a restaurant with dining sessions off): the orders carry no session id.
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ status: "served", noSession: true }] }); w.slices["5"].sessions = []; }, { sessions_enabled: false });
    await page.evaluate(() => selectTable("5")); await settle(page, 600);
    await page.evaluate(() => printTableBill("5"));
    await settle(page, 400);
    await check(id(), F, "a bill with no party row (sessions off) opens straight away — nothing to offer a computer", H, async () => ok((await opened(page)).length === 1 && posts(w, /print\/send/).length === 0));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 1000 }], session: { cust_phone: "9876543210" } }));
    w.answer("POST", /^\/print\/send/, { body: { noRoute: true } });
    w.answer("POST", /^\/tables\/5\/loyalty$/, { body: { on: true, earn_per_100: 5, balance: 40, min_redeem: 100 } });
    await openTable(page, 5);
    const got = await page.evaluate(async () => { let L; const bd = LFH_BILLDOC.billData; LFH_BILLDOC.billData = (a) => { L = a.loyalty; return bd(a); }; await printTableBill("5"); LFH_BILLDOC.billData = bd; return L; });
    const total = await page.evaluate(() => LFH_BILLDOC.billMoney(state.data.orders, state.data.settings).total);
    const earn = Math.floor((total * 5) / 100);
    await check(id(), F, "a bill with the guest's number carries their points: what this bill earns, the balance before it, how far to the next reward", H, () => ok(got && got.earn === earn && got.balance === 40 && got.toNext === Math.max(0, 100 - (40 + earn)), JSON.stringify(got)));
    w.overrides.shift();
    w.answer("POST", /^\/tables\/5\/loyalty$/, { body: { on: false } });
    const off = await page.evaluate(async () => { let L = "unset"; const bd = LFH_BILLDOC.billData; LFH_BILLDOC.billData = (a) => { L = a.loyalty; return bd(a); }; await printTableBill("5"); LFH_BILLDOC.billData = bd; return L; });
    await check(id(), F, "…and nothing at all when the module is off", H, () => ok(off === null, JSON.stringify(off)));
    w.overrides.shift();
    w.answer("POST", /^\/tables\/5\/loyalty$/, { abort: true });
    const offline = await page.evaluate(async () => { let L = "unset"; const bd = LFH_BILLDOC.billData; LFH_BILLDOC.billData = (a) => { L = a.loyalty; return bd(a); }; await printTableBill("5"); LFH_BILLDOC.billData = bd; return L; });
    await settle(page, 300);
    await check(id(), F, "…with no internet the bill prints without points, and the points lookup is not left waiting in the queue", H, async () => ok(offline === null && await queueLeft(page, /loyalty$/) === 0, JSON.stringify(offline)));
    await ctx.close();
  }

  // ── reopening a paid bill ──────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", payment_status: "paid" }] }));
    await openTable(page, 5);
    await tap(page, "#unpayBill");
    const q = await answerConfirm(page, false);
    await check(id(), F, "↩ Mark unpaid asks first, saying it reverses a recorded payment", H, () => ok(q === "Reopen this bill as UNPAID? This reverses the recorded payment — a refund or correction.", q));
    await tap(page, "#unpayBill"); await answerConfirm(page, true);
    await page.waitForSelector(".rp-ok"); await page.click(".rp-ok");
    const e = await page.evaluate(() => document.querySelector(".rp-err").textContent);
    await check(id(), F, "…then asks why, and a blank reason is refused in the box", H, () => ok(e === "A reason is required.", e));
    await page.click(".rp-cancel");
    await check(id(), F, "…backing out of the reason says 'Not reopened — a reason is required.'", H, async () => ok(await waitToast(page, /Not reopened — a reason is required\./) && posts(w, /unpay/).length === 0, (await toastsNow(page)).join(" | ")));
    await tap(page, "#unpayBill"); await answerConfirm(page, true);
    await page.waitForSelector(".rp-in"); await page.fill(".rp-in", "refund — wrong dish"); await page.click(".rp-ok");
    await check(id(), F, "…with a reason it reopens the bill, sending the reason, and says so", H, async () => ok(await waitToast(page, /Bill reopened — marked unpaid/) && posts(w, /^\/tables\/5\/unpay/).some((p) => p.body.reason === "refund — wrong dish"), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── the pay sheet ──────────────────────────────────────────────────────────────────────────
  {
    // The button exists once something is accepted and unpaid; a NEW order beside it is what dims it.
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }, { status: "received" }] }));
    await openTable(page, 5);
    await tap(page, "#payBill");
    await check(id(), F, "💳 Mark bill paid with an order not yet accepted refuses OUT LOUD (the button is never dead)", H, async () => ok(await waitToast(page, /Accept the order first — a bill can only be paid once the kitchen has it\./) && !(await page.$(".pay-overlay")), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    await openTable(page, 5);
    await openPay(page);
    const head = await page.evaluate(() => document.querySelector(".pay-overlay h3").textContent + " | " + document.querySelector(".pay-overlay").innerText.match(/Amount collected\s*(₹[\d,]+)/)?.[1]);
    await check(id(), F, "the pay sheet names the bill and the table, and the amount to collect", H, () => ok(head === "Mark bill #41 paid for table 5 | ₹400", head));
    await page.click('.pay-tip-pick[data-tip-pct="10"]');
    const t1 = await page.evaluate(() => ({ pct: document.querySelector(".pay-tip-pct").value, amt: document.querySelector(".pay-tip-amt").value, paid: document.querySelector(".pay-tip-paid").value }));
    await check(id(), F, "…the 10% tip chip fills all three boxes: 10 %, ₹40, they paid ₹440", H, () => ok(t1.pct === "10" && t1.amt === "40" && t1.paid === "440", JSON.stringify(t1)));
    await page.fill(".pay-tip-amt", "500");
    const m1 = await page.evaluate(() => document.querySelector(".pay-tip-msg").textContent);
    await check(id(), F, "…a tip bigger than the bill is allowed but said: 'That is a tip bigger than the bill (₹400). Fine if they meant it.'", H, () => ok(m1 === "That is a tip bigger than the bill (₹400). Fine if they meant it.", m1));
    await page.fill(".pay-tip-amt", "200000");
    const m2 = await page.evaluate(() => document.querySelector(".pay-tip-msg").textContent);
    await check(id(), F, "…a tip past the ceiling names the ceiling", H, () => ok(/^The most a tip can be is ₹1,00,000 — check that figure\.$/.test(m2), m2));
    await page.fill(".pay-tip-paid", "350");
    const m3 = await page.evaluate(() => ({ m: document.querySelector(".pay-tip-msg").textContent, amt: document.querySelector(".pay-tip-amt").value }));
    await check(id(), F, "…'They paid' below the bill says that box is the TOTAL handed over, and the tip becomes none", H, () => ok(m3.m === "That is less than the bill (₹400) — this box is the TOTAL they handed over, tip included." && m3.amt === "", JSON.stringify(m3)));
    await page.fill(".pay-tip-paid", "");
    await page.fill(".pay-tip-paid", "450");
    await page.click(".pay-method-btn[data-method='Cash']"); await settle(page, 700);
    const pay = posts(w, /^\/tables\/5\/pay$/), tip = posts(w, /\/tip$/);
    await check(id(), F, "…Cash settles the bill with the method", H, () => ok(pay.length === 1 && pay[0].body.payment_method === "Cash", JSON.stringify(pay[0] && pay[0].body)));
    await check(id(), F, "…and only THEN records the ₹50 tip, on the first ticket", H, () => ok(tip.length === 1 && tip[0].path === `/orders/${orders[0].id}/tip` && tip[0].body.amount === 50 && tip[0].at >= pay[0].at, JSON.stringify(tip[0] && tip[0].body)));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    const ub = await undoBar(page);
    await check(id(), F, "…and offers it back: 'Bill paid via Cash · T5 · tap undo to reopen the bill'", H, () => ok(ub && /Bill paid via Cash/.test(ub) && /T5 · tap undo to reopen the bill/.test(ub), ub));
    await tapUndo(page); await settle(page, 600);
    await check(id(), F, "…undo reopens it through the same unpay the manager uses", H, () => ok(posts(w, /^\/tables\/5\/unpay/).length === 1));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    await openTable(page, 5); await openPay(page);
    await page.click(".pay-method-btn[data-method='Other']");
    const shown = await page.evaluate(() => getComputedStyle(document.querySelector(".pay-other-write")).display !== "none" && document.activeElement.classList.contains("pay-other-input"));
    await check(id(), F, "Other opens its 'What kind?' box with the cursor in it", H, () => ok(shown));
    await page.fill(".pay-other-input", "bank transfer"); await page.press(".pay-other-input", "Enter"); await settle(page, 600);
    await check(id(), F, "…Enter settles it as Other, with what was typed", H, () => { const p = posts(w, /^\/tables\/5\/pay$/); return ok(p.length === 1 && p[0].body.payment_method === "Other" && p[0].body.payment_note === "bank transfer", JSON.stringify(p[0] && p[0].body)); });
    const second = await page.evaluate(async () => { const a = openPaymentMethodModal(100, "x"); const b = await openPaymentMethodModal(100, "y"); document.querySelector(".pay-cancel-btn").click(); return { b, n: document.querySelectorAll(".pay-overlay").length, a: await a }; });
    await check(id(), F, "a second pay sheet while one is open is refused (never two stacked money screens)", H, () => ok(second.b === null && second.a === null && second.n === 0, JSON.stringify(second)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    w.recognize = { known: true, visits: 2, name: "Asha" };
    w.answer("POST", /^\/tables\/5\/loyalty$/, { body: { on: true, balance: 120, min_redeem: 100, point_value_paise: 100 } });
    w.answer("POST", /^\/tables\/5\/loyalty-redeem/, { body: { ok: true, rupees: 120, spent: 120 } });
    w.answer("POST", /customer-capture/, { body: { ok: true, visits: 3 } });
    await openTable(page, 5); await openPay(page);
    await page.fill(".pay-cust-phone", "98765 43210"); await settle(page, 900);
    const chip = await page.evaluate(() => ({ chip: document.querySelector(".pay-cust-chip").textContent, name: document.querySelector(".pay-cust-name").value, loy: document.querySelector(".pay-loyalty").innerText }));
    await check(id(), F, "a number that has been here before: '✨ Repeat customer · 3rd visit · Asha', and the name fills itself", H, () => ok(chip.chip === "✨ Repeat customer · 3rd visit · Asha" && chip.name === "Asha", JSON.stringify(chip)));
    await check(id(), F, "…the lookup is one call after the typing stops, on the digits only", H, () => { const g = w.sent("GET", /^\/customer-recognize/); return ok(g.length === 1 && g[0].query.get("phone") === "9876543210", g.length + " lookups"); });
    await check(id(), F, "…their points show with what they are worth and a 'Use ₹120 off' button", H, () => ok(/⭐ 120 points · worth ₹120 Use ₹120 off/.test(chip.loy.replace(/\s+/g, " ")), chip.loy));
    await page.click(".pay-loyalty-use");
    await check(id(), F, "…Use spends the points in ONE request and says what came off", H, async () => ok(await waitToast(page, /⭐ ₹120 off — 120 points used/) && posts(w, /loyalty-redeem/).some((p) => p.body.phone === "9876543210" && p.body.points === 120), (await toastsNow(page)).join(" | ")));
    await page.check(".pay-cust-consent");
    await page.click(".pay-method-btn[data-method='UPI']"); await settle(page, 800);
    await check(id(), F, "…with consent ticked, the guest is saved AFTER the bill, and the toast says how many visits", H, async () => ok(posts(w, /customer-capture/).some((p) => p.body.phone === "98765 43210" && p.body.name === "Asha" && p.body.consent === true) && await waitToast(page, /📇 Saved Asha · 3 visits/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    w.recognize = { known: true, visits: 0 };
    w.answer("POST", /^\/tables\/5\/loyalty$/, { body: { on: true, balance: 30, min_redeem: 100, point_value_paise: 50 } });
    await openTable(page, 5); await openPay(page);
    await page.fill(".pay-cust-phone", "9876543210"); await settle(page, 900);
    const loy = await page.evaluate(() => document.querySelector(".pay-loyalty").innerText.replace(/\s+/g, " "));
    await check(id(), F, "points below the minimum say how many more are needed, with no Use button", H, () => ok(loy === "⭐ 30 points · worth ₹15 · 70 more to use them", loy));
    await page.fill(".pay-cust-phone", "12345");  await settle(page, 600);
    await check(id(), F, "…a number too short to be one hides the repeat-customer line again", H, async () => ok(await page.evaluate(() => getComputedStyle(document.querySelector(".pay-cust-chip")).display === "none")));
    w.recognize = { known: false };
    await page.fill(".pay-cust-phone", "9000000001"); await settle(page, 900);
    await check(id(), F, "…an unknown number shows no chip and no points", H, async () => ok(await page.evaluate(() => getComputedStyle(document.querySelector(".pay-cust-chip")).display === "none" && getComputedStyle(document.querySelector(".pay-loyalty")).display === "none")));
    await page.click(".pay-method-btn[data-method='Cash']"); await settle(page, 600);
    await check(id(), F, "…and without the consent tick nobody is saved", H, () => ok(posts(w, /customer-capture/).length === 0));
    await ctx.close();
  }
  {
    // The loyalty BUTTON's two awkward answers: a refusal, and no internet. A tap must never vanish in
    // silence, and the device's own queue answer ({ ok:true, queued:true }) is not the server's.
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    w.recognize = { known: true, visits: 1 };
    w.answer("POST", /^\/tables\/5\/loyalty$/, { body: { on: true, balance: 120, min_redeem: 100, point_value_paise: 100 } });
    w.answer("POST", /^\/tables\/5\/loyalty-redeem/, { status: 403, body: { error: "Points can't be used on a bill that already has a discount." } });
    await openTable(page, 5); await openPay(page);
    await page.fill(".pay-cust-phone", "9876543210"); await settle(page, 900);
    await clearToastsNow(page);
    await page.click(".pay-loyalty-use");
    await check(id(), F, "a refused 'Use points' tap SAYS why (the server's own sentence)", H, async () => ok(await waitToast(page, /Points can't be used on a bill that already has a discount\./), (await toastsNow(page)).join(" | ") || "nothing said"));
    w.overrides.splice(w.overrides.findIndex((o) => String(o.re) === String(/^\/tables\/5\/loyalty-redeem/)), 1);
    w.answer("POST", /^\/tables\/5\/loyalty-redeem/, { abort: true });
    await clearToastsNow(page);
    await page.click(".pay-loyalty-use"); await settle(page, 1500);
    const said = await toastsNow(page);
    await check(id(), F, "…with no internet it never says points were used ('undefined points used')", H, () => ok(!said.some((t) => /points used/.test(t)), said.join(" | ")));
    // The manager panel's ruling (T39 item 16): a saved redemption is KEPT and sent later — the ledger
    // allows one redeem per bill, so a replay cannot spend twice. The button says so; the strip waits.
    await check(id(), F, "…the button says 'Saved — sends when back online' and the points strip is not redrawn as spent", H, async () => ok(await page.evaluate(() => document.querySelector(".pay-loyalty-use")?.textContent) === "Saved — sends when back online" && said.some((t) => /^Saved ✓/.test(t)), said.join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }], session: { cust_phone: "9876543210", cust_name: "Asha" } }));
    await openTable(page, 5); await openPay(page);
    const known = await page.evaluate(() => document.querySelector(".pay-cust-known")?.innerText.replace(/\s+/g, " "));
    await check(id(), F, "a table whose guest already gave their number is not asked again: 'already saved for this table · Asha · 9876543210'", H, () => ok(/already saved for this table/.test(known) && /Asha · 9876543210/.test(known), known));
    await page.click(".pay-cust-change");
    const ch = await page.evaluate(() => ({ p: document.querySelector(".pay-cust-phone").value, n: document.querySelector(".pay-cust-name").value, c: document.querySelector(".pay-cust-consent").checked }));
    await check(id(), F, "…Change opens the boxes already filled in, consent kept", H, () => ok(ch.p === "9876543210" && ch.n === "Asha" && ch.c === true, JSON.stringify(ch)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }), { tablet_mark_paid: "pin" });
    w.answer("POST", /^\/tables\/5\/pay$/, { fn: (r) => (r.body && r.body.managerPin ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } }) });
    await openTable(page, 5); await openPay(page);
    await page.click('.pay-tip-pick[data-tip-pct="5"]');
    await page.click(".pay-method-btn[data-method='Card']");
    await typePin(page, "2468"); await settle(page, 700);
    const tip = posts(w, /\/tip$/);
    await check(id(), F, "on a PIN restaurant the bill is settled with the PIN…", H, () => { const p = posts(w, /^\/tables\/5\/pay$/); return ok(p.length === 2 && p[1].body.managerPin === "2468", p.map((x) => JSON.stringify(x.body)).join(" ")); });
    await check(id(), F, "…and the tip goes after it WITH that same PIN (never refused for want of one)", H, () => ok(tip.length === 1 && tip[0].body.managerPin === "2468" && tip[0].body.amount === 20, JSON.stringify(tip[0] && tip[0].body)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }));
    w.answer("POST", /\/tip$/, { status: 400, body: { error: "Tips are switched off here." } });
    await openTable(page, 5); await openPay(page);
    await page.click('.pay-tip-pick[data-tip-pct="10"]'); await page.click(".pay-method-btn[data-method='UPI']");
    await check(id(), F, "a refused tip is never silent: 'Bill is paid, but the ₹40 tip was not recorded — …'", H, async () => ok(await waitToast(page, /^Bill is paid, but the ₹40 tip was not recorded — Tips are switched off here\. Add it from the manager panel\.$/), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /\/tip$/, { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } });
    await clearToastsNow(page);
    await page.evaluate(() => { recordTip("5", 30, null); });
    await page.waitForSelector(".pp-cancel"); await page.click(".pp-cancel");
    await check(id(), F, "…a tip that suddenly needs a PIN asks once; cancelling says it was not recorded", H, async () => ok(await waitToast(page, /^The ₹30 tip was not recorded — add it from the manager panel\.$/), (await toastsNow(page)).join(" | ")));
    await clearToastsNow(page);
    await page.evaluate(() => recordTip("9", 30, null));
    await check(id(), F, "…a tip on a table with no ticket says there is nothing to put it on", H, async () => ok(await waitToast(page, /The tip could not be recorded — this bill has no ticket to put it on\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── on the house, pay later ────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }], tile: { tag: "family" } }), { khata_allowed: true, tablet_khata: "on", table_tags_allowed: true });
    await openTable(page, 5); await openPay(page);
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".pay-method-btn")].map((b) => b.textContent.trim()));
    await check(id(), F, "a Family table's pay sheet offers 🏠 On the house, and Pay Later when the restaurant has it", H, () => ok(tiles.some((x) => /On the house/.test(x)) && tiles.some((x) => /Pay Later/.test(x)), tiles.join(" | ")));
    await page.click('.pay-method-btn[data-special="onhouse"]'); await settle(page, 600);
    await check(id(), F, "…On the house settles it free", H, () => ok(posts(w, /^\/tables\/5\/on-the-house/).length === 1));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    await check(id(), F, "…and offers it back: '🏠 On the house — settled free'", H, async () => { const u = await undoBar(page); return ok(u && /On the house — settled free/.test(u), u); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }), { tablet_khata: "on", khata_allowed: true });
    w.khata = { customers: [{ id: "c-asha", name: "Asha Rao", phone: "9876543210", note: "regular" }] };
    await openTable(page, 5); await openPay(page);
    const plain = await page.evaluate(() => [...document.querySelectorAll(".pay-method-btn")].some((b) => /On the house/.test(b.textContent)));
    await check(id(), F, "an ordinary table is NOT offered On the house", H, () => ok(!plain));
    await page.click('.pay-method-btn[data-special="khata"]');
    await page.waitForSelector(".khata-overlay .kp-row");
    const sheet = await page.evaluate(() => document.querySelector(".khata-overlay").innerText.replace(/\s+/g, " "));
    await check(id(), F, "Pay Later opens 'who's this bill on?' with the table, the amount and the khata book", H, () => ok(/Pay Later — who's this bill on\?/.test(sheet) && /T5 bill ₹400/.test(sheet) && /Asha Rao 9876543210 · regular/.test(sheet), sheet.slice(0, 220)));
    await page.click(".kp-go");
    await check(id(), F, "…Park with nobody picked or typed says what to do", H, async () => ok(await waitToast(page, /Pick a person from the list, or type a name to add them\./), (await toastsNow(page)).join(" | ")));
    w.khata = { customers: [] };
    await page.fill(".kp-search", "zz"); await settle(page, 600);
    const none = await page.evaluate(() => document.querySelector(".kp-list").textContent.trim());
    await check(id(), F, "…a search that finds no one says 'No one found — add them below.'", H, () => ok(none === "No one found — add them below.", none));
    await check(id(), F, "…the search asks the server once the typing stops, with what was typed", H, () => ok(w.sent("GET", /^\/khata\/customers/).some((r) => r.query.get("q") === "zz")));
    await page.fill(".kp-name", "Ravi Kumar"); await page.fill(".kp-phone", "9000000002"); await page.fill(".kp-note", "pays Fridays");
    await page.click(".kp-go"); await settle(page, 700);
    await check(id(), F, "…a new person is parked with name, number and note, and the table closes", H, async () => { const p = posts(w, /^\/tables\/5\/khata/); return ok(p.length === 1 && p[0].body.name === "Ravi Kumar" && p[0].body.phone === "9000000002" && p[0].body.note === "pays Fridays" && await page.evaluate(() => state.table === null), JSON.stringify(p[0] && p[0].body)); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 400 }] }), { tablet_khata: "on", khata_allowed: true });
    w.khata = { customers: [{ id: "c-asha", name: "Asha Rao", phone: "" }] };
    await openTable(page, 5); await openPay(page);
    await page.click('.pay-method-btn[data-special="khata"]'); await page.waitForSelector(".kp-row");
    const row = await page.evaluate(() => document.querySelector(".kp-row").innerText.replace(/\s+/g, " "));
    await check(id(), F, "a khata person with no number reads 'no mobile'", H, () => ok(row === "Asha Rao no mobile", row));
    await page.click(".kp-row"); await page.click(".kp-go"); await settle(page, 600);
    await check(id(), F, "…picking them parks the bill on their id", H, () => { const p = posts(w, /^\/tables\/5\/khata/); return ok(p.length === 1 && p[0].body.customer_id === "c-asha", JSON.stringify(p[0] && p[0].body)); });
    await openTable(page, 5); await openPay(page);
    await page.click('.pay-method-btn[data-special="khata"]'); await page.waitForSelector(".kp-cancel"); await page.click(".kp-cancel"); await settle(page, 300);
    await check(id(), F, "…Cancel parks nothing", H, () => ok(posts(w, /^\/tables\/5\/khata/).length === 1));
    await ctx.close();
  }

  // ── a table's type ─────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), { table_tags_allowed: true, tablet_table_tags: "on" });
    await openTable(page, 5);
    await tap(page, "#tagTable"); await page.waitForSelector(".tag-overlay .tag-pick");
    const opts = await page.evaluate(() => [...document.querySelectorAll(".tag-pick")].map((b) => (b.querySelectorAll("span")[1] || b).childNodes[0].textContent.trim()));
    await check(id(), F, "🏷 Table type offers VIP, Family and Owner's guest (no 'Remove' while unmarked)", H, () => ok(opts.length === 3 && /VIP/.test(opts[0]) && /Family/.test(opts[1]) && /Owner's guest/.test(opts[2]), opts.join(" | ")));
    let release; w.hold = new Promise((r) => { release = r; });
    await page.click('.tag-pick[data-tag="vip"]'); await settle(page, 150);
    const now = await page.evaluate(() => state.summary.tiles["5"].tag);
    w.hold = null; release();
    await check(id(), F, "…picking VIP marks the tile at once, before the server answers", H, () => ok(now === "vip", now));
    await check(id(), F, "…then says 'Marked 👑 VIP'", H, async () => ok(await waitToast(page, /^Marked 👑 VIP$/) && posts(w, /^\/tables\/5\/tag/).some((p) => p.body.tag === "vip"), (await toastsNow(page)).join(" | ")));
    await openTable(page, 5); await tap(page, "#tagTable"); await page.waitForSelector('.tag-pick[data-tag=""]');
    await page.click('.tag-pick[data-tag=""]');
    await check(id(), F, "…a marked table offers '✕ Remove mark', which clears it", H, async () => ok(await waitToast(page, /^Mark removed$/) && posts(w, /^\/tables\/5\/tag/).some((p) => p.body.tag === null), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), { table_tags_allowed: true, tablet_table_tags: "pin" });
    w.answer("POST", /\/tag$/, { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } });
    await openTable(page, 5); await tap(page, "#tagTable"); await page.waitForSelector(".tag-pick");
    await page.click('.tag-pick[data-tag="family"]');
    await page.waitForSelector(".pp-cancel"); await page.click(".pp-cancel"); await settle(page, 300);
    await check(id(), F, "on a PIN restaurant, cancelling the PIN puts the tile back as it was", H, async () => ok(await page.evaluate(() => (state.summary.tiles["5"].tag || "") === "")));
    w.overrides.length = 0;
    w.answer("POST", /\/tag$/, { status: 400, body: { error: "Table types are switched off." } });
    await openTable(page, 5); await tap(page, "#tagTable"); await page.waitForSelector(".tag-pick");
    await page.click('.tag-pick[data-tag="guest"]');
    await check(id(), F, "a refused mark is put back and says why", H, async () => ok(await waitToast(page, /Failed: Table types are switched off\./) && await page.evaluate(() => (state.summary.tiles["5"].tag || "") === ""), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /\/tag$/, { abort: true });
    await openTable(page, 5); await tap(page, "#tagTable"); await page.waitForSelector(".tag-pick");
    await clearToastsNow(page);
    await page.click('.tag-pick[data-tag="vip"]'); await settle(page, 1500);
    const said = await toastsNow(page);
    await check(id(), F, "a mark made with no internet says it is SAVED to send, not 'Marked 👑 VIP'", H, () => ok(said.some((t) => /[Ss]aved/.test(t)) && !said.some((t) => /^Marked/.test(t)), said.join(" | ")));
    await ctx.close();
  }

  // ── the invoice ────────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, s } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }), { tablet_invoice: "on", bill_customer_required: false });
    await openTable(page, 5);
    await tap(page, "#genInvoiceBtn");
    const q = await answerConfirm(page, false);
    await check(id(), F, "🧾 Generate invoice with no customer step and no PIN still asks once: 'Generate the invoice for this table?'", H, () => ok(q === "Generate the invoice for this table?", q));
    await check(id(), F, "…and No issues nothing", H, () => ok(posts(w, /invoice/).length === 0));
    await tap(page, "#genInvoiceBtn"); await answerConfirm(page, true); await settle(page, 500);
    await check(id(), F, "…Generate issues it for that session", H, () => ok(posts(w, new RegExp(`^/sessions/${s.id}/invoice`)).length === 1));
    await ctx.close();
  }
  {
    const { w, ctx, page, s } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }], session: { cust_phone: "9876543210", cust_name: "Asha" } }), { tablet_invoice: "pin", bill_customer_required: true });
    await openTable(page, 5);
    await tap(page, "#genInvoiceBtn"); await page.waitForSelector(".bcust-overlay .bc-phone");
    const pre = await page.evaluate(() => ({ p: document.querySelector(".bc-phone").value.replace(/\D/g, ""), n: document.querySelector(".bc-name").value, confirm: !document.getElementById("confirmOverlay").hidden }));
    await check(id(), F, "when the restaurant wants the customer on the bill, that sheet IS the second step (no extra are-you-sure)", H, () => ok(!pre.confirm));
    await check(id(), F, "…and it opens with THIS session's own customer filled in", H, () => ok(pre.p.endsWith("9876543210") && pre.n === "Asha", JSON.stringify(pre)));
    await page.click(".bc-cancel"); await settle(page, 300);
    await check(id(), F, "…backing out of it issues nothing", H, () => ok(posts(w, /invoice/).length === 0));
    w.answer("POST", /\/invoice$/, { fn: (r) => r.body && r.body.managerPin ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await tap(page, "#genInvoiceBtn"); await page.waitForSelector(".bc-go");
    await page.click(".bc-go"); await typePin(page, "1357");
    await check(id(), F, "…with the customer confirmed, a PIN restaurant asks the PIN and says 'Invoice generated'", H, async () => ok(await waitToast(page, /Invoice generated/) && posts(w, new RegExp(`^/sessions/${s.id}/invoice`)).some((p) => p.body.managerPin === "1357" && p.body.cust_phone && p.body.cust_name === "Asha"), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
}
