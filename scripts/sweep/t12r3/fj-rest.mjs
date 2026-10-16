// scripts/sweep/t12r3/fj-rest.mjs — band F, group FJ: the COVERAGE TOP-UP. Written after band F's first
// measurement (94.7%), one check per stretch cov.mjs still listed that the fixture world can reach.
// What it cannot reach is explained in the round-3 report instead (a navigation that unloads the page
// before its coverage record is written, a 10-minute timer, a defensive branch with no way in).
import { ok } from "../t12s10/lib.mjs";
import { freshWorld, openWorld, seat, openTable, tap, answerConfirm, typePin, toastsNow, clearToastsNow, undoBar, waitToast, settle } from "./f-world.mjs";

const F = "public/panels/tablet/app.js";
const H = "FIXTURE — the panel against the test's own server (nothing written)";
const scene = async (build, settings = {}, device = {}, opts = {}) => {
  const w = freshWorld({ sessions_enabled: true, ...settings });
  const made = (build && build(w)) || {};
  const { ctx, page } = await openWorld(w, device, { wait: opts.wait !== false });
  return { w, ctx, page, ...made };
};
const posts = (w, re) => w.sent("POST", re);

export async function blockFJ(R, id) {
  const { check } = R;

  // ── a breadcrumb names tables: only those are re-read ──────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); seat(w, 7, { orders: [{}] }); });
    seat(w, 9, { orders: [{ status: "received" }] });         // the server now has a new order on T9
    // Stand the whole-floor refresh down while measuring: with no realtime socket in this world the
    // panel's own catch-up poll would add full reads that have nothing to do with the targeted one.
    await page.evaluate(() => { window.__realLoad = load; window.load = () => Promise.resolve(); });
    w.clear();
    await page.evaluate(() => loadTables(["9"])); await settle(page, 500);
    await page.evaluate(() => { window.load = window.__realLoad; });
    const reads = w.sent("GET", /^\/(summary|state)/).map((r) => r.path + "?" + r.query.toString());
    await check(id(), F, "a change on ONE table re-reads that table's tile only — never the whole floor", H, () => ok(reads.length >= 1 && reads.every((u) => /table=9/.test(u)), reads.join(", ")));
    await check(id(), F, "…and the T9 tile turns 'new' on the floor while the others are untouched", H, async () => ok(await page.evaluate(() => state.summary.tiles["9"].state === "new" && state.summary.tiles["5"].state === "prep" && !!document.querySelector('.tile[data-t="9"].t-new, .tile[data-t="9"]'))));
    await ctx.setOffline(true); w.clear();
    await page.evaluate(() => loadTables(["5"])); await settle(page, 300);
    await check(id(), F, "…with no internet the targeted re-read does nothing (the offline bar speaks)", H, () => ok(w.sent("GET", /^\/(summary|state)/).length === 0));
    await ctx.setOffline(false);
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => { seat(w, 5, { orders: [{}] }); seat(w, 6, {}); w.slices["6"].sessions = []; w.summary.merges = [{ parent_table: "5", child_table: "6" }]; });
    await openTable(page, 5); w.clear();
    await page.evaluate(() => loadTables(["6"])); await settle(page, 500);
    const t = w.sent("GET", /^\/summary/).map((r) => r.query.get("table")).join(",");
    await check(id(), F, "…a change on a merged table re-reads its whole party (5 and 6), and the open table's detail with it", H, () => ok(/5/.test(t) && /6/.test(t) && w.sent("GET", /^\/state$/).some((r) => r.query.get("table") === "5"), t));
    await ctx.close();
  }

  // ── a device staff have blocked ────────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene(null, {}, {}, { wait: false });
    w.answer("GET", /^\/summary/, { status: 403, body: { error: "This device has been blocked.", reason: "device_blocked" } });
    await page.evaluate(() => load().catch(() => {}));
    await page.waitForSelector("#lfh-blocked-wall", { timeout: 10000 }).catch(() => {});
    const wall = await page.evaluate(() => { const x = document.getElementById("lfh-blocked-wall"); return x && { txt: x.innerText.replace(/\s+/g, " "), role: x.getAttribute("role"), bg: getComputedStyle(x).backgroundColor }; });
    await check(id(), F, "a device staff have BLOCKED goes completely black: 'This device has been blocked · Ask a manager to unblock it.'", H, () => ok(wall && /This device has been blocked/.test(wall.txt) && /Ask a manager to unblock it\./.test(wall.txt) && wall.bg === "rgb(0, 0, 0)" && wall.role === "alertdialog", JSON.stringify(wall)));
    w.clear();
    const r = await page.evaluate(() => api("GET", "/summary").then(() => "answered", (e) => (e.blocked ? "refused here" : "other")));
    await settle(page, 300);
    await check(id(), F, "…and it stops talking: the next read is refused on the device, never sent", H, () => ok(r === "refused here" && w.log.length === 0, `${r}, ${w.log.length} sent`));
    await page.evaluate(() => { const d = document.createElement("div"); d.id = "lateOverlay"; document.body.appendChild(d); });
    await settle(page, 3500);
    await check(id(), F, "…a screen painted after it is put back BEHIND the wall", H, async () => ok(await page.evaluate(() => document.body.lastElementChild.id === "lfh-blocked-wall")));
    await ctx.close();
  }

  // ── quantity steppers on a placed dish, and Serve all ──────────────────────────────────────
  {
    const { w, ctx, page, items } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing", items: [{ title: "Test Lassi", price: 120, qty: 2, status: "preparing" }] }] }));
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true);
    let release; w.hold = new Promise((r) => { release = r; });
    await page.click(`[data-qty-inc="${items[0].id}"]`); await page.click(`[data-qty-inc="${items[0].id}"]`); await page.click(`[data-qty-inc="${items[0].id}"]`);
    const q = await page.evaluate((iid) => state.data.items.find((x) => x.id === iid).qty, items[0].id);
    w.hold = null; release(); await settle(page, 3500);
    await check(id(), F, "＋ on a placed dish counts up at once — three fast taps make 5, none lost", H, () => ok(q === 5, String(q)));
    const sent = posts(w, /\/qty$/);
    await check(id(), F, "…each tap sends the ABSOLUTE quantity (the last one wins), with what it was edited from", H, () => ok(sent.length >= 1 && sent[sent.length - 1].body.qty === 5 && /"qty"/.test(sent[0].headers["x-lfh-expect"] || ""), sent.map((x) => x.body.qty).join(",")));
    await page.evaluate((iid) => { state.data.items = state.data.items.filter((x) => x.id !== iid); }, items[0].id);
    await clearToastsNow(page); await page.evaluate((iid) => bumpItemQty(iid, 1), items[0].id);
    await check(id(), F, "…a stepper for a dish that has just changed says so (never a silent tap)", H, async () => ok(await waitToast(page, /That dish just changed — refreshing this table\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page, orders } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing" }, { status: "preparing", items: [{ title: "Espresso", price: 120, status: "ready" }] }] }));
    await openTable(page, 5);
    await tap(page, "[data-serve-all]"); await settle(page, 300);
    await check(id(), F, "🍽️ Serve all serves every dish on screen at once", H, async () => ok(await page.evaluate(() => state.data.items.every((i) => i.status === "served"))));
    await settle(page, 400);
    await check(id(), F, "…one serve-all per order goes to the server", H, () => ok(orders.every((o) => posts(w, new RegExp(`^/orders/${o.id}/serve-all`)).length === 1), posts(w, /serve-all/).length + " sent"));
    await page.waitForSelector("#lfh-undobar.show", { timeout: 6000 }).catch(() => {});
    await check(id(), F, "…with a takeback on screen", H, async () => ok(!!(await undoBar(page)), await undoBar(page)));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing" }] }));
    w.answer("POST", /serve-all/, { status: 409, body: { error: "The kitchen already served it." } });
    await openTable(page, 5); await clearToastsNow(page);
    await tap(page, "[data-serve-all]");
    await check(id(), F, "…a refused Serve all says why (and the table is re-read)", H, async () => ok(await waitToast(page, /^Failed: The kitchen already served it\.$/), (await toastsNow(page)).join(" | ")));
    await page.evaluate(() => optimisticServeAll([]));
    await check(id(), F, "…and with nothing left to serve it says so", H, async () => ok(await waitToast(page, /Nothing left to serve here — refreshing this table\./), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── a question already on screen; a PIN retry that then fails; reasons typed ───────────────
  {
    const { w, ctx, page, members } = await scene((w) => seat(w, 5, { orders: [{}], members: [{ name: "Ravi", role: "owner" }, { name: "Meera" }] }));
    await openTable(page, 5);
    const second = await page.evaluate(async () => { const a = confirmDialog("first?", "Yes"); const b = await confirmDialog("second?", "Yes"); const nudged = document.getElementById("confirmOverlay").classList.contains("cf-nudge"); document.getElementById("confirmNo").click(); return { b, a: await a, nudged }; });
    await check(id(), F, "a second question while one is on screen is answered No and the first SHAKES (no stranded tap)", H, () => ok(second.b === false && second.a === false && second.nudged, JSON.stringify(second)));
    w.answer("POST", /\/ban$/, { fn: (r) => r.body && r.body.managerPin ? { status: 409, body: { error: "That guest already left." } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await tap(page, `[data-ban="${members[1].id}"]`); await answerConfirm(page, true); await typePin(page, "2468");
    await check(id(), F, "a PIN that is right but the action then refused says 'Failed:' and why (not 'wrong PIN')", H, async () => ok(await waitToast(page, /^Failed: That guest already left\.$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "preparing" }] }));
    await openTable(page, 5);
    await tap(page, "[data-edit-order]"); await answerConfirm(page, true);
    await page.click('.ordctl-edit .talg[data-slug="nuts"]'); await page.waitForSelector(".alg-why-in");
    await page.fill(".alg-why-in", "Guest's own words: peanut allergy"); await page.press(".alg-why-in", "Enter"); await settle(page, 500);
    await check(id(), F, "a TYPED allergy reason travels with the change", H, () => { const p = posts(w, /\/allergies$/); return ok(p.length === 1 && p[0].body.reason === "Guest's own words: peanut allergy", JSON.stringify(p[0] && p[0].body)); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }), { table_tags_allowed: true, tablet_table_tags: "pin" });
    w.answer("POST", /\/tag$/, { fn: (r) => r.body && r.body.managerPin === "1357" ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await openTable(page, 5); await tap(page, "#tagTable"); await page.waitForSelector(".tag-pick");
    await page.click('.tag-pick[data-tag="vip"]'); await typePin(page, "0000"); await settle(page, 300);
    await page.fill(".pp-in", "1357"); await page.click(".pp-ok");
    await check(id(), F, "a table type on a PIN restaurant: a wrong PIN asks again, the right one marks it", H, async () => ok(await waitToast(page, /^Marked 👑 VIP$/) && posts(w, /\/tag$/).length === 3, (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }));
    w.answer("POST", /\/tip$/, { fn: (r) => r.body && r.body.managerPin ? { status: 200, body: { ok: true } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await openTable(page, 5);
    await page.evaluate(() => { recordTip("5", 40, null); });   // not awaited: it waits for the PIN typed next
    await typePin(page, "2468"); await settle(page, 500);
    await check(id(), F, "a tip that suddenly needs a PIN: entering it records the tip with that PIN", H, () => { const p = posts(w, /\/tip$/); return ok(p.length === 2 && p[1].body.managerPin === "2468" && p[1].body.amount === 40, p.map((x) => JSON.stringify(x.body)).join(" ")); });
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene();
    w.banquet = { items: [{ id: "bq", title: "Veg buffet", price: 450 }] };
    w.answer("POST", /banquet\/place/, { fn: (r) => r.body.managerPin ? { status: 400, body: { error: "Banquets are closed today." } } : { status: 403, body: { error: "A manager PIN is required for this.", needPin: true } } });
    await page.evaluate(() => openBanquet()); await page.waitForSelector("[data-bq-step]");
    await page.click('[data-bq-step="1"]'); await page.click("#bqCreate"); await typePin(page, "2468");
    await check(id(), F, "a banquet bill whose PIN is right but is then refused says 'Couldn't create the bill:' and why", H, async () => ok(await waitToast(page, /^Couldn't create the bill: Banquets are closed today\.$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    w.answer("POST", /\/orders\/[^/]+\/move/, { status: 409, body: { error: "clash_changed_elsewhere", clash: { plain: "Someone moved that ticket a moment ago.", todo: "Your change was NOT saved." } } });
    await openTable(page, 5); await tap(page, "#kotMenuBtn"); await tap(page, '[data-kotop="movekot"]'); await tap(page, "[data-pickorder]"); await tap(page, '[data-moveto="7"]');
    await check(id(), F, "a move refused because another device moved it first says both halves after 'Failed:'", H, async () => ok(await waitToast(page, /^Failed: Someone moved that ticket a moment ago\. Your change was NOT saved\.$/), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }

  // ── a saved order that comes back refused ──────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => seat(w, 3, { orders: [{}] }));
    await openTable(page, 3);
    await ctx.setOffline(true);
    await page.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/tablet", method: "POST", path: "/order", body: { table: "3", items: [{ id: "mint-melon-juice", qty: 1 }] }, panel: "tablet", table: "3" }));
    await ctx.setOffline(false);
    w.answer("POST", /^\/order$/, { status: 400, body: { error: "That dish is sold out." } });
    await page.evaluate(() => window.LFH_OUTBOX.flush && window.LFH_OUTBOX.flush()); await settle(page, 2000);
    await page.evaluate(() => renderPanel());
    const box = await page.evaluate(() => [...document.querySelectorAll("#panel .sec h3")].map((h) => h.closest(".sec").textContent.replace(/\s+/g, " ")).find((x) => /Needs you|Waiting to send/.test(x)) || "");
    await check(id(), F, "a saved order the server later REFUSES turns the box red: '⚠️ Needs you (1)' with the reason", H, () => ok(/Needs you \(1\)/.test(box) && /needs you — /.test(box), box));
    await ctx.close();
  }

  // ── closing the takeback after the table has gone; a section that changes under the waiter ─
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served" }] }));
    w.answer("POST", /^\/tables\/5\/pay$/, { fn: () => { w.slices["5"] = { sessions: [], members: [], calls: [], orders: [], items: [], requests: [] }; delete w.summary.tiles["5"]; return { status: 200, body: { ok: true } }; } });
    await openTable(page, 5); await tap(page, "#payBill"); await page.waitForSelector(".pay-method-btn");
    await page.click(".pay-method-btn[data-method='Cash']");
    await check(id(), F, "if the table is gone by the time the payment lands, the takeback becomes a plain 'Bill paid via Cash'", H, async () => ok(await waitToast(page, /^Bill paid via Cash$/, 8000) && !(await undoBar(page)), (await toastsNow(page)).join(" | ")));
    await ctx.close();
  }
  {
    const { w, ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5);
    w.summary.my_tables = ["1", "2"];
    await page.evaluate(() => load()); await settle(page, 400);
    await check(id(), F, "a table taken out of the waiter's section while it is open closes on their screen", H, async () => ok(await page.evaluate(() => state.table === null && !state.ordering)));
    await ctx.close();
  }

  // ── restaurants built differently ──────────────────────────────────────────────────────────
  {
    const { w, ctx, page } = await scene((w) => { w.summary.restaurant = { ...w.summary.restaurant, logo_text: "", name: { en: "  Little French House  ", hi: "छोटा फ़्रेंच हाउस" } }; });
    const n = await page.evaluate(() => restDisplayName(state.data.restaurant));
    await check(id(), F, "a restaurant whose name is stored per language shows its English name (trimmed)", H, () => ok(n === "Little French House", n));
    const n2 = await page.evaluate(() => restDisplayName({ name: { hi: "छोटा घर" } }) + "|" + restDisplayName({ name: {} }));
    await check(id(), F, "…any language when there is no English, and 'Restaurant' rather than a blank", H, () => ok(n2 === "छोटा घर|Restaurant", n2));
    const r = await page.evaluate(() => { const bd = LFH_BILLDOC.taxModel; LFH_BILLDOC.taxModel = null; const save = state.data.settings; state.data.settings = { ...save, tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }, { label: "", rate: 50 }] }; const a = effRate(); state.data.settings = { ...save, price_tax_mode: "composition" }; const b = effRate(); state.data.settings = save; LFH_BILLDOC.taxModel = bd; return [a, b]; });
    await check(id(), F, "before the shared bill file loads, the rate is still the restaurant's own: CGST + SGST = 5%, composition = 0", H, () => ok(Math.abs(r[0] - 0.05) < 1e-9 && r[1] === 0, JSON.stringify(r)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { seat(w, 45, { orders: [{}] }); });
    const t = await page.evaluate(() => ({ list: floorTableList().slice(-2), tile: !!document.querySelector('.tile[data-t="45"]') }));
    await check(id(), F, "a table numbered beyond the floor plan that still holds an order stays on the floor (its money reachable)", H, () => ok(t.list.includes(45) && t.tile, JSON.stringify(t)));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene();
    const icons = await page.evaluate(() => ["Water please", "Need cutlery", "Napkins", "Clean the table", "Bill please", "Call the waiter", "Hello"].map(callIcon).join(""));
    await check(id(), F, "a waiter call shows WHAT was asked: 💧 🍴 🧻 🧹 🧾 🙋, and 🔔 for anything else", H, () => ok(icons === "💧🍴🧻🧹🧾🙋🔔", icons));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => { const a = seat(w, 5, { orders: [{}] }); a.orders.length = 0; w.slices["5"].orders = []; w.slices["5"].items = []; });
    await openTable(page, 5);
    const t = await page.evaluate(() => { patchTileFromSlice("5"); return state.summary.tiles["5"]; });
    await check(id(), F, "an open table with nobody and nothing on it reads 'Open · waiting for guests'", H, () => ok(t.state === "waiting" && t.label === "Open" && t.meta === "waiting for guests", JSON.stringify(t)));
    await ctx.close();
  }

  // ── the dish list remembers where the waiter was ───────────────────────────────────────────
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{}] }));
    await openTable(page, 5); await tap(page, "#takeOrder"); await page.waitForSelector("#omScroll .om-sec");
    await page.evaluate(() => { const sc = document.getElementById("omScroll"); sc.scrollTop = sc.scrollHeight / 2; sc.dispatchEvent(new Event("scroll")); });
    await settle(page, 400);
    const spy = await page.evaluate(() => ({ on: document.querySelector(".om-nav .om-cat.on")?.dataset.cat, first: document.querySelector(".om-nav .om-cat")?.dataset.cat, top: state._omTop }));
    await check(id(), F, "scrolling the dish list moves the lit category chip with it", H, () => ok(spy.on && spy.on !== spy.first && spy.top > 0, JSON.stringify(spy)));
    await page.fill("#dishSearch", "juice"); await page.fill("#dishSearch", "");
    const back = await page.evaluate(() => Math.abs(document.getElementById("omScroll").scrollTop - state._omTop) < 4);
    await check(id(), F, "…and clearing a search puts the waiter back where they were browsing", H, () => ok(back));
    await ctx.close();
  }
  {
    const { ctx, page } = await scene((w) => seat(w, 5, { orders: [{ status: "served", total: 600 }] }));
    await openTable(page, 5); await tap(page, "#kotMenuBtn"); await tap(page, '[data-kotop="split"]'); await page.waitForSelector(".sb-row");
    await page.fill(".sb-tip .pay-tip-paid", "700");
    const t = await page.evaluate(() => ({ amt: document.querySelector(".sb-tip .pay-tip-amt").value, btn: document.querySelector(".sb-go").textContent }));
    await check(id(), F, "on the split screen 'They paid in all ₹700' on a ₹600 bill makes a ₹100 tip", H, () => ok(t.amt === "100" && /\+ ₹100 tip$/.test(t.btn), JSON.stringify(t)));
    await page.fill(".sb-tip .pay-tip-paid", "500");
    const m = await page.evaluate(() => document.querySelector(".sb-tip .pay-tip-msg").textContent);
    await check(id(), F, "…and less than the bill says that box is the total handed over", H, () => ok(/^That is less than the bill \(₹600\) — this box is the TOTAL they handed over, tip included\.$/.test(m), m));
    await ctx.close();
  }
}
