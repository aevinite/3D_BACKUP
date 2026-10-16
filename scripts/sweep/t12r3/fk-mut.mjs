// scripts/sweep/t12r3/fk-mut.mjs — band F, group FK: the checks MUTATION PASS 1 asked for. Each one is
// aimed at a deliberate break that survived band F (mutate.mjs, seed 1: 120 mutants, 88 killed, 32
// survived); the line it guards is named in the check. Breaks that change nothing observable (null ↔
// undefined from a falsy reader, a repaint the next refresh does anyway) are equivalent and recorded as
// such in the round-3 report instead. Fixture world: nothing is written anywhere.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — aimed at a mutation survivor (nothing written)";
const scene = async (build, settings = {}, device = {}, who) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  if (who) w.whoami = { ...w.whoami, ...who };
  const made = (build && build(w)) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);

export async function blockFK(R, id) { await blockFK1(R, id); await blockFK2(R, id); await blockFK3(R, id); }
async function blockFK1(R, id) {
  const { check } = R;
  {
    // renderMySection (L1172 `if (!el)`, L1185 `if (!real.length)`), floorFilterCounts (L1486), passesFilter (L1368)
    const { ctx, page } = await scene((w) => { w.summary.my_tables = ["1", "2", "3", "4", "5", "6"]; seat(w, 5, { orders: [{}] }); seat(w, 20, { orders: [{}] }); });
    const strip = await page.evaluate(() => { const e = document.getElementById("mySection"); return e && getComputedStyle(e).display !== "none" ? e.innerText.replace(/\s+/g, " ") : ""; });
    await check(id(), F, "a waiter with a section sees 'Your tables 1–6 · 6 tables' over the floor", H, () => ok(/Your tables 1–6 6 tables/.test(strip), strip));
    const nav = await page.evaluate(() => [...document.querySelectorAll("#floorNav [data-filter]")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    await check(id(), F, "…the filter counts count THEIR tables only (All 6 · Active 1 · Free 5), not the restaurant's 30", H, () => ok(nav.some((x) => /^All 6$/.test(x)) && nav.some((x) => /^Active 1$/.test(x)) && nav.some((x) => /^Free 5$/.test(x)), nav.join(" | ")));
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".tile[data-t]")].map((t) => t.dataset.t));
    await check(id(), F, "…and the floor draws only tables 1–6 (T20, busy but not theirs, is not on it)", H, () => ok(tiles.join(",") === "1,2,3,4,5,6", tiles.join(",")));
    await ctx.close();
  }
  {
    // The bell (L1606 `if (!window.LFH_BELL)`, L1615 resolved calls, L1617 my section)
    const { ctx, page } = await scene((w) => {
      w.summary.my_tables = ["1", "2", "3", "4", "5", "6"];
      seat(w, 5, { orders: [{}], calls: [{ note: "Water" }] });
      seat(w, 6, { orders: [{}], calls: [{ note: "Bill please" }] });
      seat(w, 20, { orders: [{}], calls: [{ note: "Napkins" }] });
      w.summary.calls.find((c) => c.note === "Bill please").resolved = true;
    });
    const rows = await page.evaluate(() => { let got = null; const s = window.LFH_BELL.sync; window.LFH_BELL.sync = (a) => { got = a; return s(a); }; syncGuestBell(); window.LFH_BELL.sync = s; return got && got.rows.filter((r) => r.kind === "call").map((r) => r.table + ":" + r.text); });
    await check(id(), F, "the guest bell lists live calls from the waiter's own tables only — not resolved ones, not another section's", H, () => ok(JSON.stringify(rows) === JSON.stringify(["5:Water"]), JSON.stringify(rows)));
    await ctx.close();
  }
  {
    // patchTabletTiles (L1710 `if (!grid)`, L1720 `if (!visible) continue`)
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); });
    await page.click('#floorNav [data-filter="free"]'); await settle(page, 200);
    seat(w, 9, { orders: [{}] });
    await page.evaluate(() => { window.__realLoad = load; window.load = () => Promise.resolve(); });
    await page.evaluate(() => loadTables(["9"])); await settle(page, 400);
    const r = await page.evaluate(() => ({ nine: !!document.querySelector('.tile[data-t="9"]'), five: !!document.querySelector('.tile[data-t="5"]'), free: document.querySelectorAll(".tile[data-t]").length }));
    await page.evaluate(() => { window.load = window.__realLoad; });
    await check(id(), F, "on the 'Free' filter, a table that just got an order LEAVES the floor (the patch notices it no longer belongs)", H, () => ok(!r.nine && !r.five && r.free === 28, JSON.stringify(r)));
    await ctx.close();
  }
  {
    // canTakeAParty (L1238): a merged table cannot take a moved party
    const { ctx, page } = await scene((w) => { w.summary.my_tables = ["1", "2", "3"]; seat(w, 1, { orders: [{}] }); seat(w, 2, { orders: [{}] }); seat(w, 3, {}); w.slices["3"].sessions = []; w.summary.merges = [{ parent_table: "2", child_table: "3" }]; delete w.summary.tiles["3"]; });
    await openTable(page, 1); await tap(page, "#kotMenuBtn"); await tap(page, '[data-kotop="shift"]'); await page.waitForSelector(".shiftgrid");
    const t = await page.evaluate(() => ({ free: [...document.querySelectorAll("[data-shiftto]")].map((b) => b.dataset.shiftto), txt: document.querySelector(".shiftgrid").textContent }));
    await check(id(), F, "a table joined to another is never offered as free to move a party onto (even with no tile of its own)", H, () => ok(t.free.length === 0 && /No free table to move this party to/.test(t.txt), JSON.stringify(t.free)));
    await ctx.close();
  }
  {
    // kotOpsOn (L2895) and tabletKhataOn (L1306): the admin always sees module buttons, tinted
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }), { table_ops_tablet_allowed: false, khata_allowed: false, tablet_khata: "off" }, {}, { higherView: true });
    await openTable(page, 5);
    const k = await page.evaluate(() => document.getElementById("kotMenuBtn")?.className || "none");
    // (Its TINT follows the waiters' switch, tablet_table_ops, which is on here — the module being off is
    // what the admin's always-visible rule is about, so the check is that the button is THERE.)
    await check(id(), F, "the admin looking in still sees 🧾 KOT ▾ on a restaurant without table operations", H, () => ok(k !== "none", k));
    await tap(page, "#payBill"); await page.waitForSelector(".pay-method-btn");
    const pl = await page.evaluate(() => [...document.querySelectorAll(".pay-method-btn")].some((b) => /Pay Later/.test(b.textContent)));
    await check(id(), F, "…and Pay Later on the pay sheet, though khata is off for this restaurant's waiters", H, () => ok(pl));
    await ctx.close();
  }
  {
    // The same restaurant for a real waiter: both are ABSENT
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }), { table_ops_tablet_allowed: false, khata_allowed: false, tablet_khata: "off" });
    await openTable(page, 5);
    const k = await page.evaluate(() => !!document.getElementById("kotMenuBtn"));
    await tap(page, "#payBill"); await page.waitForSelector(".pay-method-btn");
    const pl = await page.evaluate(() => [...document.querySelectorAll(".pay-method-btn")].some((b) => /Pay Later/.test(b.textContent)));
    await check(id(), F, "…while a real waiter there has neither 🧾 KOT ▾ nor Pay Later (absent, not greyed)", H, () => ok(!k && !pl, `kot ${k} · pay later ${pl}`));
    await ctx.close();
  }
  {
    // xray zones (L6147 banquet module, L6148 table ops module): a module the restaurant hasn't got isn't counted
    const { ctx, page } = await scene(null, { banquet_allowed: false, tablet_banquet: "off", table_ops_tablet_allowed: false, tablet_table_ops: "off", tablet_discount: "off" }, {}, { higherView: true });
    await page.waitForSelector("#xrayZonesBtn");
    const n = await page.evaluate(() => document.getElementById("xrayZonesBtn").textContent);
    await check(id(), F, "the admin ribbon never counts a switch for a module the restaurant does not have (banquet, table ops)", H, () => ok(/^1 control off for waiters/.test(n), n));
    await ctx.close();
  }
  {
    // recordTip (L4374): no tip → nothing is written
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }));
    await openTable(page, 5); await tap(page, "#payBill"); await page.waitForSelector(".pay-method-btn");
    await page.click(".pay-method-btn[data-method='UPI']"); await settle(page, 800);
    await check(id(), F, "a bill paid with NO tip writes no tip at all (never a ₹0 tip on every bill)", H, () => ok(posts(w, /\/pay$/).length === 1 && posts(w, /\/tip$/).length === 0, `${posts(w, /\/tip$/).length} tip write(s)`));
    await ctx.close();
  }
  {
    // removeOneDish (L5059): − on the tile takes from the PLAIN line, never the customised one
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    const id0 = await page.evaluate(() => document.querySelector("#omScroll .dish:not(.out)").dataset.dish);
    await page.evaluate((d) => { const dish = state.data.dishes.find((x) => x.id === d); state.cart.push({ id: d, title: dish.title, price: 100, qty: 1, avoid: ["nuts"] }); state.cart.push({ id: d, title: dish.title, price: 100, qty: 2 }); updateDishBadges(); }, id0);
    await page.click(`#omScroll .dish[data-dish="${id0}"] [data-dishminus]`);
    const c = await page.evaluate(() => state.cart.map((l) => (l.avoid ? "no-nuts×" : "plain×") + l.qty).join(","));
    await check(id(), F, "the tile's − takes a plate off the PLAIN line and leaves 'no nuts' alone", H, () => ok(c === "no-nuts×1,plain×1", c));
    await ctx.close();
  }
  {
    // order-wide ＋ Other (L5318): cancelling adds nothing
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    await page.click("#omScroll .dish:not(.out) .dname"); await page.click("#omViewBtn"); await page.waitForSelector("#orderAlg");
    await page.click("#orderAlg [data-alg-other]"); await page.waitForSelector(".alg-cancel"); await page.click(".alg-cancel");
    await check(id(), F, "cancelling '＋ Other' on the whole-order allergy row adds nothing (no blank allergy)", H, async () => ok(await page.evaluate(() => state.allergies === "")));
    await ctx.close();
  }
  {
    // L5839 + L6381: a background repaint never lands on top of an open picker or an order in progress
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); seat(w, 7, { orders: [{}] }); });
    await openTable(page, 5); await tap(page, "#kotMenuBtn"); await page.waitForSelector("[data-kotop]");
    await page.evaluate(() => window.dispatchEvent(new Event("lfh:outbox-changed")));
    seat(w, 5, { orders: [{}, {}] });
    await page.evaluate(() => loadTables(["5"])); await settle(page, 500);
    await check(id(), F, "a queue change or a table refresh while 🧾 KOT ▾ is open leaves the picker where it is", H, async () => ok(await page.evaluate(() => !!document.querySelector("[data-kotop]") && state.pickerOpen)));
    await page.click(".picker-back"); await settle(page, 200);
    await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    await page.click("#omScroll .dish:not(.out) .dname");
    seat(w, 5, { orders: [{}, {}, {}] });
    await page.evaluate(() => { window.dispatchEvent(new Event("lfh:outbox-changed")); return loadTables(["5"]); }); await settle(page, 500);
    await check(id(), F, "…and leaves an order being built on screen, its cart intact", H, async () => ok(await page.evaluate(() => state.ordering && state.cart.length === 1 && !!document.getElementById("omScroll"))));
    await ctx.close();
  }
}

// ── MUTATION PASS 2 (seed 2: 120 fresh mutants, 84 killed) and the pass-1 survivors re-run ───────────
async function blockFK2(R, id) {
  const { check } = R;
  {
    // L1724 + L1714: a VISIBLE tile is patched in place when its table changes (no full redraw)
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); });
    seat(w, 5, { orders: [{}, { status: "received" }] });
    await page.evaluate(() => { window.__realLoad = load; window.load = () => Promise.resolve(); window.__p0 = { ...window.__lfhPerf }; });
    await page.evaluate(() => loadTables(["5"])); await settle(page, 400);
    const r = await page.evaluate(() => ({ acc: !!document.querySelector('.tile[data-t="5"] .tacc'), txt: document.querySelector('.tile[data-t="5"]').innerText.replace(/\s+/g, " "), full: window.__lfhPerf.fullRenders - window.__p0.fullRenders, patched: window.__lfhPerf.tilesPatched - window.__p0.tilesPatched }));
    await page.evaluate(() => { window.load = window.__realLoad; });
    await check(id(), F, "a new order on a table that is ON screen shows on its tile at once (its ✓ accept appears)", H, () => ok(r.acc, r.txt));
    await check(id(), F, "…by patching that one tile, not redrawing the whole floor", H, () => ok(r.patched >= 1 && r.full === 0, JSON.stringify(r)));
    await ctx.close();
  }
  {
    // L5843 / L5942 / L5649: a live change on the OPEN table reaches its detail; an open picker survives a full refresh
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ status: "preparing", items: [{ title: "Test Lassi", price: 120, status: "preparing" }] }] }); });
    await openTable(page, 5);
    w.slices["5"].items[0].note = "less sugar"; w.slices["5"].orders[0].items[0].note = "less sugar";
    await page.evaluate(() => load()); await settle(page, 500);
    const t1 = await page.evaluate(() => document.querySelector("#panel .detail-pop").innerText);
    await check(id(), F, "a change made elsewhere to the open table (a kitchen note) appears in its detail on the next refresh", H, () => ok(/less sugar/.test(t1), t1.slice(0, 160)));
    seat(w, 5, { orders: [{ status: "preparing" }, { status: "received", kot_no: 555 }] });
    await page.evaluate(() => { window.__realLoad = load; window.load = () => Promise.resolve(); });
    await page.evaluate(() => loadTables(["5"])); await settle(page, 400);
    await page.evaluate(() => { window.load = window.__realLoad; });
    const t2 = await page.evaluate(() => document.querySelector("#panel .detail-pop").innerText);
    await check(id(), F, "…and a new ticket on it arrives through the one-table refresh too", H, () => ok(/#555/.test(t2), t2.slice(0, 200)));
    await tap(page, "#kotMenuBtn"); await page.waitForSelector("[data-kotop]");
    w.slices["5"].orders[0].allergies = ["nuts"];
    await page.evaluate(() => load()); await settle(page, 500);
    await check(id(), F, "…while 🧾 KOT ▾ is open, even a full refresh with real changes leaves the picker on screen", H, async () => ok(await page.evaluate(() => !!document.querySelector("[data-kotop]") && state.pickerOpen)));
    await ctx.close();
  }
  {
    // L5033: a dish that sells out while the waiter is building an order
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    const d = await page.evaluate(() => document.querySelector("#omScroll .dish:not(.out)").dataset.dish);
    await page.evaluate((x) => { state.data.dishes.find((y) => y.id === x).tags.push("sold-out"); updateDishAvailability(); }, d);
    const t = await page.evaluate((x) => { const b = document.querySelector(`#omScroll .dish[data-dish="${x}"]`); return { dis: b.disabled, price: b.querySelector(".dprice").textContent }; }, d);
    await check(id(), F, "a dish that sells out mid-order turns SOLD OUT and untappable on the open grid, without a rebuild", H, () => ok(t.dis && t.price === "SOLD OUT", JSON.stringify(t)));
    await ctx.close();
  }
  {
    // L2084: the invoice chip and the Generate button follow the invoice
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }], session: { invoice_no: 12 } }), { tablet_invoice: "on" });
    await openTable(page, 5);
    const a = await page.evaluate(() => ({ chip: document.querySelector("#panel .billbox .inv")?.textContent || "", gen: !!document.getElementById("genInvoiceBtn") }));
    await check(id(), F, "an invoiced bill shows its number ('🧾 #12') and no Generate invoice", H, () => ok(a.chip === "🧾 #12" && !a.gen, JSON.stringify(a)));
    await page.evaluate(() => { state.data.sessions[0].invoice_voided = true; renderPanel(); });
    const b = await page.evaluate(() => ({ chip: !!document.querySelector("#panel .billbox .inv"), gen: !!document.getElementById("genInvoiceBtn") }));
    await check(id(), F, "…and a voided one drops the chip and offers Generate invoice again", H, () => ok(!b.chip && b.gen, JSON.stringify(b)));
    await ctx.close();
  }
  {
    // L1296 + L1314: table types — the admin always sees them, a real waiter only when the module is on
    const off = { table_tags_allowed: false, tablet_table_tags: "on" };
    const a = await scene((w) => seat(w, 5, { orders: [{}], tile: { tag: "vip" } }), off, {}, { higherView: true });
    await openTable(a.page, 5);
    const ad = await a.page.evaluate(() => ({ btn: !!document.getElementById("tagTable"), rib: document.querySelector('.tile[data-t="5"] .t-ribbon')?.textContent || "" }));
    await check(id(), F, "the admin looking in sees a table's type (ribbon + 🏷 button) even where the module is off", H, () => ok(ad.btn && ad.rib === "👑 VIP", JSON.stringify(ad)));
    await a.ctx.close();
    const b = await scene((w) => seat(w, 5, { orders: [{}], tile: { tag: "vip" } }), off);
    await openTable(b.page, 5);
    const wt = await b.page.evaluate(() => ({ btn: !!document.getElementById("tagTable"), rib: !!document.querySelector('.tile[data-t="5"] .t-ribbon') }));
    await check(id(), F, "…a real waiter there sees neither", H, () => ok(!wt.btn && !wt.rib, JSON.stringify(wt)));
    await b.ctx.close();
  }
  {
    // L1628: the bell lists NEW ORDERS as well as calls
    const { ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ status: "received" }] }); });
    const rows = await page.evaluate(() => { let got = null; const s = window.LFH_BELL.sync; window.LFH_BELL.sync = (a) => { got = a; return s(a); }; syncGuestBell(); window.LFH_BELL.sync = s; return got && got.rows.map((r) => r.kind + ":" + r.table); });
    await check(id(), F, "the guest bell lists a table with a NEW order, not only waiter calls", H, () => ok(rows && rows.some((r) => /:5$/.test(r) && !/^call/.test(r)), JSON.stringify(rows)));
    await ctx.close();
  }
  {
    // L1653: a device that has never opened this restaurant shows a loading block, never an invented floor
    const w = freshWorld({ sessions_enabled: true });
    let release; w.hold = new Promise((r) => { release = r; });
    const { ctx, page } = await openWorld(w, {}, { wait: false });
    await page.waitForSelector("#tiles", { timeout: 15000 });
    await settle(page, 600);
    const boot = await page.evaluate(() => ({ msg: document.querySelector("#tiles .floor-booting")?.innerText || "", tiles: document.querySelectorAll(".tile[data-t]").length }));
    w.hold = null; release();
    await page.waitForFunction(() => document.querySelectorAll(".tile[data-t]").length > 0, null, { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => document.querySelectorAll(".tile[data-t]").length);
    await check(id(), F, "a tablet that has never seen this restaurant says 'Loading your tables…' instead of guessing a floor", H, () => ok(/Loading your tables/.test(boot.msg) && boot.tiles === 0, JSON.stringify(boot)));
    await check(id(), F, "…and draws the real floor the moment it lands", H, () => ok(after === 30, String(after)));
    await ctx.close();
  }
  {
    // L1691: a waiter with an EMPTY section
    const { ctx, page } = await scene((w) => { w.summary.my_tables = []; });
    const t = await page.evaluate(() => document.getElementById("tiles").innerText.replace(/\s+/g, " "));
    await check(id(), F, "a waiter with a section of NO tables is told so, kindly, instead of an empty grid", H, () => ok(/No tables assigned to you yet/.test(t) && /Ask your manager to give you a section/.test(t), t));
    await ctx.close();
  }
  {
    // L5955 + the clock: the drawer's time is the RESTAURANT's, and it ticks while the drawer is open
    const { ctx, page } = await scene(null, {}, { width: 390, height: 844, touch: true, mobile: true, dpr: 2, tz: "America/New_York" });
    await page.click("#hamburger"); await page.waitForSelector(".tbl-drawer.open"); await settle(page, 1300);
    const shown = await page.evaluate(() => document.getElementById("dwClock")?.textContent || "");
    const ist = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const ist2 = new Date(Date.now() - 60000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    await check(id(), F, "the drawer's clock shows the RESTAURANT's time even on a tablet set to another time zone", H, () => ok(shown === ist || shown === ist2, `shown ${shown} · restaurant ${ist}`));
    await ctx.close();
  }
  {
    // L5322: ＋ Other on the whole-order allergy row really adds the word
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .dish");
    await page.click("#omScroll .dish:not(.out) .dname"); await page.click("#omViewBtn"); await page.waitForSelector("#orderAlg");
    await page.click("#orderAlg [data-alg-other]"); await page.waitForSelector(".alg-in"); await page.fill(".alg-in", "Coriander"); await page.click(".alg-ok"); await settle(page, 200);
    await check(id(), F, "'＋ Other' on the whole-order row adds the typed allergy, lit, to every dish's avoid list", H, async () => ok(await page.evaluate(() => state.allergies === "coriander" && [...document.querySelectorAll("#orderAlg .optchoice.on")].some((b) => /coriander/i.test(b.textContent)))));
    await ctx.close();
  }
  {
    // L6385: the "waiting to send" box appears BY ITSELF when the queue changes (no manual repaint)
    const { w, ctx, page } = await scene((w) => seat(w, 3, { orders: [{}] }));
    await openTable(page, 3);
    w.answer("POST", /^\/order$/, { abort: true });
    await page.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/tablet", method: "POST", path: "/order", body: { table: "3", items: [{ id: "mint-melon-juice", qty: 1 }] }, panel: "tablet", table: "3" }));
    await settle(page, 1200);
    const box = await page.evaluate(() => /Waiting to send/i.test(document.getElementById("panel").textContent));
    await check(id(), F, "an order saved on the device shows in the open table's 'Waiting to send' box by itself, at once", H, () => ok(box));
    await ctx.close();
  }
  {
    // L6252: an Access change repaints the OPEN table's buttons on an admin tab, not just the ribbon
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }), { tablet_discount: "on" }, {}, { higherView: true });
    await openTable(page, 5);
    const before = await page.evaluate(() => document.getElementById("billDiscountBtn")?.className || "");
    w.summary.settings.tablet_discount = "off"; w.whoami = { ...w.whoami, nonce: 3 };
    await page.evaluate(async () => { await load(); refreshWhoami(true); }); await settle(page, 900);
    const after = await page.evaluate(() => document.getElementById("billDiscountBtn")?.className || "");
    await check(id(), F, "an Access change reaches the admin's OPEN table: the discount button turns tinted without a reload", H, () => ok(!/xray-off/.test(before) && /xray-off/.test(after), `${before} → ${after}`));
    await ctx.close();
  }
}

// ── MUTATION PASS 3 (seed 3: 100 fresh mutants, 88 killed) ────────────────────────────────────────────
async function blockFK3(R, id) {
  const { check } = R;
  {
    // ordersOf (L660): whose orders are on this party's bill
    const { ctx, page } = await scene((w) => {
      const a = seat(w, 5, { orders: [{ kot_no: 501 }] });
      const now = Date.now();
      const extra = (k, sess, ageMin) => ({ id: `0rdx${k}-0000-4000-8000-000000000000`, created_at: new Date(now - ageMin * 60e3).toISOString(), session_id: sess, table_number: "5", status: "preparing", payment_status: "pending", total: 105, discount: 0, kot_no: 600 + k, items: [{ id: "x", qty: 1, title: "Ghost dish " + k, price: "100", status: "preparing" }], archived: false });
      w.slices["5"].orders.push(extra(1, "5e55ffff-0000-4000-8000-000000000000", 5));   // ANOTHER party's ticket, newer
      w.slices["5"].orders.push(extra(2, null, 60 * 24 * 9));                          // party-less, 9 days old
      w.slices["5"].orders.push(extra(3, null, 2));                                    // party-less, rung during this sitting
      return a;
    });
    await openTable(page, 5);
    const kots = await page.evaluate(() => ordersOf("5").map((o) => o.kot_no).sort().join(","));
    await check(id(), F, "a table's bill holds THIS party's tickets — never another party's, never a party-less one from before it sat down", H, () => ok(kots === "501,603", kots));
    await ctx.close();
  }
  {
    // canTakeAParty (L1241): a table a guest has asked to be seated at is not free to move a party onto
    const { ctx, page } = await scene((w) => { w.summary.my_tables = ["1", "2"]; seat(w, 1, { orders: [{}] }); w.summary.tiles["2"] = { state: "free", label: "Free", hasReq: true, counts: {} }; });
    await openTable(page, 1); await tap(page, "#kotMenuBtn"); await tap(page, '[data-kotop="shift"]'); await page.waitForSelector(".shiftgrid");
    const t = await page.evaluate(() => ({ free: [...document.querySelectorAll("[data-shiftto]")].length, txt: document.querySelector(".shiftgrid").textContent }));
    await check(id(), F, "a table a guest has asked for is never offered as free to move a party onto", H, () => ok(t.free === 0 && /No free table to move this party to/.test(t.txt), JSON.stringify(t.free)));
    await ctx.close();
  }
  {
    // L1274: an admin hovering a tinted control is told what it means
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }), { tablet_discount: "off" }, {}, { higherView: true });
    await openTable(page, 5);
    await page.hover("#billDiscountBtn"); await settle(page, 150);
    const t = await page.evaluate(() => document.getElementById("billDiscountBtn").title);
    await check(id(), F, "the admin hovering a tinted control is told it is off for this restaurant's waiters", H, () => ok(/^Not available — this isn't enabled for this restaurant's waiters\./.test(t), t));
    await ctx.close();
  }
  {
    // L4448: cancelling the pay-later person sheet ANSWERS (nobody) — no flow is left waiting forever
    const { ctx, page } = await scene();
    const r = await page.evaluate(async () => { const p = openKhataPersonSheet(100, "5"); await new Promise((x) => setTimeout(x, 200)); document.querySelector(".kp-cancel").click(); return await Promise.race([p.then((v) => ({ answered: true, v })), new Promise((x) => setTimeout(() => x({ answered: false }), 2000))]); });
    await check(id(), F, "cancelling the pay-later person sheet answers 'nobody' at once (the split screen and the pay flow never wait forever)", H, () => ok(r.answered && r.v === null, JSON.stringify(r)));
    const r2 = await page.evaluate(async () => { const p = openKhataPersonSheet(100, "5"); await new Promise((x) => setTimeout(x, 200)); document.querySelector(".kp-close").click(); return await Promise.race([p.then((v) => ({ answered: true, v })), new Promise((x) => setTimeout(() => x({ answered: false }), 2000))]); });
    await check(id(), F, "…and so does its ✕", H, () => ok(r2.answered && r2.v === null, JSON.stringify(r2)));
    await ctx.close();
  }
}
