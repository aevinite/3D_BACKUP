// scripts/sweep/t12r3/fa-floor.mjs — band F, group 1: the FLOOR — the quick buttons on a tile (✓ accept,
// ＋ take order, ⏻ close, 💳 pay), switching tables with an unsent order, the three ways the first load
// can fail, and the fallback poll a tablet runs when its realtime script never loaded.
// Fixture world: nothing is written anywhere; what the panel SENT is read back from the world's log.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, answerConfirm, toastsNow, clearToastsNow, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}, opts = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = build(w) || {};
  if (opts.beforeOpen) opts.beforeOpen(w);
  const { ctx, page } = await openWorld(w, device, { wait: opts.wait !== false });
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);
const quick = (page, cls, t) => page.click(`.tile[data-t="${t}"] .${cls}`);

export async function blockFA(R, id) {
  const { check } = R;
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "received" }, { status: "received" }] }));
    const has = await page.evaluate(() => !!document.querySelector('.tile[data-t="5"] .tacc'));
    await check(id(), F, "a tile with a new order carries its own ✓", H, () => ok(has));
    await quick(page, "tacc", 5); await settle(page, 600);
    await check(id(), F, "…✓ reads the table fresh, then accepts EVERY new order on it — without opening the table", H, () => ok(w.sent("GET", /^\/state$/).some((r) => r.query.get("table") === "5") && orders.every((o) => posts(w, new RegExp(`^/orders/${o.id}/accept`)).length === 1) && true, `${posts(w, /accept/).length} accept(s)`));
    await check(id(), F, "…and the tap never also opens the table behind it", H, async () => ok(await page.evaluate(() => state.table === null)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); seat(w, 6, { orders: [{}] }); });
    await quick(page, "t-take", 5); await page.waitForSelector("#omScroll .dish");
    await check(id(), F, "a tile's ＋ Take order opens straight into taking an order for THAT table", H, async () => ok(await page.evaluate(() => state.ordering && state.table === "5")));
    await page.click("#omScroll .dish:not(.out) .dname");
    // At tablet sizes the order screen covers the floor; where the floor stays beside it (a wide
    // screen) a tile is still tappable — the same delegated handler, so the tap is delivered to it.
    await page.evaluate(() => document.querySelector('.tile[data-t="6"] .t-take').click());
    const q = await answerConfirm(page, false);
    await check(id(), F, "…with dishes in the cart, another table's ＋ asks before throwing them away", H, () => ok(q === "Discard this unsent order and switch table?", q));
    await check(id(), F, "…No keeps the order and the table", H, async () => ok(await page.evaluate(() => state.table === "5" && state.cart.length === 1)));
    await page.evaluate(() => document.querySelector('.tile[data-t="6"] .tnum, .tile[data-t="6"]').click());
    await answerConfirm(page, true); await settle(page, 400);
    await check(id(), F, "…the same question guards a plain tile tap, and Yes moves to the other table with an empty cart", H, async () => ok(await page.evaluate(() => state.table === "6" && state.cart.length === 0)));
    await ctx.close();
  }
  {
    const { w, ctx, page, s } = await scene((w) => seat(w, 5, { orders: [{ status: "served", payment_status: "paid" }] }));
    const has = await page.evaluate(() => !!document.querySelector('.tile[data-t="5"] .tclose'));
    await check(id(), F, "a finished tile (all served, all paid) offers ⏻ to free it", H, () => ok(has));
    await quick(page, "tclose", 5);
    const q = await answerConfirm(page, true); await settle(page, 500);
    await check(id(), F, "…⏻ goes through the one close path: its question, then the close", H, () => ok(/^Close .*5.* and free it\?$/.test(q) && posts(w, new RegExp(`^/sessions/${s.id}/close`)).length === 1, q));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 399 }] }));
    const has = await page.evaluate(() => !!document.querySelector('.tile[data-t="5"] .tpay'));
    await check(id(), F, "a served-but-unpaid tile carries 💳", H, () => ok(has));
    await quick(page, "tpay", 5); await page.waitForSelector(".pay-overlay");
    const head = await page.evaluate(() => document.querySelector(".pay-overlay h3").textContent);
    // From the FLOOR the sheet names no bill number (the tile's summary carries none) — inside the table
    // it says "#41". Not wrong, only less; recorded in the report as an observation, not a fault.
    await check(id(), F, "…💳 opens the same pay sheet as the table, for that table's bill, without opening the table", H, async () => ok(/^Mark bill (#41 )?paid for table 5$/.test(head) && await page.evaluate(() => state.table === null), head));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(() => {});
    await page.click('.tile[data-t="9"]'); await page.waitForSelector("#omScroll .dish");
    await check(id(), F, "a FREE tile goes straight into taking an order (there is no 'open the table' step)", H, async () => ok(await page.evaluate(() => state.ordering && state.table === "9")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), { tablet_take_orders: "off" });
    await check(id(), F, "a waiter who may not take orders has no ＋ on any tile (absent, not greyed)", H, async () => ok(await page.evaluate(() => !document.querySelector(".t-take"))));
    await ctx.close();
  }

  // ── the first load fails ───────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await scene(() => {}, {}, {}, { wait: false, beforeOpen: (w) => w.answer("GET", /^\/summary/, { status: 503, body: { error: "TimeoutError: The operation was aborted due to timeout", busy: true }, headers: { "X-LFH-Busy": "1" } }) });
    await check(id(), F, "a BUSY server at first load says it will come back by itself — never 'database' or the raw timeout", H, async () => ok(await waitToast(page, /^The system is very busy right now — this will come back by itself in a moment\.$/, 15000) && !(await toastsNow(page)).some((t) => /database|TimeoutError/.test(t)), (await toastsNow(page)).join(" | ")));
    await check(id(), F, "…and the floor is still drawn (never a spinner that never resolves)", H, async () => ok(await page.evaluate(() => state.settingsSettled && document.querySelectorAll(".tile[data-t]").length > 0)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(() => {}, {}, {}, { wait: false, beforeOpen: (w) => w.answer("GET", /^\/summary/, { status: 400, body: { error: "This restaurant's tablet is switched off." } }) });
    await check(id(), F, "any other failure at first load says 'Couldn't load the floor — try again.' and why", H, async () => ok(await waitToast(page, /^Couldn't load the floor — try again\. This restaurant's tablet is switched off\.$/, 15000), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene(() => {}, {}, {}, { wait: false, beforeOpen: (w) => w.answer("GET", /^\/summary/, { abort: true }) });
    await settle(page, 4000);
    await check(id(), F, "no internet at first load: no alarming toast — the offline bar explains it", H, async () => ok(!(await toastsNow(page)).some((t) => /Couldn't load|busy/.test(t)), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── the fallback poll, when the realtime script never loaded ──────────────────────────────
  {
    const w = freshWorld({ sessions_enabled: true });
    // openWorld builds its own context, so the realtime block rides on that context (see below).
    const made = await openWorldNoRealtime(w);
    const p = made.page;
    const rt = await p.evaluate(() => typeof window.LFH_RT);
    await check(id(), F, "with the realtime script blocked the panel still opens (LFH_RT absent)", H, () => ok(rt === "undefined", rt));
    w.clear(); await settle(p, 7000);
    const n1 = w.sent("GET", /^\/summary/).length;
    await check(id(), F, "…and keeps the floor fresh with a gentle poll (about every 2 s while reads succeed)", H, () => ok(n1 >= 2 && n1 <= 5, `${n1} reads in 7s`));
    w.answer("GET", /^\/summary/, { status: 503, body: { error: "busy", busy: true } });
    w.clear(); await settle(p, 14000);
    // netretry.js retries a failed read twice within a second before giving up, so one poll TICK is a
    // burst of up to three requests. Count the bursts, and their spacing.
    const at = w.sent("GET", /^\/summary/).map((r) => r.at);
    const ticks = at.filter((t, i) => i === 0 || t - at[i - 1] > 1500);
    const gaps = ticks.slice(1).map((t, i) => Math.round((t - ticks[i]) / 1000));
    await check(id(), F, "…while reads FAIL it backs off (2 → 4 → 8 s …), never hammering a struggling server", H, () => ok(ticks.length <= 4 && gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 1) && (gaps.length < 2 || gaps[gaps.length - 1] > gaps[0]), `${at.length} requests in ${ticks.length} ticks, gaps ${gaps.join("s, ")}s`));
    w.overrides.length = 0;
    await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await settle(p, 3000); w.clear(); await settle(p, 9000);
    const n3 = w.sent("GET", /^\/summary/).length;
    await check(id(), F, "…and a hidden screen reads nothing at all", H, () => ok(n3 === 0, `${n3} reads while hidden`));
    await made.ctx.close();
  }
}

// openWorld with /panels/realtime.js refused — the one case where the panel must poll by itself.
async function openWorldNoRealtime(w) {
  const { browser } = await import("../t12s10/lib.mjs");
  const { openWorld } = await import("./f-world.mjs");
  const b = await browser();
  const orig = b.newContext.bind(b);
  b.newContext = async (opts) => { const c = await orig(opts); await c.route(/\/panels\/realtime\.js/, (r) => r.abort("blockedbyclient")); b.newContext = orig; return c; };
  return openWorld(w);
}
