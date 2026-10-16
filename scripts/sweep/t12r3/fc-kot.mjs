// scripts/sweep/t12r3/fc-kot.mjs — band F, group 3: 🧾 KOT ▾ and every picker it opens (change table,
// merge, move a KOT, move a dish, reprint). Fixture world: nothing is written anywhere.
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, answerConfirm, toastsNow, clearToastsNow, undoBar, tapUndo, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = build(w) || {};
  const { ctx, page } = await openWorld(w, device);
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-kotop]")].map((b) => ({ op: b.dataset.kotop, label: b.querySelector("b").textContent, on: !b.disabled })));
const kotMenu = async (page, n) => { await openTable(page, n); await tap(page, "#kotMenuBtn"); await page.waitForSelector("[data-kotop]"); };

export async function blockFC(R, id) {
  const { check } = R;

  // ── the menu itself ────────────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ kot_no: 301 }] }); seat(w, 7, { orders: [{}] }); });
    await kotMenu(page, 5);
    const r = await rows(page);
    await check(id(), F, "🧾 KOT ▾ lists the six operations in the manager's order", H, () => ok(r.map((x) => x.op).join(",") === "shift,merge,movekot,moveitem,split,reprint", r.map((x) => x.op).join(",")));
    await check(id(), F, "…every one enabled on a table with a cooking order and another open table", H, () => ok(r.every((x) => x.on), JSON.stringify(r.filter((x) => !x.on))));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ status: "received" }] }); seat(w, 12, { orders: [{}] }); w.summary.my_tables = ["1", "2", "3", "4", "5", "6"]; });
    await kotMenu(page, 5);
    const r = Object.fromEntries((await rows(page)).map((x) => [x.op, x.on]));
    await check(id(), F, "Merge is greyed when the only other open table is outside the waiter's section", H, () => ok(r.merge === false, JSON.stringify(r)));
    await check(id(), F, "Split the bill is greyed while the only order is not yet accepted", H, () => ok(r.split === false, JSON.stringify(r)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { seat(w, 5, {}); }, { split_bill_enabled: false });
    await kotMenu(page, 5);
    const r = Object.fromEntries((await rows(page)).map((x) => [x.op, x.on]));
    await check(id(), F, "Split the bill is ABSENT (not greyed) when the restaurant has splitting off", H, () => ok(!("split" in r), Object.keys(r).join(",")));
    await check(id(), F, "on a table with no ticket, move-a-KOT, move-a-dish and reprint are greyed", H, () => ok(r.movekot === false && r.moveitem === false && r.reprint === false, JSON.stringify(r)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); }, { tablet_mark_paid: "off" });
    await kotMenu(page, 5);
    const r = (await rows(page)).map((x) => x.op);
    await check(id(), F, "a waiter who may not take payment gets no Split row at all (R67)", H, () => ok(!r.includes("split"), r.join(",")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { const a = seat(w, 5, { orders: [{}] }); seat(w, 6, {}); w.slices["6"].sessions = []; w.summary.merges = [{ parent_table: "5", child_table: "6" }]; });
    await kotMenu(page, 5);
    const r = (await rows(page)).find((x) => x.op === "shift");
    await check(id(), F, "a merged party's Change table row says 'unmerge first' and is greyed", H, () => ok(r.label === "Change table — unmerge first" && !r.on, JSON.stringify(r)));
    await ctx.close();
  }

  // ── change table (shift) ───────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, s } = await scene((w) => {
      const a = seat(w, 5, { orders: [{}] });
      seat(w, 6, { orders: [{}] });                                         // taken
      seat(w, 8, {}); seat(w, 9, {}); w.slices["9"].sessions = []; w.summary.merges = [{ parent_table: "8", child_table: "9" }]; // joined
      w.summary.tiles["10"] = { state: "req", label: "Wants in", meta: "asked for access", hasReq: true, counts: {} };          // wants in
      w.summary.my_tables = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];                                                 // 11+ not yours
      return a;
    });
    await kotMenu(page, 5); await tap(page, '[data-kotop="shift"]'); await page.waitForSelector(".shiftgrid");
    const cells = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".shiftgrid .shiftpick")].map((b) => [b.textContent.replace(/(free|this one|taken|joined|wants in|not yours)$/, "").trim(), b.querySelector("small").textContent])));
    await check(id(), F, "Change table draws the WHOLE floor, each table labelled", H, () => ok(Object.keys(cells).length === 30, Object.keys(cells).length + " tiles"));
    await check(id(), F, "…its own table says 'this one', a seated one 'taken', a merged one 'joined', a requested one 'wants in', another section's 'not yours', the rest 'free'", H, () =>
      ok(cells.T5 === "this one" && cells.T6 === "taken" && cells.T8 === "joined" && cells.T9 === "joined" && cells.T10 === "wants in" && cells.T12 === "not yours" && cells.T7 === "free", JSON.stringify(cells)));
    const says = {};
    for (const [t, word] of [["6", "taken"], ["8", "joined"], ["10", "wants in"], ["12", "not yours"], ["5", "this one"]]) {
      await clearToastsNow(page);
      await page.click(`.shiftgrid .shiftpick-off[data-shiftlabel="T${t}"]`);
      says[word] = (await toastsNow(page))[0] || "";
    }
    await check(id(), F, "…a dimmed table still answers a tap, with the reason as a sentence", H, () => ok(
      says.taken === "T6: There's already a party on that table. Move them off it first, or pick another."
      && says.joined === "T8: That table is joined with another and shares its bill — unmerge it first."
      && says["wants in"] === "T10: A guest has asked to be seated there — answer their request first."
      && says["not yours"] === "T12: That table isn't in your section — ask your manager to add it."
      && says["this one"] === "T5: That's the table this party is already on.", JSON.stringify(says)));
    await page.click('.shiftgrid [data-shiftto="7"]'); await settle(page, 200);
    await check(id(), F, "…a free table moves the party at once — the open table is now T7", H, async () => ok(await page.evaluate(() => state.table) === "7"));
    await check(id(), F, "…and the server is asked to shift the session to 7", H, () => { const p = posts(w, new RegExp(`^/sessions/${s.id}/shift`)); return ok(p.length === 1 && p[0].body.to === "7"); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); });
    w.answer("POST", /\/shift/, { status: 409, body: { error: "That table is already taken — pick a free one." } });
    await kotMenu(page, 5); await tap(page, '[data-kotop="shift"]'); await page.waitForSelector(".shiftgrid");
    await page.click('.shiftgrid [data-shiftto="7"]');
    await check(id(), F, "a shift the server refuses says why and snaps back to the table it came from", H, async () => ok(await waitToast(page, /Failed: That table is already taken/) && (await settle(page, 500), await page.evaluate(() => state.table)) === "5", (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { seat(w, 1, { orders: [{}] }); seat(w, 2, { orders: [{}] }); w.summary.my_tables = ["1", "2"]; });
    await kotMenu(page, 1); await tap(page, '[data-kotop="shift"]'); await page.waitForSelector(".shiftgrid");
    const t = await page.evaluate(() => document.querySelector(".shiftgrid").textContent);
    await check(id(), F, "with no table able to take the party, the picker says so in one sentence", H, () => ok(/No free table to move this party to — every other table is taken, joined, waiting on a guest, or outside your section\./.test(t), t.slice(-160)));
    await ctx.close();
  }

  // ── merge ──────────────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, s } = await scene((w) => { seat(w, 5, { orders: [{ total: 399 }] }); const b = seat(w, 7, { orders: [{ total: 210 }] }); return { s: b.s }; });
    w.answer("POST", /\/merge/, { body: { ok: true, parent_table: "5", child_table: "7" } });
    w.answer("POST", /\/tables\/7\/unmerge/, { body: { ok: true, moved: 1 } });
    await kotMenu(page, 7); await tap(page, '[data-kotop="merge"]'); await page.waitForSelector("[data-mergeto]");
    const list = await page.evaluate(() => [...document.querySelectorAll("[data-mergeto]")].map((b) => b.dataset.mergeto));
    await check(id(), F, "Merge offers only the other OPEN tables", H, () => ok(list.join(",") === "5", list.join(",")));
    await tap(page, '[data-mergeto="5"]');
    const q = await answerConfirm(page, false);
    await check(id(), F, "…and the question names the table that will HOLD the bill (the lowest number) and the money", H, () => ok(/^Merge .*7.* into .*5.*\? They become ONE party on ONE bill, held by .*5.* \(the lowest table number\)\. ₹210 \+ ₹399 → ₹609 on one bill\.$/.test(q), q));
    await check(id(), F, "…No merges nothing", H, () => ok(posts(w, /\/merge$/).length === 0));
    await tap(page, '[data-mergeto="5"]'); await answerConfirm(page, true); await settle(page, 500);
    await check(id(), F, "…Merge asks the server to join T7's session to 5", H, () => { const p = posts(w, new RegExp(`^/sessions/${s.id}/merge`)); return ok(p.length === 1 && p[0].body.to === "5"); });
    await check(id(), F, "…the screen follows the table the SERVER kept (T5)", H, async () => ok(await page.evaluate(() => state.table) === "5"));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    const ub = await undoBar(page);
    await check(id(), F, "…and offers a takeback: 'T7 joined T5 — one bill'", H, () => ok(ub && /7 joined .*5 — one bill/.test(ub) && /tap undo to separate them again/.test(ub), ub));
    await page.evaluate(() => { state.summary.merges = [{ parent_table: "5", child_table: "7" }]; });
    await tapUndo(page); await settle(page, 600);
    await check(id(), F, "…undo unmerges the joined table straight away (no second question)", H, async () => ok(posts(w, /\/tables\/7\/unmerge/).length === 1 && !(await page.evaluate(() => !document.getElementById("confirmOverlay").hidden))));
    await ctx.close();
  }
  {
    const { ctx, page, s } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5);
    await page.evaluate(() => renderMergePicker("5", sessionOf("5")));
    const t = await page.evaluate(() => document.querySelector(".shiftgrid").textContent.trim());
    await check(id(), F, "with no other open table the merge picker says 'No other open tables to merge with.'", H, () => ok(t === "No other open tables to merge with.", t));
    await ctx.close();
  }

  // ── move a KOT ─────────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, orders } = await scene((w) => {
      const a = seat(w, 5, { orders: [{ kot_no: 301, total: 420, discount: 20 }, { kot_no: 302, total: 105, payment_status: "paid" }] });
      seat(w, 6, {}); w.slices["6"].sessions = []; w.summary.merges = [{ parent_table: "5", child_table: "6" }];   // a party mate
      seat(w, 8, { orders: [{}] }); seat(w, 9, {}); w.slices["9"].sessions = []; w.summary.merges.push({ parent_table: "8", child_table: "9" }); // another party's child
      w.summary.my_tables = Array.from({ length: 12 }, (_, i) => String(i + 1));
      return a;
    });
    await kotMenu(page, 5); await tap(page, '[data-kotop="movekot"]'); await page.waitForSelector("[data-pickorder]");
    const list = await page.evaluate(() => [...document.querySelectorAll("[data-pickorder]")].map((b) => b.textContent));
    await check(id(), F, "Move a KOT lists only the unpaid tickets, each at its NET due (discount before tax)", H, () => ok(list.length === 1 && list[0] === "#301 · Order 1 · ₹399", list.join(" | ")));
    await tap(page, "[data-pickorder]"); await page.waitForSelector("[data-moveto]");
    const to = await page.evaluate(() => [...document.querySelectorAll("[data-moveto]")].map((b) => b.dataset.moveto));
    await check(id(), F, "…the target list leaves out its own party, another party's merged child, and tables outside the section", H, () => ok(!to.includes("5") && !to.includes("6") && !to.includes("9") && !to.includes("13") && to.includes("8") && to.includes("7"), to.join(",")));
    await tap(page, '[data-moveto="7"]');
    await check(id(), F, "…moving it says 'KOT moved to T7' and asks the server to move that order", H, async () => ok(await waitToast(page, /KOT moved to .*7/) && posts(w, new RegExp(`^/orders/${orders[0].id}/move`)).some((p) => p.body.to === "7"), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ kot_no: 301 }] }); w.summary.my_tables = ["5"]; });
    await kotMenu(page, 5); await tap(page, '[data-kotop="movekot"]'); await tap(page, "[data-pickorder]");
    const t = await page.evaluate(() => document.querySelector(".shiftgrid").textContent.trim());
    await check(id(), F, "with no other table in the section, Move a KOT says 'No other table in your section to move this to.'", H, () => ok(t === "No other table in your section to move this to.", t));
    await page.evaluate(() => renderMoveOrderPicker("5"));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ payment_status: "paid" }] }); });
    await openTable(page, 5);
    await page.evaluate(() => renderMoveOrderPicker("5"));
    const t = await page.evaluate(() => document.querySelector(".pactions").textContent.trim());
    await check(id(), F, "a table whose tickets are all paid has nothing to move, and says why", H, () => ok(t === "No movable orders (paid bills can't be moved).", t));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ kot_no: 301 }] }); });
    w.answer("POST", /\/orders\/[^/]+\/move/, { status: 409, body: { error: "That table's bill is already invoiced." } });
    await kotMenu(page, 5); await tap(page, '[data-kotop="movekot"]'); await tap(page, "[data-pickorder]"); await tap(page, '[data-moveto="7"]');
    await check(id(), F, "a refused KOT move says why (and the ticket is shown back where it was)", H, async () => ok(await waitToast(page, /Failed: That table's bill is already invoiced\./) && (await settle(page, 500), await page.evaluate(() => state.data.orders.every((o) => o.table_number === "5"))), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── move one dish ──────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, items } = await scene((w) => { const a = seat(w, 5, { orders: [{ kot_no: 301, items: [{ title: "Espresso", price: 120, qty: 2 }, { title: "Mint Melon Juice", price: 380 }] }] }); w.summary.my_tables = ["4", "5", "7"]; return a; });
    await kotMenu(page, 5); await tap(page, '[data-kotop="moveitem"]'); await page.waitForSelector("[data-mvitem]");
    const list = await page.evaluate(() => document.querySelector(".pactions").innerText.replace(/\s+/g, " "));
    await check(id(), F, "Move a dish groups dishes under their KOT, a multi-plate line as one ('2× Espresso ₹240')", H, () => ok(/KOT #301/.test(list) && /2× Espresso ₹240/.test(list) && /Mint Melon Juice ₹380/.test(list), list));
    await tap(page, `[data-mvitem="${items[0].id}"]`); await page.waitForSelector(".kotm-grid");
    const to = await page.evaluate(() => [...document.querySelectorAll("[data-mvto]")].map((b) => b.dataset.mvto));
    await check(id(), F, "…the target grid offers only the other tables in the waiter's section", H, () => ok(to.join(",") === "4,7", to.join(",")));
    await tap(page, '[data-mvto="7"]');
    await check(id(), F, "…moving it says 'Dish moved to table 7 (new KOT)' and moves that dish line", H, async () => ok(await waitToast(page, /Dish moved to table 7 \(new KOT\)/) && posts(w, new RegExp(`^/order-items/${items[0].id}/move`)).some((p) => p.body.to === "7"), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { seat(w, 5, { orders: [{ db: false }] }); w.summary.my_tables = ["5"]; });
    await openTable(page, 5);
    await page.evaluate(() => renderMoveItemPicker("5"));
    const t = await page.evaluate(() => document.querySelector(".pactions").textContent.trim());
    await check(id(), F, "a ticket with no per-dish rows has no movable dish, and says so", H, () => ok(t === "No movable dishes.", t));
    await page.evaluate(() => renderMoveItemTarget("5", "x"));
    const t2 = await page.evaluate(() => document.querySelector(".kotm-grid").textContent.trim());
    await check(id(), F, "…and with no other table in the section the target says 'No other table you serve can take this dish right now.'", H, () => ok(t2 === "No other table you serve can take this dish right now.", t2));
    await ctx.close();
  }

  // ── reprint a KOT ──────────────────────────────────────────────────────────────────────────
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ kot_no: 301, items: [{ title: "Espresso", price: 120, qty: 2 }, { title: "Mint Melon Juice", price: 380 }] }] }));
    w.answer("POST", /^\/print\/send/, { body: { noRoute: true } });
    await kotMenu(page, 5); await tap(page, '[data-kotop="reprint"]'); await page.waitForSelector("[data-pickprint]");
    const list = await page.evaluate(() => [...document.querySelectorAll("[data-pickprint]")].map((b) => b.textContent));
    await check(id(), F, "Print a KOT lists each ticket with its dish count ('#301 · Order 1 · 3 dishes')", H, () => ok(list[0] === "#301 · Order 1 · 3 dishes", list.join(" | ")));
    await tap(page, "[data-pickprint]"); await page.waitForSelector("[data-printkitchen]");
    const sheet = await page.evaluate(() => document.querySelector(".pactions").innerText.replace(/\s+/g, " "));
    await check(id(), F, "…with no computer owning the slips, it offers 'Reprint in the kitchen' AND 'Print here'", H, () => ok(/Reprint in the kitchen/.test(sheet) && /Print here/.test(sheet) && !/instead/.test(sheet), sheet));
    await check(id(), F, "…the question it asked the server queued nothing (a probe: no order id)", H, () => { const p = posts(w, /^\/print\/send/); return ok(p.length === 1 && p[0].body.kind === "kot" && !p[0].body.orderId, JSON.stringify(p[0] && p[0].body)); });
    await tap(page, "[data-printkitchen]");
    await check(id(), F, "…in the kitchen: one print job for that order, and 'it comes out marked DUPLICATE'", H, async () => ok(await waitToast(page, /KOT #301 sent to the kitchen printer — it comes out marked DUPLICATE\./) && posts(w, /^\/print-jobs/).some((p) => p.body.order_id === orders[0].id), (await toastsNow(page)).join(" | ")));
    await tap(page, '#kotMenuBtn').catch(() => {});
    await page.evaluate((o) => renderReprintWhere("5", state.data.orders[0]), null);
    await page.waitForSelector("[data-printhere]");
    const doc = await page.evaluate(() => { let got = null; const orig = LFH_BILLDOC.kotDocHtml; LFH_BILLDOC.kotDocHtml = (a) => { got = a; return orig(a); }; document.querySelector("[data-printhere]").click(); LFH_BILLDOC.kotDocHtml = orig; return got && { reprint: got.reprint, kot: got.kot, lines: got.lines.length, frames: document.querySelectorAll("iframe").length }; });
    await check(id(), F, "…Print here builds the shared ticket with the DUPLICATE banner and prints it in a hidden frame", H, async () => ok(doc && doc.reprint === true && doc.kot === 301 && doc.lines === 2 && doc.frames >= 1 && await waitToast(page, /KOT #301 sent to print/), JSON.stringify(doc)));
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printhere]");
    await clearToastsNow(page);
    await page.evaluate(() => { const k = LFH_BILLDOC.kotDocHtml; LFH_BILLDOC.kotDocHtml = null; document.querySelector("[data-printhere]").click(); LFH_BILLDOC.kotDocHtml = k; });
    await check(id(), F, "…if the ticket maker failed to load, Print here says so and points to the kitchen", H, async () => ok(await waitToast(page, /Can't print just now — reload the panel, or send it to the kitchen instead\./), (await toastsNow(page)).join(" | ")));
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printhere]");
    await clearToastsNow(page);
    await page.evaluate(() => { const ce = document.createElement; document.createElement = function (t, ...r) { if (String(t).toLowerCase() === "iframe") throw new Error("blocked"); return ce.call(document, t, ...r); }; try { document.querySelector("[data-printhere]").click(); } finally { document.createElement = ce; } });
    await check(id(), F, "…and if this device can't start a print it says so (in red), never 'sent to print'", H, async () => ok(await waitToast(page, /This device couldn't start a print — send it to the kitchen instead\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ kot_no: 301 }] }));
    w.answer("POST", /^\/print\/send/, { body: { printer: "Counter", agent: "Front PC", connected: true } });
    await openTable(page, 5);
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printkitchen]");
    const sheet = await page.evaluate(() => document.querySelector(".pactions").innerText.replace(/\s+/g, " "));
    await check(id(), F, "when a computer owns the slips the sheet says 'Print on Counter' and hides Print here", H, () => ok(/Print on Counter/.test(sheet) && /Goes straight to Front PC/.test(sheet) && !/Print here/.test(sheet), sheet));
    await tap(page, "[data-printkitchen]");
    await check(id(), F, "…and the toast names that printer: 'KOT #301 sent to Counter — marked DUPLICATE.'", H, async () => ok(await waitToast(page, /KOT #301 sent to Counter — marked DUPLICATE\./), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /^\/print\/send/, { body: { printer: "Counter", agent: "Front PC", connected: false } });
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printhere]");
    const sheet2 = await page.evaluate(() => document.querySelector(".pactions").innerText.replace(/\s+/g, " "));
    await check(id(), F, "when that computer is not answering, 'Print here instead' comes back, saying why", H, () => ok(/Print here instead/.test(sheet2) && /only because Front PC is not answering/.test(sheet2), sheet2));
    await tap(page, "[data-printkitchen]");
    await check(id(), F, "…and the kitchen send says it is saved until Front PC is back", H, async () => ok(await waitToast(page, /KOT #301 saved — it prints at Counter as soon as Front PC is back — marked DUPLICATE\./), (await toastsNow(page)).join(" | ")));
    w.overrides.length = 0;
    w.answer("POST", /^\/print\/send/, { abort: true });
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printkitchen]"); await settle(page, 600);
    const left = await page.evaluate(() => (() => { const sn = window.LFH_OUTBOX.getSnapshot(); return [...sn.queued, ...sn.failed].filter((x) => /print\/send/.test(x.path)).length; })());
    const sheet3 = await page.evaluate(() => document.querySelector(".pactions").innerText.replace(/\s+/g, " "));
    await check(id(), F, "with no internet the 'who owns the slips?' question is taken back out of the queue (it is not a change)", H, () => ok(left === 0, `${left} left waiting`));
    await check(id(), F, "…and the sheet answers from what the server said last time (Counter, not answering)", H, () => ok(/Print on Counter/.test(sheet3) && /Print here instead/.test(sheet3), sheet3));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ kot_no: 301 }] }));
    w.answer("POST", /^\/print\/send/, { body: { noRoute: true } });
    w.answer("POST", /^\/print-jobs/, { status: 409, body: { error: "That ticket was cancelled." } });
    await openTable(page, 5);
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printkitchen]");
    await tap(page, "[data-printkitchen]");
    await check(id(), F, "a kitchen reprint the server refuses says 'Couldn't send it to the kitchen:' and why", H, async () => ok(await waitToast(page, /Couldn't send it to the kitchen: That ticket was cancelled\./), (await toastsNow(page)).join(" | ")));
    w.overrides.shift();
    w.answer("POST", /^\/print-jobs/, { abort: true });
    await page.evaluate(() => renderReprintWhere("5", state.data.orders[0])); await page.waitForSelector("[data-printkitchen]");
    await clearToastsNow(page); await tap(page, "[data-printkitchen]");
    await check(id(), F, "…with no internet it is saved to send, and says so", H, async () => ok(await waitToast(page, /[Ss]aved/, 8000), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, {}));
    await openTable(page, 5);
    await page.evaluate(() => renderReprintKotPicker("5"));
    const t = await page.evaluate(() => document.querySelector(".pactions").textContent.trim());
    await check(id(), F, "a table with no ticket yet: 'No kitchen tickets on this table yet.'", H, () => ok(t === "No kitchen tickets on this table yet.", t));
    await ctx.close();
  }

  // ── a write someone else changed first ─────────────────────────────────────────────────────
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing" }] }));
    w.answer("POST", /\/items\/[^/]+\/delete/, { status: 409, body: { error: "clash_changed_elsewhere", clash: { plain: "Someone else changed this order a moment ago.", todo: "Your change was NOT saved." } } });
    await openTable(page, 5);
    await tap(page, `[data-del-item="${items[0].id}"]`); await answerConfirm(page, true);
    await check(id(), F, "a change refused because another device changed it first says BOTH halves — what happened and that yours was not saved", H, async () => ok(await waitToast(page, /^Someone else changed this order a moment ago\. Your change was NOT saved\.$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
}
